import { describe, expect, it } from "vitest";
import { hashQbPassword } from "./qbwc-auth";
import {
  dispatchQbwcSoap,
  MAX_QBWC_BODY_BYTES,
  parseQbwcSoap,
  rejectOversizedOrUnsafeXml,
  soapStringArrayResult,
  soapStringResult,
} from "./qbwc-soap";
import { buildBillAddRq, xmlUnescape } from "./qbxml";

function envelope(inner: string): string {
  return `<?xml version="1.0"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>${inner}</soap:Body>
</soap:Envelope>`;
}

describe("QBWC SOAP parse", () => {
  it("parses authenticate with prefixed tags", () => {
    const parsed = parseQbwcSoap(
      envelope(
        `<tns:authenticate xmlns:tns="http://developer.intuit.com/">
          <tns:strUserName>bfy_user</tns:strUserName>
          <tns:strPassword>secret</tns:strPassword>
        </tns:authenticate>`,
      ),
    );
    expect(parsed).toMatchObject({
      method: "authenticate",
      params: { strusername: "bfy_user", strpassword: "secret" },
    });
  });

  it("parses serverVersion and sendRequestXML", () => {
    expect(parseQbwcSoap(envelope(`<serverVersion></serverVersion>`))).toMatchObject({
      method: "serverVersion",
    });
    const send = parseQbwcSoap(
      envelope(
        `<sendRequestXML>
          <ticket>abc</ticket>
          <strHCPResponse>&lt;Host/&gt;</strHCPResponse>
          <qbXMLMajorVers>13</qbXMLMajorVers>
        </sendRequestXML>`,
      ),
    );
    expect(send).toMatchObject({
      method: "sendRequestXML",
      params: { ticket: "abc", strhcpresponse: "<Host/>", qbxmlmajorvers: "13" },
    });
  });

  it("rejects entity expansion and unknown methods", () => {
    expect(rejectOversizedOrUnsafeXml(`<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><x/>`)).toBe(
      "XML entities are not allowed",
    );
    expect(parseQbwcSoap(envelope(`<nope></nope>`))).toEqual({ error: "Unknown SOAP method" });
  });

  it("rejects oversized bodies", () => {
    expect(rejectOversizedOrUnsafeXml("x".repeat(MAX_QBWC_BODY_BYTES + 1))).toBe("Request too large");
  });

  it("builds SOAP 1.1 string results, not JSON", () => {
    const xml = soapStringResult("serverVersion", "1.0.0");
    expect(xml).toContain("soap:Envelope");
    expect(xml).toContain("<serverVersionResult>1.0.0</serverVersionResult>");
    expect(xml).not.toMatch(/^\s*\{/);
    const auth = soapStringArrayResult("authenticate", ["nvu", ""]);
    expect(auth).toContain("<string>nvu</string>");
  });

  it("puts BillAdd qbXML in sendRequestXML as escaped text without a BOM", () => {
    const qbxml = buildBillAddRq({
      vendorName: "Drouyn & Co",
      refNumber: "018674",
      txnDate: "2026-08-09",
      dueDate: "2026-08-16",
      terms: "NET 7 DAYS",
      apAccount: { listId: "80000021-1671050285", fullName: "Accounts Payable" },
      expenses: [{ account: { listId: "8000000A-1671048355", fullName: "Food Purchases" }, amount: 61.5, memo: "" }],
      total: 61.5,
    });
    const soap = soapStringResult("sendRequestXML", qbxml);
    expect(soap.charCodeAt(0)).not.toBe(0xfeff);
    expect(soap).toContain("<?xml version=\"1.0\" encoding=\"utf-8\"?>");
    expect(soap).toContain("<sendRequestXMLResult>");
    expect(soap).toContain("&lt;BillAddRq&gt;");
    expect(soap).not.toContain("<BillAddRq>");
    const packed = /<sendRequestXMLResult>([\s\S]*)<\/sendRequestXMLResult>/.exec(soap)?.[1] ?? "";
    const inner = xmlUnescape(packed);
    expect(inner).toBe(qbxml);
    expect(inner.startsWith("<?xml version=\"1.0\" encoding=\"utf-8\"?>")).toBe(true);
    expect(inner.indexOf("<APAccountRef>")).toBeLessThan(inner.indexOf("<TxnDate>"));
    expect(inner.indexOf("<DueDate>")).toBeLessThan(inner.indexOf("<RefNumber>"));
    expect(inner).toContain("<FullName>Drouyn &amp; Co</FullName>");
    expect(inner).not.toContain("TermsRef");
  });

  it("authenticate returns a ticket or nvu without logging the password", async () => {
    const hash = await hashQbPassword("pw");
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
    };
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("quickbooks_desktop_connections") && method === "GET") {
        if (url.includes("bfy_ok")) {
          return Response.json([
            {
              id: "conn-1",
              org_id: "org-1",
              restaurant_id: null,
              name: "Shared",
              qb_username: "bfy_ok",
              password_hash: hash,
              owner_id: "o",
              file_id: "f",
              company_file: null,
              qb_company_name: null,
              qb_product_name: null,
              qb_major_version: null,
              qb_minor_version: null,
              is_active: true,
              last_connected_at: null,
              last_successful_sync_at: null,
              last_error: null,
            },
          ]);
        }
        return Response.json([]);
      }
      if (url.includes("quickbooks_desktop_sessions") && method === "POST") {
        return new Response(null, { status: 201 });
      }
      if (url.includes("quickbooks_sync_jobs")) {
        return new Response(null, { status: 201 });
      }
      throw new Error(`unexpected ${method} ${url}`);
    };
    const ok = await dispatchQbwcSoap(
      { method: "authenticate", params: { strusername: "bfy_ok", strpassword: "pw" } },
      env,
      fetchImpl,
    );
    expect(ok).toContain("<authenticateResult>");
    expect(ok).not.toContain("nvu");
    expect(ok).not.toContain("pw");
    expect(ok).not.toContain("service-role");
    const nvu = await dispatchQbwcSoap(
      { method: "authenticate", params: { strusername: "bfy_ok", strpassword: "nope" } },
      env,
      fetchImpl,
    );
    expect(nvu).toContain("<string>nvu</string>");
  });

  it("completes BillAddRs with TxnID and fails on QuickBooks error", async () => {
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
    };
    const job = {
      id: "job-bill",
      org_id: "org-1",
      connection_id: "conn-1",
      status: "sending",
      operation: "bill_add",
      entity_type: "invoice",
      entity_id: "inv-1",
      attempt_count: 1,
      qbxml_request: "<BillAddRq/>",
      qbxml_response: null,
      quickbooks_txn_id: null,
      edit_sequence: null,
      error_code: null,
      error_message: null,
    };
    const invoicePatches: unknown[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("quickbooks_desktop_sessions") && method === "GET") {
        return Response.json([
          { ticket: "t1", connection_id: "conn-1", org_id: "org-1", expires_at: "2099-01-01T00:00:00.000Z", last_error: null },
        ]);
      }
      if (url.includes("quickbooks_desktop_connections") && method === "GET") {
        return Response.json([
          {
            id: "conn-1",
            org_id: "org-1",
            restaurant_id: "rest-kane",
            name: "Kane",
            qb_username: "bfy_ok",
            password_hash: "x",
            owner_id: "o",
            file_id: "f",
            company_file: null,
            qb_company_name: "Kane",
            qb_product_name: null,
            qb_major_version: "13",
            qb_minor_version: "0",
            is_active: true,
            last_connected_at: "2026-09-19T00:00:00.000Z",
            last_successful_sync_at: null,
            last_error: null,
          },
        ]);
      }
      if (url.includes("quickbooks_sync_jobs") && method === "GET") {
        return Response.json([job]);
      }
      if (url.includes("quickbooks_sync_jobs") && method === "PATCH") {
        Object.assign(job, JSON.parse(String(init?.body ?? "{}")));
        return Response.json([job]);
      }
      if (url.includes("/rest/v1/invoices") && method === "PATCH") {
        invoicePatches.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(null, { status: 204 });
      }
      if (url.includes("quickbooks_desktop_connections") && method === "PATCH") {
        return new Response(null, { status: 204 });
      }
      if (url.includes("quickbooks_desktop_sessions") && method === "PATCH") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected ${method} ${url}`);
    };

    const ok = await dispatchQbwcSoap(
      {
        method: "receiveResponseXML",
        params: {
          ticket: "t1",
          response: `<BillAddRs statusCode="0" statusMessage="Status OK"><BillRet><TxnID>TX-1</TxnID><EditSequence>2</EditSequence></BillRet></BillAddRs>`,
        },
      },
      env,
      fetchImpl,
    );
    expect(ok).toContain("<receiveResponseXMLResult>100</receiveResponseXMLResult>");
    expect(job.status).toBe("completed");
    expect(job.quickbooks_txn_id).toBe("TX-1");
    expect(invoicePatches[0]).toMatchObject({
      status: "exported",
      quickbooks_txn_id: "TX-1",
    });

    job.status = "sending";
    const fail = await dispatchQbwcSoap(
      {
        method: "receiveResponseXML",
        params: {
          ticket: "t1",
          response: `<BillAddRs statusCode="3120" statusSeverity="Error" statusMessage="Vendor not found"></BillAddRs>`,
        },
      },
      env,
      fetchImpl,
    );
    expect(fail).toContain("<receiveResponseXMLResult>-1</receiveResponseXMLResult>");
    expect(job.status).toBe("failed");
    expect(job.error_message).toBe("Vendor not found");
  });
});
