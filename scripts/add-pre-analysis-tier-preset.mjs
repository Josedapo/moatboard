// Additive migration: separate the OBJECTIVE data layer (scorecard,
// moat) from the OPINION layer (tier) on discovery_pre_analyses.
//
// The new tier_preset column makes explicit which interpretation of
// the scorecard produced the persisted tier. Today everything ships
// as 'moatboard_default'. Future presets (akre_quality, smith_growth,
// buffett_classic) will recompute the tier in-memory from the cached
// scorecard_summary without re-running the expensive 10-K pipeline.

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);

console.log("Adding tier_preset column to discovery_pre_analyses...");

await sql`
  ALTER TABLE discovery_pre_analyses
  ADD COLUMN IF NOT EXISTS tier_preset VARCHAR(40) NOT NULL
  DEFAULT 'moatboard_default'
`;

const rows = await sql`
  SELECT tier_preset, COUNT(*)::int AS n
  FROM discovery_pre_analyses
  GROUP BY tier_preset
`;
console.log("tier_preset distribution:");
for (const r of rows) console.log(`  ${r.tier_preset}: ${r.n}`);
console.log("Done.");
