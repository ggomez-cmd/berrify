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

  it("keeps the account path Utilities:Gas distinct from the top-level name Utilities Gas", () => {
    const topLevel = {
      name: "Utilities Gas",
      fullyQualifiedName: "Utilities Gas",
      accountType: "Expense",
      accountSubType: null,
      accountNumber: null,
      isActive: true,
    };
    const hierarchical = {
      name: "Gas",
      fullyQualifiedName: "Utilities:Gas",
      accountType: "Expense",
      accountSubType: null,
      accountNumber: null,
      isActive: true,
    };
    const plan = planQboListCopy(
      buildQboListExport({
        sourceCompanyName: "Lelas",
        exportedAt: "2026-10-06T15:00:00.000Z",
        vendors: [],
        accounts: [hierarchical],
      }),
      [],
      [topLevel],
    );
    expect({
      hierarchicalMatchesTopLevel: accountAlreadyExists(hierarchical.fullyQualifiedName, [topLevel]),
      topLevelMatchesHierarchical: accountAlreadyExists(topLevel.fullyQualifiedName, [hierarchical]),
      accountsToCreate: plan.accountsToCreate.map((row) => row.fullyQualifiedName),
      accountsToSkip: plan.accountsToSkip.map((row) => row.fullyQualifiedName),
    }).toEqual({
      hierarchicalMatchesTopLevel: false,
      topLevelMatchesHierarchical: false,
      accountsToCreate: ["Utilities:Gas"],
      accountsToSkip: [],
    });
  });

  it("does not give a child under Utilities:Gas the id of top-level Utilities Gas", async () => {
    const child = {
      name: "Meter",
      fullyQualifiedName: "Utilities:Gas:Meter",
      accountType: "Expense",
      accountSubType: null,
      accountNumber: null,
      isActive: true,
    };
    const created: Array<Record<string, unknown>> = [];
    const result = await applyQboListCopy(async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("/query") && url.includes("Vendor")) {
        return Response.json({ QueryResponse: { Vendor: [] } });
      }
      if (url.includes("/query") && url.includes("Account")) {
        return Response.json({
          QueryResponse: {
            Account: [
              {
                Id: "99",
                Name: "Utilities Gas",
                FullyQualifiedName: "Utilities Gas",
                AccountType: "Expense",
                Active: true,
              },
            ],
          },
        });
      }
      if (method === "POST" && url.includes("/account")) {
        created.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return Response.json({ Account: { Id: "100" } });
      }
      throw new Error(`${method} ${url}`);
    }, {
      apiBase: "https://sandbox-quickbooks.api.intuit.com",
      realmId: "sandbox-1",
      accessToken: "access-sandbox",
      source: buildQboListExport({
        sourceCompanyName: "Lelas",
        exportedAt: "2026-10-06T15:00:00.000Z",
        vendors: [],
        accounts: [child],
      }),
    });
    expect({
      created: created.map((body) => ({
        Name: body.Name,
        ParentRef: body.ParentRef ?? null,
      })),
      accountsCreated: "accountsCreated" in result ? result.accountsCreated : null,
      errors: "errors" in result ? result.errors : [result.error],
    }).toEqual({
      created: [],
      accountsCreated: 0,
      errors: ['Utilities:Gas:Meter: parent account "Utilities:Gas" is missing'],
    });
  });

  it("rejects a vendor entry missing displayName at its 1-based position", () => {
    const parsed = parseQboListExport({
      kind: QBO_LIST_EXPORT_KIND,
      version: 1,
      exportedAt: "2026-10-06T15:00:00.000Z",
      sourceCompanyName: "Lelas",
      vendors: [
        { displayName: "SuperMax", companyName: null, isActive: true },
        { companyName: "No display name", isActive: true },
      ],
      accounts: [
        {
          name: "Food",
          fullyQualifiedName: "Food",
          accountType: "Expense",
          accountSubType: null,
          accountNumber: null,
          isActive: true,
        },
      ],
    });
    expect(parsed).toEqual({
      error: "That QuickBooks list export has invalid entries: vendor 2 is missing displayName",
    });
  });

  it("rejects an account entry missing accountType at its 1-based position", () => {
    const parsed = parseQboListExport({
      kind: QBO_LIST_EXPORT_KIND,
      version: 1,
      exportedAt: "2026-10-06T15:00:00.000Z",
      sourceCompanyName: "Lelas",
      vendors: [{ displayName: "SuperMax", companyName: null, isActive: true }],
      accounts: [
        {
          name: "Food",
          fullyQualifiedName: "Food",
          accountType: "Expense",
          accountSubType: null,
          accountNumber: null,
          isActive: true,
        },
        {
          name: "Mystery",
          fullyQualifiedName: "Mystery",
          accountSubType: null,
          accountNumber: null,
          isActive: true,
        },
      ],
    });
    expect(parsed).toEqual({
      error: "That QuickBooks list export has invalid entries: account 2 is missing accountType",
    });
  });

  it("bounds invalid-entry details while reporting how many were omitted", () => {
    const parsed = parseQboListExport({
      kind: QBO_LIST_EXPORT_KIND,
      version: 1,
      vendors: Array.from({ length: 25 }, () => null),
      accounts: [],
    });
    expect(parsed).toEqual({
      error: `That QuickBooks list export has invalid entries: ${Array.from(
        { length: 20 },
        (_, index) => `vendor ${index + 1} is not an object`,
      ).join("; ")}; and 5 more invalid entries`,
    });
    expect("error" in parsed ? parsed.error.length : Number.POSITIVE_INFINITY).toBeLessThan(1_000);
  });
});
