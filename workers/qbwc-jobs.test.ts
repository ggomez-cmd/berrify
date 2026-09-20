import { describe, expect, it } from "vitest";
import {
  BILL_ADD_OPERATION,
  claimNextPendingJob,
  COMPANY_QUERY_OPERATION,
  companyQueryJobKey,
  completeJob,
  ACCOUNT_QUERY_OPERATION,
  accountQueryJobKey,
  enqueueAccountQueryJob,
  enqueueBillAddJob,
  enqueueCompanyQueryJob,
  enqueueVendorQueryJob,
  VENDOR_QUERY_OPERATION,
  vendorQueryJobKey,
  failJob,
  qbxmlRequestForClaim,
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
      const created = jobRow({
        id: `job-${store.jobs.length + 1}`,
        org_id: body.org_id ?? "org-1",
        connection_id: body.connection_id ?? "conn-1",
        status: "pending",
        operation: body.operation ?? COMPANY_QUERY_OPERATION,
        entity_type: body.entity_type ?? "connection",
        entity_id: body.entity_id ?? "conn-1",
        qbxml_request: body.qbxml_request ?? null,
      });
      store.jobs.push(created);
      return Response.json([created], { status: 201 });
    }
    if (method === "GET") {
      const connectionId = parsed.searchParams.get("connection_id")?.replace(/^eq\./, "");
      const status = parsed.searchParams.get("status")?.replace(/^eq\./, "");
      const entityType = parsed.searchParams.get("entity_type")?.replace(/^eq\./, "");
      const entityId = parsed.searchParams.get("entity_id")?.replace(/^eq\./, "");
      const operation = parsed.searchParams.get("operation")?.replace(/^eq\./, "");
      const rows = store.jobs.filter(
        (job) =>
          job.connection_id === connectionId &&
          (!status || job.status === status) &&
          (!entityType || job.entity_type === entityType) &&
          (!entityId || job.entity_id === entityId) &&
          (!operation || job.operation === operation),
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

  it("does not rewrite bill_add jobs as CompanyQuery", async () => {
    const billXml = "<BillAddRq><BillAdd /></BillAddRq>";
    expect(
      qbxmlRequestForClaim({
        operation: BILL_ADD_OPERATION,
        qbxml_request: billXml,
      }),
    ).toBe(billXml);
    expect(qbxmlRequestForClaim({ operation: BILL_ADD_OPERATION, qbxml_request: null })).toBeNull();
    const store: Store = {
      jobs: [
        jobRow({
          operation: BILL_ADD_OPERATION,
          entity_type: "invoice",
          entity_id: "inv-1",
          qbxml_request: billXml,
        }),
      ],
    };
    const claimed = await claimNextPendingJob(env, "conn-1", mockJobsFetch(store));
    expect(claimed?.qbxml_request).toBe(billXml);
    expect(claimed?.qbxml_request).not.toContain("CompanyQuery");
  });

  it("enqueues bill_add once and retries a failed job on the same unique key", async () => {
    const store: Store = { jobs: [] };
    const fetchImpl = mockJobsFetch(store);
    const first = await enqueueBillAddJob(
      env,
      { orgId: "org-1", connectionId: "conn-1", invoiceId: "inv-1", qbxmlRequest: "<BillAddRq/>" },
      fetchImpl,
    );
    const second = await enqueueBillAddJob(
      env,
      { orgId: "org-1", connectionId: "conn-1", invoiceId: "inv-1", qbxmlRequest: "<BillAddRq/>" },
      fetchImpl,
    );
    expect(first.result).toBe("inserted");
    expect(second.result).toBe("duplicate");
    expect(store.jobs).toHaveLength(1);
    store.jobs[0]!.status = "failed";
    store.jobs[0]!.error_message = "Vendor not found";
    const retried = await enqueueBillAddJob(
      env,
      { orgId: "org-1", connectionId: "conn-1", invoiceId: "inv-1", qbxmlRequest: "<BillAddRq retry/>" },
      fetchImpl,
    );
    expect(retried.result).toBe("retried");
    expect(store.jobs[0]).toMatchObject({ status: "pending", error_message: null });
    expect(store.jobs[0]?.qbxml_request).toContain("retry");
    store.jobs[0]!.status = "completed";
    const again = await enqueueBillAddJob(
      env,
      { orgId: "org-1", connectionId: "conn-1", invoiceId: "inv-1", qbxmlRequest: "<BillAddRq/>" },
      fetchImpl,
    );
    expect(again.result).toBe("duplicate");
    expect(store.jobs).toHaveLength(1);
    expect(store.jobs[0]?.status).toBe("completed");
  });

  it("keys vendor_query to the connection and rebuilds VendorQuery XML", async () => {
    expect(vendorQueryJobKey("conn-1")).toEqual({
      operation: VENDOR_QUERY_OPERATION,
      entity_type: "connection",
      entity_id: "conn-1",
    });
    expect(qbxmlRequestForClaim({ operation: VENDOR_QUERY_OPERATION, qbxml_request: null })).toContain(
      "VendorQueryRq",
    );
    const store: Store = { jobs: [] };
    const fetchImpl = mockJobsFetch(store);
    const first = await enqueueVendorQueryJob(env, { id: "conn-1", org_id: "org-1" }, fetchImpl);
    const second = await enqueueVendorQueryJob(env, { id: "conn-1", org_id: "org-1" }, fetchImpl);
    expect(first).toBe("inserted");
    expect(second).toBe("duplicate");
    store.jobs[0]!.status = "completed";
    const refreshed = await enqueueVendorQueryJob(env, { id: "conn-1", org_id: "org-1" }, fetchImpl, {
      refresh: true,
    });
    expect(refreshed).toBe("retried");
    expect(store.jobs[0]?.status).toBe("pending");
    expect(store.jobs[0]?.qbxml_request).toContain("VendorQueryRq");
  });

  it("keys account_query to the connection and rebuilds AccountQuery XML", async () => {
    expect(accountQueryJobKey("conn-1")).toEqual({
      operation: ACCOUNT_QUERY_OPERATION,
      entity_type: "connection",
      entity_id: "conn-1",
    });
    expect(qbxmlRequestForClaim({ operation: ACCOUNT_QUERY_OPERATION, qbxml_request: null })).toContain(
      "AccountQueryRq",
    );
    const store: Store = { jobs: [] };
    const fetchImpl = mockJobsFetch(store);
    const first = await enqueueAccountQueryJob(env, { id: "conn-1", org_id: "org-1" }, fetchImpl);
    const second = await enqueueAccountQueryJob(env, { id: "conn-1", org_id: "org-1" }, fetchImpl);
    expect(first).toBe("inserted");
    expect(second).toBe("duplicate");
    store.jobs[0]!.status = "completed";
    const refreshed = await enqueueAccountQueryJob(env, { id: "conn-1", org_id: "org-1" }, fetchImpl, {
      refresh: true,
    });
    expect(refreshed).toBe("retried");
    expect(store.jobs[0]?.status).toBe("pending");
    expect(store.jobs[0]?.qbxml_request).toContain("AccountQueryRq");
    expect(store.jobs[0]?.qbxml_request).not.toContain("BillAddRq");
  });
});
