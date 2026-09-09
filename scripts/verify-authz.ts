import dotenv from "dotenv";
import type { QueryResult } from "pg";
import { createPgClient } from "./pg.ts";

dotenv.config();

if (!process.env.DIRECT_URL && !process.env.DATABASE_URL) {
  throw new Error("DIRECT_URL or DATABASE_URL is required to verify authorization.");
}

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

async function expectReject(fn: () => Promise<unknown>): Promise<boolean> {
  const savepoint = `sp_${crypto.randomUUID().replaceAll("-", "")}`;
  await client.query(`savepoint ${savepoint}`);
  try {
    await fn();
    await client.query(`release savepoint ${savepoint}`);
    return false;
  } catch {
    await client.query(`rollback to savepoint ${savepoint}`);
    return true;
  }
}

await client.connect();

try {
  await client.query("begin");

  const { rows: users } = await q<{ id: string; email: string }>(
    `select id, email
     from auth.users
     where email in ('demo@berrify.local', 'server@berrify.local')`,
  );
  const userByEmail = Object.fromEntries(users.map((row) => [row.email, row.id]));
  const ownerId = userByEmail["demo@berrify.local"];
  const staffId = userByEmail["server@berrify.local"];
  if (!ownerId || !staffId) {
    throw new Error("Demo users missing. Run npm run db:seed first.");
  }

  const { rows: orgs } = await q<{ id: string }>(
    `select o.id
     from public.organizations o
     join public.memberships m on m.org_id = o.id
     where m.user_id = $1
     limit 1`,
    [ownerId],
  );
  const orgId = orgs[0]?.id;
  if (!orgId) throw new Error("Demo organization missing.");

  const staffInvoices = await asAuthenticated(staffId, async () => {
    const { rows } = await q<{ id: string }>(`select id from public.invoices where org_id = $1`, [orgId]);
    return rows;
  });
  assert(staffInvoices.length === 0, "staff can select invoices");

  const staffInvoiceInsert = await asAuthenticated(staffId, async () =>
    expectReject(() =>
      q(
        `insert into public.invoices (org_id, vendor_name, status, source)
         values ($1, 'Probe', 'received', 'upload')`,
        [orgId],
      ),
    ),
  );
  assert(staffInvoiceInsert, "staff can insert invoices");

  const staffAliases = await asAuthenticated(staffId, async () => {
    const { rows } = await q<{ id: string }>(`select id from public.vendor_aliases where org_id = $1`, [orgId]);
    return rows;
  });
  assert(staffAliases.length === 0, "staff can select vendor_aliases");

  const staffRates = await asAuthenticated(staffId, async () =>
    expectReject(() => q(`select hourly_rate, email, phone from public.employees where org_id = $1`, [orgId])),
  );
  assert(staffRates, "staff can select employee wage/PII columns");

  const staffDirectory = await asAuthenticated(staffId, async () => {
    const { rows } = await q<{ full_name: string }>(
      `select full_name from public.employees where org_id = $1`,
      [orgId],
    );
    return rows;
  });
  assert(staffDirectory.length > 0, "staff cannot select employee directory names");

  const staffEmployeeRpc = await asAuthenticated(staffId, async () => {
    const { rows } = await q<{ hourly_rate: number }>(`select hourly_rate from public.list_employees_full()`);
    return rows;
  });
  assert(staffEmployeeRpc.length === 0, "staff list_employees_full returned rows");

  const managerEmployees = await asAuthenticated(ownerId, async () => {
    const { rows } = await q<{ hourly_rate: number }>(`select hourly_rate from public.list_employees_full()`);
    return rows;
  });
  assert(managerEmployees.length > 0, "manager list_employees_full returned no rows");
  assert(
    managerEmployees.some((row) => Number(row.hourly_rate) > 0),
    "manager list_employees_full hid hourly_rate",
  );

  const { rows: itemsBefore } = await q<{ count: string }>(
    `select count(*)::text as count from public.inventory_items where org_id = $1`,
    [orgId],
  );
  await asAuthenticated(staffId, async () => {
    await q(`delete from public.inventory_items where org_id = $1`, [orgId]);
  });
  const { rows: itemsAfter } = await q<{ count: string }>(
    `select count(*)::text as count from public.inventory_items where org_id = $1`,
    [orgId],
  );
  assert(itemsBefore[0]?.count === itemsAfter[0]?.count, "staff can delete inventory items");

  const staffSupplierInsert = await asAuthenticated(staffId, async () =>
    expectReject(() =>
      q(`insert into public.suppliers (org_id, name) values ($1, 'Probe vendor')`, [orgId]),
    ),
  );
  assert(staffSupplierInsert, "staff can insert suppliers");

  const { rows: orgBefore } = await q<{ name: string }>(
    `select name from public.organizations where id = $1`,
    [orgId],
  );
  await asAuthenticated(staffId, async () => {
    await q(`update public.organizations set name = 'Hijacked' where id = $1`, [orgId]);
  });
  const { rows: orgAfter } = await q<{ name: string }>(
    `select name from public.organizations where id = $1`,
    [orgId],
  );
  assert(orgBefore[0]?.name === orgAfter[0]?.name, "staff can rename the organization");
  assert(orgAfter[0]?.name !== "Hijacked", "staff org rename persisted");

  const staffInventory = await asAuthenticated(staffId, async () => {
    const { rows } = await q<{ id: string }>(`select id from public.inventory_items where org_id = $1`, [orgId]);
    return rows;
  });
  assert(staffInventory.length > 0, "staff cannot read inventory");

  const staffUnitCost = await asAuthenticated(staffId, async () =>
    expectReject(() => q(`select unit_cost from public.inventory_items where org_id = $1`, [orgId])),
  );
  assert(staffUnitCost, "staff can select inventory unit_cost");

  const staffInventoryRpc = await asAuthenticated(staffId, async () => {
    const { rows } = await q<{ unit_cost: number }>(`select unit_cost from public.list_inventory_full()`);
    return rows;
  });
  assert(staffInventoryRpc.length === 0, "staff list_inventory_full returned rows");

  const managerInventory = await asAuthenticated(ownerId, async () => {
    const { rows } = await q<{ unit_cost: number }>(`select unit_cost from public.list_inventory_full()`);
    return rows;
  });
  assert(managerInventory.length > 0, "manager list_inventory_full returned no rows");
  assert(
    managerInventory.some((row) => Number(row.unit_cost) > 0),
    "manager list_inventory_full hid unit_cost",
  );

  const staffSupplierContacts = await asAuthenticated(staffId, async () =>
    expectReject(() =>
      q(`select contact_email, phone, notes from public.suppliers where org_id = $1`, [orgId]),
    ),
  );
  assert(staffSupplierContacts, "staff can select supplier contact columns");

  const staffSupplierNames = await asAuthenticated(staffId, async () => {
    const { rows } = await q<{ name: string }>(`select name from public.suppliers where org_id = $1`, [orgId]);
    return rows;
  });
  assert(staffSupplierNames.length > 0, "staff cannot select supplier names");

  const staffSupplierRpc = await asAuthenticated(staffId, async () => {
    const { rows } = await q<{ contact_email: string }>(`select contact_email from public.list_suppliers_full()`);
    return rows;
  });
  assert(staffSupplierRpc.length === 0, "staff list_suppliers_full returned rows");

  const managerSuppliers = await asAuthenticated(ownerId, async () => {
    const { rows } = await q<{ contact_email: string | null }>(
      `select contact_email from public.list_suppliers_full()`,
    );
    return rows;
  });
  assert(managerSuppliers.length > 0, "manager list_suppliers_full returned no rows");

  const staffInviteCode = await asAuthenticated(staffId, async () =>
    expectReject(() => q(`select invite_code from public.employees where org_id = $1`, [orgId])),
  );
  assert(staffInviteCode, "staff can select employee invite_code");

  let { rows: pendingInvites } = await q<{ id: string; invite_code: string | null }>(
    `select id, invite_code
     from public.employees
     where org_id = $1 and user_id is null and email is not null
     limit 1`,
    [orgId],
  );
  if (!pendingInvites[0]) {
    const inserted = await q<{ id: string; invite_code: string | null }>(
      `insert into public.employees (org_id, full_name, email, position)
       values ($1, 'Authz Probe', 'probe-invite@berrify.example', 'Other')
       returning id, invite_code`,
      [orgId],
    );
    pendingInvites = inserted.rows;
  }
  const pending = pendingInvites[0];
  assert(Boolean(pending?.invite_code), "unbound employee with email has no invite_code");

  if (pending?.id) {
    const staffRotate = await asAuthenticated(staffId, async () =>
      expectReject(() => q(`select public.rotate_employee_invite($1)`, [pending.id])),
    );
    assert(staffRotate, "staff can rotate employee invite codes");

    const managerRotate = await asAuthenticated(ownerId, async () => {
      const { rows } = await q<{ rotate_employee_invite: string }>(
        `select public.rotate_employee_invite($1)`,
        [pending.id],
      );
      return rows[0]?.rotate_employee_invite;
    });
    assert(Boolean(managerRotate), "manager rotate_employee_invite returned no code");
    assert(managerRotate !== pending.invite_code, "manager rotate_employee_invite reused the same code");
  }

  if (failures.length > 0) {
    throw new Error(`Authorization verification failed:\n- ${failures.join("\n- ")}`);
  }

  console.log("Authorization verification passed.");
  console.log("  staff denied: invoices, aliases, wage columns, unit_cost, supplier contacts, invite codes");
  console.log("  staff allowed: employee names, inventory qty, supplier names");
  console.log("  manager allowed: full inventory/suppliers/employees RPCs and invite rotate");
} finally {
  await client.query("rollback");
  await client.end();
}
