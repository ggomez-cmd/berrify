export const QBXML_VERSION = "13.0";

export type QbxmlOpcode =
  | "CompanyQuery"
  | "VendorQuery"
  | "AccountQuery"
  | "ItemQuery"
  | "BillAdd";

export type CompanyQueryResult = {
  companyName: string | null;
  legalCompanyName: string | null;
  productName: string | null;
  majorVersion: string | null;
  minorVersion: string | null;
  statusCode: string | null;
  statusSeverity: string | null;
  statusMessage: string | null;
};

export type ParsedQbStatus = {
  statusCode: string | null;
  statusSeverity: string | null;
  statusMessage: string | null;
  ok: boolean;
};

const TAG_RE = (name: string) =>
  new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i");

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function xmlUnescape(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function xmlText(xml: string, tag: string): string | null {
  const match = TAG_RE(tag).exec(xml);
  if (!match) return null;
  const text = xmlUnescape(match[1].trim());
  return text.length > 0 ? text : null;
}

export function xmlAttr(xml: string, tag: string, attr: string): string | null {
  const open = new RegExp(`<${tag}\\b([^>]*)>`, "i").exec(xml);
  if (!open) return null;
  const quoted = new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, "i").exec(open[1]);
  if (quoted) return xmlUnescape(quoted[1]);
  const single = new RegExp(`${attr}\\s*=\\s*'([^']*)'`, "i").exec(open[1]);
  return single ? xmlUnescape(single[1]) : null;
}

export function parseQbStatus(xml: string, responseTag: string): ParsedQbStatus {
  const statusCode = xmlAttr(xml, responseTag, "statusCode");
  const statusSeverity = xmlAttr(xml, responseTag, "statusSeverity");
  const statusMessage = xmlAttr(xml, responseTag, "statusMessage");
  const ok = statusCode === "0" || statusCode === null;
  return { statusCode, statusSeverity, statusMessage, ok };
}

export function buildCompanyQueryRq(): string {
  return [
    `<?xml version="1.0"?>`,
    `<?qbxml version="${QBXML_VERSION}"?>`,
    `<QBXML>`,
    `  <QBXMLMsgsRq onError="stopOnError">`,
    `    <CompanyQueryRq></CompanyQueryRq>`,
    `  </QBXMLMsgsRq>`,
    `</QBXML>`,
  ].join("\n");
}

export function parseCompanyQueryRs(xml: string): CompanyQueryResult {
  const status = parseQbStatus(xml, "CompanyQueryRs");
  const host = parseQbStatus(xml, "HostQueryRs");
  return {
    companyName: xmlText(xml, "CompanyName"),
    legalCompanyName: xmlText(xml, "LegalCompanyName"),
    productName: xmlText(xml, "ProductName"),
    majorVersion: xmlText(xml, "MajorVersion"),
    minorVersion: xmlText(xml, "MinorVersion"),
    statusCode: status.statusCode ?? host.statusCode,
    statusSeverity: status.statusSeverity ?? host.statusSeverity,
    statusMessage: status.statusMessage ?? host.statusMessage,
  };
}

export function parseHcpHostInfo(xml: string): Pick<
  CompanyQueryResult,
  "companyName" | "productName" | "majorVersion" | "minorVersion"
> {
  return {
    companyName: xmlText(xml, "CompanyName"),
    productName: xmlText(xml, "ProductName"),
    majorVersion: xmlText(xml, "MajorVersion"),
    minorVersion: xmlText(xml, "MinorVersion"),
  };
}

/** Stubs for later Invoice → Bill mapping. Do not enqueue these jobs in this pass. */
export type FutureBillAddFields = {
  vendorName: string;
  refNumber: string | null;
  txnDate: string | null;
  dueDate: string | null;
  terms: string | null;
  apAccount: string;
  expenses: Array<{ account: string; amount: number; memo: string }>;
  total: number;
};

export function futureVendorQueryOpcode(): Extract<QbxmlOpcode, "VendorQuery"> {
  return "VendorQuery";
}

export function futureAccountQueryOpcode(): Extract<QbxmlOpcode, "AccountQuery"> {
  return "AccountQuery";
}

export function futureItemQueryOpcode(): Extract<QbxmlOpcode, "ItemQuery"> {
  return "ItemQuery";
}

export function futureBillAddOpcode(): Extract<QbxmlOpcode, "BillAdd"> {
  return "BillAdd";
}
