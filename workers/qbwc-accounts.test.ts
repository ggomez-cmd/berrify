import { describe, expect, it } from "vitest";
import { upsertAccountsFromQuery } from "./qbwc-accounts";

type AccountRow = {
  connection_id: string;
  list_id: string;
  full_name: string;
  account_number?: string | null;
  account_type?: string;
  is_active: boolean;
};

describe("account upsert", () => {
  it("upserts per connection and deactivates names missing from the latest query", async () => {
    const store: AccountRow[] = [
      { connection_id: "conn-kane", list_id: "old", full_name: "Gone Expense", is_active: true },
      { connection_id: "conn-semilla", list_id: "keep", full_name: "Local Food", is_active: true },
    ];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.includes("quickbooks_accounts") && method === "GET") {
        const connectionId = /connection_id=eq\.([^&]+)/.exec(url)?.[1];
        return Response.json(store.filter((row) => row.connection_id === connectionId).map((row) => ({ list_id: row.list_id })));
      }
      if (url.includes("quickbooks_accounts") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "[]")) as AccountRow[];
        for (const row of body) {
          const existing = store.find((item) => item.connection_id === row.connection_id && item.list_id === row.list_id);
          if (existing) Object.assign(existing, row);
          else store.push({ ...row, is_active: row.is_active ?? true });
        }
        return new Response(null, { status: 201 });
      }
      if (url.includes("quickbooks_accounts") && method === "PATCH") {
        const connectionId = /connection_id=eq\.([^&]+)/.exec(url)?.[1];
        const listId = /list_id=eq\.([^&]+)/.exec(url)?.[1];
        const body = JSON.parse(String(init?.body ?? "{}")) as Partial<AccountRow>;
        for (const row of store) {
          if (row.connection_id === connectionId && row.list_id === listId) Object.assign(row, body);
        }
        return new Response(null, { status: 204 });
      }
      throw new Error(url);
    };

    const result = await upsertAccountsFromQuery(
      { NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
      {
        orgId: "org-1",
        connectionId: "conn-kane",
        accounts: [
          {
            listId: "1",
            fullName: "SalesTaxExpense",
            accountNumber: "68200",
            accountType: "Expense",
            isActive: true,
          },
        ],
      },
      fetchImpl,
    );
    expect(result).toEqual({ upserted: 1, deactivated: 1 });
    expect(store.find((row) => row.connection_id === "conn-kane" && row.list_id === "old")?.is_active).toBe(false);
    expect(store.find((row) => row.connection_id === "conn-semilla")?.is_active).toBe(true);
    expect(store.some((row) => row.connection_id === "conn-kane" && row.full_name === "SalesTaxExpense")).toBe(true);
  });
});
