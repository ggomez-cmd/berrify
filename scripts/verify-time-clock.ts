import dotenv from "dotenv";
import type { QueryResult } from "pg";
import { createPgClient } from "./pg.ts";

dotenv.config();

if (!process.env.DIRECT_URL && !process.env.DATABASE_URL) {
  throw new Error("DIRECT_URL or DATABASE_URL is required to verify the time clock.");
}

type ClockEvent = {
  id: string;
  employee_id: string;
  event_type: string;
  actor_type: string;
  source: string;
  client_event_id: string;
  occurred_at: string;
};

const client = createPgClient();
const failures: string[] = [];

function assert(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

async function q<T extends Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  return client.query<T>(sql, params);
}

async function become(userId: string): Promise<void> {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await client.query(
    "select set_config('request.jwt.claims', $1, true)",
    [JSON.stringify({ sub: userId, role: "authenticated" })],
  );
}

async function asAuthenticated<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  await become(userId);
  await client.query("set local role authenticated");
  try {
    return await fn();
  } finally {
    await client.query("reset role");
  }
}

async function punch(
  eventType: string,
  clientEventId: string,
  extras: { note?: string; restaurantId?: string | null } = {},
): Promise<ClockEvent> {
  const { rows } = await q<ClockEvent>(
    `select * from public.record_clock_event(
      $1, $2::uuid, $3, now(), $4::uuid, null, null, null, 'web'
    )`,
    [eventType, clientEventId, extras.note ?? null, extras.restaurantId ?? null],
  );
  return rows[0];
}

