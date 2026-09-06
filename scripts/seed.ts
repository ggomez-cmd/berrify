import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import {
  ACCOUNTS,
  DEFAULT_ACCOUNT_RULES,
  extractInvoiceFromText,
} from "../src/lib/invoice-extract.ts";
import { JOSE_SANTIAGO_OCR } from "../src/lib/invoice-fixtures.ts";

dotenv.config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.DEMO_EMAIL ?? process.env.NEXT_PUBLIC_DEMO_EMAIL ?? "demo@berrify.local";
const password = process.env.DEMO_PASSWORD ?? process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "BerrifyDemo2026!";
const staffPassword = password;

if (!url || !serviceRole) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const admin = createClient(url, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function ensureSupplier(
  orgId: string,
  name: string,
  extras: { contact_email?: string; phone?: string; notes?: string },
): Promise<string> {
  const { data: existing, error: existingError } = await admin
    .from("suppliers")
    .select("id")
    .eq("org_id", orgId)
    .eq("name", name)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id) return existing.id as string;

  const { data, error } = await admin
    .from("suppliers")
    .insert({ org_id: orgId, name, ...extras })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error(`Failed to insert ${name}`);
  return data.id as string;
}

async function findUserId(lookupEmail: string): Promise<string | null> {
  const perPage = 200;
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((u) => u.email === lookupEmail);
    if (found) return found.id;
    if (data.users.length < perPage) break;
    page += 1;
  }
  return null;
}

async function findOrCreateUser(
  lookupEmail: string,
  userPassword: string,
  orgName?: string,
): Promise<string> {
  const existing = await findUserId(lookupEmail);
  if (existing) return existing;

  const { data, error } = await admin.auth.admin.createUser({
    email: lookupEmail,
    password: userPassword,
    email_confirm: true,
    user_metadata: orgName ? { org_name: orgName } : {},
  });
  if (error || !data.user) throw error ?? new Error(`Failed to create ${lookupEmail}`);
  return data.user.id;
}

async function orgForUser(userId: string): Promise<string> {
  const { data, error } = await admin
    .from("memberships")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (data?.org_id) return data.org_id as string;

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: "Pacifico Kitchen" })
    .select("id")
    .single();
  if (orgError || !org) throw orgError ?? new Error("Failed to create org");

  const { error: memError } = await admin.from("memberships").insert({
    user_id: userId,
    org_id: org.id,
    role: "owner",
  });
  if (memError) throw memError;
  return org.id as string;
}

