// One-shot additive migration: create discovery_filing_dismissals so
// the Discovery "Novedades" panel can remember per-user acknowledgement
// of newly-arrived 13F filings. Idempotent (IF NOT EXISTS).
//
// Run once: node scripts/add-discovery-filing-dismissals-table.mjs

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

console.log("Creating discovery_filing_dismissals (if missing)...");

await sql.query(`
  CREATE TABLE IF NOT EXISTS discovery_filing_dismissals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filing_id INTEGER NOT NULL REFERENCES discovery_filings(id) ON DELETE CASCADE,
    dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, filing_id)
  )
`);

await sql.query(
  `CREATE INDEX IF NOT EXISTS idx_dfd_user_dismissed ON discovery_filing_dismissals(user_id, dismissed_at DESC)`,
);

console.log("Done.");
