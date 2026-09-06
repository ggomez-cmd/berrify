export type InvoiceCategory = "food" | "kitchen" | "cleaning" | "tax" | "other";

export type AccountRule = {
  keyword: string;
  account: string;
  memo: string | null;
  category: InvoiceCategory;
};

export type VendorAlias = {
  match_text: string;
  supplier_id: string;
  qbo_vendor_name: string;
};

export type ExtractedSku = {
  code: string | null;
  description: string;
  qty_ordered: number;
  qty_shipped: number;
  uom: string | null;
  pounds: number | null;
  unit_price: number;
  amount: number;
  category: InvoiceCategory;
};

export type ExpenseLine = {
  account: string;
  amount: number;
  memo: string;
};

export type ExtractedInvoice = {
  vendor_name: string | null;
  qbo_vendor_name: string;
  supplier_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  terms: string;
  subtotal: number;
  tax: number;
  total: number;
  lines: ExtractedSku[];
  expenses: ExpenseLine[];
};

export const ACCOUNTS = {
  ap: "20000 · Accounts payable",
  food: "50000 · Food Purchases",
  kitchen: "60020 · Restaurant & Kitchen Expense",
  cleaning: "60021 · Cleaning Supplies",
  tax: "60025 · Sales tax expense",
} as const;

export const DEFAULT_ACCOUNT_RULES: AccountRule[] = [
  { keyword: "fabuloso", account: ACCOUNTS.cleaning, memo: "Fabuloso", category: "cleaning" },
  { keyword: "clean", account: ACCOUNTS.cleaning, memo: "Cleaning", category: "cleaning" },
  { keyword: "detergent", account: ACCOUNTS.cleaning, memo: "Cleaning", category: "cleaning" },
  { keyword: "cup", account: ACCOUNTS.kitchen, memo: "Cups/ napkins /containers", category: "kitchen" },
  { keyword: "napkin", account: ACCOUNTS.kitchen, memo: "Cups/ napkins /containers", category: "kitchen" },
  { keyword: "container", account: ACCOUNTS.kitchen, memo: "Cups/ napkins /containers", category: "kitchen" },
  { keyword: "cont.", account: ACCOUNTS.kitchen, memo: "Cups/ napkins /containers", category: "kitchen" },
  { keyword: "saran", account: ACCOUNTS.kitchen, memo: "Cups/ napkins /containers", category: "kitchen" },
  { keyword: "film", account: ACCOUNTS.kitchen, memo: "Cups/ napkins /containers", category: "kitchen" },
  { keyword: "wrap", account: ACCOUNTS.kitchen, memo: "Cups/ napkins /containers", category: "kitchen" },
  { keyword: "vaso", account: ACCOUNTS.kitchen, memo: "Cups/ napkins /containers", category: "kitchen" },
  { keyword: "tapa", account: ACCOUNTS.kitchen, memo: "Cups/ napkins /containers", category: "kitchen" },
  { keyword: "cuchara", account: ACCOUNTS.kitchen, memo: "Cups/ napkins /containers", category: "kitchen" },
  { keyword: "bandeja", account: ACCOUNTS.kitchen, memo: "Cups/ napkins /containers", category: "kitchen" },
  { keyword: "servilleta", account: ACCOUNTS.kitchen, memo: "Cups/ napkins /containers", category: "kitchen" },
];

