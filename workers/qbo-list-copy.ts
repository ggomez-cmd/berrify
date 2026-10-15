import { foldVendorName } from "../src/lib/qb-vendor-match";
import {
  fetchQboEntities,
  isQboDuplicateNameError,
  mapQueryVendors,
  postQboEntity,
} from "./qbo-api";

export const QBO_LIST_EXPORT_KIND = "berrify.qbo.list-export";
export const QBO_LIST_EXPORT_VERSION = 1;
export const QBO_LIST_IMPORT_CONFIRM = "create-missing-lists";
export const QBO_LIST_IMPORT_MAX_BYTES = 2_000_000;

export type QboListVendor = {
  displayName: string;
  companyName: string | null;
  isActive: boolean;
};

export type QboListAccount = {
  name: string;
  fullyQualifiedName: string;
  accountType: string;
  accountSubType: string | null;
  accountNumber: string | null;
  isActive: boolean;
};

export type QboListExport = {
  kind: typeof QBO_LIST_EXPORT_KIND;
  version: typeof QBO_LIST_EXPORT_VERSION;
  exportedAt: string;
  sourceCompanyName: string | null;
  vendors: QboListVendor[];
  accounts: QboListAccount[];
};

export type QboListCopyCounts = {
  vendorsCreated: number;
  vendorsSkipped: number;
  accountsCreated: number;
  accountsSkipped: number;
  errors: string[];
};

export type QboListCopyTarget = {
  apiBase: string;
  realmId: string;
  accessToken: string;
};

function accountPathKey(fullyQualifiedName: string): string {
  return fullyQualifiedName
    .split(":")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) =>
      segment
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim(),
    )
    .join(":");
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function entityId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function accountLeafName(fullyQualifiedName: string): string {
  const parts = fullyQualifiedName.split(":").map((part) => part.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? fullyQualifiedName.trim();
}

export function accountParentName(fullyQualifiedName: string): string | null {
  const parts = fullyQualifiedName.split(":").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  return parts.slice(0, -1).join(":");
}

export function accountDepth(fullyQualifiedName: string): number {
  return fullyQualifiedName.split(":").filter((part) => part.trim()).length;
}

export function mapListCopyVendors(entities: unknown[]): QboListVendor[] {
  return mapQueryVendors({ QueryResponse: { Vendor: entities } }).map((row) => ({
    displayName: row.fullName,
    companyName: row.companyName,
    isActive: row.isActive,
  }));
}

export function mapListCopyAccounts(entities: unknown[]): QboListAccount[] {
  return entities.flatMap((entity) => {
    if (!entity || typeof entity !== "object") return [];
    const row = entity as Record<string, unknown>;
    const qualified = text(row.FullyQualifiedName);
    const name = text(row.Name);
    const fullyQualifiedName = qualified || name;
    if (!fullyQualifiedName) return [];
    const accountNumber = text(row.AcctNum);
    const accountType = text(row.AccountType);
    const accountSubType = text(row.AccountSubType);
    return [
      {
        name: name || accountLeafName(fullyQualifiedName),
        fullyQualifiedName,
        accountType: accountType || "Expense",
        accountSubType: accountSubType || null,
        accountNumber: accountNumber || null,
        isActive: row.Active !== false,
      },
    ];
  });
}

export function buildQboListExport(input: {
  sourceCompanyName: string | null;
  vendors: QboListVendor[];
  accounts: QboListAccount[];
  exportedAt?: string;
}): QboListExport {
  return {
    kind: QBO_LIST_EXPORT_KIND,
    version: QBO_LIST_EXPORT_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    sourceCompanyName: input.sourceCompanyName,
    vendors: input.vendors,
    accounts: input.accounts,
  };
}

const MAX_INVALID_ENTRY_REASONS = 20;

type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

function parseVendor(value: unknown): Parsed<QboListVendor> {
  if (!value || typeof value !== "object") return { ok: false, reason: "is not an object" };
  const row = value as Record<string, unknown>;
  const displayName = text(row.displayName);
  if (!displayName) return { ok: false, reason: "is missing displayName" };
  return {
    ok: true,
    value: {
      displayName,
      companyName: text(row.companyName) || null,
      isActive: row.isActive !== false,
    },
  };
}

function parseAccount(value: unknown): Parsed<QboListAccount> {
  if (!value || typeof value !== "object") return { ok: false, reason: "is not an object" };
  const row = value as Record<string, unknown>;
  const fullyQualifiedName = text(row.fullyQualifiedName) || text(row.name);
  const name = text(row.name) || accountLeafName(fullyQualifiedName);
  const accountType = text(row.accountType);
  if (!fullyQualifiedName || !name) return { ok: false, reason: "is missing name" };
  if (!accountType) return { ok: false, reason: "is missing accountType" };
  return {
    ok: true,
    value: {
      name,
      fullyQualifiedName,
      accountType,
      accountSubType: text(row.accountSubType) || null,
      accountNumber: text(row.accountNumber) || null,
      isActive: row.isActive !== false,
    },
  };
}

function collectParsed<T>(entries: unknown[], label: string, parse: (value: unknown) => Parsed<T>): {
  values: T[];
  reasons: string[];
  invalidCount: number;
} {
  const values: T[] = [];
  const reasons: string[] = [];
  let invalidCount = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const parsed = parse(entries[index]);
    if (parsed.ok) values.push(parsed.value);
    else {
      invalidCount += 1;
      if (reasons.length < MAX_INVALID_ENTRY_REASONS) {
        reasons.push(`${label} ${index + 1} ${parsed.reason}`);
      }
    }
  }
  return { values, reasons, invalidCount };
}

