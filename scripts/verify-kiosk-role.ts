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

function outcome(result: { rows: Record<string, unknown>[] } | { error: string }): string {
  return "error" in result ? `error (${result.error})` : `ok (${result.rows.length} rows)`;
}

function failed(result: { rows: Record<string, unknown>[] } | { error: string }): boolean {
  return "error" in result;
}

// Kiosk PIN RPCs return { error } for a wrong PIN instead of raising (0039).
function pinRejected(result: { rows: Record<string, unknown>[] } | { error: string }): boolean {
  if ("error" in result) return true;
  const r = result.rows[0]?.r as { error?: unknown } | null | undefined;
  return typeof r?.error === "string";
}

async function rowCount(sql: string, params: unknown[] = []): Promise<number | string> {
  const result = await attempt(sql, params);
  if ("error" in result) return `error (${result.error})`;
  return Number(result.rows[0]?.n ?? 0);
}

async function tempUser(orgId: string, role: string): Promise<string> {
  const id = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [id, `kiosk-verify-${id}@example.invalid`]);
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

try {
  await client.query("begin");
  if (migrationPath) {
    await client.query(readFileSync(migrationPath, "utf8"));
    console.log(`loaded ${migrationPath} inside the transaction`);
  }

  const { rows: homes } = await client.query<{ org_id: string; admin_id: string; emp_id: string; position: string }>(
    `select m.org_id, m.user_id as admin_id, e.id as emp_id, e.position
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
       and not exists (select 1 from public.clock_sessions s where s.employee_id = e.id)
     limit 1`,
    [home.org_id],
  );
  const away = aways[0];
  if (!away) throw new Error("Need an active employee in another organization.");

  const homePin = pin();
  const awayPin = pin();
  const exitPin = pin();
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
  const staff = await tempUser(home.org_id, "staff");

  const { rows: drafts } = await client.query<{ id: string }>(
    `insert into public.staff_shifts (org_id, employee_id, position, starts_at, ends_at, status)
     values ($1, $2, $3, '2031-03-03T10:00:00Z', '2031-03-03T12:00:00Z', 'draft') returning id`,
    [home.org_id, home.emp_id, home.position],
  );
  const draftId = drafts[0].id;

  const { rows: tables } = await client.query<{ name: string }>(
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
       and c.relname not in ('memberships', 'organizations')
     order by 1`,
  );

  console.log("-- kiosk login: kiosk RPCs in its own org");
  await asUser(kiosk, async () => {
    const unlock = await attempt("select public.kiosk_unlock_v2($1) as r", [homePin]);
    check(
      "kiosk_unlock finds its org's employee",
      "error" in unlock ? outcome(unlock) : (unlock.rows[0].r as { id: string }).id,
      home.emp_id,
    );
    const punch = await attempt(
      "select public.kiosk_record_clock_event_v2($1, 'clock_in', $2, null)->>'employee_id' as id",
      [homePin, randomUUID()],
    );
    check("kiosk_record_clock_event clocks that employee in", "error" in punch ? outcome(punch) : punch.rows[0].id, home.emp_id);
    const required = await attempt("select public.kiosk_exit_required() as r");
    check("kiosk_exit_required sees the admin exit PIN", "error" in required ? outcome(required) : required.rows[0].r, true);
    check("kiosk_confirm_exit with the admin PIN", outcome(await attempt("select public.kiosk_confirm_exit_v2($1)", [exitPin])), "ok (1 rows)");
    check(
      "kiosk_confirm_exit with a wrong PIN fails",
      pinRejected(await attempt("select public.kiosk_confirm_exit_v2($1) as r", [awayPin])),
      true,
    );
  });

  console.log("-- kiosk login: another org");
  await asUser(kiosk, async () => {
    check("kiosk_unlock with another org's PIN fails", pinRejected(await attempt("select public.kiosk_unlock_v2($1) as r", [awayPin])), true);
    check(
      "kiosk_record_clock_event with another org's PIN fails",
      pinRejected(await attempt("select public.kiosk_record_clock_event_v2($1, 'clock_in', $2, null) as r", [awayPin, randomUUID()])),
      true,
    );
  });

  console.log("-- kiosk login: old RPC names fail closed (0039)");
  await asUser(kiosk, async () => {
    const legacy = "The kiosk was updated. Reload this page.";
    const unlock = await attempt("select public.kiosk_unlock($1)", [homePin]);
    check("kiosk_unlock raises", "error" in unlock ? unlock.error : "ok", legacy);
    const punch = await attempt("select public.kiosk_record_clock_event($1, 'clock_out', $2, null)", [homePin, randomUUID()]);
    check("kiosk_record_clock_event raises", "error" in punch ? punch.error : "ok", legacy);
    const exit = await attempt("select public.kiosk_confirm_exit($1)", [exitPin]);
    check("kiosk_confirm_exit raises", "error" in exit ? exit.error : "ok", legacy);
  });

  console.log("-- kiosk login: reads");
  await asUser(kiosk, async () => {
    check("organizations visible (own org only)", await rowCount("select count(*) as n from public.organizations"), 1);
    check(
      "the visible organization is its own",
      await rowCount("select count(*) as n from public.organizations where id = $1", [home.org_id]),
      1,
    );
    check("memberships visible (own row only)", await rowCount("select count(*) as n from public.memberships"), 1);
    for (const { name } of tables) {
      const n = await rowCount(`select count(*) as n from public.${name}`);
      check(`no rows readable in ${name}`, typeof n === "string" ? 0 : n, 0);
    }
    check("list_whos_working returns nothing", await rowCount("select count(*) as n from public.list_whos_working()"), 0);
    check(
      "kiosk_employee_for_pin is not directly callable",
      failed(await attempt("select public.kiosk_employee_for_pin($1)", [homePin])),
      true,
    );
  });

  console.log("-- kiosk login: manager and admin RPCs and writes");
  await asUser(kiosk, async () => {
    const published = await attempt("select public.publish_shifts($1::uuid[], null) as n", [[draftId]]);
    check("publish_shifts writes nothing", "error" in published ? 0 : Number(published.rows[0].n), 0);
    check(
      "manager_record_punch fails",
      failed(
        await attempt("select public.manager_record_punch($1, 'clock_in', now(), 'verify', $2)", [home.emp_id, randomUUID()]),
      ),
      true,
    );
    check(
      "set_employee_clock_pin fails",
      failed(await attempt("select public.set_employee_clock_pin($1, $2)", [home.emp_id, pin()])),
      true,
    );
    check(
      "update_org_clock_settings fails",
      failed(
        await attempt("select public.update_org_clock_settings('UTC', 0::smallint, '00:00'::time, false, true)"),
      ),
      true,
    );
    check("record_clock_event (self punch) fails", failed(await attempt("select public.record_clock_event('clock_in', $1)", [randomUUID()])), true);
    const renamed = await attempt("update public.organizations set name = name where id = $1 returning id", [home.org_id]);
    check("cannot update its organization", "error" in renamed ? 0 : renamed.rows.length, 0);
    const promoted = await attempt("update public.memberships set role = 'admin' where user_id = $1 returning user_id", [kiosk]);
    check("cannot change its own role", "error" in promoted ? 0 : promoted.rows.length, 0);
    const inserted = await attempt(
      "insert into public.employees (org_id, full_name, position) values ($1, 'Kiosk verify', 'Other') returning id",
      [home.org_id],
    );
    check("cannot insert employees", failed(inserted), true);
  });
  const status = (await client.query<{ status: string }>("select status from public.staff_shifts where id = $1", [draftId])).rows[0].status;
  check("draft stays draft", status, "draft");

  console.log("-- kiosk membership cannot be turned into something else");
  check(
    "linking an employee to the kiosk login fails",
    failed(await attempt("update public.employees set user_id = $1 where id = $2", [kiosk, home.emp_id])),
    true,
  );
  check(
    "employees.login_role 'kiosk' is rejected",
    failed(await attempt("update public.employees set login_role = 'kiosk' where id = $1", [home.emp_id])),
    true,
  );
  const kioskRole = (await client.query<{ role: string }>("select role from public.memberships where user_id = $1", [kiosk])).rows[0].role;
  check("kiosk membership role unchanged", kioskRole, "kiosk");
  check(
    "kiosk login cannot gain a second membership",
    failed(await attempt("insert into public.memberships (user_id, org_id, role) values ($1, $2, 'admin')", [kiosk, away.org_id])),
    true,
  );
  check(
    "a login with another membership cannot become kiosk",
    failed(await attempt("insert into public.memberships (user_id, org_id, role) values ($1, $2, 'kiosk')", [home.admin_id, away.org_id])),
    true,
  );
  await client.query("update public.employees set user_id = $1 where id = $2", [staff, home.emp_id]);
  check(
    "a staff login linked to an employee cannot be turned into kiosk",
    failed(await attempt("update public.memberships set role = 'kiosk' where user_id = $1 and org_id = $2", [staff, home.org_id])),
    true,
  );
  await client.query("update public.employees set user_id = null where id = $1", [home.emp_id]);

  console.log("-- other roles unchanged");
  await asUser(home.admin_id, async () => {
    const n = await rowCount("select count(*) as n from public.employees where org_id = $1", [home.org_id]);
    check("admin reads employees", typeof n === "number" && n > 0, true);
    const s = await rowCount("select count(*) as n from public.staff_shifts where id = $1", [draftId]);
    check("admin reads the draft shift", s, 1);
    check("admin reads its organization", await rowCount("select count(*) as n from public.organizations where id = $1", [home.org_id]), 1);
    // 0043: only a kiosk login runs the kiosk.
    const unlock = await attempt("select public.kiosk_unlock_v2($1) as r", [homePin]);
    check("admin kiosk_unlock is refused", "error" in unlock ? unlock.error : "ran", "Not authorized");
  });
  await asUser(staff, async () => {
    // 0040: staff read only their own employee row; this staff login has none.
    check(
      "staff without an employee row reads no employees",
      await rowCount("select count(*) as n from public.employees where org_id = $1", [home.org_id]),
      0,
    );
    check("staff does not see the draft shift", await rowCount("select count(*) as n from public.staff_shifts where id = $1", [draftId]), 0);
    check("staff reads its organization", await rowCount("select count(*) as n from public.organizations where id = $1", [home.org_id]), 1);
    const unlock = await attempt("select public.kiosk_unlock_v2($1)", [homePin]);
    check("staff kiosk_unlock still not authorized", "error" in unlock ? unlock.error : "ok", "Not authorized");
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
