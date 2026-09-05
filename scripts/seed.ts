import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = process.env.DEMO_EMAIL ?? process.env.NEXT_PUBLIC_DEMO_EMAIL ?? "demo@berrify.local";
const password = process.env.DEMO_PASSWORD ?? process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "BerrifyDemo2026!";

if (!url || !serviceRole) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const admin = createClient(url, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function findOrCreateUser(): Promise<string> {
  const perPage = 200;
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((u) => u.email === email);
    if (found) return found.id;
    if (data.users.length < perPage) break;
    page += 1;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { org_name: "Pacifico Kitchen" },
  });
  if (error || !data.user) throw error ?? new Error("Failed to create demo user");
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

async function main() {
  const userId = await findOrCreateUser();
  const orgId = await orgForUser(userId);

  const { count, error: countError } = await admin
    .from("inventory_items")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);
  if (countError) throw countError;
  if ((count ?? 0) > 0) {
    console.log(`Org already has ${count} item(s); skipping seed.`);
    console.log(`Demo login: ${email}`);
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
  console.log(`Demo login: ${email}`);
}

await main();
