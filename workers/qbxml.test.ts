import { describe, expect, it } from "vitest";
import {
  buildCompanyQueryRq,
  parseCompanyQueryRs,
  parseQbStatus,
  xmlEscape,
} from "./qbxml";

const OK_RS = `<?xml version="1.0"?>
<QBXML>
  <QBXMLMsgsRs>
    <CompanyQueryRs statusCode="0" statusSeverity="Info" statusMessage="Status OK">
      <CompanyRet>
        <CompanyName>Semilla</CompanyName>
        <LegalCompanyName>CAN ENTERPRISE</LegalCompanyName>
      </CompanyRet>
    </CompanyQueryRs>
    <HostQueryRs statusCode="0">
      <HostRet>
        <ProductName>QuickBooks Pro 2021</ProductName>
        <MajorVersion>31</MajorVersion>
        <MinorVersion>0</MinorVersion>
      </HostRet>
    </HostQueryRs>
  </QBXMLMsgsRs>
</QBXML>`;

const ERROR_RS = `<CompanyQueryRs statusCode="3120" statusSeverity="Error" statusMessage="Object not found">
</CompanyQueryRs>`;

describe("CompanyQuery qbXML", () => {
  it("builds CompanyQueryRq without BillAddRq", () => {
    const xml = buildCompanyQueryRq();
    expect(xml).toContain("<CompanyQueryRq>");
    expect(xml).toContain('<?qbxml version="13.0"?>');
    expect(xml).not.toContain("BillAddRq");
  });

  it("parses a successful company and host response", () => {
    const parsed = parseCompanyQueryRs(OK_RS);
    expect(parsed.companyName).toBe("Semilla");
    expect(parsed.productName).toBe("QuickBooks Pro 2021");
    expect(parsed.majorVersion).toBe("31");
    expect(parsed.statusCode).toBe("0");
  });

  it("parses a QuickBooks error response", () => {
    const status = parseQbStatus(ERROR_RS, "CompanyQueryRs");
    expect(status.ok).toBe(false);
    expect(status.statusCode).toBe("3120");
    expect(status.statusMessage).toBe("Object not found");
  });

  it("escapes XML special characters", () => {
    expect(xmlEscape(`A&B <C>`)).toBe("A&amp;B &lt;C&gt;");
  });
});
