import { describe, expect, it } from "vitest";
import {
  buildBillAddRq,
  buildCompanyQueryRq,
  parseBillAddRs,
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

describe("BillAdd qbXML", () => {
  it("builds BillAddRq from the IIF vendor, dates, terms, and expense lines", () => {
    const xml = buildBillAddRq({
      vendorName: "Jose Santiago Inc",
      refNumber: "6512495",
      txnDate: "2026-08-12",
      dueDate: "2026-08-27",
      terms: "Net 15",
      apAccount: "20000 · Accounts payable",
      expenses: [
        { account: "50000 · Food Purchases", amount: 1100, memo: "Food" },
        { account: "60025 · Sales tax expense", amount: 55.59, memo: "Tax" },
      ],
      total: 1155.59,
    });
    expect(xml).toContain("<BillAddRq>");
    expect(xml).toContain("<FullName>Jose Santiago Inc</FullName>");
    expect(xml).toContain("<RefNumber>6512495</RefNumber>");
    expect(xml).toContain("<TxnDate>2026-08-12</TxnDate>");
    expect(xml).toContain("<DueDate>2026-08-27</DueDate>");
    expect(xml).toContain("<FullName>Net 15</FullName>");
    expect(xml).toContain("<FullName>20000 · Accounts payable</FullName>");
    expect(xml).toContain("<Amount>1100.00</Amount>");
    expect(xml).toContain("<Amount>55.59</Amount>");
    expect(xml).not.toContain("VendorAddRq");
  });

  it("escapes vendor names in BillAddRq", () => {
    const xml = buildBillAddRq({
      vendorName: "A&B <Food>",
      refNumber: null,
      txnDate: "2026-09-20",
      dueDate: null,
      terms: null,
      apAccount: "20000 · Accounts payable",
      expenses: [{ account: "50000 · Food Purchases", amount: 10, memo: "" }],
      total: 10,
    });
    expect(xml).toContain("<FullName>A&amp;B &lt;Food&gt;</FullName>");
  });

  it("parses BillAddRs success TxnID", () => {
    const parsed = parseBillAddRs(`<BillAddRs statusCode="0" statusSeverity="Info" statusMessage="Status OK">
      <BillRet><TxnID>99-BILL</TxnID><EditSequence>144</EditSequence></BillRet>
    </BillAddRs>`);
    expect(parsed.ok).toBe(true);
    expect(parsed.txnId).toBe("99-BILL");
    expect(parsed.editSequence).toBe("144");
  });

  it("parses a BillAdd QuickBooks error", () => {
    const parsed = parseBillAddRs(
      `<BillAddRs statusCode="3120" statusSeverity="Error" statusMessage="Vendor not found"></BillAddRs>`,
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.statusCode).toBe("3120");
    expect(parsed.statusMessage).toBe("Vendor not found");
    expect(parsed.txnId).toBeNull();
  });
});
