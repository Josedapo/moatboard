// One-shot additive migration: create ticker_aliases without touching any
// existing table. Safe to re-run (uses IF NOT EXISTS).
//
// The table maps share-class duplicates (GOOG/GOOGL, BRK-B/BRK-A) to a
// single canonical ticker so Discovery aggregates conviction by business
// and analysis caches dedupe across share classes. The canonical maps to
// itself implicitly: if no row exists for a ticker, it's its own canonical.
// Hard rule (CHECK): never INSERT a row where ticker = canonical.
//
// Run once: node scripts/add-ticker-aliases-table.mjs

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

console.log("Creating ticker_aliases (if missing)...");

await sql.query(`
  CREATE TABLE IF NOT EXISTS ticker_aliases (
    ticker VARCHAR(10) PRIMARY KEY,
    canonical_ticker VARCHAR(10) NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_alias_not_self CHECK (ticker <> canonical_ticker)
  )
`);

await sql.query(
  `CREATE INDEX IF NOT EXISTS idx_ticker_aliases_canonical
     ON ticker_aliases(canonical_ticker)`,
);

console.log("Done.");
