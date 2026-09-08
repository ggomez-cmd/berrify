import pg from "pg";

export function createPgClient(): pg.Client {
  const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DIRECT_URL or DATABASE_URL is required.");
  }

  let sanitized = connectionString;
  try {
    const parsed = new URL(connectionString);
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("ssl");
    // Transaction-mode pooler (6543) times out node-pg auth_query in this environment.
    if (parsed.hostname.includes("pooler.supabase.com") && parsed.port === "6543") {
      parsed.port = "5432";
    }
    sanitized = parsed.toString();
  } catch {
    sanitized = connectionString.replace(/[?&]sslmode=[^&]+/g, "");
  }

  return new pg.Client({
    connectionString: sanitized,
    ssl: { rejectUnauthorized: false },
  });
}
