import {
  restUrl,
  supabaseHeaders,
  type QbwcConnectionRow,
  type QbwcRestEnv,
} from "./qbwc-auth";
import { buildCompanyQueryRq } from "./qbxml";

export const COMPANY_QUERY_OPERATION = "company_query";
export const COMPANY_QUERY_ENTITY_TYPE = "connection";

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
        qbxml_request: job.qbxml_request ?? buildCompanyQueryRq(),
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