function weekStart(date = new Date()): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function atHour(dayOffset: number, hour: number, minute = 0): string {
  const d = weekStart();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

async function seedInventory(orgId: string, userId: string) {
  const { count, error: countError } = await admin
    .from("inventory_items")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);
  if (countError) throw countError;
  if ((count ?? 0) > 0) {
    console.log(`Org already has ${count} item(s); skipping inventory seed.`);
    return;
  }

  const { data: suppliers, error: supError } = await admin
    .from("suppliers")
    .insert([
      {
        org_id: orgId,
        name: "Valle Produce",
        contact_email: "orders@valleproduce.example",
        phone: "787-555-0101",
        notes: "Tuesday / Friday deliveries",
      },
      {
        org_id: orgId,
        name: "Atlantic Seafood",
        contact_email: "desk@atlanticseafood.example",
        phone: "787-555-0144",
        notes: "Call by 9am for same-day",
      },
      {
        org_id: orgId,
        name: "Casa Dairy",
        contact_email: "billing@casadairy.example",
        phone: "787-555-0188",
      },
      {
        org_id: orgId,
        name: "Metro Dry Goods",
        contact_email: "sales@metrodry.example",
        phone: "787-555-0199",
      },
    ])
    .select("id, name");
  if (supError || !suppliers) throw supError ?? new Error("Failed to insert suppliers");

  const byName = Object.fromEntries(suppliers.map((s) => [s.name, s.id]));

  const { data: items, error: itemError } = await admin
    .from("inventory_items")
    .insert([
      { org_id: orgId, name: "Roma tomatoes", sku: "PR-001", category: "Produce", unit: "lb", quantity: 0, reorder_level: 20, unit_cost: 1.85, supplier_id: byName["Valle Produce"] },
      { org_id: orgId, name: "Romaine hearts", sku: "PR-014", category: "Produce", unit: "case", quantity: 0, reorder_level: 8, unit_cost: 18, supplier_id: byName["Valle Produce"] },
      { org_id: orgId, name: "Chicken breast", sku: "PT-003", category: "Protein", unit: "lb", quantity: 0, reorder_level: 25, unit_cost: 3.4, supplier_id: null },
      { org_id: orgId, name: "Salmon fillet", sku: "PT-011", category: "Protein", unit: "lb", quantity: 0, reorder_level: 10, unit_cost: 12.5, supplier_id: byName["Atlantic Seafood"] },
      { org_id: orgId, name: "Whole milk", sku: "DY-002", category: "Dairy", unit: "gal", quantity: 0, reorder_level: 6, unit_cost: 4.1, supplier_id: byName["Casa Dairy"] },
      { org_id: orgId, name: "Heavy cream", sku: "DY-008", category: "Dairy", unit: "qt", quantity: 0, reorder_level: 8, unit_cost: 3.25, supplier_id: byName["Casa Dairy"] },
      { org_id: orgId, name: "All-purpose flour", sku: "DG-004", category: "Dry Goods", unit: "lb", quantity: 0, reorder_level: 15, unit_cost: 0.65, supplier_id: byName["Metro Dry Goods"] },
      { org_id: orgId, name: "Espresso beans", sku: "BV-010", category: "Beverages", unit: "lb", quantity: 0, reorder_level: 10, unit_cost: 8.75, supplier_id: byName["Metro Dry Goods"] },
      { org_id: orgId, name: "12oz paper cups", sku: "PP-020", category: "Paper", unit: "sleeve", quantity: 0, reorder_level: 20, unit_cost: 4.5, supplier_id: byName["Metro Dry Goods"] },
      { org_id: orgId, name: "Olive oil", sku: "DG-019", category: "Dry Goods", unit: "L", quantity: 0, reorder_level: 4, unit_cost: 11, supplier_id: byName["Metro Dry Goods"] },
    ])
    .select("id, sku");
  if (itemError || !items) throw itemError ?? new Error("Failed to insert items");

  const itemBySku = Object.fromEntries(items.map((i) => [i.sku, i.id]));

  const movements = [
    { sku: "PR-001", delta: 40, reason: "purchase", note: "Opening PO #1042" },
    { sku: "PR-001", delta: -28, reason: "usage", note: "Weekend service" },
    { sku: "PR-014", delta: 12, reason: "purchase", note: "Opening PO #1042" },
    { sku: "PR-014", delta: -6, reason: "usage", note: "Salads" },
    { sku: "PT-003", delta: 50, reason: "purchase", note: "Sysco drop" },
    { sku: "PT-003", delta: -32, reason: "usage", note: "Dinner service" },
    { sku: "PT-011", delta: 16, reason: "purchase", note: "Friday fish" },
    { sku: "PT-011", delta: -9, reason: "usage", note: "Specials" },
    { sku: "DY-002", delta: 10, reason: "purchase", note: "Casa Dairy" },
    { sku: "DY-002", delta: -7, reason: "usage", note: "Barista station" },
    { sku: "DY-008", delta: 12, reason: "purchase", note: "Casa Dairy" },
    { sku: "DY-008", delta: -5, reason: "usage", note: "Sauces" },
    { sku: "DG-004", delta: 50, reason: "purchase", note: "Bulk bag" },
    { sku: "DG-004", delta: -18, reason: "usage", note: "Pastry" },
    { sku: "BV-010", delta: 20, reason: "purchase", note: "Roaster drop" },
    { sku: "BV-010", delta: -6, reason: "usage", note: "Espresso" },
    { sku: "PP-020", delta: 24, reason: "purchase", note: "To-go stock" },
    { sku: "PP-020", delta: -8, reason: "usage", note: "Weekend" },
    { sku: "DG-019", delta: 6, reason: "purchase", note: "Metro" },
    { sku: "DG-019", delta: -1, reason: "waste", note: "Leaking tin" },
  ];

  const { error: moveError } = await admin.from("stock_movements").insert(
    movements.map((m) => ({
      org_id: orgId,
      item_id: itemBySku[m.sku],
      delta: m.delta,
      reason: m.reason,
      note: m.note,
      created_by: userId,
    })),
  );
  if (moveError) throw moveError;
  console.log("Seeded Pacifico Kitchen inventory.");
}

