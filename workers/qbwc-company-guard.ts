export type CompanySession =
  | { status: "unknown" }
  | { status: "unlocked"; open: string }
  | { status: "matched"; expected: string; open: string }
  | { status: "mismatch"; expected: string; open: string };

export function normalizeCompanyName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function assessCompanySession(
  expected: string | null | undefined,
  open: string | null | undefined,
): CompanySession {
  const locked = expected?.trim() ?? "";
  const opened = open?.trim() ?? "";
  if (!opened) return { status: "unknown" };
  if (!locked) return { status: "unlocked", open: opened };
  if (normalizeCompanyName(locked) === normalizeCompanyName(opened)) {
    return { status: "matched", expected: locked, open: opened };
  }
  return { status: "mismatch", expected: locked, open: opened };
}

export function companyMismatchMessage(session: Extract<CompanySession, { status: "mismatch" }>): string {
  return `Wrong company file open: ${session.open}. Expected ${session.expected}.`;
}

export function isCompanyMismatchError(message: string | null | undefined): boolean {
  return Boolean(message?.startsWith("Wrong company file open:"));
}

export function lockedCompanyName(
  expected: string | null | undefined,
  open: string | null | undefined,
): string | null {
  const session = assessCompanySession(expected, open);
  switch (session.status) {
    case "unlocked":
      return session.open;
    case "matched":
      return session.expected;
    case "mismatch":
      return session.expected;
    case "unknown":
      return expected?.trim() || null;
    default: {
      const exhaustive: never = session;
      return exhaustive;
    }
  }
}
