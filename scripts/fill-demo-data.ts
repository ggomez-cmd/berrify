import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import dotenv from "dotenv";
import { ACCOUNTS } from "../src/lib/invoice-extract.ts";
import { DEMO_FILL_NOTE, demoWeekShifts } from "../src/lib/demo-fill.ts";

dotenv.config();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const email = process.env.DEMO_EMAIL ?? process.env.NEXT_PUBLIC_DEMO_EMAIL ?? "demo@berrify.local";
const password = process.env.DEMO_PASSWORD ?? process.env.NEXT_PUBLIC_DEMO_PASSWORD ?? "12345678";

if (!url || !anonKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required.");
}

const supabaseUrl = url;
const supabaseAnonKey = anonKey;

type EmployeeRow = {
  id: string;
  email: string | null;
  full_name: string;
  position: string;
};

function client(): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signIn(sb: SupabaseClient, userEmail: string): Promise<string> {
  const { data, error } = await sb.auth.signInWithPassword({ email: userEmail, password });
  if (error || !data.user) throw error ?? new Error(`Failed to sign in ${userEmail}`);
  return data.user.id;
}

async function punch(
  sb: SupabaseClient,
  employeeId: string,
  eventType: "clock_in" | "break_start" | "break_end" | "clock_out",
  occurredAt: string,
  reason: string,
) {
  const { error } = await sb.rpc("manager_record_punch", {
    employee_id: employeeId,
    event_type: eventType,
    occurred_at: occurredAt,
    reason,
    client_event_id: randomUUID(),
  });
  if (error) throw error;
}

async function fillEmployees(sb: SupabaseClient, orgId: string): Promise<EmployeeRow[]> {
  const { data: existing, error } = await sb
    .from("employees")
    .select("id, email, full_name, position")
    .eq("org_id", orgId);
  if (error) throw error;
  const rows = (existing ?? []) as EmployeeRow[];
  if (!rows.some((row) => row.email === "manager@pacifico.example")) {
    const { data, error: insertError } = await sb
      .from("employees")
      .insert({
        org_id: orgId,
        full_name: "Pablo Rios",
        email: "manager@pacifico.example",
        phone: "787-555-1006",
        position: "Manager",
        hourly_rate: 18,
        active: true,
      })
      .select("id, email, full_name, position")
      .single();
    if (insertError || !data) throw insertError ?? new Error("Failed to insert Pablo Rios");
    rows.push(data as EmployeeRow);
    console.log("Added floor manager Pablo Rios.");
  }
  return rows;
}

async function fillWeekShifts(
  sb: SupabaseClient,
  orgId: string,
  userId: string,
  employees: EmployeeRow[],
) {
  const { data: existing, error } = await sb
    .from("staff_shifts")
    .select("id")
    .eq("org_id", orgId)
    .like("note", `${DEMO_FILL_NOTE}%`)
    .limit(1);
  if (error) throw error;
  if ((existing ?? []).length > 0) {
    console.log("Current-week demo shifts already present.");
    return;
  }

  const byEmail = Object.fromEntries(employees.filter((row) => row.email).map((row) => [row.email, row.id]));
  const drafts = demoWeekShifts();
  const { error: insertError } = await sb.from("staff_shifts").insert(
    drafts.map((row) => ({
      org_id: orgId,
      employee_id: row.email ? (byEmail[row.email] ?? null) : null,
      position: row.position,
      starts_at: row.startsAt,
      ends_at: row.endsAt,
      status: row.status,
      note: row.note,
      created_by: userId,
    })),
  );
  if (insertError) throw insertError;
  console.log(`Inserted ${drafts.length} current-week shifts.`);
}

