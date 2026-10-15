import { describe, expect, it } from "vitest";
import {
  accountAlreadyExists,
  accountParentName,
  applyQboListCopy,
  buildQboAccountCreateBody,
  buildQboListExport,
  buildQboVendorCreateBody,
  mapListCopyAccounts,
  parseQboListExport,
  parseQboListImportBody,
  planQboListCopy,
  QBO_LIST_EXPORT_KIND,
  QBO_LIST_IMPORT_CONFIRM,
  vendorAlreadyExists,
} from "./qbo-list-copy";

const source = buildQboListExport({
  sourceCompanyName: "Lelas",
  exportedAt: "2026-10-06T15:00:00.000Z",
  vendors: [
    { displayName: "Jose Santiago Inc", companyName: "Jose Santiago", isActive: true },
    { displayName: "SuperMax", companyName: null, isActive: true },
  ],
  accounts: [
    {
      name: "Cost of Goods Sold",
      fullyQualifiedName: "Cost of Goods Sold",
      accountType: "Cost of Goods Sold",
      accountSubType: "SuppliesMaterialsCogs",
      accountNumber: "50000",
      isActive: true,
    },
    {
      name: "Food",
      fullyQualifiedName: "Cost of Goods Sold:Food",
      accountType: "Cost of Goods Sold",
      accountSubType: "SuppliesMaterialsCogs",
      accountNumber: null,
      isActive: true,
    },
  ],
});

describe("QuickBooks list-copy helpers", () => {
  it("builds an export without tokens or realm ids", () => {
    const serialized = JSON.stringify(source);
    expect(source.kind).toBe(QBO_LIST_EXPORT_KIND);
    expect(serialized).not.toContain("refresh");
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("realm");
    expect(accountParentName("Cost of Goods Sold:Food")).toBe("Cost of Goods Sold");
    expect(buildQboVendorCreateBody(source.vendors[0]!)).toEqual({
      DisplayName: "Jose Santiago Inc",
      CompanyName: "Jose Santiago",
      Active: true,
    });
    expect(buildQboAccountCreateBody(source.accounts[1]!, "99")).toEqual({
      Name: "Food",
      AccountType: "Cost of Goods Sold",
      AccountSubType: "SuppliesMaterialsCogs",
      Active: true,
      ParentRef: { value: "99" },
    });
  });

  it("rejects imports without the explicit confirm phrase", () => {
    expect(parseQboListImportBody({ export: source })).toEqual({
      error: `Confirm import with "${QBO_LIST_IMPORT_CONFIRM}". This creates missing vendors and accounts only.`,
    });
    expect(parseQboListExport({ kind: "other", version: 1, vendors: [], accounts: [] })).toEqual({
      error: "That file is not a Berrify QuickBooks list export",
    });
    const parsed = parseQboListImportBody({ confirm: QBO_LIST_IMPORT_CONFIRM, export: source });
    expect("export" in parsed && parsed.export.vendors).toHaveLength(2);
  });

  it("dedupes by folded name and never plans an overwrite", () => {
    const plan = planQboListCopy(source, [{ displayName: "jose santiago inc", companyName: null, isActive: true }], [
      {
        name: "Cost of Goods Sold",
        fullyQualifiedName: "Cost of Goods Sold",
        accountType: "Cost of Goods Sold",
        accountSubType: null,
        accountNumber: "50000",
        isActive: true,
      },
    ]);
    expect(plan.vendorsToCreate.map((row) => row.displayName)).toEqual(["SuperMax"]);
    expect(plan.vendorsToSkip.map((row) => row.displayName)).toEqual(["Jose Santiago Inc"]);
    expect(plan.accountsToCreate.map((row) => row.fullyQualifiedName)).toEqual(["Cost of Goods Sold:Food"]);
    expect(vendorAlreadyExists("SuperMax", [])).toBe(false);
    expect(accountAlreadyExists("Cost of Goods Sold", plan.accountsToSkip)).toBe(true);
  });

  it("maps account subtype from a query entity", () => {
    expect(
      mapListCopyAccounts([
        {
          Id: "7",
          Name: "Food",
          FullyQualifiedName: "Cost of Goods Sold:Food",
          AccountType: "Cost of Goods Sold",
          AccountSubType: "SuppliesMaterialsCogs",
          Active: true,
        },
      ]),
    ).toEqual([
      {
        name: "Food",
        fullyQualifiedName: "Cost of Goods Sold:Food",
        accountType: "Cost of Goods Sold",
        accountSubType: "SuppliesMaterialsCogs",
        accountNumber: null,
        isActive: true,
      },
    ]);
  });

  it("creates missing records and skips existing names", async () => {
    const created: Array<{ url: string; body: Record<string, unknown> }> = [];
    const result = await applyQboListCopy(async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/query") && url.includes("Vendor")) {
        return Response.json({
          QueryResponse: { Vendor: [{ Id: "1", DisplayName: "Jose Santiago Inc", Active: true }] },
        });
      }
      if (url.includes("/query") && url.includes("Account")) {
        return Response.json({
          QueryResponse: {
            Account: [
              {
                Id: "10",
                Name: "Cost of Goods Sold",
                FullyQualifiedName: "Cost of Goods Sold",
                AccountType: "Cost of Goods Sold",
                Active: true,
              },
            ],
          },
        });
      }
      if (method === "POST") {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        created.push({ url, body });
        if (url.includes("/vendor")) return Response.json({ Vendor: { Id: "2" } });
        if (url.includes("/account")) {
          expect(body.Name).toBe("Food");
          expect(body.ParentRef).toEqual({ value: "10" });
          return Response.json({ Account: { Id: "11" } });
        }
      }
      throw new Error(`${method} ${url}`);
    }, {
      apiBase: "https://sandbox-quickbooks.api.intuit.com",
      realmId: "sandbox-1",
      accessToken: "access-sandbox",
      source,
    });
    expect(result).toEqual({
      vendorsCreated: 1,
      vendorsSkipped: 1,
      accountsCreated: 1,
      accountsSkipped: 1,
      errors: [],
    });
    expect(created).toHaveLength(2);
    expect(created.some((row) => row.url.includes("/vendor") && row.body.DisplayName === "SuperMax")).toBe(true);
    expect(created.some((row) => row.body.DisplayName === "Jose Santiago Inc")).toBe(false);
  });
});
