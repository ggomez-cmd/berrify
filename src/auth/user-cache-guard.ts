import type { QueryClient } from "@tanstack/react-query";

/**
 * Returns a callback to run with the signed-in user id (null when signed out)
 * every time the session changes. It empties the query cache when the user
 * changes or signs out, so the next login on the same tab never sees the
 * previous login's rows. The first call only records the user.
 */
export function createUserCacheGuard(client: QueryClient): (userId: string | null) => void {
  let last: string | null | undefined;
  return (userId) => {
    if (last !== undefined && last !== userId) client.clear();
    last = userId;
  };
}
