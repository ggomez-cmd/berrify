import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import { createPgClient } from "./pg.ts";

dotenv.config();

const migrationFlag = process.argv.indexOf("--migration");
const migrationPath = migrationFlag >= 0 ? process.argv[migrationFlag + 1] : null;

const client = createPgClient();
await client.connect();
const failures: string[] = [];

function check(name: string, got: unknown, want: unknown) {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}: got ${String(got)}, expected ${String(want)}`);
  if (!ok) failures.push(name);
}

async function asUser<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("set local role authenticated");
  try {
    return await fn();
  } finally {
    await client.query("reset role");
  }
}

// Runs one statement; returns its rows, or the error message if it failed.
// A failed statement is rolled back to the savepoint, so anything it wrote is lost.
async function attempt(sql: string, params: unknown[] = []): Promise<{ rows: Record<string, unknown>[] } | { error: string }> {
  await client.query("savepoint probe");
  try {
    const { rows } = await client.query(sql, params);
    await client.query("release savepoint probe");
    return { rows };
  } catch (err) {
    await client.query("rollback to savepoint probe");
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// What a kiosk RPC told the caller: the raised error, the returned { error }, or "ok".
async function pinCall(sql: string, params: unknown[] = []): Promise<string> {
  const result = await attempt(sql, params);
  if ("error" in result) return result.error;
  const r = result.rows[0]?.r as { error?: string } | null | undefined;
  return r && typeof r.error === "string" ? r.error : "ok";
}

const unlock = (pin: string) => pinCall("select public.kiosk_unlock_v2($1) as r", [pin]);
const punch = (pin: string, event: string) =>
  pinCall("select public.kiosk_record_clock_event_v2($1, $2, $3, null) as r", [pin, event, randomUUID()]);
const confirmExit = (pin: string) => pinCall("select public.kiosk_confirm_exit_v2($1) as r", [pin]);

// Reads as the connection owner, then goes back to the impersonated role if any.
async function failureCount(userId: string): Promise<number> {
  const { rows: roles } = await client.query<{ r: string }>("select current_user as r");
  await client.query("reset role");
  try {
    const { rows } = await client.query<{ n: string }>(
      "select count(*) as n from public.kiosk_pin_failures where user_id = $1",
      [userId],
    );
    return Number(rows[0].n);
  } finally {
    if (roles[0].r === "authenticated") await client.query("set local role authenticated");
  }
}

async function eventCount(employeeId: string): Promise<number> {
  const { rows } = await client.query<{ n: string }>("select count(*) as n from public.clock_events where employee_id = $1", [
    employeeId,
  ]);
  return Number(rows[0].n);
}

async function backdate(userId: string, by: string) {
  await client.query("update public.kiosk_pin_failures set failed_at = failed_at - $2::interval where user_id = $1", [
    userId,
    by,
  ]);
}

async function tempUser(orgId: string, role: string): Promise<string> {
  const id = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [id, `kiosk-pin-verify-${id}@example.invalid`]);
  // handle_new_user bootstraps a personal org; replace it with the membership under test.
  const { rows } = await client.query<{ org_id: string }>(
    "delete from public.memberships where user_id = $1 returning org_id",
    [id],
  );
  for (const row of rows) await client.query("delete from public.organizations where id = $1", [row.org_id]);
  await client.query("insert into public.memberships (user_id, org_id, role) values ($1, $2, $3)", [id, orgId, role]);
  return id;
}

function pin(): string {
  return String(10_000_000 + Math.floor(Math.random() * 89_999_999));
}

const LOCKED = "Too many wrong PINs. Try again in 10 minutes.";

try {
  await client.query("begin");
  if (migrationPath) {
    await client.query(readFileSync(migrationPath, "utf8"));
    console.log(`loaded ${migrationPath} inside the transaction`);
  }

  const { rows: homes } = await client.query<{ org_id: string; admin_id: string; emp_id: string }>(
    `select m.org_id, m.user_id as admin_id, e.id as emp_id
     from public.memberships m
     join public.employees e on e.org_id = m.org_id and e.active
     where m.role = 'admin'
       and not exists (select 1 from public.clock_sessions s where s.employee_id = e.id)
     limit 1`,
  );
  const home = homes[0];
  if (!home) throw new Error("Need an admin in an org with an active employee who is off the clock.");
  const { rows: aways } = await client.query<{ org_id: string; emp_id: string }>(
    `select e.org_id, e.id as emp_id from public.employees e
     where e.org_id <> $1 and e.active
     limit 1`,
    [home.org_id],
  );
  const away = aways[0];
  if (!away) throw new Error("Need an active employee in another organization.");

  const homePin = pin();
  const awayPin = pin();
  const exitPin = pin();
  const wrongPin = "00000000";
  await client.query(
    "update public.employees set clock_pin_hash = extensions.crypt($1, extensions.gen_salt('bf')) where id = $2",
    [homePin, home.emp_id],
  );
  await client.query(
    "update public.employees set clock_pin_hash = extensions.crypt($1, extensions.gen_salt('bf')) where id = $2",
    [awayPin, away.emp_id],
  );
  await client.query(
    "update public.memberships set kiosk_exit_pin_hash = extensions.crypt($1, extensions.gen_salt('bf')) where user_id = $2 and org_id = $3",
    [exitPin, home.admin_id, home.org_id],
  );

  const kiosk = await tempUser(home.org_id, "kiosk");
  const kiosk2 = await tempUser(home.org_id, "kiosk");
  const awayKiosk = await tempUser(away.org_id, "kiosk");
  const manager = await tempUser(home.org_id, "manager");

  console.log("-- table is locked down");
  const { rows: meta } = await client.query<{ rls: boolean; cols: string }>(
    `select c.relrowsecurity as rls,
            (select string_agg(a.attname, ',' order by a.attnum) from pg_attribute a
             where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) as cols
     from pg_class c where c.oid = 'public.kiosk_pin_failures'::regclass`,
  );
  check("RLS enabled on kiosk_pin_failures", meta[0].rls, true);
  check("kiosk_pin_failures stores no PIN", meta[0].cols, "id,user_id,check_kind,failed_at");
  for (const role of ["authenticated", "anon"]) {
    const { rows } = await client.query<{ any: boolean }>(
      `select has_table_privilege($1, 'public.kiosk_pin_failures', 'select')
           or has_table_privilege($1, 'public.kiosk_pin_failures', 'insert')
           or has_table_privilege($1, 'public.kiosk_pin_failures', 'update')
           or has_table_privilege($1, 'public.kiosk_pin_failures', 'delete') as any`,
      [role],
    );
    check(`${role} has no table privileges`, rows[0].any, false);
  }
  await asUser(kiosk, async () => {
    check("kiosk cannot read kiosk_pin_failures", "error" in (await attempt("select * from public.kiosk_pin_failures")), true);
    check(
      "kiosk cannot write kiosk_pin_failures",
      "error" in
        (await attempt("insert into public.kiosk_pin_failures (user_id, check_kind) values ($1, 'unlock')", [kiosk])),
      true,
    );
    for (const fn of [
      "public.kiosk_assert_pin_budget()",
      "public.kiosk_record_pin_failure('unlock')",
      `public.kiosk_employee_for_pin('${homePin}', 'unlock')`,
    ]) {
      check(`${fn} is not directly callable`, "error" in (await attempt(`select ${fn}`)), true);
    }
  });

  console.log("-- correct PIN under the limit");
  await asUser(kiosk, async () => {
    check("kiosk_unlock with the right PIN", await unlock(homePin), "ok");
    check("kiosk_record_clock_event clocks in", await punch(homePin, "clock_in"), "ok");
    check("kiosk_confirm_exit with the admin PIN", await confirmExit(exitPin), "ok");
  });
  check("no failures recorded for correct PINs", await failureCount(kiosk), 0);
  const punched = await client.query<{ n: string }>(
    "select count(*) as n from public.clock_events where employee_id = $1 and source = 'kiosk' and event_type = 'clock_in'",
    [home.emp_id],
  );
  check("the punch was saved", Number(punched.rows[0].n) >= 1, true);

  console.log("-- wrong PINs are recorded and survive each call; a correct PIN does not reset them");
  await asUser(kiosk, async () => {
    for (let i = 1; i <= 3; i += 1) {
      check(`wrong unlock #${i} says Invalid PIN`, await unlock(wrongPin), "Invalid PIN");
      check(`failure #${i} persisted`, await failureCount(kiosk), i);
    }
    check("correct PIN still unlocks under the limit", await unlock(homePin), "ok");
    check("correct PIN left the 3 failures in place", await failureCount(kiosk), 3);
    check("wrong punch PIN says Invalid PIN", await punch(wrongPin, "clock_out"), "Invalid PIN");
    check("punch failure counted", await failureCount(kiosk), 4);
    check("wrong exit PIN (5th wrong PIN) says Invalid PIN", await confirmExit(awayPin), "Invalid PIN");
    check("exit failure counted", await failureCount(kiosk), 5);
  });
  const kinds = await client.query<{ k: string }>(
    "select string_agg(check_kind, ',' order by check_kind) as k from public.kiosk_pin_failures where user_id = $1",
    [kiosk],
  );
  check("failures recorded by check", kinds.rows[0].k, "exit,punch,unlock,unlock,unlock");

  console.log("-- locked out after the limit, even with correct PINs");
  await asUser(kiosk, async () => {
    check("unlock with the correct PIN is locked", await unlock(homePin), LOCKED);
    check("punch with the correct PIN is locked", await punch(homePin, "clock_out"), LOCKED);
    check("exit with the correct PIN is locked", await confirmExit(exitPin), LOCKED);
    check("wrong PIN while locked is locked", await unlock(wrongPin), LOCKED);
  });
  check("locked attempts are not recorded", await failureCount(kiosk), 5);
  const stillIn = await client.query<{ state: string }>(
    "select state from public.clock_sessions where employee_id = $1",
    [home.emp_id],
  );
  check("locked punch did not clock out", stillIn.rows[0]?.state !== undefined, true);

  console.log("-- other logins and orgs are independent");
  await asUser(kiosk2, async () => {
    check("another kiosk login in the same org unlocks", await unlock(homePin), "ok");
    check("its wrong PIN says Invalid PIN", await unlock(wrongPin), "Invalid PIN");
  });
  check("second login has its own count", await failureCount(kiosk2), 1);
  await asUser(awayKiosk, async () => {
    check("kiosk in another org unlocks its employee", await unlock(awayPin), "ok");
    check("kiosk in another org: wrong PIN says Invalid PIN", await unlock(wrongPin), "Invalid PIN");
  });
  check("other org's login has its own count", await failureCount(awayKiosk), 1);
  check("first login still at 5", await failureCount(kiosk), 5);

  console.log("-- manager logins cannot run the kiosk (0043)");
  await asUser(manager, async () => {
    check("manager unlock, right PIN", await unlock(homePin), "Not authorized");
    check("manager unlock, wrong PIN", await unlock(wrongPin), "Not authorized");
    check("manager punch", await punch(homePin, "clock_in"), "Not authorized");
    check("manager exit", await confirmExit(exitPin), "Not authorized");
  });
  check("manager refusals are not counted", await failureCount(manager), 0);

  console.log("-- the window passes");
  await backdate(kiosk, "3 minutes");
  await asUser(kiosk, async () => {
    check("countdown shows the minutes left", await unlock(homePin), "Too many wrong PINs. Try again in 7 minutes.");
  });
  await client.query(
    `update public.kiosk_pin_failures set failed_at = now() - interval '11 minutes'
     where id = (select id from public.kiosk_pin_failures where user_id = $1 order by failed_at, id limit 1)`,
    [kiosk],
  );
  await asUser(kiosk, async () => {
    check("one failure aging out drops below the limit", await unlock(homePin), "ok");
    check("next wrong PIN locks again", await unlock(wrongPin), "Invalid PIN");
    check("back at the limit", await unlock(homePin), "Too many wrong PINs. Try again in 7 minutes.");
  });
  await backdate(kiosk, "11 minutes");
  await asUser(kiosk, async () => {
    check("after the window, correct PIN unlocks", await unlock(homePin), "ok");
    check("after the window, correct PIN punches", await punch(homePin, "clock_out"), "ok");
    check("after the window, exit PIN works", await confirmExit(exitPin), "ok");
  });

  console.log("-- other errors still raise and are not counted");
  await asUser(kiosk2, async () => {
    check("bad PIN format raises", await unlock("12"), "PIN must be 4 to 8 digits");
  });
  check("format error not counted", await failureCount(kiosk2), 1);

  console.log("-- old RPC names fail closed without checking the PIN");
  const legacy = "The kiosk was updated. Reload this page.";
  const legacyUser = await tempUser(home.org_id, "kiosk");
  const eventsBeforeLegacy = await eventCount(home.emp_id);
  await asUser(legacyUser, async () => {
    for (const pinValue of [homePin, wrongPin]) {
      check(`kiosk_unlock(${pinValue === homePin ? "right" : "wrong"} PIN) raises`, await pinCall("select public.kiosk_unlock($1) as r", [pinValue]), legacy);
      check(
        `kiosk_record_clock_event(${pinValue === homePin ? "right" : "wrong"} PIN) raises`,
        await pinCall("select (public.kiosk_record_clock_event($1, 'clock_out', $2, null)).id as r", [pinValue, randomUUID()]),
        legacy,
      );
    }
    check("kiosk_confirm_exit(right PIN) raises", await pinCall("select public.kiosk_confirm_exit($1) as r", [exitPin]), legacy);
    check("kiosk_confirm_exit(wrong PIN) raises", await pinCall("select public.kiosk_confirm_exit($1) as r", [wrongPin]), legacy);
  });
  check("old names record no failures", await failureCount(legacyUser), 0);
  check("old punch name wrote no clock event", await eventCount(home.emp_id), eventsBeforeLegacy);

  console.log("-- managers cannot read PIN hashes");
  await asUser(manager, async () => {
    const listed = await attempt("select * from public.list_employees_full() where id = $1", [home.emp_id]);
    check("manager still lists the employee", "error" in listed ? listed.error : listed.rows.length, 1);
    const columns = "error" in listed ? [] : Object.keys(listed.rows[0] ?? {});
    check("list_employees_full has no clock_pin_hash", columns.includes("clock_pin_hash"), false);
    check("list_employees_full keeps invite_code for invites", columns.includes("invite_code"), true);
    check(
      "list_employees_full clock_pin_hash column does not exist",
      "error" in (await attempt("select clock_pin_hash from public.list_employees_full()")),
      true,
    );
    const rowJson = await attempt("select bool_or(to_jsonb(l) ? 'clock_pin_hash') as has from public.list_employees_full() l");
    check("no listed row carries clock_pin_hash", "error" in rowJson ? rowJson.error : rowJson.rows[0].has, false);
    check(
      "direct select of employees.clock_pin_hash denied",
      "error" in (await attempt("select clock_pin_hash from public.employees where id = $1", [home.emp_id])),
      true,
    );
    check(
      "whole-row select of employees denied",
      "error" in (await attempt("select to_jsonb(e) from public.employees e where id = $1", [home.emp_id])),
      true,
    );
    check(
      "filtering employees on clock_pin_hash denied",
      "error" in (await attempt("select id from public.employees where clock_pin_hash is not null")),
      true,
    );
    check(
      "direct select of memberships.kiosk_exit_pin_hash denied",
      "error" in (await attempt("select kiosk_exit_pin_hash from public.memberships")),
      true,
    );
  });
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
