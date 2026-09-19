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
});
