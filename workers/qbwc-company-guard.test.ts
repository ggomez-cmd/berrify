import { describe, expect, it } from "vitest";
import {
  assessCompanySession,
  companyMismatchMessage,
  isCompanyMismatchError,
  lockedCompanyName,
  normalizeCompanyName,
} from "./qbwc-company-guard";

describe("company session", () => {
  it("normalizes case and inner spaces", () => {
    expect(normalizeCompanyName("  Can  Enterprise  LLC  ")).toBe("can enterprise llc");
  });

  it("stays unlocked until a company name arrives", () => {
    expect(assessCompanySession(null, null)).toEqual({ status: "unknown" });
    expect(assessCompanySession(null, "  Can Enterprise LLC dba Semilla ")).toEqual({
      status: "unlocked",
      open: "Can Enterprise LLC dba Semilla",
    });
  });

  it("locks the first name and matches later sessions case-insensitively", () => {
    expect(assessCompanySession("Can Enterprise Deux LLC DBA Kane", "can enterprise deux llc dba kane")).toEqual({
      status: "matched",
      expected: "Can Enterprise Deux LLC DBA Kane",
      open: "can enterprise deux llc dba kane",
    });
  });

  it("rejects a different open company and keeps the locked name", () => {
    const session = assessCompanySession(
      "Can Enterprise Deux LLC DBA Kane",
      "Can Enterprise LLC dba Semilla",
    );
    expect(session).toEqual({
      status: "mismatch",
      expected: "Can Enterprise Deux LLC DBA Kane",
      open: "Can Enterprise LLC dba Semilla",
    });
    expect(companyMismatchMessage(session)).toBe(
      "Wrong company file open: Can Enterprise LLC dba Semilla. Expected Can Enterprise Deux LLC DBA Kane.",
    );
    expect(lockedCompanyName("Can Enterprise Deux LLC DBA Kane", "Can Enterprise LLC dba Semilla")).toBe(
      "Can Enterprise Deux LLC DBA Kane",
    );
    expect(isCompanyMismatchError(companyMismatchMessage(session))).toBe(true);
    expect(isCompanyMismatchError("status 3120")).toBe(false);
  });

  it("locks the open name on the first session", () => {
    expect(lockedCompanyName(null, "Can Enterprise LLC dba Semilla")).toBe("Can Enterprise LLC dba Semilla");
    expect(lockedCompanyName("  Kane  ", null)).toBe("Kane");
  });
});
