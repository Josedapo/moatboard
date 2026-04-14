// Initialize the database schema in Neon
// Run: node scripts/init-db.mjs

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const rawSchema = readFileSync("src/lib/schema.sql", "utf-8");

// Strip comment lines, then split on semicolons
const cleaned = rawSchema
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const statements = cleaned
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

console.log(`Executing ${statements.length} SQL statements...`);

for (const [i, statement] of statements.entries()) {
  const preview = statement.substring(0, 70).replace(/\n/g, " ");
  try {
    await sql.query(statement);
    console.log(`  [${i + 1}/${statements.length}] OK: ${preview}...`);
  } catch (err) {
    console.error(`  [${i + 1}/${statements.length}] FAIL: ${preview}...`);
    console.error(`  Error: ${err.message}`);
    process.exit(1);
  }
}

console.log("\nDatabase initialized successfully.");
