// One-shot additive migration: create insider_transactions. Per-ticker,
// shared across users (Form 4 is public SEC data). Idempotent (IF NOT
// EXISTS). Safe to re-run.
//
// Run once: node scripts/add-insider-transactions-table.mjs

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

console.log("Creating insider_transactions (if missing)...");

await sql.query(`
  CREATE TABLE IF NOT EXISTS insider_transactions (
    id BIGSERIAL PRIMARY KEY,
    ticker VARCHAR(10) NOT NULL,
    issuer_cik VARCHAR(10) NOT NULL,
    accession VARCHAR(25) NOT NULL,
    filing_date DATE NOT NULL,
    transaction_date DATE NOT NULL,
    transaction_index INT NOT NULL,
    reporting_owner_cik VARCHAR(10) NOT NULL,
    reporting_owner_name VARCHAR(200) NOT NULL,
    reporting_owner_title VARCHAR(200),
    is_officer BOOLEAN NOT NULL DEFAULT FALSE,
    is_director BOOLEAN NOT NULL DEFAULT FALSE,
    is_ten_percent_owner BOOLEAN NOT NULL DEFAULT FALSE,
    transaction_code CHAR(1) NOT NULL,
    acquired_disposed CHAR(1) NOT NULL,
    shares NUMERIC(20,4) NOT NULL,
    price_per_share NUMERIC(14,4) NOT NULL,
    transaction_value_usd NUMERIC(18,2) GENERATED ALWAYS AS (shares * price_per_share) STORED,
    rule10b5_1_flag BOOLEAN,
    direct_or_indirect CHAR(1) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (accession, transaction_index)
  )
`);

await sql.query(
  `CREATE INDEX IF NOT EXISTS idx_insider_tx_ticker_date ON insider_transactions(ticker, transaction_date DESC)`,
);
await sql.query(
  `CREATE INDEX IF NOT EXISTS idx_insider_tx_code ON insider_transactions(ticker, transaction_code, transaction_date DESC)`,
);

console.log("Done.");
