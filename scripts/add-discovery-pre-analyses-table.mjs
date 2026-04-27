// Additive migration: discovery_pre_analyses table for the agentic
// pre-tiering of the Discovery roster.
//
// Idempotent — every CREATE uses IF NOT EXISTS.

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

const sql = neon(process.env.DATABASE_URL);

console.log("Creating discovery_pre_analyses table...");

await sql`
  CREATE TABLE IF NOT EXISTS discovery_pre_analyses (
    ticker VARCHAR(10) PRIMARY KEY,
    status VARCHAR(20) NOT NULL CHECK (
      status IN ('covered', 'not_covered', 'pending', 'error')
    ),
    tier VARCHAR(15) CHECK (
      tier IS NULL OR tier IN ('exceptional', 'good', 'mediocre', 'poor')
    ),
    applicable_dimensions INT,
    scorecard_summary JSONB,
    moat_strength VARCHAR(10) CHECK (
      moat_strength IS NULL OR moat_strength IN ('strong', 'weak', 'unclear')
    ),
    moat_archetype VARCHAR(30) CHECK (
      moat_archetype IS NULL OR moat_archetype IN (
        'brand', 'network_effects', 'switching_costs', 'scale',
        'ip', 'regulatory', 'cost_advantage', 'none'
      )
    ),
    has_serious_red_flags BOOLEAN NOT NULL DEFAULT FALSE,
    serious_red_flags_count INT NOT NULL DEFAULT 0,
    watch_red_flags_count INT NOT NULL DEFAULT 0,
    last_10k_accession VARCHAR(30),
    last_10k_period_end DATE,
    not_covered_reason VARCHAR(200),
    error_message VARCHAR(500),
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    evaluated_with_model VARCHAR(50)
  )
`;

await sql`
  CREATE INDEX IF NOT EXISTS idx_discovery_pre_analyses_tier
    ON discovery_pre_analyses(status, tier)
`;

await sql`
  CREATE INDEX IF NOT EXISTS idx_discovery_pre_analyses_serious
    ON discovery_pre_analyses(has_serious_red_flags)
    WHERE status = 'covered'
`;

const rows = await sql`SELECT COUNT(*) AS total FROM discovery_pre_analyses`;
console.log(`discovery_pre_analyses ready (${rows[0].total} existing rows).`);
console.log("Done.");