const MONEY = /\$?\s*([0-9]{1,3}(?:,[0-9]{3})*\.[0-9]{2}|[0-9]+\.[0-9]{2})/;
const DATE = /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/;
const COMMENT = /martes solo recibe|comments:|debido a nuestro|recibe: miercoles|inventario anual/i;
const SKU_LINE =
  /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+([A-Z]{1,4})\s+(\d{4,})\s+(.+?)\s+(\d+(?:,\d{3})*\.\d{2,4})[A-Z$#]*\s+(\d+(?:,\d{3})*\.\d{2})\s*$/i;
const SKU_LOOSE = /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+([A-Z]{1,4})\s+(\d{4,})\s+(.+)$/i;
const BALLESTER_WEIGHT =
  /^(\d{4,5})\s+(.+?)\s+(\d+\.\d{1,2})\s+(\d+\.\d{3,4})\s+(\d+\.\d{2})\s*$/;
const BALLESTER_FLAT = /^(\d{4,5})\s+(.+?)\s+(\d+\.\d{2,4})\s+(\d+\.\d{2})\s*$/;

export function parseMoney(raw: string | undefined): number {
  if (!raw) return 0;
  return Number(raw.replace(/[$,\s]/g, "")) || 0;
}

export function stripPriceSuffix(raw: string): number {
  return parseMoney(raw.replace(/[A-Z$#]+$/i, ""));
}

export function normalizeDate(raw: string | undefined): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!m) return null;
  const month = m[1].padStart(2, "0");
  const day = m[2].padStart(2, "0");
  const year = m[3].length === 2 ? `20${m[3]}` : m[3];
  const y = Number(year);
  if (y < 2020 || y > 2039) return null;
  return `${year}-${month}-${day}`;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function classifySku(
  description: string,
  rules: AccountRule[] = DEFAULT_ACCOUNT_RULES,
): { category: InvoiceCategory; account: string; memo: string } {
  const hay = description.toLowerCase();
  for (const rule of rules) {
    if (hay.includes(rule.keyword.toLowerCase())) {
      return {
        category: rule.category,
        account: rule.account,
        memo: rule.memo ?? description,
      };
    }
  }
  return { category: "food", account: ACCOUNTS.food, memo: "" };
}

const KNOWN_VENDORS = [
  { test: /ballester/i, qbo: "Ballester Hermanos Inc", print: "Ballester Hermanos, Inc." },
  { test: /supermax|superhax|super max/i, qbo: "SuperMax", print: "SuperMax" },
  { test: /jose\s+santiago/i, qbo: "Jose Santiago Inc", print: "Jose Santiago Inc" },
] as const;

export function matchVendor(
  text: string,
  aliases: VendorAlias[],
): { supplier_id: string | null; qbo_vendor_name: string; vendor_name: string | null } {
  const letterhead =
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /ballester|supermax|jose santiago|can enterprise|benmaman/i.test(l)) ?? null;
  const hay = text.toLowerCase();

  const known = KNOWN_VENDORS.find((v) => v.test.test(text));
  if (known) {
    const alias = aliases.find(
      (a) =>
        hay.includes(a.match_text.toLowerCase()) &&
        a.qbo_vendor_name.toLowerCase() === known.qbo.toLowerCase(),
    );
    return {
      supplier_id: alias?.supplier_id ?? null,
      qbo_vendor_name: known.qbo,
      vendor_name: letterhead && letterhead.length < 60 ? letterhead : known.print,
    };
  }

  const hit = [...aliases].sort((a, b) => b.match_text.length - a.match_text.length).find((a) =>
    hay.includes(a.match_text.toLowerCase()),
  );
  if (hit) {
    return {
      supplier_id: hit.supplier_id,
      qbo_vendor_name: hit.qbo_vendor_name,
      vendor_name: letterhead ?? hit.match_text,
    };
  }

  if (/can enterprise|benmaman/i.test(text)) {
    return {
      supplier_id: null,
      qbo_vendor_name: "Jose Santiago Inc",
      vendor_name: letterhead ?? "CAN ENTERPRISE LLC",
    };
  }
  return { supplier_id: null, qbo_vendor_name: "Unknown vendor", vendor_name: letterhead };
}

function lineStartMoney(text: string, label: string): number {
  const re = new RegExp(`^${label}\\s*[:.]?\\s*${MONEY.source}`, "im");
  const match = text.match(re);
  return match?.[1] ? parseMoney(match[1]) : 0;
}

function labeledMoney(text: string, labels: string[]): number {
  for (const label of labels) {
    const re = new RegExp(`${label}[^\\n$]*${MONEY.source}`, "i");
    const match = text.match(re);
    if (match?.[1]) return parseMoney(match[1]);
  }
  return 0;
}

export function rollupExpenses(lines: ExtractedSku[], tax: number): ExpenseLine[] {
  const kitchen = lines.filter((l) => l.category === "kitchen");
  const cleaning = lines.filter((l) => l.category === "cleaning");
  const food = lines.filter((l) => l.category === "food" || l.category === "other");
  const expenses: ExpenseLine[] = [];

  if (tax > 0) {
    expenses.push({ account: ACCOUNTS.tax, amount: round2(tax), memo: "Tax" });
  }
  const kitchenAmt = sum(kitchen);
  if (kitchenAmt > 0) {
    expenses.push({
      account: ACCOUNTS.kitchen,
      amount: kitchenAmt,
      memo: "Cups/ napkins /containers",
    });
  }
  const cleaningAmt = sum(cleaning);
  if (cleaningAmt > 0) {
    const memo = cleaning
      .map((l) => l.description.split(/[*(]/)[0]?.trim().split(/\s+/)[0] ?? "Cleaning")
      .filter(Boolean)
      .slice(0, 3)
      .join(" / ");
    expenses.push({
      account: ACCOUNTS.cleaning,
      amount: cleaningAmt,
      memo: /fabuloso/i.test(cleaning.map((l) => l.description).join(" ")) ? "Fabuloso" : memo,
    });
  }
  const foodAmt = sum(food);
  if (foodAmt > 0) {
    expenses.push({ account: ACCOUNTS.food, amount: foodAmt, memo: "" });
  }
  return expenses;
}

function sum(lines: ExtractedSku[]): number {
  return round2(lines.reduce((s, l) => s + Number(l.amount || 0), 0));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function invoiceTotals(lines: Array<{ amount: number }>, tax: number) {
  const subtotal = sum(lines as ExtractedSku[]);
  return { subtotal, tax: round2(tax), total: round2(subtotal + tax) };
}

export type ExtractHint = "ballester" | "supermax" | "jose" | "auto";

export function extractInvoiceFromText(
  ocrText: string,
  aliases: VendorAlias[] = [],
  rules: AccountRule[] = DEFAULT_ACCOUNT_RULES,
  hint: ExtractHint = "auto",
): ExtractedInvoice {
  const text = ocrText.replace(/\r/g, "");
  const rawLines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const vendor =
    hint === "ballester"
      ? {
          supplier_id: aliases.find((a) => /ballester/i.test(a.match_text))?.supplier_id ?? null,
          qbo_vendor_name: "Ballester Hermanos Inc",
          vendor_name: "Ballester Hermanos, Inc.",
        }
      : hint === "supermax"
        ? {
            supplier_id: aliases.find((a) => /supermax/i.test(a.match_text))?.supplier_id ?? null,
            qbo_vendor_name: "SuperMax",
            vendor_name: "SuperMax",
          }
        : matchVendor(text, aliases);
  const invoiceNumber = extractInvoiceNumber(text, hint);
  const fecha = text.match(new RegExp(`fecha(?:\\s+\\w+)?\\s*[:.]?\\s*(${DATE.source})`, "i"));
  const invoiceDate = normalizeDate(fecha?.[1]) ?? normalizeDate(text.match(DATE)?.[0]);
  const termsInfo = detectTerms(text, hint);
  const dueDate = invoiceDate ? addDaysIso(invoiceDate, termsInfo.days) : null;

  const municipal = labeledMoney(
    text,
    hint === "supermax"
      ? ["tax municipal"]
      : hint === "ballester"
        ? ["municipal auth"]
        : ["municipal auth", "tax municipal", "municipal sales tax", "municipal"],
  );
  const territory = labeledMoney(
    text,
    hint === "supermax"
      ? ["tax estatal"]
      : hint === "ballester"
        ? ["pr territory auth"]
        : ["pr territory auth", "territory auth", "tax estatal", "state sales tax", "estatal"],
  );
  let tax = round2(municipal + territory);
  if (hint === "ballester" && (tax > 50 || /sales tax[^\n]*\.000/i.test(text))) {
    tax = 0;
  }

  const lines: ExtractedSku[] = [];
  for (const line of rawLines) {
    if (COMMENT.test(line)) continue;
    const parsed = parseSkuLine(line);
    if (!parsed) continue;
    if (hint === "ballester") {
      if (/cheddar|jerry|brownie|ldpe|t-shirt|sales tax|invoiced/i.test(parsed.description)) continue;
      if (!parsed.code && !/pork|beef|juice|coconut|carnita|hormel/i.test(parsed.description)) continue;
    }
    if (hint === "supermax") {
      if (parsed.amount > 30) continue;
      if (!/cheddar|jerry|brownie|bag|ldpe/i.test(parsed.description)) continue;
    }
    if (parsed.qty_shipped === 0 && parsed.amount === 0) continue;
    const classified = classifySku(parsed.description, rules);
    lines.push({ ...parsed, category: classified.category });
  }

  const lineSum = sum(lines);
  const subtotals = [...text.matchAll(/sub\s*-?totals?\s*\$?\s*([\d,]+\.\d{2})/gi)].map((m) =>
    parseMoney(m[1]),
  );
  let subtotal = labeledMoney(text, ["subtotal", "sub total"]) || lineSum;
  if (hint === "ballester") {
    subtotal = Math.max(lineSum, ...subtotals, 0);
  } else if (hint === "supermax") {
    const retail = subtotals.filter((n) => n > 5 && n < 200);
    subtotal = retail.length > 0 ? retail[retail.length - 1]! : lineSum;
  }
  let total =
    labeledMoney(text, ["balance due", "total due", "amount due"]) ||
    lineStartMoney(text, "total") ||
    round2(subtotal + tax);
  if (hint === "ballester") {
    tax = 0;
    total = subtotal;
  } else if (hint === "supermax") {
    const purchase = text.match(/purchase amount[:\s]+\$?([\d,]+\.\d{2})/i);
    const ath = text.match(/(?:ath|debit\s*sale)[^\n]*?([\d,]+\.\d{2})/i);
    const smallTotals = [...text.matchAll(/^total\s*\$?\s*([\d,]+\.\d{2})/gim)]
      .map((m) => parseMoney(m[1]))
      .filter((n) => n > 0 && n < 200);
    total =
      (purchase ? parseMoney(purchase[1]) : 0) ||
      (ath ? parseMoney(ath[1]) : 0) ||
      (smallTotals.length > 0 ? smallTotals[smallTotals.length - 1] : 0) ||
      round2(subtotal + tax);
    if (tax > 5) tax = Math.max(0, round2(total - subtotal));
  }

  return {
    vendor_name: vendor.vendor_name,
    qbo_vendor_name: vendor.qbo_vendor_name,
    supplier_id: vendor.supplier_id,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    due_date: dueDate,
    terms: termsInfo.terms,
    subtotal: round2(subtotal),
    tax: round2(tax),
    total: round2(total),
    lines,
    expenses: rollupExpenses(lines, tax || round2(total - subtotal)),
  };
}

export function extractInvoicesFromText(
  ocrText: string,
  aliases: VendorAlias[] = [],
  rules: AccountRule[] = DEFAULT_ACCOUNT_RULES,
): ExtractedInvoice[] {
  const hasBallester = /ballester/i.test(ocrText);
  const hasSupermax = /supermax|superhax/i.test(ocrText);
  if (hasBallester && hasSupermax) {
    return [
      extractInvoiceFromText(ocrText, aliases, rules, "ballester"),
      extractInvoiceFromText(ocrText, aliases, rules, "supermax"),
    ];
  }
  return splitVendorDocuments(ocrText).map((chunk) => extractInvoiceFromText(chunk, aliases, rules));
}

function splitVendorDocuments(text: string): string[] {
  const markers = [
    { re: /ballester/i },
    { re: /supermax|superhax/i },
    { re: /jose\s+santiago/i },
  ];
  const hits = markers
    .map((m) => ({ idx: text.search(m.re) }))
    .filter((h) => h.idx >= 0)
    .sort((a, b) => a.idx - b.idx);
  if (hits.length < 2) return [text];
  const chunks = hits.map((h, i) => {
    const end = i + 1 < hits.length ? hits[i + 1]!.idx : text.length;
    return text.slice(h.idx, end);
  });
  return chunks.filter((c) => c.trim().length > 20);
}

function detectTerms(text: string, hint: ExtractHint = "auto"): { terms: string; days: number } {
  if (hint === "ballester" || (hint === "auto" && /ballester/i.test(text) && !/supermax|superhax/i.test(text))) {
    return { terms: "Net 7", days: 7 };
  }
  if (
    hint === "supermax" ||
    (/supermax|superhax/i.test(text) && /selfcheckout|ath|debit/i.test(text))
  ) {
    return { terms: "Due on receipt", days: 0 };
  }
  if (/\b7\s*days\b/i.test(text)) return { terms: "Net 7", days: 7 };
  if (/15-?\s*net\s*15|net\s*15/i.test(text)) return { terms: "Net 15", days: 15 };
  return { terms: "Net 15", days: 15 };
}

export function toQuickBooksBillIif(input: {
  vendor: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  terms: string;
  apAccount: string;
  expenses: ExpenseLine[];
  total: number;
}): string {
  const date = toQbDate(input.invoiceDate);
  const due = toQbDate(input.dueDate);
  const header = [
    "!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO\tCLEAR\tTOPRINT\tADDR1\tDUEDATE\tTERMS",
    "!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO\tCLEAR",
    "!ENDTRNS",
  ];
  const trns = [
    "TRNS",
    "",
    "BILL",
    date,
    input.apAccount,
    input.vendor,
    "",
    String(-round2(input.total)),
    input.invoiceNumber,
    "",
    "N",
    "N",
    input.vendor,
    due,
    input.terms,
  ].join("\t");
  const spls = input.expenses.map((e) =>
    ["SPL", "", "BILL", date, e.account, "", "", String(round2(e.amount)), "", e.memo, "N"].join("\t"),
  );
  return [...header, trns, ...spls, "ENDTRNS", ""].join("\n");
}

export function toQuickBooksBillCsv(input: {
  vendor: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  expenses: ExpenseLine[];
}): string {
  const header = "Vendor,RefNumber,TxnDate,DueDate,Account,Amount,Memo,A/P Account";
  const rows = input.expenses.map((e) =>
    [
      csv(input.vendor),
      csv(input.invoiceNumber),
      csv(input.invoiceDate),
      csv(input.dueDate),
      csv(e.account),
      String(round2(e.amount)),
      csv(e.memo),
      csv(ACCOUNTS.ap),
    ].join(","),
  );
  return [header, ...rows].join("\n") + "\n";
}

function extractInvoiceNumber(text: string, hint: ExtractHint = "auto"): string | null {
  const withoutCliente = text.replace(/num(?:ero|\.)?\s+cliente\b[^\n]*/gi, "");
  if (hint === "supermax") {
    const receipt =
      withoutCliente.match(/invoice\s*#:?\s*(\d{8,})/i) ??
      withoutCliente.match(/nice\s*#:?\s*\(?(\d{8,})/i);
    return receipt?.[1] ?? null;
  }
  const numFactura = withoutCliente.match(/num\.?\s*factura[\s\S]{0,160}?(\d{8})/i);
  if (numFactura?.[1]) return numFactura[1];
  const factura = withoutCliente.match(/\b(?:num\.?\s*)?factura[^\d]{0,40}(\d{7,8})/i);
  if (factura?.[1] && factura[1].length >= 7) return factura[1];
  const invoiceHash = withoutCliente.match(/\binvoice\s*#:?\s*(\d{5,})/i);
  if (invoiceHash?.[1]) return invoiceHash[1];
  const labeled = withoutCliente.match(
    /\b(?:num(?:ero|\.)?|ref(?:\.|\s*no\.?)?)\s*[:#]?\s*(\d{5,})\b/i,
  );
  if (labeled?.[1]) return labeled[1];
  return null;
}

function parseSkuLine(line: string): ExtractedSku | null {
  if (
    /subtotal|balance due|municipal|territory auth|amount due|total due|tax estatal|selfcheckout|recibe mas|debit sale|total de articulos|sales tax|taxable amount|weight invoiced|eight invoiced/i.test(
      line,
    )
  ) {
    return null;
  }
  const weight = line.match(BALLESTER_WEIGHT);
  if (weight) {
    return {
      code: weight[1],
      description: weight[2].trim(),
      qty_ordered: 0,
      qty_shipped: Number(weight[3]),
      uom: /lb/i.test(weight[2]) ? "LB" : null,
      pounds: Number(weight[3]),
      unit_price: Number(weight[4]),
      amount: parseMoney(weight[5]),
      category: "food",
    };
  }
  const mid = line.match(/(.{6,}?)\s+(\d{4,5})\s+(\d+\.\d{2,4})\s+(\d+\.\d{2})\b/);
  if (mid && /lb|oz|pork|beef|juice|coconut|carnita|hormel|ground/i.test(mid[1])) {
    return {
      code: mid[2],
      description: mid[1].replace(/[^A-Za-z0-9 /.*#"'&+-]+/g, " ").replace(/\s+/g, " ").trim(),
      qty_ordered: 1,
      qty_shipped: 1,
      uom: /lb/i.test(mid[1]) ? "LB" : null,
      pounds: null,
      unit_price: Number(mid[3]),
      amount: parseMoney(mid[4]),
      category: "food",
    };
  }
  const flat = line.match(BALLESTER_FLAT);
  if (flat) {
    return {
      code: flat[1],
      description: flat[2].trim(),
      qty_ordered: 1,
      qty_shipped: 1,
      uom: null,
      pounds: null,
      unit_price: Number(flat[3]),
      amount: parseMoney(flat[4]),
      category: "food",
    };
  }
  const strict = line.match(SKU_LINE);
  if (strict) {
    return {
      code: strict[4],
      description: strict[5].trim(),
      qty_ordered: Number(strict[1]),
      qty_shipped: Number(strict[2]),
      uom: strict[3].toUpperCase(),
      pounds: null,
      unit_price: stripPriceSuffix(strict[6]),
      amount: parseMoney(strict[7]),
      category: "food",
    };
  }

  const loose = line.match(SKU_LOOSE);
  if (!loose) return parseFuzzySku(line);
  const rest = loose[5];
  const money = [...rest.matchAll(/(\d+(?:,\d{3})*\.\d{2,4})[A-Z$#]*/gi)];
  if (money.length < 2) return null;
  const amountTok = money[money.length - 1];
  const priceTok = money[money.length - 2];
  const description = rest.slice(0, priceTok.index ?? 0).trim();
  if (!description) return null;
  return {
    code: loose[4],
    description,
    qty_ordered: Number(loose[1]),
    qty_shipped: Number(loose[2]),
    uom: loose[3].toUpperCase(),
    pounds: null,
    unit_price: stripPriceSuffix(priceTok[0]),
    amount: parseMoney(amountTok[1]),
    category: "food",
  };
}

function parseFuzzySku(line: string): ExtractedSku | null {
  const fuzzy = line.match(/(\d{6,7})\D+(.+?)\s+(\d{1,3}(?:,\d{3})*\.\d{2})\s*$/);
  if (fuzzy) {
    const description = fuzzy[2].replace(/[^A-Za-z0-9 /.*#"'-]+/g, " ").replace(/\s+/g, " ").trim();
    if (description.length < 4) return null;
    return {
      code: fuzzy[1],
      description,
      qty_ordered: 0,
      qty_shipped: 1,
      uom: null,
      pounds: null,
      unit_price: 0,
      amount: parseMoney(fuzzy[3]),
      category: "food",
    };
  }

  const tail = line.match(/([A-Za-z][A-Za-z0-9 /.*#"'&+-]{5,})\s+(\d{1,3}(?:,\d{3})*\.\d{2})\b/);
  if (!tail) return null;
  const description = tail[1].trim();
  if (COMMENT.test(description) || description.length < 6) return null;
  return {
    code: null,
    description,
    qty_ordered: 0,
    qty_shipped: 1,
    uom: null,
    pounds: null,
    unit_price: 0,
    amount: parseMoney(tail[2]),
    category: "food",
  };
}

function toQbDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${m}/${d}/${y}`;
}

function csv(value: string): string {
  const safe = value ?? "";
  if (/[",\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`;
  return safe;
}
