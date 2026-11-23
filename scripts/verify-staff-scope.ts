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

async function rowCount(sql: string, params: unknown[] = []): Promise<number | string> {
  const result = await attempt(sql, params);
  if ("error" in result) return `error (${result.error})`;
  return Number(result.rows[0]?.n ?? 0);
}

// Sorted, comma-joined values of one column, or the error.
async function column(sql: string, params: unknown[] = []): Promise<string> {
  const result = await attempt(sql, params);
  if ("error" in result) return `error (${result.error})`;
  return result.rows
    .map((r) => String(Object.values(r)[0]))
    .sort()
    .join(",");
}

async function tempUser(orgId: string, role: string): Promise<string> {
  const id = randomUUID();
  await client.query("insert into auth.users (id, email) values ($1, $2)", [id, `staff-scope-verify-${id}@example.invalid`]);
  // handle_new_user bootstraps a personal org; replace it with the membership under test.
  const { rows } = await client.query<{ org_id: string }>(
    "delete from public.memberships where user_id = $1 returning org_id",
    [id],
  );
  for (const row of rows) await client.query("delete from public.organizations where id = $1", [row.org_id]);
  await client.query("insert into public.memberships (user_id, org_id, role) values ($1, $2, $3)", [id, orgId, role]);
  return id;
}

async function one<T>(sql: string, params: unknown[]): Promise<T> {
  const { rows } = await client.query(sql, params);
  return rows[0] as T;
}

async function org(name: string): Promise<string> {
  return (await one<{ id: string }>("insert into public.organizations (name) values ($1) returning id", [name])).id;
}

async function restaurant(orgId: string, name: string): Promise<string> {
  return (
    await one<{ id: string }>(
      "insert into public.restaurants (org_id, name, qbo_company_name, slug) values ($1, $2, $2, $3) returning id",
      [orgId, name, `verify-${randomUUID()}`],
    )
  ).id;
}

async function employee(orgId: string, name: string, home: string | null, userId: string | null = null): Promise<string> {
  return (
    await one<{ id: string }>(
      `insert into public.employees (org_id, full_name, position, home_restaurant_id, user_id)
       values ($1, $2, 'Server', $3, $4) returning id`,
      [orgId, name, home, userId],
    )
  ).id;
}

async function shift(
  orgId: string,
  employeeId: string | null,
  restaurantId: string | null,
  day: number,
  status: "published" | "draft" = "published",
): Promise<string> {
  const starts = `2031-03-${String(3 + day).padStart(2, "0")}T14:00:00Z`;
  const ends = `2031-03-${String(3 + day).padStart(2, "0")}T20:00:00Z`;
  return (
    await one<{ id: string }>(
      `insert into public.staff_shifts (org_id, employee_id, restaurant_id, position, starts_at, ends_at, status)
       values ($1, $2, $3, 'Server', $4, $5, $6) returning id`,
      [orgId, employeeId, restaurantId, starts, ends, status],
    )
  ).id;
}

const FROM = "2031-03-02T00:00:00Z";
const TO = "2031-03-12T00:00:00Z";