async function ensureStaffUser(staffEmail: string, orgId: string): Promise<string> {
  const existing = await findUserId(staffEmail);
  if (existing) {
    await admin.from("memberships").upsert({
      user_id: existing,
      org_id: orgId,
      role: "staff",
    });
    return existing;
  }

  const userId = await findOrCreateUser(staffEmail, staffPassword);
  await admin.from("memberships").upsert({
    user_id: userId,
    org_id: orgId,
    role: "staff",
  });
  return userId;
}

async function seedSchedule(orgId: string, ownerId: string) {
  const { count, error: countError } = await admin
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);
  if (countError) throw countError;
  if ((count ?? 0) > 0) {
    console.log(`Org already has ${count} employee(s); skipping schedule seed.`);
    return;
  }

  const roster = [
    { full_name: "Sofia Reyes", email: "server@berrify.local", phone: "787-555-1001", position: "Server", hourly_rate: 12, login: true },
    { full_name: "Marco Diaz", email: "cook@berrify.local", phone: "787-555-1002", position: "Cook", hourly_rate: 16, login: true },
    { full_name: "Elena Cruz", email: "host@pacifico.example", phone: "787-555-1003", position: "Host", hourly_rate: 11, login: false },
    { full_name: "Luis Ortega", email: "bar@pacifico.example", phone: "787-555-1004", position: "Bartender", hourly_rate: 14, login: false },
    { full_name: "Nina Velez", email: "dish@pacifico.example", phone: "787-555-1005", position: "Dish", hourly_rate: 10, login: false },
  ];

  const { data: employees, error: empError } = await admin
    .from("employees")
    .insert(
      roster.map((row) => ({
        org_id: orgId,
        full_name: row.full_name,
        email: row.email,
        phone: row.phone,
        position: row.position,
        hourly_rate: row.hourly_rate,
        active: true,
      })),
    )
    .select("id, email, full_name");
  if (empError || !employees) throw empError ?? new Error("Failed to insert employees");

  const byEmail = Object.fromEntries(employees.map((e) => [e.email, e.id]));

  for (const row of roster.filter((r) => r.login)) {
    const userId = await ensureStaffUser(row.email, orgId);
    const { error } = await admin
      .from("employees")
      .update({ user_id: userId })
      .eq("id", byEmail[row.email]);
    if (error) throw error;
  }

  const sofia = byEmail["server@berrify.local"];
  const marco = byEmail["cook@berrify.local"];
  const elena = byEmail["host@pacifico.example"];
  const luis = byEmail["bar@pacifico.example"];
  const nina = byEmail["dish@pacifico.example"];

  const rows = [
    { employee_id: sofia, position: "Server", starts_at: atHour(1, 16), ends_at: atHour(1, 22), status: "published", note: "Dinner floor" },
    { employee_id: marco, position: "Cook", starts_at: atHour(1, 15), ends_at: atHour(1, 23), status: "published", note: "Line lead" },
    { employee_id: elena, position: "Host", starts_at: atHour(1, 16), ends_at: atHour(1, 21), status: "published", note: null },
    { employee_id: sofia, position: "Server", starts_at: atHour(3, 11), ends_at: atHour(3, 16), status: "published", note: "Lunch" },
    { employee_id: sofia, position: "Server", starts_at: atHour(4, 16), ends_at: atHour(4, 22), status: "published", note: "Dinner" },
    { employee_id: marco, position: "Cook", starts_at: atHour(4, 14), ends_at: atHour(4, 22), status: "published", note: null },
    { employee_id: luis, position: "Bartender", starts_at: atHour(5, 16), ends_at: atHour(5, 23), status: "published", note: "Weekend bar" },
    { employee_id: nina, position: "Dish", starts_at: atHour(5, 16), ends_at: atHour(5, 23), status: "published", note: null },
    { employee_id: null, position: "Server", starts_at: atHour(5, 17), ends_at: atHour(5, 23), status: "published", note: "Open Friday night" },
    { employee_id: sofia, position: "Server", starts_at: atHour(6, 16), ends_at: atHour(6, 22), status: "published", note: "Saturday dinner" },
    { employee_id: marco, position: "Cook", starts_at: atHour(6, 14), ends_at: atHour(6, 22), status: "draft", note: "Hold for cover" },
    { employee_id: elena, position: "Host", starts_at: atHour(6, 16), ends_at: atHour(6, 21), status: "draft", note: "Draft host" },
  ];

  const { error: shiftError } = await admin.from("staff_shifts").insert(
    rows.map((row) => ({
      org_id: orgId,
      employee_id: row.employee_id,
      position: row.position,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      status: row.status,
      note: row.note,
      created_by: ownerId,
    })),
  );
  if (shiftError) throw shiftError;
  console.log("Seeded Pacifico Kitchen schedule.");
}

