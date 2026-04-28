// Additive migration — creates the iris_actions table and its indexes.
// Safe to re-run; uses IF NOT EXISTS throughout. No DROPs.
//
// Schema source of truth lives in src/lib/schema.sql. This script
// mirrors the relevant CREATE statements so production (which shares
// the Neon instance with local) gets the new table without re-running
// init-db.mjs (which DROPs other tables on CHECK changes).

import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

async function main() {
  console.log("[migrate] Creating iris_actions...");
  await sql`
    CREATE TABLE IF NOT EXISTS iris_actions (
      id SERIAL PRIMARY KEY,
      action_type VARCHAR(50) NOT NULL CHECK (action_type IN (
        'daily_sec_scan',
        'weekly_13f_scan',
        'tenk_refresh',
        'tenq_recompute',
        'understanding_regen',
        'tier_propagated',
        'snapshot_created',
        'filing_detected'
      )),
      ticker VARCHAR(20),
      narration_md TEXT NOT NULL,
      metadata JSONB,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  console.log("[migrate] Creating indexes...");
  await sql`
    CREATE INDEX IF NOT EXISTS iris_actions_occurred_at_idx
      ON iris_actions(occurred_at DESC)
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS iris_actions_ticker_idx
      ON iris_actions(ticker, occurred_at DESC)
  `;

  const counts = await sql`SELECT COUNT(*)::int AS n FROM iris_actions`;
  console.log(`[migrate] iris_actions ready · ${counts[0].n} rows.`);
}

main().catch((err) => {
  console.error("[migrate] Failed:", err);
  process.exit(1);
});
