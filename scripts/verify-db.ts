import dotenv from "dotenv";
import { createPgClient } from "./pg.ts";

dotenv.config();

if (!process.env.DIRECT_URL && !process.env.DATABASE_URL) {
  throw new Error("DIRECT_URL or DATABASE_URL is required to verify the schema.");
}

const requiredTables = [
  "organizations",
  "memberships",
  "suppliers",
  "inventory_items",
  "stock_movements",
  "employees",
  "staff_shifts",
  "invoices",
  "invoice_lines",
  "invoice_expense_lines",
  "vendor_aliases",
  "account_rules",
  "restaurants",
  "restaurant_aliases",
] as const;

const requiredPolicies: Record<(typeof requiredTables)[number], string[]> = {
  organizations: ["orgs_select_member", "orgs_update_member"],
  memberships: ["memberships_select_own"],
  suppliers: ["suppliers_all_member"],
  inventory_items: ["inventory_items_all_member"],
  stock_movements: ["stock_movements_select_member", "stock_movements_insert_member"],
  employees: ["employees_select_member", "employees_write_manager"],
  staff_shifts: ["staff_shifts_select_member", "staff_shifts_write_manager"],
  invoices: ["invoices_all_member"],
  invoice_lines: ["invoice_lines_all_member"],
  invoice_expense_lines: ["invoice_expenses_all_member"],
  vendor_aliases: ["vendor_aliases_all_member"],
  account_rules: ["account_rules_all_member"],
  restaurants: ["restaurants_all_member"],
  restaurant_aliases: ["restaurant_aliases_all_member"],
};

const client = createPgClient();

await client.connect();

try {
  const tables = await client.query<{ table_name: string }>(
    `select table_name
     from information_schema.tables
     where table_schema = 'public'
       and table_name = any($1::text[])`,
    [requiredTables],
  );

  const foundTables = new Set(tables.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((name) => !foundTables.has(name));
  if (missingTables.length > 0) {
    throw new Error(`Missing tables: ${missingTables.join(", ")}`);
  }

  const rls = await client.query<{ relname: string; relrowsecurity: boolean }>(
    `select c.relname, c.relrowsecurity
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = any($1::text[])`,
    [requiredTables],
  );

  const missingRls = rls.rows.filter((row) => !row.relrowsecurity).map((row) => row.relname);
  if (missingRls.length > 0) {
    throw new Error(`RLS disabled on: ${missingRls.join(", ")}`);
  }

  const policies = await client.query<{ tablename: string; policyname: string }>(
    `select tablename, policyname
     from pg_policies
     where schemaname = 'public'
       and tablename = any($1::text[])`,
    [requiredTables],
  );

  const foundPolicies = new Set(policies.rows.map((row) => `${row.tablename}:${row.policyname}`));
  const missingPolicies: string[] = [];
  for (const [table, names] of Object.entries(requiredPolicies)) {
    for (const name of names) {
      if (!foundPolicies.has(`${table}:${name}`)) {
        missingPolicies.push(`${table}.${name}`);
      }
    }
  }
  if (missingPolicies.length > 0) {
    throw new Error(`Missing policies: ${missingPolicies.join(", ")}`);
  }

  const fns = await client.query<{ proname: string }>(
    `select p.proname
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = any($1::text[])`,
    [["is_org_member", "has_org_role", "handle_new_user", "apply_stock_movement", "set_updated_at"]],
  );
  const foundFns = new Set(fns.rows.map((row) => row.proname));
  for (const name of [
    "is_org_member",
    "has_org_role",
    "handle_new_user",
    "apply_stock_movement",
    "set_updated_at",
  ]) {
    if (!foundFns.has(name)) {
      throw new Error(`Missing function: ${name}`);
    }
  }

  console.log("Schema verification passed.");
  console.log(`  tables: ${requiredTables.join(", ")}`);
  console.log(`  rls: enabled`);
  console.log(`  policies: ${foundPolicies.size}`);
} finally {
  await client.end();
}
