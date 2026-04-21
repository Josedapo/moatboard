// Additive migration: add last_10k_accession + last_10k_period_end to
// business_understanding. Idempotent (IF NOT EXISTS). No data loss.
// Run: node scripts/add-business-understanding-10k-columns.mjs

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const statements = [
  `ALTER TABLE business_understanding
     ADD COLUMN IF NOT EXISTS last_10k_accession TEXT`,
  `ALTER TABLE business_understanding
     ADD COLUMN IF NOT EXISTS last_10k_period_end DATE`,
];

for (const stmt of statements) {
  try {
    await sql.query(stmt);
    console.log(`OK: ${stmt.replace(/\s+/g, " ").slice(0, 80)}...`);
  } catch (err) {
    console.error(`FAIL: ${err.message}`);
    process.exit(1);
  }
}

console.log("\nMigration complete.");
