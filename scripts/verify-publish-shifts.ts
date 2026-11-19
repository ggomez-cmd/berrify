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

try {
  await client.query("begin");
  if (migrationPath) {
    await client.query(readFileSync(migrationPath, "utf8"));
    console.log(`loaded ${migrationPath} inside the transaction`);
  }

  const { rows: admins } = await client.query<{ user_id: string; org_id: string }>(
    `select m.user_id, m.org_id from public.memberships m
     where m.role = 'admin'
       and (select count(*) from public.restaurants r where r.org_id = m.org_id) >= 2
     limit 1`,
  );
  const admin = admins[0];
  if (!admin) throw new Error("Need an admin in an org with two restaurants.");
  const { rows: outsiders } = await client.query<{ user_id: string }>(
    `select m.user_id from public.memberships m
     where m.role = 'admin'
       and not exists (select 1 from public.memberships x where x.user_id = m.user_id and x.org_id = $1)
     limit 1`,
    [admin.org_id],
  );
  const outsider = outsiders[0]?.user_id;
  if (!outsider) throw new Error("Need an admin of another organization.");
  const { rows: rs } = await client.query<{ id: string }>(
    "select id from public.restaurants where org_id = $1 order by name limit 2",
    [admin.org_id],
  );
  const [north, south] = rs.map((r) => r.id);
  const { rows: emps } = await client.query<{ id: string; position: string }>(
    "select id, position from public.employees where org_id = $1 limit 1",
    [admin.org_id],
  );
  const emp = emps[0];

  const draft = async (restaurantId: string | null) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into public.staff_shifts (org_id, employee_id, restaurant_id, position, starts_at, ends_at, status)
       values ($1, $2, $3, $4, '2031-03-03T10:00:00Z', '2031-03-03T12:00:00Z', 'draft') returning id`,
      [admin.org_id, emp.id, restaurantId, emp.position],
    );
    return rows[0].id;
  };
  const status = async (id: string) =>
    (await client.query<{ status: string }>("select status from public.staff_shifts where id = $1", [id])).rows[0]
      .status;
  const publish = (userId: string, ids: string[], restaurantId: string | null) =>
    asUser(userId, async () =>
      Number(
        (await client.query<{ n: number }>("select public.publish_shifts($1::uuid[], $2) as n", [ids, restaurantId]))
          .rows[0].n,
      ),
    );

  const stored = await draft(north);
  check("draft stored at North, published from North", await publish(admin.user_id, [stored], north), 1);
  check("its status", await status(stored), "published");

  const other = await draft(south);
  check("draft stored at South, published from North tab", await publish(admin.user_id, [other], north), 0);
  check("its status", await status(other), "draft");

  await client.query("update public.employees set home_restaurant_id = $1 where id = $2", [north, emp.id]);
  const legacy = await draft(null);
  check("draft with no saved restaurant, from its employee's home tab", await publish(admin.user_id, [legacy], north), 0);
  check("its status", await status(legacy), "draft");
  check("same draft from All restaurants", await publish(admin.user_id, [legacy], null), 1);

  const anywhere = await draft(south);
  check("All restaurants tab publishes any restaurant", await publish(admin.user_id, [anywhere], null), 1);
  check("already published is not counted again", await publish(admin.user_id, [anywhere], null), 0);

  const guarded = await draft(north);
  check("admin of another organization", await publish(outsider, [guarded], null), 0);
  check("its status", await status(guarded), "draft");
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
