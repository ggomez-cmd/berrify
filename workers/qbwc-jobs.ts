import {
  restUrl,
  supabaseHeaders,
  type QbwcConnectionRow,
  type QbwcRestEnv,
} from "./qbwc-auth";
import { buildCompanyQueryRq, buildVendorQueryRq } from "./qbxml";

export const COMPANY_QUERY_OPERATION = "company_query";
export const COMPANY_QUERY_ENTITY_TYPE = "connection";
export const VENDOR_QUERY_OPERATION = "vendor_query";
export const VENDOR_QUERY_ENTITY_TYPE = "connection";
export const BILL_ADD_OPERATION = "bill_add";
export const BILL_ADD_ENTITY_TYPE = "invoice";

export type JobStatus = "pending" | "sending" | "completed" | "failed";

export type QbwcJobRow = {
  id: string;
  org_id: string;
  connection_id: string;
  status: JobStatus;
  operation: string;
  entity_type: string;
  entity_id: string;
  attempt_count: number;
  qbxml_request: string | null;
  qbxml_response: string | null;
  quickbooks_txn_id: string | null;
  edit_sequence: string | null;
  error_code: string | null;
  error_message: string | null;
};

export function companyQueryJobKey(connectionId: string): {
  operation: typeof COMPANY_QUERY_OPERATION;
  entity_type: typeof COMPANY_QUERY_ENTITY_TYPE;
  entity_id: string;
} {
  return {
    operation: COMPANY_QUERY_OPERATION,
    entity_type: COMPANY_QUERY_ENTITY_TYPE,
    entity_id: connectionId,
  };
}

export function shouldEnqueueCompanyQuery(connection: Pick<QbwcConnectionRow, "last_connected_at">): boolean {
  return !connection.last_connected_at;
}

export function vendorQueryJobKey(connectionId: string): {
  operation: typeof VENDOR_QUERY_OPERATION;
  entity_type: typeof VENDOR_QUERY_ENTITY_TYPE;
  entity_id: string;
} {
  return {
    operation: VENDOR_QUERY_OPERATION,
    entity_type: VENDOR_QUERY_ENTITY_TYPE,
    entity_id: connectionId,
  };
}

export function billAddJobKey(invoiceId: string): {
  operation: typeof BILL_ADD_OPERATION;
  entity_type: typeof BILL_ADD_ENTITY_TYPE;
  entity_id: string;
} {
  return {
    operation: BILL_ADD_OPERATION,
    entity_type: BILL_ADD_ENTITY_TYPE,
    entity_id: invoiceId,
  };
}

export function qbxmlRequestForClaim(job: Pick<QbwcJobRow, "operation" | "qbxml_request">): string | null {
  if (job.qbxml_request) return job.qbxml_request;
  if (job.operation === COMPANY_QUERY_OPERATION) return buildCompanyQueryRq();
  if (job.operation === VENDOR_QUERY_OPERATION) return buildVendorQueryRq();
  return null;
}

export async function enqueueCompanyQueryJob(
  env: QbwcRestEnv,
  connection: Pick<QbwcConnectionRow, "id" | "org_id">,
  fetchImpl: typeof fetch,
): Promise<"inserted" | "duplicate" | "error"> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) return "error";
  const key = companyQueryJobKey(connection.id);
  await fetchImpl(
    restUrl(
      supabaseUrl,
      `quickbooks_sync_jobs?connection_id=eq.${encodeURIComponent(connection.id)}&entity_type=eq.${key.entity_type}&entity_id=eq.${encodeURIComponent(key.entity_id)}&operation=eq.${key.operation}&status=eq.failed`,
    ),
    {
      method: "PATCH",
      headers: { ...supabaseHeaders(serviceRole), Prefer: "return=minimal" },
      body: JSON.stringify({ status: "pending", error_code: null, error_message: null }),
    },
  );
  const response = await fetchImpl(
    restUrl(supabaseUrl, "quickbooks_sync_jobs?on_conflict=connection_id,entity_type,entity_id,operation"),
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(serviceRole),
        Prefer: "return=minimal,resolution=ignore-duplicates",
      },
      body: JSON.stringify({
        org_id: connection.org_id,
        connection_id: connection.id,
        status: "pending",
        operation: key.operation,
        entity_type: key.entity_type,
        entity_id: key.entity_id,
        qbxml_request: buildCompanyQueryRq(),
      }),
    },
  );
  if (response.status === 409) return "duplicate";
  if (!response.ok) return "error";
  return "inserted";
}

