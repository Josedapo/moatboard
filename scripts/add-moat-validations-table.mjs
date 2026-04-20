// One-shot additive migration: create moat_validations without touching
// any existing table. Safe to re-run (uses IF NOT EXISTS).
//
// Run once: node scripts/add-moat-validations-table.mjs

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

console.log("Creating moat_validations (if missing)...");

await sql.query(`
  CREATE TABLE IF NOT EXISTS moat_validations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    ticker VARCHAR(10) NOT NULL,
    from_snapshot_id INTEGER NOT NULL REFERENCES fundamentals_snapshots(id) ON DELETE CASCADE,
    original_archetype VARCHAR(30) NOT NULL,
    original_strength VARCHAR(10) NOT NULL,
    original_reasoning TEXT NOT NULL,
    original_recorded_at TIMESTAMPTZ NOT NULL,
    verdict VARCHAR(15) NOT NULL CHECK (verdict IN ('intact', 'expanding', 'compressing', 'dissolved')),
    new_archetype VARCHAR(30) NOT NULL CHECK (new_archetype IN (
      'brand', 'network_effects', 'switching_costs', 'scale',
      'ip', 'regulatory', 'cost_advantage', 'none'
    )),
    new_strength VARCHAR(10) NOT NULL CHECK (new_strength IN ('strong', 'weak', 'unclear')),
    reasoning TEXT NOT NULL,
    validated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    validated_with_model VARCHAR(50) NOT NULL
  )
`);

await sql.query(
  `CREATE INDEX IF NOT EXISTS moat_validations_from_snapshot_idx ON moat_validations(from_snapshot_id)`,
);
await sql.query(
  `CREATE INDEX IF NOT EXISTS moat_validations_position_idx ON moat_validations(position_id)`,
);

console.log("Done.");
