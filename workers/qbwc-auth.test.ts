import { describe, expect, it } from "vitest";
import {
  hashQbPassword,
  newSessionTicket,
  sessionExpiryIso,
  sessionIsExpired,
  verifyQbPassword,
} from "./qbwc-auth";

describe("QBWC password and tickets", () => {
  it("accepts the matching password and rejects a wrong one", async () => {
    const hash = await hashQbPassword("correct-horse");
    expect(hash).toMatch(/^pbkdf2\$sha256\$/);
    await expect(verifyQbPassword("correct-horse", hash)).resolves.toBe(true);
    await expect(verifyQbPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("rejects a malformed stored hash", async () => {
    await expect(verifyQbPassword("x", "not-a-hash")).resolves.toBe(false);
  });

  it("issues tickets with a future expiry", () => {
    const ticket = newSessionTicket();
    expect(ticket).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const expires = sessionExpiryIso(1_000);
    expect(sessionIsExpired({ expires_at: expires }, 500)).toBe(false);
    expect(sessionIsExpired({ expires_at: expires }, 1_000 + 1)).toBe(true);
  });
});