async function fillInventory(sb: SupabaseClient, orgId: string, userId: string) {
  const { data: items, error } = await sb
    .from("inventory_items")
    .select("id, sku, quantity")
    .eq("org_id", orgId);
  if (error) throw error;
  const bySku = Object.fromEntries((items ?? []).map((row) => [row.sku, row]));

  if (!bySku["BV-022"]) {
    const { data: created, error: itemError } = await sb
      .from("inventory_items")
      .insert({
        org_id: orgId,
        name: "Sparkling water",
        sku: "BV-022",
        category: "Beverages",
        unit: "case",
        quantity: 0,
        reorder_level: 4,
        unit_cost: 9.5,
      })
      .select("id")
      .single();
    if (itemError || !created) throw itemError ?? new Error("Failed to insert sparkling water");
    bySku["BV-022"] = { id: created.id, sku: "BV-022", quantity: 0 };
    console.log("Added out-of-stock sparkling water.");
  }

  const { count, error: moveCountError } = await sb
    .from("stock_movements")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("note", `${DEMO_FILL_NOTE} dinner usage`);
  if (moveCountError) throw moveCountError;
  if ((count ?? 0) > 0) {
    console.log("Demo stock movements already present.");
    return;
  }

  const roma = bySku["PR-001"];
  const flour = bySku["DG-004"];
  const water = bySku["BV-022"];
  const rows = [
    roma ? { item_id: roma.id, delta: -4, reason: "usage", note: `${DEMO_FILL_NOTE} dinner usage` } : null,
    flour ? { item_id: flour.id, delta: 25, reason: "purchase", note: `${DEMO_FILL_NOTE} Metro restock` } : null,
    water ? { item_id: water.id, delta: 4, reason: "purchase", note: `${DEMO_FILL_NOTE} sparkling in` } : null,
    water ? { item_id: water.id, delta: -4, reason: "usage", note: `${DEMO_FILL_NOTE} sparkling out` } : null,
  ].filter((row): row is NonNullable<typeof row> => row !== null);

  const { error: moveError } = await sb.from("stock_movements").insert(
    rows.map((row) => ({ org_id: orgId, created_by: userId, ...row })),
  );
  if (moveError) throw moveError;
  console.log(`Inserted ${rows.length} stock movements.`);
}

async function fillInvoices(sb: SupabaseClient, orgId: string, userId: string) {
  const { data: existing, error } = await sb
    .from("invoices")
    .select("invoice_number, status")
    .eq("org_id", orgId)
    .in("invoice_number", ["DEMO-RCV-1", "DEMO-REV-1"]);
  if (error) throw error;
  const have = new Set((existing ?? []).map((row) => row.invoice_number));

  const { data: suppliers, error: supError } = await sb
    .from("suppliers")
    .select("id, name")
    .eq("org_id", orgId);
  if (supError) throw supError;
  const valle = (suppliers ?? []).find((row) => row.name === "Valle Produce");
  const metro = (suppliers ?? []).find((row) => row.name === "Metro Dry Goods");

  const { data: restaurants, error: restError } = await sb
    .from("restaurants")
    .select("id, slug")
    .eq("org_id", orgId);
  if (restError) throw restError;
  const semilla = (restaurants ?? []).find((row) => row.slug === "semilla");
  const kane = (restaurants ?? []).find((row) => row.slug === "kane-rum-bar");

  if (!have.has("DEMO-RCV-1")) {
    const { error: insertError } = await sb.from("invoices").insert({
      org_id: orgId,
      restaurant_id: kane?.id ?? null,
      supplier_id: valle?.id ?? null,
      vendor_name: "Valle Produce",
      invoice_number: "DEMO-RCV-1",
      invoice_date: "2026-09-07",
      terms: "Net 7",
      subtotal: 0,
      tax: 0,
      total: 0,
      ap_account: ACCOUNTS.ap,
      status: "received",
      source: "whatsapp",
      caption: `${DEMO_FILL_NOTE} photo waiting for review`,
      whatsapp_group: "Kane invoices",
      ocr_text: null,
      created_by: userId,
    });
    if (insertError) throw insertError;
    console.log("Added received invoice DEMO-RCV-1.");
  }

  if (!have.has("DEMO-REV-1")) {
    const { data: invoice, error: insertError } = await sb
      .from("invoices")
      .insert({
        org_id: orgId,
        restaurant_id: semilla?.id ?? null,
        supplier_id: metro?.id ?? null,
        vendor_name: "Metro Dry Goods",
        invoice_number: "DEMO-REV-1",
        invoice_date: "2026-09-06",
        due_date: "2026-09-21",
        terms: "Net 15",
        subtotal: 86.25,
        tax: 0,
        total: 86.25,
        ap_account: ACCOUNTS.ap,
        status: "reviewed",
        source: "upload",
        caption: `${DEMO_FILL_NOTE} reviewed dry goods bill`,
        created_by: userId,
      })
      .select("id")
      .single();
    if (insertError || !invoice) throw insertError ?? new Error("Failed to insert reviewed invoice");

    const { error: lineError } = await sb.from("invoice_lines").insert([
      {
        org_id: orgId,
        invoice_id: invoice.id,
        code: "DG-004",
        description: "All-purpose flour",
        qty_ordered: 50,
        qty_shipped: 50,
        uom: "lb",
        unit_price: 0.65,
        amount: 32.5,
        category: "food",
      },
      {
        org_id: orgId,
        invoice_id: invoice.id,
        code: "PP-020",
        description: "12oz paper cups",
        qty_ordered: 12,
        qty_shipped: 12,
        uom: "sleeve",
        unit_price: 4.5,
        amount: 54,
        category: "kitchen",
      },
    ]);
    if (lineError) throw lineError;

    const { error: expError } = await sb.from("invoice_expense_lines").insert([
      { org_id: orgId, invoice_id: invoice.id, account: ACCOUNTS.food, amount: 32.5, memo: "Flour", sort_order: 0 },
      { org_id: orgId, invoice_id: invoice.id, account: ACCOUNTS.kitchen, amount: 54, memo: "Cups/ napkins /containers", sort_order: 1 },
    ]);
    if (expError) throw expError;
    console.log("Added reviewed invoice DEMO-REV-1.");
  }
}