export async function enqueueVendorQueryJob(
  env: QbwcRestEnv,
  connection: Pick<QbwcConnectionRow, "id" | "org_id">,
  fetchImpl: typeof fetch,
  options: { refresh?: boolean } = {},
): Promise<"inserted" | "duplicate" | "retried" | "error"> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) return "error";
  const key = vendorQueryJobKey(connection.id);
  const existing = await loadJobByKey(env, connection.id, key, fetchImpl);
  if (existing?.status === "pending" || existing?.status === "sending") {
    return "duplicate";
  }
  if (existing && (existing.status === "failed" || (options.refresh && existing.status === "completed"))) {
    const reset = await fetchImpl(
      restUrl(supabaseUrl, `quickbooks_sync_jobs?id=eq.${encodeURIComponent(existing.id)}`),
      {
        method: "PATCH",
        headers: { ...supabaseHeaders(serviceRole), Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "pending",
          error_code: null,
          error_message: null,
          qbxml_request: buildVendorQueryRq(),
          qbxml_response: null,
        }),
      },
    );
    return reset.ok ? "retried" : "error";
  }
  const response = await fetchImpl(
    restUrl(supabaseUrl, "quickbooks_sync_jobs?on_conflict=connection_id,entity_type,entity_id,operation"),
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(serviceRole),
        Prefer: "return=minimal,resolution=ignore-duplicates",
      },
      body: JSON.stringify({
        org_id: connection.org_id,
        connection_id: connection.id,
        status: "pending",
        operation: key.operation,
        entity_type: key.entity_type,
        entity_id: key.entity_id,
        qbxml_request: buildVendorQueryRq(),
      }),
    },
  );
  if (response.status === 409) return "duplicate";
  if (!response.ok) return "error";
  return "inserted";
}

export async function enqueueBillAddJob(
  env: QbwcRestEnv,
  input: {
    orgId: string;
    connectionId: string;
    invoiceId: string;
    qbxmlRequest: string;
  },
  fetchImpl: typeof fetch,
): Promise<{ result: "inserted" | "duplicate" | "retried" | "error"; job: QbwcJobRow | null }> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) return { result: "error", job: null };
  const key = billAddJobKey(input.invoiceId);
  const existing = await loadJobByKey(env, input.connectionId, key, fetchImpl);
  if (existing?.status === "completed") {
    return { result: "duplicate", job: existing };
  }
  if (existing?.status === "pending" || existing?.status === "sending") {
    return { result: "duplicate", job: existing };
  }
  if (existing?.status === "failed") {
    const reset = await fetchImpl(
      restUrl(
        supabaseUrl,
        `quickbooks_sync_jobs?id=eq.${encodeURIComponent(existing.id)}&status=eq.failed`,
      ),
      {
        method: "PATCH",
        headers: { ...supabaseHeaders(serviceRole), Prefer: "return=representation" },
        body: JSON.stringify({
          status: "pending",
          error_code: null,
          error_message: null,
          qbxml_request: input.qbxmlRequest,
          qbxml_response: null,
        }),
      },
    );
    if (!reset.ok) return { result: "error", job: null };
    const rows = (await reset.json()) as QbwcJobRow[];
    return { result: "retried", job: rows[0] ?? existing };
  }
  const response = await fetchImpl(
    restUrl(supabaseUrl, "quickbooks_sync_jobs?on_conflict=connection_id,entity_type,entity_id,operation"),
    {
      method: "POST",
      headers: {
        ...supabaseHeaders(serviceRole),
        Prefer: "return=representation,resolution=ignore-duplicates",
      },
      body: JSON.stringify({
        org_id: input.orgId,
        connection_id: input.connectionId,
        status: "pending",
        operation: key.operation,
        entity_type: key.entity_type,
        entity_id: key.entity_id,
        qbxml_request: input.qbxmlRequest,
      }),
    },
  );
  if (response.status === 409) {
    return { result: "duplicate", job: await loadJobByKey(env, input.connectionId, key, fetchImpl) };
  }
  if (!response.ok) return { result: "error", job: null };
  const created = (await response.json()) as QbwcJobRow[];
  return { result: created[0] ? "inserted" : "duplicate", job: created[0] ?? (await loadJobByKey(env, input.connectionId, key, fetchImpl)) };
}