export function parseQboListExport(value: unknown): QboListExport | { error: string } {
  if (!value || typeof value !== "object") return { error: "Paste a Berrify QuickBooks list export" };
  const row = value as Record<string, unknown>;
  if (row.kind !== QBO_LIST_EXPORT_KIND) {
    return { error: "That file is not a Berrify QuickBooks list export" };
  }
  if (row.version !== QBO_LIST_EXPORT_VERSION) {
    return { error: "That QuickBooks list export version is not supported" };
  }
  if (!Array.isArray(row.vendors) || !Array.isArray(row.accounts)) {
    return { error: "That QuickBooks list export is missing vendors or accounts" };
  }
  const vendors = collectParsed(row.vendors, "vendor", parseVendor);
  const accounts = collectParsed(row.accounts, "account", parseAccount);
  const invalidCount = vendors.invalidCount + accounts.invalidCount;
  const reasons = [...vendors.reasons, ...accounts.reasons].slice(0, MAX_INVALID_ENTRY_REASONS);
  const omitted = invalidCount - reasons.length;
  if (reasons.length > 0) {
    const suffix = omitted > 0 ? `; and ${omitted} more invalid entries` : "";
    return { error: `That QuickBooks list export has invalid entries: ${reasons.join("; ")}${suffix}` };
  }
  return {
    kind: QBO_LIST_EXPORT_KIND,
    version: QBO_LIST_EXPORT_VERSION,
    exportedAt: text(row.exportedAt) || new Date().toISOString(),
    sourceCompanyName: text(row.sourceCompanyName) || null,
    vendors: vendors.values,
    accounts: accounts.values,
  };
}

export function parseQboListImportBody(value: unknown):
  | { export: QboListExport }
  | { error: string } {
  if (!value || typeof value !== "object") return { error: "Send a list export and confirmation" };
  const row = value as Record<string, unknown>;
  if (row.confirm !== QBO_LIST_IMPORT_CONFIRM) {
    return { error: `Confirm import with "${QBO_LIST_IMPORT_CONFIRM}". This creates missing vendors and accounts only.` };
  }
  const parsed = parseQboListExport(row.export ?? row.payload);
  if ("error" in parsed) return parsed;
  if (parsed.vendors.length === 0 && parsed.accounts.length === 0) {
    return { error: "That QuickBooks list export has no vendors or accounts" };
  }
  return { export: parsed };
}

export function vendorAlreadyExists(name: string, target: QboListVendor[]): boolean {
  const folded = foldVendorName(name);
  if (!folded) return false;
  return target.some((row) => foldVendorName(row.displayName) === folded);
}

export function accountAlreadyExists(fullyQualifiedName: string, target: QboListAccount[]): boolean {
  const folded = accountPathKey(fullyQualifiedName);
  if (!folded) return false;
  return target.some((row) => accountPathKey(row.fullyQualifiedName) === folded);
}

export function planQboListCopy(
  source: QboListExport,
  targetVendors: QboListVendor[],
  targetAccounts: QboListAccount[],
): {
  vendorsToCreate: QboListVendor[];
  vendorsToSkip: QboListVendor[];
  accountsToCreate: QboListAccount[];
  accountsToSkip: QboListAccount[];
} {
  const vendorsToCreate: QboListVendor[] = [];
  const vendorsToSkip: QboListVendor[] = [];
  const seenVendors = new Set<string>();
  for (const vendor of source.vendors) {
    const key = foldVendorName(vendor.displayName);
    if (!key || seenVendors.has(key) || vendorAlreadyExists(vendor.displayName, targetVendors)) {
      vendorsToSkip.push(vendor);
      continue;
    }
    seenVendors.add(key);
    vendorsToCreate.push(vendor);
  }

  const accountsToCreate: QboListAccount[] = [];
  const accountsToSkip: QboListAccount[] = [];
  const seenAccounts = new Set<string>();
  const sorted = [...source.accounts].sort(
    (left, right) => accountDepth(left.fullyQualifiedName) - accountDepth(right.fullyQualifiedName),
  );
  for (const account of sorted) {
    const key = accountPathKey(account.fullyQualifiedName);
    if (!key || seenAccounts.has(key) || accountAlreadyExists(account.fullyQualifiedName, targetAccounts)) {
      accountsToSkip.push(account);
      continue;
    }
    seenAccounts.add(key);
    accountsToCreate.push(account);
  }
  return { vendorsToCreate, vendorsToSkip, accountsToCreate, accountsToSkip };
}