try {
  await client.query("begin");
  // Existing admin and manager logins: what they read before and after the migration.
  const { rows: leads } = await client.query<{ user_id: string; role: string }>(
    "select distinct user_id, role from public.memberships where role in ('admin', 'manager') order by 1",
  );
  const readsOf = async (userId: string) =>
    asUser(userId, async () =>
      [
        await rowCount("select count(*) as n from public.employees"),
        await rowCount("select count(*) as n from public.staff_shifts"),
        await rowCount("select count(*) as n from public.list_whos_working()"),
      ].join("/"),
    );
  const before = new Map<string, string>();
  for (const lead of leads) before.set(lead.user_id, await readsOf(lead.user_id));
  if (migrationPath) {
    await client.query(readFileSync(migrationPath, "utf8"));
    console.log(`loaded ${migrationPath} inside the transaction`);
  }
  console.log("-- existing admin and manager logins (employees/shifts/whos_working)");
  for (const lead of leads) {
    check(`${lead.role} ${lead.user_id.slice(0, 8)} reads the same rows`, await readsOf(lead.user_id), before.get(lead.user_id));
  }

  const home = await org("Staff scope verify");
  const away = await org("Staff scope verify (other org)");
  const resA = await restaurant(home, "Verify A");
  const resB = await restaurant(home, "Verify B");
  const resAway = await restaurant(away, "Verify away");

  const s1 = await tempUser(home, "staff");
  const s2 = await tempUser(home, "staff");
  const s0 = await tempUser(home, "staff");
  const manager = await tempUser(home, "manager");
  const admin = await tempUser(home, "admin");
  const kiosk = await tempUser(home, "kiosk");
  const awayStaff = await tempUser(away, "staff");

  const e1 = await employee(home, "Verify E1", resA, s1);
  const e2 = await employee(home, "Verify E2", resA);
  const e3 = await employee(home, "Verify E3", resB);
  const e4 = await employee(home, "Verify E4 no home", null, s2);
  const eAway = await employee(away, "Verify away", resAway, awayStaff);

  const shE2A = await shift(home, e2, resA, 0);
  const shE3B = await shift(home, e3, resB, 0);
  const shE1B = await shift(home, e1, resB, 0);
  const shE2Null = await shift(home, e2, null, 1);
  const shDraftA = await shift(home, e2, resA, 2, "draft");
  const shOpenA = await shift(home, null, resA, 3);
  const shE1Null = await shift(home, e1, null, 4);
  const shE4A = await shift(home, e4, resA, 5);
  const shAway = await shift(away, eAway, resAway, 0);

  const allHomeEmployees = 4;
  const allHomeShifts = 8;

  console.log("-- staff S1 (employee E1, home A)");
  await asUser(s1, async () => {
    check("employees readable: own row only", await column("select id from public.employees"), e1);
    check(
      "own row keeps the granted columns",
      await column("select full_name || '|' || coalesce(home_restaurant_id::text, '') from public.employees"),
      `Verify E1|${resA}`,
    );
    check("list_employees_full returns nothing", await rowCount("select count(*) as n from public.list_employees_full()"), 0);
    const visible = [shE2A, shE1B, shOpenA, shE1Null, shE4A].sort().join(",");
    check("shifts readable: home A published + own anywhere", await column("select id from public.staff_shifts"), visible);
    check("sees E2 at A", await rowCount("select count(*) as n from public.staff_shifts where id = $1", [shE2A]), 1);
    check("sees own cover at B", await rowCount("select count(*) as n from public.staff_shifts where id = $1", [shE1B]), 1);
    check("sees own shift with no restaurant", await rowCount("select count(*) as n from public.staff_shifts where id = $1", [shE1Null]), 1);
    check("does not see E3 at B", await rowCount("select count(*) as n from public.staff_shifts where id = $1", [shE3B]), 0);
    check(
      "does not see E2 with no restaurant",
      await rowCount("select count(*) as n from public.staff_shifts where id = $1", [shE2Null]),
      0,
    );
    check("does not see the draft at A", await rowCount("select count(*) as n from public.staff_shifts where id = $1", [shDraftA]), 0);
    check("does not see the other org's shift", await rowCount("select count(*) as n from public.staff_shifts where id = $1", [shAway]), 0);
    check(
      "embedded employee names are hidden for coworkers",
      await column("select coalesce(e.full_name, 'hidden') from public.staff_shifts s left join public.employees e on e.id = s.employee_id where s.id = $1", [shE2A]),
      "hidden",
    );
    check(
      "list_shift_coworkers returns self and visible coworkers (E1, E2, E4), not E3",
      await column("select employee_id from public.list_shift_coworkers($1, $2)", [FROM, TO]),
      [e1, e2, e4].sort().join(","),
    );
    check(
      "list_shift_coworkers names",
      await column("select full_name from public.list_shift_coworkers($1, $2)", [FROM, TO]),
      "Verify E1,Verify E2,Verify E4 no home",
    );
    check(
      "list_shift_coworkers respects the range",
      await column("select full_name from public.list_shift_coworkers($1, $2)", [FROM, "2031-03-04T00:00:00Z"]),
      "Verify E1,Verify E2",
    );
    check(
      "list_shift_coworkers columns",
      await column("select pg_get_function_result('public.list_shift_coworkers(timestamptz, timestamptz)'::regprocedure)"),
      "TABLE(employee_id uuid, full_name text)",
    );
    check("cannot insert a shift", "error" in (await attempt(
      "insert into public.staff_shifts (org_id, employee_id, restaurant_id, starts_at, ends_at, status) values ($1, $2, $3, '2031-03-03T10:00:00Z', '2031-03-03T11:00:00Z', 'published')",
      [home, e1, resA],
    )), true);
  });

  console.log("-- staff S2 (employee E4, no home restaurant)");
  await asUser(s2, async () => {
    check("employees readable: own row only", await column("select id from public.employees"), e4);
    check("shifts readable: own only", await column("select id from public.staff_shifts"), shE4A);
    check(
      "list_shift_coworkers returns self only",
      await column("select employee_id from public.list_shift_coworkers($1, $2)", [FROM, TO]),
      e4,
    );
  });

  console.log("-- staff S0 (no employee row)");
  await asUser(s0, async () => {
    check("no employees readable", await rowCount("select count(*) as n from public.employees"), 0);
    check("no shifts readable", await rowCount("select count(*) as n from public.staff_shifts"), 0);
    check("list_shift_coworkers returns nothing", await rowCount("select count(*) as n from public.list_shift_coworkers($1, $2)", [FROM, TO]), 0);
    check("restaurants still readable", await rowCount("select count(*) as n from public.restaurants where org_id = $1", [home]), 2);
    check("organization still readable", await rowCount("select count(*) as n from public.organizations where id = $1", [home]), 1);
  });

  console.log("-- other org staff");
  await asUser(awayStaff, async () => {
    check("employees readable: own row only", await column("select id from public.employees"), eAway);
    check("shifts readable: own org only", await column("select id from public.staff_shifts"), shAway);
    check(
      "list_shift_coworkers returns only its own org",
      await column("select employee_id from public.list_shift_coworkers($1, $2)", [FROM, TO]),
      eAway,
    );
  });

  console.log("-- who's working");
  await asUser(manager, async () => {
    const punchE1 = await attempt("select public.manager_record_punch($1, 'clock_in', now(), 'verify', $2)", [e1, randomUUID()]);
    check("manager clocks E1 in", "error" in punchE1 ? punchE1.error : "ok", "ok");
    const punch = await attempt("select public.manager_record_punch($1, 'clock_in', now(), 'verify', $2)", [e2, randomUUID()]);
    check("manager clocks E2 in", "error" in punch ? punch.error : "ok", "ok");
    check(
      "manager list_whos_working sees E1 and E2",
      await column("select employee_id from public.list_whos_working() where org_id = $1", [home]),
      [e1, e2].sort().join(","),
    );
  });
  await asUser(s1, async () => {
    check("S1 list_whos_working: own row only", await column("select employee_id from public.list_whos_working()"), e1);
    check(
      "S1 list_whos_working hides clocked_in_at",
      await column("select coalesce(clocked_in_at::text, 'null') from public.list_whos_working()"),
      "null",
    );
  });
  await asUser(s0, async () => {
    check("S0 list_whos_working returns nothing", await rowCount("select count(*) as n from public.list_whos_working()"), 0);
  });

  console.log("-- manager and admin unchanged");
  for (const [label, userId] of [
    ["manager", manager],
    ["admin", admin],
  ] as const) {
    await asUser(userId, async () => {
      check(`${label} reads every employee`, await rowCount("select count(*) as n from public.employees where org_id = $1", [home]), allHomeEmployees);
      check(`${label} reads every shift incl. draft`, await rowCount("select count(*) as n from public.staff_shifts where org_id = $1", [home]), allHomeShifts);
      check(`${label} reads the draft`, await rowCount("select count(*) as n from public.staff_shifts where id = $1", [shDraftA]), 1);
      check(`${label} reads E3 at B`, await rowCount("select count(*) as n from public.staff_shifts where id = $1", [shE3B]), 1);
      check(
        `${label} list_employees_full`,
        await rowCount("select count(*) as n from public.list_employees_full() where org_id = $1", [home]),
        allHomeEmployees,
      );
      check(`${label} sees no other org employees`, await rowCount("select count(*) as n from public.employees where org_id = $1", [away]), 0);
      check(`${label} sees no other org shifts`, await rowCount("select count(*) as n from public.staff_shifts where org_id = $1", [away]), 0);
      check(
        `${label} list_shift_coworkers`,
        await column("select full_name from public.list_shift_coworkers($1, $2)", [FROM, TO]),
        "Verify E1,Verify E2,Verify E3,Verify E4 no home",
      );
    });
  }

  console.log("-- kiosk login");
  await asUser(kiosk, async () => {
    check("no employees readable", await rowCount("select count(*) as n from public.employees"), 0);
    check("no shifts readable", await rowCount("select count(*) as n from public.staff_shifts"), 0);
    check("list_shift_coworkers returns nothing", await rowCount("select count(*) as n from public.list_shift_coworkers($1, $2)", [FROM, TO]), 0);
    check("list_whos_working returns nothing", await rowCount("select count(*) as n from public.list_whos_working()"), 0);
  });

  console.log("-- punches only at the kiosk (0042)");
  const s3 = await tempUser(home, "staff");
  await employee(home, "Verify E5 punch", resA, s3);
  for (const [label, userId] of [
    ["linked staff", s3],
    ["manager", manager],
    ["admin", admin],
  ] as const) {
    await asUser(userId, async () => {
      const punch = await attempt("select public.record_clock_event('clock_in', $1)", [randomUUID()]);
      check(`${label} self punch is refused`, "error" in punch ? punch.error : "ok", "Clock in and out at the kiosk.");
    });
  }

  console.log("-- kiosk PIN functions");
  const pin = () => String(10_000_000 + Math.floor(Math.random() * 89_999_999));
  const e2Pin = pin();
  const e3Pin = pin();
  const exitPin = pin();
  const wrongPin = pin();
  await client.query(
    "update public.employees set clock_pin_hash = extensions.crypt($1, extensions.gen_salt('bf')) where id = $2",
    [e2Pin, e2],
  );
  await client.query(
    "update public.employees set clock_pin_hash = extensions.crypt($1, extensions.gen_salt('bf')) where id = $2",
    [e3Pin, e3],
  );
  await client.query(
    "update public.memberships set kiosk_exit_pin_hash = extensions.crypt($1, extensions.gen_salt('bf')) where user_id = $2 and org_id = $3",
    [exitPin, admin, home],
  );
  const failuresOf = async (userId: string) =>
    Number((await client.query("select count(*) as n from public.kiosk_pin_failures where user_id = $1", [userId])).rows[0].n);
  const answer = (r: { rows: Record<string, unknown>[] } | { error: string }) => {
    if ("error" in r) return `raise: ${r.error}`;
    const v = r.rows[0]?.r as Record<string, unknown> | boolean | null;
    if (v && typeof v === "object") {
      if (typeof v.error === "string") return `error: ${v.error}`;
      if (typeof v.employee_id === "string") return `employee: ${v.employee_id}`;
      if (typeof v.id === "string") return `id: ${v.id}`;
      if (v.ok === true) return "ok";
    }
    return `value: ${String(v)}`;
  };

  for (const [label, userId] of [
    ["staff S1", s1],
    ["staff S0 (no employee)", s0],
  ] as const) {
    await asUser(userId, async () => {
      const denied = "raise: Not authorized";
      check(`${label} unlock, right PIN`, answer(await attempt("select public.kiosk_unlock_v2($1) as r", [e2Pin])), denied);
      check(`${label} unlock, wrong PIN`, answer(await attempt("select public.kiosk_unlock_v2($1) as r", [wrongPin])), denied);
      check(
        `${label} kiosk punch, right PIN`,
        answer(await attempt("select public.kiosk_record_clock_event_v2($1, 'clock_in', $2, null) as r", [e3Pin, randomUUID()])),
        denied,
      );
      check(
        `${label} kiosk punch, wrong PIN`,
        answer(await attempt("select public.kiosk_record_clock_event_v2($1, 'clock_in', $2, null) as r", [wrongPin, randomUUID()])),
        denied,
      );
      check(`${label} exit, right PIN`, answer(await attempt("select public.kiosk_confirm_exit_v2($1) as r", [exitPin])), denied);
      check(`${label} exit, wrong PIN`, answer(await attempt("select public.kiosk_confirm_exit_v2($1) as r", [wrongPin])), denied);
      check(`${label} kiosk_exit_required`, answer(await attempt("select public.kiosk_exit_required() as r")), denied);
    });
    check(`${label} refusals are not counted as PIN failures`, await failuresOf(userId), 0);
  }

  for (const [label, userId] of [
    ["admin", admin],
    ["manager", manager],
    ["kiosk", kiosk],
  ] as const) {
    const before = await failuresOf(userId);
    await asUser(userId, async () => {
      check(`${label} unlock, right PIN`, answer(await attempt("select public.kiosk_unlock_v2($1) as r", [e2Pin])), `id: ${e2}`);
      check(`${label} unlock, wrong PIN`, answer(await attempt("select public.kiosk_unlock_v2($1) as r", [wrongPin])), "error: Invalid PIN");
      check(`${label} exit, right PIN`, answer(await attempt("select public.kiosk_confirm_exit_v2($1) as r", [exitPin])), "ok");
      check(`${label} exit, wrong PIN`, answer(await attempt("select public.kiosk_confirm_exit_v2($1) as r", [wrongPin])), "error: Invalid PIN");
      check(`${label} kiosk_exit_required`, answer(await attempt("select public.kiosk_exit_required() as r")), "value: true");
    });
    check(`${label} wrong PINs are counted`, (await failuresOf(userId)) - before, 2);
  }
  await asUser(kiosk, async () => {
    check(
      "kiosk punch with the right PIN clocks E3 in",
      answer(await attempt("select public.kiosk_record_clock_event_v2($1, 'clock_in', $2, null) as r", [e3Pin, randomUUID()])),
      `employee: ${e3}`,
    );
    check(
      "kiosk punch with a wrong PIN",
      answer(await attempt("select public.kiosk_record_clock_event_v2($1, 'clock_in', $2, null) as r", [wrongPin, randomUUID()])),
      "error: Invalid PIN",
    );
  });
  await asUser(awayStaff, async () => {
    check("other org staff unlock with a home PIN", answer(await attempt("select public.kiosk_unlock_v2($1) as r", [e2Pin])), "raise: Not authorized");
  });

  console.log("-- anon");
  await client.query("set local role anon");
  check(
    "anon cannot call list_shift_coworkers",
    "error" in (await attempt("select * from public.list_shift_coworkers($1, $2)", [FROM, TO])),
    true,
  );
  await client.query("reset role");
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
