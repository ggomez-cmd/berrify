import { restUrl, supabaseHeaders, type QbwcRestEnv } from "./qbwc-auth";
import type { VendorQueryRow } from "./qbxml";

export type StoredQbVendor = {
  connection_id: string;
  list_id: string;
  full_name: string;
  company_name: string | null;
  is_active: boolean;
};

export async function upsertVendorsFromQuery(
  env: QbwcRestEnv,
  input: {
    orgId: string;
    connectionId: string;
    vendors: VendorQueryRow[];
  },
  fetchImpl: typeof fetch,
): Promise<{ upserted: number; deactivated: number } | null> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) return null;

  const incomingIds = new Set(input.vendors.map((row) => row.listId));
  const existingRes = await fetchImpl(
    restUrl(
      supabaseUrl,
      `quickbooks_vendors?connection_id=eq.${encodeURIComponent(input.connectionId)}&select=list_id`,
    ),
    { headers: { ...supabaseHeaders(serviceRole), Accept: "application/json" } },
  );
  if (!existingRes.ok) return null;
  const existing = (await existingRes.json()) as Array<{ list_id: string }>;

  if (input.vendors.length > 0) {
    const upsert = await fetchImpl(
      restUrl(supabaseUrl, "quickbooks_vendors?on_conflict=connection_id,list_id"),
      {
        method: "POST",
        headers: {
          ...supabaseHeaders(serviceRole),
          Prefer: "return=minimal,resolution=merge-duplicates",
        },
        body: JSON.stringify(
          input.vendors.map((row) => ({
            org_id: input.orgId,
            connection_id: input.connectionId,
            list_id: row.listId,
            full_name: row.fullName,
            company_name: row.companyName,
            is_active: row.isActive,
          })),
        ),
      },
    );
    if (!upsert.ok) return null;
  }

  const missing = existing.filter((row) => !incomingIds.has(row.list_id));
  let deactivated = 0;
  for (const row of missing) {
    const patch = await fetchImpl(
      restUrl(
        supabaseUrl,
        `quickbooks_vendors?connection_id=eq.${encodeURIComponent(input.connectionId)}&list_id=eq.${encodeURIComponent(row.list_id)}`,
      ),
      {
        method: "PATCH",
        headers: { ...supabaseHeaders(serviceRole), Prefer: "return=minimal" },
        body: JSON.stringify({ is_active: false }),
      },
    );
    if (patch.ok) deactivated += 1;
  }

  return { upserted: input.vendors.length, deactivated };
}
