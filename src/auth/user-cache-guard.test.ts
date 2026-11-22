import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { createUserCacheGuard } from "./user-cache-guard";

function seeded(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(["shift_coworkers", "org-1"], new Map([["e3", "Luis"]]));
  return client;
}

describe("createUserCacheGuard", () => {
  it("keeps the cache for the first user and for the same user again", () => {
    const client = seeded();
    const guard = createUserCacheGuard(client);
    guard("user-a");
    guard("user-a");
    expect(client.getQueryData(["shift_coworkers", "org-1"])).toBeDefined();
  });

  it("clears the cache when another user signs in", () => {
    const client = seeded();
    const guard = createUserCacheGuard(client);
    guard("user-a");
    guard("user-b");
    expect(client.getQueryData(["shift_coworkers", "org-1"])).toBeUndefined();
  });

  it("clears the cache on sign-out", () => {
    const client = seeded();
    const guard = createUserCacheGuard(client);
    guard("user-a");
    guard(null);
    expect(client.getQueryData(["shift_coworkers", "org-1"])).toBeUndefined();
  });

  it("clears data loaded while signed out once a user signs in", () => {
    const client = new QueryClient();
    const guard = createUserCacheGuard(client);
    guard(null);
    client.setQueryData(["x"], 1);
    guard("user-a");
    expect(client.getQueryData(["x"])).toBeUndefined();
  });
});
