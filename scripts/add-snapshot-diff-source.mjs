// Widen review_signals.source CHECK to include 'snapshot_diff', the
// analytical source emitted by the delta-alert path in snapshotFlow.
// Run: node scripts/add-snapshot-diff-source.mjs

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

try {
  await sql.query(
    "ALTER TABLE review_signals DROP CONSTRAINT IF EXISTS review_signals_source_check",
  );
  await sql.query(`
    ALTER TABLE review_signals
    ADD CONSTRAINT review_signals_source_check
    CHECK (source IN (
      'sec_8k', 'sec_10q', 'sec_10k', 'sec_10qa', 'sec_10ka',
      'snapshot_diff'
    ))
  `);
  console.log("OK: review_signals.source now accepts 'snapshot_diff'");
} catch (err) {
  console.error("FAIL:", err.message);
  process.exit(1);
}
