// Additive migration: add summarized_at + summarized_with_model columns
// to review_signals. Safe to re-run (IF NOT EXISTS via information_schema
// check — Postgres doesn't support ALTER TABLE ADD COLUMN IF NOT EXISTS
// on all versions, so we check first).
//
// Run once: node scripts/add-signal-summary-columns.mjs

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

console.log("Adding summarized_at + summarized_with_model to review_signals…");

await sql.query(`
  ALTER TABLE review_signals
  ADD COLUMN IF NOT EXISTS summarized_at TIMESTAMPTZ
`);

await sql.query(`
  ALTER TABLE review_signals
  ADD COLUMN IF NOT EXISTS summarized_with_model VARCHAR(50)
`);

console.log("Done.");
