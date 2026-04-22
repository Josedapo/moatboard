// Extend the CHECK constraint on review_signals.source to include
// the new `discovery_13f` source emitted by the weekly Discovery cron
// when a curated fund moves a user-owned or watchlisted ticker.
//
// Run once: node scripts/extend-review-signals-source-check.mjs

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

console.log("Dropping old review_signals_source_check...");
await sql.query(
  `ALTER TABLE review_signals DROP CONSTRAINT IF EXISTS review_signals_source_check`,
);

console.log("Adding review_signals_source_check with discovery_13f...");
await sql.query(`
  ALTER TABLE review_signals
    ADD CONSTRAINT review_signals_source_check
    CHECK (source IN (
      'sec_8k', 'sec_10q', 'sec_10k', 'sec_10qa', 'sec_10ka',
      'snapshot_diff', 'discovery_13f'
    ))
`);

console.log("Done.");
