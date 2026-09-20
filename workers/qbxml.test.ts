import { describe, expect, it } from "vitest";
import {
  buildAccountQueryRq,
  buildBillAddRq,
  buildCompanyQueryRq,
  buildVendorQueryRq,
  parseAccountQueryRs,
  parseBillAddRs,
  parseCompanyQueryRs,
  parseQbStatus,
  parseVendorQueryRs,
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

describe("VendorQuery qbXML", () => {
  it("builds VendorQueryRq for a full vendor list", () => {
    const xml = buildVendorQueryRq();
    expect(xml).toContain("<VendorQueryRq>");
    expect(xml).toContain("<ActiveStatus>All</ActiveStatus>");
    expect(xml).not.toContain("BillAddRq");
    expect(xml).not.toContain("CompanyQueryRq");
  });

  it("parses VendorRet FullName and ListID", () => {
    const parsed = parseVendorQueryRs(`<VendorQueryRs statusCode="0" statusMessage="Status OK">
      <VendorRet>
        <ListID>80000001-1</ListID>
        <Name>Jose Santiago Inc (food)</Name>
        <FullName>Jose Santiago Inc (food)</FullName>
        <CompanyName>Jose Santiago</CompanyName>
        <IsActive>true</IsActive>
      </VendorRet>
      <VendorRet>
        <ListID>80000002-2</ListID>
        <FullName>Jose Santiago Inc (liquor)</FullName>
        <IsActive>true</IsActive>
      </VendorRet>
    </VendorQueryRs>`);
    expect(parsed.ok).toBe(true);
    expect(parsed.vendors).toEqual([
      {
        listId: "80000001-1",
        fullName: "Jose Santiago Inc (food)",
        companyName: "Jose Santiago",
        isActive: true,
      },
      {
        listId: "80000002-2",
        fullName: "Jose Santiago Inc (liquor)",
        companyName: null,
        isActive: true,
      },
    ]);
  });
});

describe("AccountQuery qbXML", () => {
  it("builds AccountQueryRq for a full account list", () => {
    const xml = buildAccountQueryRq();
    expect(xml).toContain("<AccountQueryRq>");
    expect(xml).toContain("<ActiveStatus>All</ActiveStatus>");
    expect(xml).not.toContain("BillAddRq");
    expect(xml).not.toContain("VendorQueryRq");
  });

  it("parses kept account types and drops bank/income", () => {
    const parsed = parseAccountQueryRs(`<AccountQueryRs statusCode="0" statusMessage="Status OK">
      <AccountRet>
        <ListID>80000010-1</ListID>
        <Name>SalesTaxExpense</Name>
        <FullName>SalesTaxExpense</FullName>
        <AccountNumber>68200</AccountNumber>
        <AccountType>Expense</AccountType>
        <IsActive>true</IsActive>
      </AccountRet>
      <AccountRet>
        <ListID>80000011-2</ListID>
        <FullName>WinePurchase</FullName>
        <AccountNumber>51500</AccountNumber>
        <AccountType>CostOfGoodsSold</AccountType>
        <IsActive>true</IsActive>
      </AccountRet>
      <AccountRet>
        <ListID>80000012-3</ListID>
        <FullName>Accounts Payable</FullName>
        <AccountNumber>20000</AccountNumber>
        <AccountType>AccountsPayable</AccountType>
        <IsActive>true</IsActive>
      </AccountRet>
      <AccountRet>
        <ListID>80000013-4</ListID>
        <FullName>Checking</FullName>
        <AccountType>Bank</AccountType>
        <IsActive>true</IsActive>
      </AccountRet>
      <AccountRet>
        <ListID>80000014-5</ListID>
        <FullName>Sales</FullName>
        <AccountType>Income</AccountType>
        <IsActive>true</IsActive>
      </AccountRet>
    </AccountQueryRs>`);
    expect(parsed.ok).toBe(true);
    expect(parsed.accounts).toEqual([
      {
        listId: "80000010-1",
        fullName: "SalesTaxExpense",
        accountNumber: "68200",
        accountType: "Expense",
        isActive: true,
      },
      {
        listId: "80000011-2",
        fullName: "WinePurchase",
        accountNumber: "51500",
        accountType: "CostOfGoodsSold",
        isActive: true,
      },
      {
        listId: "80000012-3",
        fullName: "Accounts Payable",
        accountNumber: "20000",
        accountType: "AccountsPayable",
        isActive: true,
      },
    ]);
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