async function fillTimeClock(sb: SupabaseClient, orgId: string, employees: EmployeeRow[]) {
  const { count, error } = await sb
    .from("clock_events")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .like("note", `${DEMO_FILL_NOTE}%`);
  if (error) throw error;
  if ((count ?? 0) > 0) {
    console.log("Demo punches already present.");
    return;
  }

  const byEmail = Object.fromEntries(employees.filter((row) => row.email).map((row) => [row.email, row.id]));
  const sofia = byEmail["server@berrify.local"];
  const marco = byEmail["cook@berrify.local"];
  const luis = byEmail["bar@pacifico.example"];
  const nina = byEmail["dish@pacifico.example"];
  if (!sofia || !marco || !luis || !nina) throw new Error("Missing roster emails for punch fill");

  const sunday = demoWeekShifts()[0];
  if (!sunday) throw new Error("No demo shifts");
  // Monday dinner / line from the generated week (index 3 and 4 in builder).
  const week = demoWeekShifts();
  const mondayDinner = week.find((row) => row.note.endsWith("Monday dinner"));
  const mondayLine = week.find((row) => row.note.endsWith("Monday line"));
  if (!mondayDinner || !mondayLine) throw new Error("Monday demo shifts missing");

  await punch(sb, sofia, "clock_in", mondayDinner.startsAt.replace("16:00:00", "16:02:00"), `${DEMO_FILL_NOTE} on time`);
  await punch(sb, sofia, "break_start", mondayDinner.startsAt.replace("16:00:00", "18:30:00"), `${DEMO_FILL_NOTE} meal`);
  await punch(sb, sofia, "break_end", mondayDinner.startsAt.replace("16:00:00", "18:50:00"), `${DEMO_FILL_NOTE} back`);
  await punch(sb, sofia, "clock_out", mondayDinner.endsAt.replace("22:00:00", "22:04:00"), `${DEMO_FILL_NOTE} close`);

  await punch(sb, marco, "clock_in", mondayLine.startsAt.replace("15:00:00", "15:22:00"), `${DEMO_FILL_NOTE} late in`);
  await punch(sb, marco, "break_start", mondayLine.startsAt.replace("15:00:00", "19:00:00"), `${DEMO_FILL_NOTE} long meal`);
  await punch(sb, marco, "break_end", mondayLine.startsAt.replace("15:00:00", "19:45:00"), `${DEMO_FILL_NOTE} back late`);
  await punch(sb, marco, "clock_out", mondayLine.endsAt, `${DEMO_FILL_NOTE} close`);

  await punch(sb, nina, "clock_in", "2026-09-07T10:00:00-04:00", `${DEMO_FILL_NOTE} unscheduled in`);
  await punch(sb, nina, "clock_out", "2026-09-07T13:30:00-04:00", `${DEMO_FILL_NOTE} unscheduled out`);

  const now = Date.now();
  const coverStart = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const coverEnd = new Date(now + 6 * 60 * 60 * 1000).toISOString();
  const { error: coverError } = await sb.from("staff_shifts").insert({
    org_id: orgId,
    employee_id: luis,
    position: "Bartender",
    starts_at: coverStart,
    ends_at: coverEnd,
    status: "published",
    note: `${DEMO_FILL_NOTE} live cover`,
  });
  if (coverError) throw coverError;
  await punch(sb, luis, "clock_in", new Date(now - 25 * 60 * 1000).toISOString(), `${DEMO_FILL_NOTE} on the bar`);

  const { data: session } = await sb.from("clock_sessions").select("employee_id").eq("org_id", orgId);
  console.log(`Inserted demo punches. On clock: ${(session ?? []).length}.`);
}

async function main() {
  const sb = client();
  const userId = await signIn(sb, email);
  const { data: membership, error: memError } = await sb
    .from("memberships")
    .select("org_id, role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (memError || !membership) throw memError ?? new Error("No membership for demo manager");

  const orgId = membership.org_id as string;
  const employees = await fillEmployees(sb, orgId);
  await fillWeekShifts(sb, orgId, userId, employees);
  await fillInventory(sb, orgId, userId);
  await fillInvoices(sb, orgId, userId);
  await fillTimeClock(sb, orgId, employees);
  await sb.auth.signOut();
  console.log("Demo workspace is filled for testing.");
}

await main();
