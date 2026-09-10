import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECOVERY_PATH = path.join(ROOT, "supabase/templates/recovery.html");

export const RECOVERY_SUBJECT = "Reset your Berrify password";
export const RECOVERY_TEMPLATE_MAX_CHARS = 5000;

export function readRecoveryTemplate(): string {
  return readFileSync(RECOVERY_PATH, "utf8").trim();
}

export function projectRefFromSupabaseUrl(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
  }
  const ref = host.split(".")[0]?.trim();
  if (!ref) {
    throw new Error("Could not read the Supabase project ref from NEXT_PUBLIC_SUPABASE_URL.");
  }
  return ref;
}
