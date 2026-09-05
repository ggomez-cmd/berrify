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

const MONEY = /\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+\.[0-9]{2})/;
const DATE = /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/;
const COMMENT = /martes solo recibe|comments:|debido a nuestro|recibe: miercoles|inventario anual/i;
const SKU_LINE =
  /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+([A-Z]{1,4})\s+(\d{4,})\s+(.+?)\s+(\d+(?:,\d{3})*\.\d{2,4})[A-Z$#]*\s+(\d+(?:,\d{3})*\.\d{2})\s*$/i;
const SKU_LOOSE = /^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+([A-Z]{1,4})\s+(\d{4,})\s+(.+)$/i;

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

export function matchVendor(
  text: string,
  aliases: VendorAlias[],
): { supplier_id: string | null; qbo_vendor_name: string; vendor_name: string | null } {
  const letterhead =
    text
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /can enterprise|jose santiago|benmaman/i.test(l)) ?? null;
  const hay = text.toLowerCase();
  const hit = aliases.find((a) => hay.includes(a.match_text.toLowerCase()));
  if (hit) {
    return {
      supplier_id: hit.supplier_id,
      qbo_vendor_name: hit.qbo_vendor_name,
      vendor_name: letterhead ?? hit.match_text,
    };
  }
  if (/jose santiago|can enterprise|benmaman/i.test(text)) {
    return {
      supplier_id: null,
      qbo_vendor_name: "Jose Santiago Inc",
      vendor_name: letterhead ?? "CAN ENTERPRISE LLC",
    };
  }
  return { supplier_id: null, qbo_vendor_name: "Jose Santiago Inc", vendor_name: letterhead };
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

export function extractInvoiceFromText(
  ocrText: string,
  aliases: VendorAlias[] = [],
  rules: AccountRule[] = DEFAULT_ACCOUNT_RULES,
): ExtractedInvoice {
  const text = ocrText.replace(/\r/g, "");
  const rawLines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const vendor = matchVendor(text, aliases);
  const invoiceNumber = extractInvoiceNumber(text);
  const fecha = text.match(new RegExp(`fecha\\s*[:.]?\\s*(${DATE.source})`, "i"));
  const invoiceDate = normalizeDate(fecha?.[1]) ?? normalizeDate(text.match(DATE)?.[0]);
  const dueDate = invoiceDate ? addDaysIso(invoiceDate, 15) : null;

  const municipal = labeledMoney(text, ["municipal auth", "municipal"]);
  const territory = labeledMoney(text, ["pr territory auth", "territory auth"]);
  const tax = round2(municipal + territory) || labeledMoney(text, ["tax", "sales tax"]);

  const lines: ExtractedSku[] = [];
  for (const line of rawLines) {
    if (COMMENT.test(line)) continue;
    const parsed = parseSkuLine(line);
    if (!parsed) continue;
    if (parsed.qty_shipped === 0 && parsed.amount === 0) continue;
    const classified = classifySku(parsed.description, rules);
    lines.push({ ...parsed, category: classified.category });
  }

  const lineSum = sum(lines);
  const subtotal = labeledMoney(text, ["subtotal", "sub total"]) || lineSum;
  const total =
    labeledMoney(text, ["balance due", "total due", "amount due", "total"]) || round2(subtotal + tax);

  return {
    vendor_name: vendor.vendor_name,
    qbo_vendor_name: vendor.qbo_vendor_name,
    supplier_id: vendor.supplier_id,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate,
    due_date: dueDate,
    terms: "Net 15",
    subtotal: round2(subtotal),
    tax: round2(tax),
    total: round2(total),
    lines,
    expenses: rollupExpenses(lines, tax || round2(total - subtotal)),
  };
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

function extractInvoiceNumber(text: string): string | null {
  const withoutCliente = text.replace(/num(?:ero|\.)?\s+cliente\b[^\n]*/gi, "");
  const factura = withoutCliente.match(/\bfactura\s+(\d{5,})/i);
  if (factura?.[1]) return factura[1];
  const labeled = withoutCliente.match(
    /\b(?:num(?:ero|\.)?|ref(?:\.|\s*no\.?)?)\s*[:#]?\s*(\d{5,})\b/i,
  );
  if (labeled?.[1]) return labeled[1];
  return null;
}

function parseSkuLine(line: string): ExtractedSku | null {
  if (/subtotal|balance due|municipal|territory auth|amount due|total due/i.test(line)) {
    return null;
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

  const tail = line.match(/([A-Za-z][A-Za-z0-9 /.*#"'-]{5,})\s+(\d{1,3}(?:,\d{3})*\.\d{2})\s*$/);
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