export function buildQboVendorCreateBody(vendor: QboListVendor): Record<string, unknown> {
  const body: Record<string, unknown> = {
    DisplayName: vendor.displayName,
    Active: vendor.isActive,
  };
  if (vendor.companyName) body.CompanyName = vendor.companyName;
  return body;
}

export function buildQboAccountCreateBody(
  account: QboListAccount,
  parentId: string | null,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    Name: account.name || accountLeafName(account.fullyQualifiedName),
    AccountType: account.accountType,
    Active: account.isActive,
  };
  if (account.accountSubType) body.AccountSubType = account.accountSubType;
  if (account.accountNumber) body.AcctNum = account.accountNumber;
  if (parentId) body.ParentRef = { value: parentId };
  return body;
}

function targetVendorRows(entities: unknown[]): QboListVendor[] {
  return mapListCopyVendors(entities);
}

function targetAccountRows(entities: unknown[]): Array<QboListAccount & { listId: string | null }> {
  return entities.flatMap((entity) => {
    const [mapped] = mapListCopyAccounts([entity]);
    if (!mapped) return [];
    const listId = entity && typeof entity === "object" ? entityId((entity as { Id?: unknown }).Id) : null;
    return [{ ...mapped, listId }];
  });
}

export async function readQboListExport(
  fetchImpl: typeof fetch,
  input: QboListCopyTarget & { sourceCompanyName: string | null },
): Promise<QboListExport | { error: string }> {
  const vendors = await fetchQboEntities(fetchImpl, { ...input, entity: "Vendor" });
  if ("error" in vendors) return vendors;
  const accounts = await fetchQboEntities(fetchImpl, { ...input, entity: "Account" });
  if ("error" in accounts) return accounts;
  return buildQboListExport({
    sourceCompanyName: input.sourceCompanyName,
    vendors: mapListCopyVendors(vendors.entities),
    accounts: mapListCopyAccounts(accounts.entities),
  });
}

export async function applyQboListCopy(
  fetchImpl: typeof fetch,
  input: QboListCopyTarget & { source: QboListExport },
): Promise<QboListCopyCounts | { error: string }> {
  const listedVendors = await fetchQboEntities(fetchImpl, { ...input, entity: "Vendor" });
  if ("error" in listedVendors) return listedVendors;
  const listedAccounts = await fetchQboEntities(fetchImpl, { ...input, entity: "Account" });
  if ("error" in listedAccounts) return listedAccounts;

  const targetVendors = targetVendorRows(listedVendors.entities);
  const targetAccounts = targetAccountRows(listedAccounts.entities);
  const plan = planQboListCopy(input.source, targetVendors, targetAccounts);
  const accountIds = new Map<string, string>();
  for (const row of targetAccounts) {
    if (row.listId) accountIds.set(accountPathKey(row.fullyQualifiedName), row.listId);
  }

  const counts: QboListCopyCounts = {
    vendorsCreated: 0,
    vendorsSkipped: plan.vendorsToSkip.length,
    accountsCreated: 0,
    accountsSkipped: plan.accountsToSkip.length,
    errors: [],
  };

  for (const vendor of plan.vendorsToCreate) {
    const created = await postQboEntity(fetchImpl, {
      ...input,
      entity: "vendor",
      body: buildQboVendorCreateBody(vendor),
    });
    if ("error" in created) {
      if (isQboDuplicateNameError(created.error)) {
        counts.vendorsSkipped += 1;
        continue;
      }
      counts.errors.push(`${vendor.displayName}: ${created.error}`);
      continue;
    }
    counts.vendorsCreated += 1;
  }

  for (const account of plan.accountsToCreate) {
    const parentName = accountParentName(account.fullyQualifiedName);
    const parentId = parentName ? accountIds.get(accountPathKey(parentName)) ?? null : null;
    if (parentName && !parentId) {
      counts.errors.push(`${account.fullyQualifiedName}: parent account "${parentName}" is missing`);
      continue;
    }
    const created = await postQboEntity(fetchImpl, {
      ...input,
      entity: "account",
      body: buildQboAccountCreateBody(account, parentId),
    });
    if ("error" in created) {
      if (isQboDuplicateNameError(created.error)) {
        counts.accountsSkipped += 1;
        continue;
      }
      counts.errors.push(`${account.fullyQualifiedName}: ${created.error}`);
      continue;
    }
    accountIds.set(accountPathKey(account.fullyQualifiedName), created.id);
    counts.accountsCreated += 1;
  }

  return counts;
}
