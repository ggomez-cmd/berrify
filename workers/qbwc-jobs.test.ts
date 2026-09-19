import { describe, expect, it } from "vitest";
import {
  claimNextPendingJob,
  COMPANY_QUERY_OPERATION,
  companyQueryJobKey,
  completeJob,
  enqueueCompanyQueryJob,
  failJob,
  shouldEnqueueCompanyQuery,
  type QbwcJobRow,
} from "./qbwc-jobs";

type Store = {
  jobs: QbwcJobRow[];
};

function jobRow(overrides: Partial<QbwcJobRow> = {}): QbwcJobRow {
  return {
    id: "job-1",
    org_id: "org-1",
    connection_id: "conn-1",
    status: "pending",
    operation: COMPANY_QUERY_OPERATION,
    entity_type: "connection",
    entity_id: "conn-1",
    attempt_count: 0,
    qbxml_request: "<CompanyQueryRq></CompanyQueryRq>",
    qbxml_response: null,
    quickbooks_txn_id: null,
    edit_sequence: null,
    error_code: null,
    error_message: null,
    ...overrides,
  };
}

function mockJobsFetch(store: Store): typeof fetch {
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const parsed = new URL(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Partial<QbwcJobRow>) : {};
    if (!url.includes("/rest/v1/quickbooks_sync_jobs")) {
      throw new Error(`unexpected ${method} ${url}`);
    }
    if (method === "POST") {
      const key = `${body.connection_id}:${body.entity_type}:${body.entity_id}:${body.operation}`;
      const exists = store.jobs.some(
        (job) => `${job.connection_id}:${job.entity_type}:${job.entity_id}:${job.operation}` === key,
      );
      if (exists) return new Response(null, { status: 409 });
      store.jobs.push(
        jobRow({
          id: `job-${store.jobs.length + 1}`,
          org_id: body.org_id ?? "org-1",
          connection_id: body.connection_id ?? "conn-1",
          status: "pending",
          operation: body.operation ?? COMPANY_QUERY_OPERATION,
          entity_type: body.entity_type ?? "connection",
          entity_id: body.entity_id ?? "conn-1",
          qbxml_request: body.qbxml_request ?? null,
        }),
      );
      return new Response(null, { status: 201 });
    }
    if (method === "GET") {
      const connectionId = parsed.searchParams.get("connection_id")?.replace(/^eq\./, "");
      const status = parsed.searchParams.get("status")?.replace(/^eq\./, "");
      const rows = store.jobs.filter(
        (job) => job.connection_id === connectionId && (!status || job.status === status),
      );
      return Response.json(rows.slice(0, 1));
    }
    if (method === "PATCH") {
      const id = parsed.searchParams.get("id")?.replace(/^eq\./, "");
      const status = parsed.searchParams.get("status")?.replace(/^eq\./, "");
      const job = store.jobs.find((row) => row.id === id && (!status || row.status === status));
      if (!job) return Response.json([]);
      Object.assign(job, body);
      return Response.json([job]);
    }
    throw new Error(`unexpected ${method} ${url}`);
  };
  return fetchImpl;
}

const env = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
};

describe("QBWC jobs", () => {
  it("keys company_query to the connection id", () => {
    expect(companyQueryJobKey("conn-1")).toEqual({
      operation: "company_query",
      entity_type: "connection",
      entity_id: "conn-1",
    });
    expect(shouldEnqueueCompanyQuery({ last_connected_at: null })).toBe(true);
    expect(shouldEnqueueCompanyQuery({ last_connected_at: "2026-09-19T00:00:00.000Z" })).toBe(false);
  });

  it("claims pending → sending and completes or fails", async () => {
    const store: Store = { jobs: [jobRow()] };
    const fetchImpl = mockJobsFetch(store);
    const claimed = await claimNextPendingJob(env, "conn-1", fetchImpl);
    expect(claimed?.status).toBe("sending");
    expect(claimed?.attempt_count).toBe(1);
    const again = await claimNextPendingJob(env, "conn-1", fetchImpl);
    expect(again?.id).toBe(claimed?.id);
    expect(again?.status).toBe("sending");
    await completeJob(env, claimed!.id, { qbxml_response: "<ok/>" }, fetchImpl);
    expect(store.jobs[0]?.status).toBe("completed");
    store.jobs[0]!.status = "sending";
    await failJob(env, claimed!.id, { error_code: "3120", error_message: "Object not found" }, fetchImpl);
    expect(store.jobs[0]).toMatchObject({ status: "failed", error_code: "3120" });
  });

  it("treats a duplicate unique key as duplicate, not a second job", async () => {
    const store: Store = { jobs: [] };
    const fetchImpl = mockJobsFetch(store);
    const first = await enqueueCompanyQueryJob(env, { id: "conn-1", org_id: "org-1" }, fetchImpl);
    const second = await enqueueCompanyQueryJob(env, { id: "conn-1", org_id: "org-1" }, fetchImpl);
    expect(first).toBe("inserted");
    expect(second).toBe("duplicate");
    expect(store.jobs).toHaveLength(1);
  });

  it("does not let org B claim org A jobs", async () => {
    const store: Store = { jobs: [jobRow({ org_id: "org-a", connection_id: "conn-a" })] };
    const fetchImpl = mockJobsFetch(store);
    const claimed = await claimNextPendingJob(env, "conn-b", fetchImpl);
    expect(claimed).toBeNull();
  });
});
