import { readFileSync } from "node:fs";
import dotenv from "dotenv";
import { createPgClient } from "./pg.ts";

dotenv.config();

const migrationFlag = process.argv.indexOf("--migration");
const migrationPath = migrationFlag >= 0 ? process.argv[migrationFlag + 1] : null;

type Case = {
  name: string;
  shifts: Array<{ label: string; starts: string; ends: string; otherOrg?: boolean }>;
  punchAt: string;
  expect: string | null;
};

// Wall-clock times on a fixed far-future day, so no real shift can match.
const DAY = "2031-03-03";
const at = (hhmm: string) => `${DAY}T${hhmm}:00Z`;

const CASES: Case[] = [
  {
    name: "punch inside shift A, B starts sooner",
    shifts: [
      { label: "A", starts: "10:00", ends: "12:00" },
      { label: "B", starts: "12:30", ends: "16:00" },
    ],
    punchAt: "11:50",
    expect: "A",
  },
  {
    name: "late clock-in inside a long shift A, B within grace",
    shifts: [
      { label: "A", starts: "10:00", ends: "14:00" },
      { label: "B", starts: "14:30", ends: "18:00" },
    ],
    punchAt: "13:00",
    expect: "A",
  },
  {
    name: "early arrival before A",
    shifts: [
      { label: "A", starts: "10:00", ends: "12:00" },
      { label: "B", starts: "12:30", ends: "16:00" },
    ],
    punchAt: "09:30",
    expect: "A",
  },
  {
    name: "between shifts, early for B",
    shifts: [
      { label: "A", starts: "10:00", ends: "12:00" },
      { label: "B", starts: "12:30", ends: "16:00" },
    ],
    punchAt: "12:20",
    expect: "B",
  },
  {
    name: "shift filed under another organization",
    shifts: [{ label: "A", starts: "10:00", ends: "12:00", otherOrg: true }],
    punchAt: "10:05",
    expect: null,
  },
  {
    name: "outside every grace window",
    shifts: [{ label: "A", starts: "10:00", ends: "12:00" }],
    punchAt: "15:00",
    expect: null,
  },
];

const client = createPgClient();
await client.connect();
const failures: string[] = [];

try {
  await client.query("begin");
  if (migrationPath) {
    await client.query(readFileSync(migrationPath, "utf8"));
    console.log(`loaded ${migrationPath} inside the transaction`);
  }

  const { rows } = await client.query<{ id: string; org_id: string; position: string }>(
    `select e.id, e.org_id, e.position
     from public.employees e
     where (select count(*) from public.restaurants r where r.org_id = e.org_id) >= 2
     limit 1`,
  );
  const employee = rows[0];
  if (!employee) throw new Error("Need an employee in an org with two restaurants.");
  const { rows: restaurants } = await client.query<{ id: string }>(
    "select id from public.restaurants where org_id = $1 order by name limit 2",
    [employee.org_id],
  );
  const { rows: otherOrgs } = await client.query<{ id: string }>(
    "select id from public.organizations where id <> $1 limit 1",
    [employee.org_id],
  );
  const otherOrgId = otherOrgs[0]?.id;
  if (!otherOrgId) throw new Error("Need a second organization for the cross-org case.");

  for (const c of CASES) {
    await client.query("savepoint each_case");
    const idToLabel = new Map<string, string>();
    for (const [i, s] of c.shifts.entries()) {
      const { rows: inserted } = await client.query<{ id: string }>(
        `insert into public.staff_shifts (org_id, employee_id, restaurant_id, position, starts_at, ends_at, status)
         values ($1, $2, $3, $4, $5, $6, 'published') returning id`,
        s.otherOrg
          ? [otherOrgId, employee.id, null, employee.position, at(s.starts), at(s.ends)]
          : [employee.org_id, employee.id, restaurants[i % 2].id, employee.position, at(s.starts), at(s.ends)],
      );
      idToLabel.set(inserted[0].id, s.label);
    }
    const { rows: match } = await client.query<{ id: string | null }>(
      "select (public.match_published_shift($1, $2)).id",
      [employee.id, at(c.punchAt)],
    );
    const got = match[0]?.id ? (idToLabel.get(match[0].id) ?? "other") : null;
    const ok = got === c.expect;
    console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}: punch ${c.punchAt} matched ${got ?? "none"}, expected ${c.expect ?? "none"}`);
    if (!ok) failures.push(c.name);
    await client.query("rollback to savepoint each_case");
  }
} finally {
  await client.query("rollback").catch(() => undefined);
  await client.end();
}

if (failures.length > 0) {
  console.error(`${failures.length} case(s) failed`);
  process.exit(1);
}
console.log("all cases passed");