async function loadJobByKey(
  env: QbwcRestEnv,
  connectionId: string,
  key: { operation: string; entity_type: string; entity_id: string },
  fetchImpl: typeof fetch,
): Promise<QbwcJobRow | null> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) return null;
  const response = await fetchImpl(
    restUrl(
      supabaseUrl,
      `quickbooks_sync_jobs?connection_id=eq.${encodeURIComponent(connectionId)}&entity_type=eq.${encodeURIComponent(key.entity_type)}&entity_id=eq.${encodeURIComponent(key.entity_id)}&operation=eq.${encodeURIComponent(key.operation)}&limit=1`,
    ),
    { headers: { ...supabaseHeaders(serviceRole), Accept: "application/json" } },
  );
  if (!response.ok) return null;
  const rows = (await response.json()) as QbwcJobRow[];
  return rows[0] ?? null;
}

export async function markInvoiceQuickbooksBill(
  env: QbwcRestEnv,
  invoiceId: string,
  patch: { quickbooks_txn_id: string | null; quickbooks_edit_sequence: string | null },
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) return false;
  const response = await fetchImpl(
    restUrl(supabaseUrl, `invoices?id=eq.${encodeURIComponent(invoiceId)}`),
    {
      method: "PATCH",
      headers: { ...supabaseHeaders(serviceRole), Prefer: "return=minimal" },
      body: JSON.stringify({
        status: "exported",
        exported_at: new Date().toISOString(),
        quickbooks_txn_id: patch.quickbooks_txn_id,
        quickbooks_edit_sequence: patch.quickbooks_edit_sequence,
      }),
    },
  );
  return response.ok;
}

export async function claimNextPendingJob(
  env: QbwcRestEnv,
  connectionId: string,
  fetchImpl: typeof fetch,
): Promise<QbwcJobRow | null> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) return null;

  const sendingRes = await fetchImpl(
    restUrl(
      supabaseUrl,
      `quickbooks_sync_jobs?connection_id=eq.${encodeURIComponent(connectionId)}&status=eq.sending&order=created_at.asc&limit=1`,
    ),
    { headers: { ...supabaseHeaders(serviceRole), Accept: "application/json" } },
  );
  if (sendingRes.ok) {
    const sending = (await sendingRes.json()) as QbwcJobRow[];
    if (sending[0]) return sending[0];
  }

  const pendingRes = await fetchImpl(
    restUrl(
      supabaseUrl,
      `quickbooks_sync_jobs?connection_id=eq.${encodeURIComponent(connectionId)}&status=eq.pending&order=created_at.asc&limit=1`,
    ),
    { headers: { ...supabaseHeaders(serviceRole), Accept: "application/json" } },
  );
  if (!pendingRes.ok) return null;
  const pending = (await pendingRes.json()) as QbwcJobRow[];
  const job = pending[0];
  if (!job) return null;

  const claim = await fetchImpl(
    restUrl(
      supabaseUrl,
      `quickbooks_sync_jobs?id=eq.${encodeURIComponent(job.id)}&status=eq.pending`,
    ),
    {
      method: "PATCH",
      headers: {
        ...supabaseHeaders(serviceRole),
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        status: "sending",
        attempt_count: (job.attempt_count ?? 0) + 1,
        qbxml_request: qbxmlRequestForClaim(job),
      }),
    },
  );
  if (!claim.ok) return null;
  const claimed = (await claim.json()) as QbwcJobRow[];
  return claimed[0] ?? null;
}

export async function completeJob(
  env: QbwcRestEnv,
  jobId: string,
  patch: Pick<QbwcJobRow, "qbxml_response"> &
    Partial<Pick<QbwcJobRow, "quickbooks_txn_id" | "edit_sequence" | "error_code" | "error_message">>,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  return patchJob(env, jobId, { ...patch, status: "completed" }, fetchImpl);
}

export async function failJob(
  env: QbwcRestEnv,
  jobId: string,
  patch: Partial<Pick<QbwcJobRow, "qbxml_response" | "error_code" | "error_message">>,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  return patchJob(env, jobId, { ...patch, status: "failed" }, fetchImpl);
}

async function patchJob(
  env: QbwcRestEnv,
  jobId: string,
  patch: Partial<QbwcJobRow>,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRole) return false;
  const response = await fetchImpl(
    restUrl(supabaseUrl, `quickbooks_sync_jobs?id=eq.${encodeURIComponent(jobId)}`),
    {
      method: "PATCH",
      headers: { ...supabaseHeaders(serviceRole), Prefer: "return=minimal" },
      body: JSON.stringify(patch),
    },
  );
  return response.ok;
}

export function jobOpcode(job: Pick<QbwcJobRow, "operation">): string {
  return job.operation;
}
