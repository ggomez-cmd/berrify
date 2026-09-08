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
    sanitized = parsed.toString();
  } catch {
    sanitized = connectionString.replace(/[?&]sslmode=[^&]+/g, "");
  }

  return new pg.Client({
    connectionString: sanitized,
    ssl: { rejectUnauthorized: false },
  });
}