async function expectReject(fn: () => Promise<unknown>, pattern: RegExp): Promise<boolean> {
  const savepoint = `sp_${crypto.randomUUID().replaceAll("-", "")}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    await fn();
    await client.query(`release savepoint ${savepoint}`);
    return false;
  } catch (err) {
    await client.query(`rollback to savepoint ${savepoint}`);
    return err instanceof Error && pattern.test(err.message);
  }
}

await client.connect();

try {
  await client.query("begin");

  const { rows: users } = await q<{ id: string; email: string }>(
    `select id, email
     from auth.users
     where email in ('demo@berrify.local', 'server@berrify.local', 'cook@berrify.local')`,
  );
  const userByEmail = Object.fromEntries(users.map((row) => [row.email, row.id]));
  const ownerId = userByEmail["demo@berrify.local"];
  const staffId = userByEmail["server@berrify.local"];
  const cookUserId = userByEmail["cook@berrify.local"];
  if (!ownerId || !staffId || !cookUserId) {
    throw new Error("Demo users missing. Run npm run db:seed first.");
  }

  const { rows: employees } = await q<{
    id: string;
    email: string;
    org_id: string;
    home_restaurant_id: string | null;
    position: string;
  }>(
    `select id, email, org_id, home_restaurant_id, position
     from public.employees
     where email in ('server@berrify.local', 'cook@berrify.local')`,
  );
  const sofia = employees.find((row) => row.email === "server@berrify.local");
  const marco = employees.find((row) => row.email === "cook@berrify.local");
  if (!sofia || !marco) throw new Error("Demo employees missing.");

  const { rows: restaurants } = await q<{ id: string; slug: string }>(
    `select id, slug from public.restaurants where org_id = $1`,
    [sofia.org_id],
  );
  const home = restaurants[0] ?? null;
  const scheduledSite = restaurants.find((row) => row.id !== home?.id) ?? home;

  await client.query(
    `update public.employees set home_restaurant_id = $1 where id = $2`,
    [home?.id ?? null, sofia.id],
  );

  const shiftStarts = new Date();
  shiftStarts.setMinutes(0, 0, 0);
  const shiftEnds = new Date(shiftStarts.getTime() + 6 * 3600 * 1000);
  const { rows: shifts } = await q<{ id: string }>(
    `insert into public.staff_shifts (
       org_id, employee_id, restaurant_id, position, starts_at, ends_at, status, note
     ) values ($1, $2, $3, $4, $5, $6, 'published', 'phase1-test')
     returning id`,
    [sofia.org_id, sofia.id, scheduledSite?.id ?? null, sofia.position, shiftStarts.toISOString(), shiftEnds.toISOString()],
  );
  const shiftId = shifts[0]?.id ?? null;

  await become(staffId);
  const clockInId = crypto.randomUUID();
  const firstIn = await punch("clock_in", clockInId);
  assert(firstIn.event_type === "clock_in", "clock_in should insert");
  assert(firstIn.actor_type === "employee", "employee actor");
  assert(firstIn.source === "web", "employee source web");
  assert(firstIn.employee_id === sofia.id, "clock_in employee");

  const replay = await punch("clock_in", clockInId);
  assert(replay.id === firstIn.id, "duplicate client_event_id returns the same event");

  const { rows: eventCount } = await q<{ n: string }>(
    `select count(*)::text as n from public.clock_events where client_event_id = $1`,
    [clockInId],
  );
  assert(eventCount[0]?.n === "1", "duplicate client_event_id must not insert a second row");

  assert(
    await expectReject(() => punch("clock_in", crypto.randomUUID()), /Invalid clock transition/i),
    "second clock_in while working is rejected",
  );

  const { rows: sessionAfterIn } = await q<{ restaurant_id: string | null; staff_shift_id: string | null; state: string }>(
    `select restaurant_id, staff_shift_id, state from public.clock_sessions where employee_id = $1`,
    [sofia.id],
  );
  assert(sessionAfterIn[0]?.state === "working", "session is working after clock_in");
  if (scheduledSite) {
    assert(sessionAfterIn[0]?.restaurant_id === scheduledSite.id, "scheduled restaurant wins over home");
  }
  if (shiftId) {
    assert(sessionAfterIn[0]?.staff_shift_id === shiftId, "published shift is matched");
  }

  await punch("break_start", crypto.randomUUID());
  assert(
    await expectReject(() => punch("break_start", crypto.randomUUID()), /Invalid clock transition/i),
    "break_start while on_break is rejected",
  );
  await punch("break_end", crypto.randomUUID());
  await punch("break_start", crypto.randomUUID());
  await punch("break_end", crypto.randomUUID());

  const clockOut = await punch("clock_out", crypto.randomUUID());
  assert(clockOut.event_type === "clock_out", "clock_out inserted");

  const { rows: sessions } = await q<{ n: string }>(
    `select count(*)::text as n from public.clock_sessions where employee_id = $1`,
    [sofia.id],
  );
  assert(sessions[0]?.n === "0", "session is deleted after clock_out");

  const { rows: entries } = await q<{
    id: string;
    worked_seconds: number;
    unpaid_break_seconds: number;
    paid_break_seconds: number;
    gross_seconds: number;
    restaurant_id: string | null;
  }>(
    `select id, worked_seconds, unpaid_break_seconds, paid_break_seconds, gross_seconds, restaurant_id
     from public.time_entries where employee_id = $1 order by started_at desc limit 1`,
    [sofia.id],
  );
  const entry = entries[0];
  assert(Boolean(entry), "one time_entry after clock-out");
  if (entry) {
    assert(
      entry.worked_seconds === entry.gross_seconds - entry.unpaid_break_seconds,
      "worked_seconds = gross - unpaid",
    );
    assert(entry.paid_break_seconds >= 0, "paid break seconds recorded");
    if (scheduledSite) {
      assert(entry.restaurant_id === scheduledSite.id, "entry restaurant uses matched shift");
    }
  }

  const { rows: breaks } = await q<{ n: string }>(
    `select count(*)::text as n from public.time_breaks where time_entry_id = $1`,
    [entry?.id ?? "00000000-0000-0000-0000-000000000000"],
  );
  assert(Number(breaks[0]?.n ?? 0) >= 2, "multiple time_breaks rows for one session");

  const mealStart = new Date("2026-09-01T16:00:00.000Z");
  const mealFinish = new Date("2026-09-01T16:31:00.000Z");
  await become(ownerId);
  await q(`select * from public.manager_record_punch($1, 'clock_in', $2::timestamptz, 'hist in', $3::uuid)`, [
    sofia.id,
    "2026-09-01T14:00:00.000Z",
    crypto.randomUUID(),
  ]);
  await q(`select * from public.manager_record_punch($1, 'break_start', $2::timestamptz, 'hist meal start', $3::uuid)`, [
    sofia.id,
    mealStart.toISOString(),
    crypto.randomUUID(),
  ]);
  await q(`select * from public.manager_record_punch($1, 'break_end', $2::timestamptz, 'hist meal end', $3::uuid)`, [
    sofia.id,
    mealFinish.toISOString(),
    crypto.randomUUID(),
  ]);
  await q(`select * from public.manager_record_punch($1, 'clock_out', $2::timestamptz, 'hist out', $3::uuid)`, [
    sofia.id,
    "2026-09-01T22:00:00.000Z",
    crypto.randomUUID(),
  ]);
  const { rows: mealEntries } = await q<{
    unpaid_break_seconds: number;
    worked_seconds: number;
    gross_seconds: number;
    id: string;
  }>(
    `select unpaid_break_seconds, worked_seconds, gross_seconds, id
     from public.time_entries
     where employee_id = $1 and started_at = '2026-09-01T14:00:00.000Z'`,
    [sofia.id],
  );
  assert(mealEntries[0]?.unpaid_break_seconds === 31 * 60, "unpaid meal is excluded from worked seconds");
  assert(
    mealEntries[0]?.worked_seconds === 8 * 3600 - 31 * 60,
    "worked seconds keep paid time and drop unpaid meal",
  );
  const { rows: longBreak } = await q<{ n: string }>(
    `select count(*)::text as n
     from public.time_exceptions
     where time_entry_id = $1 and type = 'long_break'`,
    [mealEntries[0]?.id ?? "00000000-0000-0000-0000-000000000000"],
  );
  assert(longBreak[0]?.n === "1", "31-minute meal flags long_break");

  const yesterday = new Date(Date.now() - 6 * 3600 * 1000);
  yesterday.setUTCHours(2, 0, 0, 0);
  const midnightOut = new Date(yesterday.getTime() + 4 * 3600 * 1000);
  await become(ownerId);
  await q(
    `select * from public.manager_record_punch($1, 'clock_in', $2::timestamptz, 'missing in', $3::uuid)`,
    [sofia.id, yesterday.toISOString(), crypto.randomUUID()],
  );
  await q(
    `select * from public.manager_record_punch($1, 'clock_out', $2::timestamptz, 'missing out', $3::uuid)`,
    [sofia.id, midnightOut.toISOString(), crypto.randomUUID()],
  );
  const { rows: midnightEntries } = await q<{ n: string; worked: number }>(
    `select count(*)::text as n, max(worked_seconds) as worked
     from public.time_entries
     where employee_id = $1 and started_at = $2::timestamptz`,
    [sofia.id, yesterday.toISOString()],
  );
  assert(midnightEntries[0]?.n === "1", "cross-midnight stays one time_entry");
  assert(midnightEntries[0]?.worked === 4 * 3600, "cross-midnight duration is 4 hours in seconds");

  await become(staffId);
  await punch("clock_in", crypto.randomUUID());
  await become(ownerId);
  assert(
    await expectReject(
      () =>
        q(`select * from public.manager_force_clock_out($1, '   ', $2::uuid, now())`, [
          sofia.id,
          crypto.randomUUID(),
        ]),
      /reason is required/i,
    ),
    "force-out requires a reason",
  );

  const forceFromWorking = (
    await q<ClockEvent>(
      `select * from public.manager_force_clock_out($1, 'end of night', $2::uuid, now())`,
      [sofia.id, crypto.randomUUID()],
    )
  ).rows[0];
  assert(forceFromWorking.actor_type === "manager", "force-out actor is manager");
  assert(forceFromWorking.source === "web", "manager web source");
  assert(forceFromWorking.event_type === "clock_out", "force-out writes clock_out");

  const { rows: originalIns } = await q<{ n: string }>(
    `select count(*)::text as n from public.clock_events where id = $1`,
    [firstIn.id],
  );
  assert(originalIns[0]?.n === "1", "original employee events remain after manager force-out");

  await become(staffId);
  await punch("clock_in", crypto.randomUUID());
  await punch("break_start", crypto.randomUUID());
  await become(ownerId);
  const forceFromBreak = (
    await q<ClockEvent>(
      `select * from public.manager_force_clock_out($1, 'left on break', $2::uuid, now())`,
      [sofia.id, crypto.randomUUID()],
    )
  ).rows[0];
  assert(forceFromBreak.event_type === "clock_out", "force-out from on_break still clocks out");
  const { rows: openAfterForce } = await q<{ n: string }>(
    `select count(*)::text as n from public.clock_sessions where employee_id = $1`,
    [sofia.id],
  );
  assert(openAfterForce[0]?.n === "0", "force-out deletes the live session");

  await become(staffId);
  await punch("clock_in", crypto.randomUUID());
  await become(ownerId);
  await q(`select public.reconcile_attendance()`);
  await client.query(
    `update public.clock_sessions
     set clocked_in_at = now() - interval '13 hours'
     where employee_id = $1`,
    [sofia.id],
  );
  await become(ownerId);
  await q(`select public.reconcile_attendance()`);
  const { rows: missedOut } = await q<{ n: string }>(
    `select count(*)::text as n
     from public.time_exceptions
     where employee_id = $1 and type = 'missed_out' and status = 'open'`,
    [sofia.id],
  );
  assert(Number(missedOut[0]?.n ?? 0) >= 1, "open session produces missed_out, not an invented punch");
  const { rows: stillOpen } = await q<{ n: string }>(
    `select count(*)::text as n from public.clock_sessions where employee_id = $1`,
    [sofia.id],
  );
  assert(stillOpen[0]?.n === "1", "missed_out leaves the session open");
  await become(ownerId);
  await q(`select * from public.manager_force_clock_out($1, 'close after reconcile', $2::uuid, now())`, [
    sofia.id,
    crypto.randomUUID(),
  ]);

  const otherOrg = (
    await q<{ id: string }>(`insert into public.organizations (name) values ('phase1-other') returning id`)
  ).rows[0];
  const otherEmp = (
    await q<{ id: string }>(
      `insert into public.employees (org_id, full_name, position, hourly_rate, active)
       values ($1, 'Other Worker', 'Cook', 10, true)
       returning id`,
      [otherOrg.id],
    )
  ).rows[0];
  await become(ownerId);
  assert(
    await expectReject(
      () =>
        q(`select * from public.manager_force_clock_out($1, 'nope', $2::uuid, now())`, [
          otherEmp.id,
          crypto.randomUUID(),
        ]),
      /Not authorized/i,
    ),
    "manager cannot operate on another organization",
  );

  assert(
    await expectReject(
      () =>
        asAuthenticated(staffId, async () => {
          await q(
            `insert into public.clock_events (
               org_id, employee_id, event_type, actor_type, source, occurred_at, client_event_id
             ) values ($1, $2, 'clock_in', 'employee', 'web', now(), $3::uuid)`,
            [sofia.org_id, sofia.id, crypto.randomUUID()],
          );
        }),
      /./,
    ),
    "staff cannot write clock_events directly",
  );

  await become(cookUserId);
  await punch("clock_in", crypto.randomUUID());
  const coworkerVisible = await (async () => {
    const savepoint = `sp_${crypto.randomUUID().replaceAll("-", "")}`;
    await client.query(`savepoint ${savepoint}`);
    try {
      const visible = await asAuthenticated(staffId, async () => {
        const { rows } = await q<{ n: string }>(
          `select count(*)::text as n from public.clock_events where employee_id = $1`,
          [marco.id],
        );
        return Number(rows[0]?.n ?? 0);
      });
      await client.query(`release savepoint ${savepoint}`);
      return visible;
    } catch {
      await client.query(`rollback to savepoint ${savepoint}`);
      return 0;
    }
  })();
  assert(coworkerVisible === 0, "staff cannot inspect coworker clock history");

  const whoSave = `sp_${crypto.randomUUID().replaceAll("-", "")}`;
  await client.query(`savepoint ${whoSave}`);
  let staffWhos: Array<{ clocked_in_at: string | null; full_name: string }> = [];
  try {
    staffWhos = (
      await asAuthenticated(staffId, async () => {
        return (await q<{ clocked_in_at: string | null; full_name: string }>(`select * from public.list_whos_working()`))
          .rows;
      })
    );
    await client.query(`release savepoint ${whoSave}`);
  } catch (err) {
    await client.query(`rollback to savepoint ${whoSave}`);
    failures.push(`list_whos_working as staff failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const marcoRow = staffWhos.find((row) => row.full_name === "Marco Diaz");
  assert(Boolean(marcoRow), "staff can see coworker names/state via Who's Working");
  assert(marcoRow?.clocked_in_at == null, "staff Who's Working omits punch timestamps");

  await become(ownerId);
  await q(`select * from public.manager_force_clock_out($1, 'cleanup cook', $2::uuid, now())`, [
    marco.id,
    crypto.randomUUID(),
  ]);

  await become(staffId);
  assert(
    await expectReject(
      () => q(`update public.organizations set timezone = 'UTC' where id = $1`, [sofia.org_id]),
      /Not authorized to change clock settings/i,
    ),
    "staff cannot change org clock settings",
  );
  assert(
    await expectReject(
      () =>
        q(
          `select * from public.update_org_clock_settings('UTC', 0::smallint, '00:00'::time, false, true)`,
        ),
      /Not authorized/i,
    ),
    "staff cannot call update_org_clock_settings",
  );

  await client.query("rollback");

  if (failures.length > 0) {
    console.error("Time clock verification failed:");
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("Time clock verification passed.");
  }
} catch (err) {
  await client.query("rollback").catch(() => undefined);
  console.error(err);
  throw err;
} finally {
  await client.end();
}