async function seedInvoices(orgId: string, userId: string) {
  const joseId = await ensureSupplier(orgId, "Jose Santiago Inc", {
    contact_email: "billing@josesantiago.example",
    phone: "787-555-0249",
    notes: "QBO vendor for Jose Santiago / CAN ENTERPRISE letterhead invoices.",
  });
  const ballesterId = await ensureSupplier(orgId, "Ballester Hermanos Inc", {
    contact_email: "billing@ballester.example",
    phone: "787-555-1914",
    notes: "Wholesale. Terms Net 30 (BC 30 DAYS). Customer on the form is CAN ENTERPRISE.",
  });
  const supermaxId = await ensureSupplier(orgId, "SuperMax", {
    contact_email: "condado@supermax.example",
    phone: "787-723-1611",
    notes: "Condado SuperMax self-checkout receipts.",
  });
  const drouynId = await ensureSupplier(orgId, "Drouyn & Co", {
    contact_email: "billing@drouyn.example",
    phone: "787-765-6643",
    notes: "Produce. Terms Net 7. Skip back-ordered lines.",
  });
  const santurceId = await ensureSupplier(orgId, "Santurce Brewing Inc", {
    contact_email: "billing@santurcebrewing.example",
    phone: "787-555-1356",
    notes: "Beer. Terms Net 15. Expense account 50010 Beverage Purchases.",
  });
  const fernandezId = await ensureSupplier(orgId, "B. Fernandez & Hnos Inc", {
    contact_email: "billing@bfernandez.example",
    phone: "787-288-7272",
    notes: "Liquor. Terms Net 30. Customer on the form is KANE RUM BAR.",
  });
  const northwesternId = await ensureSupplier(orgId, "Northwestern Selecta", {
    contact_email: "billing@northwesternselecta.example",
    phone: "787-781-1950",
    notes: "Protein. Terms Net 7. Weight lines (cajas / libras / por libra).",
  });

  const aliases = [
    { match_text: "jose santiago", qbo_vendor_name: "Jose Santiago Inc", supplier_id: joseId },
    { match_text: "ballester", qbo_vendor_name: "Ballester Hermanos Inc", supplier_id: ballesterId },
    { match_text: "supermax", qbo_vendor_name: "SuperMax", supplier_id: supermaxId },
    { match_text: "drouyn", qbo_vendor_name: "Drouyn & Co", supplier_id: drouynId },
    { match_text: "santurce", qbo_vendor_name: "Santurce Brewing Inc", supplier_id: santurceId },
    { match_text: "fernandez", qbo_vendor_name: "B. Fernandez & Hnos Inc", supplier_id: fernandezId },
    { match_text: "fernández", qbo_vendor_name: "B. Fernandez & Hnos Inc", supplier_id: fernandezId },
    { match_text: "northwestern", qbo_vendor_name: "Northwestern Selecta", supplier_id: northwesternId },
    { match_text: "selecta", qbo_vendor_name: "Northwestern Selecta", supplier_id: northwesternId },
  ];
  const { error: aliasError } = await admin.from("vendor_aliases").upsert(
    aliases.map((a) => ({
      org_id: orgId,
      match_text: a.match_text,
      supplier_id: a.supplier_id,
      qbo_vendor_name: a.qbo_vendor_name,
    })),
    { onConflict: "org_id,match_text" },
  );
  if (aliasError) throw aliasError;

  const { error: ruleError } = await admin.from("account_rules").upsert(
    DEFAULT_ACCOUNT_RULES.map((rule) => ({
      org_id: orgId,
      keyword: rule.keyword,
      account: rule.account,
      memo: rule.memo,
      category: rule.category,
    })),
    { onConflict: "org_id,keyword" },
  );
  if (ruleError) throw ruleError;

  const { count, error: countError } = await admin
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("invoice_number", "6512495");
  if (countError) throw countError;
  if ((count ?? 0) > 0) {
    console.log("Jose Santiago sample bill already present; vendors/aliases upserted.");
    return;
  }

  const extracted = extractInvoiceFromText(JOSE_SANTIAGO_OCR, aliases);
  const { data: invoice, error: invError } = await admin
    .from("invoices")
    .insert({
      org_id: orgId,
      supplier_id: joseId,
      vendor_name: "CAN ENTERPRISE LLC",
      invoice_number: extracted.invoice_number,
      invoice_date: extracted.invoice_date,
      due_date: extracted.due_date,
      terms: extracted.terms,
      subtotal: extracted.subtotal,
      tax: extracted.tax,
      total: extracted.total,
      ap_account: ACCOUNTS.ap,
      status: "extracted",
      source: "upload",
      caption: "Seeded from Jose Santiago $1,155.59 example",
      ocr_text: JOSE_SANTIAGO_OCR,
      created_by: userId,
    })
    .select("id")
    .single();
  if (invError || !invoice) throw invError ?? new Error("Failed to insert sample invoice");

  const { error: lineError } = await admin.from("invoice_lines").insert(
    extracted.lines.map((line) => ({
      org_id: orgId,
      invoice_id: invoice.id,
      code: line.code,
      description: line.description,
      qty_ordered: line.qty_ordered,
      qty_shipped: line.qty_shipped,
      uom: line.uom,
      pounds: line.pounds,
      unit_price: line.unit_price,
      amount: line.amount,
      category: line.category,
    })),
  );
  if (lineError) throw lineError;

  const { error: expError } = await admin.from("invoice_expense_lines").insert(
    extracted.expenses.map((line, index) => ({
      org_id: orgId,
      invoice_id: invoice.id,
      account: line.account,
      amount: line.amount,
      memo: line.memo,
      sort_order: index,
    })),
  );
  if (expError) throw expError;
  console.log("Seeded Jose Santiago Inc aliases, account rules, and $1,155.59 sample bill.");
}

async function main() {
  const userId = await findOrCreateUser(email, password, "Pacifico Kitchen");
  const orgId = await orgForUser(userId);
  await seedInventory(orgId, userId);
  await seedSchedule(orgId, userId);
  await seedInvoices(orgId, userId);
  console.log(`Manager login: ${email}`);
  console.log("Staff login: server@berrify.local / cook@berrify.local");
}

await main();
