// Additive migration: Discovery module tables. Idempotent.
// Run: node scripts/add-discovery-tables.mjs

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const statements = [
  `CREATE TABLE IF NOT EXISTS discovery_funds (
    id SERIAL PRIMARY KEY,
    cik VARCHAR(10) NOT NULL UNIQUE,
    manager_name VARCHAR(160) NOT NULL,
    display_name VARCHAR(120) NOT NULL,
    tier VARCHAR(1) NOT NULL CHECK (tier IN ('A','B','C','D','E')),
    tier_weight NUMERIC(3, 1) NOT NULL,
    philosophy VARCHAR(400),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_discovery_funds_active_tier
     ON discovery_funds(active, tier)`,
  `CREATE TABLE IF NOT EXISTS discovery_filings (
    id SERIAL PRIMARY KEY,
    fund_id INTEGER NOT NULL REFERENCES discovery_funds(id) ON DELETE CASCADE,
    accession VARCHAR(25) NOT NULL,
    period_of_report DATE NOT NULL,
    filing_date DATE NOT NULL,
    total_value_usd NUMERIC(20, 2),
    holdings_count INTEGER,
    source_url TEXT,
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (fund_id, accession)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_discovery_filings_fund_period
     ON discovery_filings(fund_id, period_of_report DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_discovery_filings_period
     ON discovery_filings(period_of_report DESC)`,
  `CREATE TABLE IF NOT EXISTS discovery_holdings (
    id SERIAL PRIMARY KEY,
    filing_id INTEGER NOT NULL REFERENCES discovery_filings(id) ON DELETE CASCADE,
    cusip VARCHAR(9) NOT NULL,
    ticker VARCHAR(10),
    issuer_name VARCHAR(200) NOT NULL,
    class_title VARCHAR(40),
    shares BIGINT NOT NULL,
    value_usd NUMERIC(20, 2) NOT NULL,
    weight_in_fund NUMERIC(7, 4) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_discovery_holdings_filing
     ON discovery_holdings(filing_id)`,
  `CREATE INDEX IF NOT EXISTS idx_discovery_holdings_ticker
     ON discovery_holdings(ticker)`,
  `CREATE INDEX IF NOT EXISTS idx_discovery_holdings_cusip
     ON discovery_holdings(cusip)`,
  `CREATE TABLE IF NOT EXISTS discovery_cusip_ticker (
    cusip VARCHAR(9) PRIMARY KEY,
    ticker VARCHAR(10),
    issuer_name VARCHAR(200),
    exchange_code VARCHAR(10),
    resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source VARCHAR(30) NOT NULL DEFAULT 'openfigi'
  )`,
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

console.log("\nDiscovery schema applied.");
