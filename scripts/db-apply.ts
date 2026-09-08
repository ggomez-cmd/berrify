import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createPgClient } from "./pg.ts";

dotenv.config();

const name = process.argv[2];
if (!name) {
  throw new Error("Usage: npm run db:apply -- <migration-file.sql>");
}

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "migrations");
const file = name.endsWith(".sql") ? name : `${name}.sql`;
const sql = readFileSync(path.join(migrationsDir, file), "utf8");

const client = createPgClient();
await client.connect();
try {
  console.log(`Applying ${file}…`);
  await client.query(sql);
  console.log("  ok");
} finally {
  await client.end();
}
