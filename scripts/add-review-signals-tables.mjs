// One-shot additive migration: create review_signals + cron_runs
// without touching any existing table. Safe to re-run (IF NOT EXISTS).
//
// Run once: node scripts/add-review-signals-tables.mjs

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

console.log("Creating review_signals (if missing)...");
await sql.query(`
  CREATE TABLE IF NOT EXISTS review_signals (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticker VARCHAR(10) NOT NULL,
    source VARCHAR(20) NOT NULL CHECK (source IN (
      'sec_8k', 'sec_10q', 'sec_10k', 'sec_10qa', 'sec_10ka'
    )),
    event_type VARCHAR(40) NOT NULL,
    event_date TIMESTAMPTZ NOT NULL,
    source_ref VARCHAR(50) NOT NULL,
    source_url TEXT,
    severity VARCHAR(20) NOT NULL CHECK (severity IN (
      'floor', 'material', 'informational'
    )),
    status VARCHAR(15) NOT NULL DEFAULT 'new' CHECK (status IN (
      'new', 'reviewed', 'dismissed', 'expired'
    )),
    reviewed_at TIMESTAMPTZ,
    reviewed_by_snapshot_id INTEGER REFERENCES fundamentals_snapshots(id) ON DELETE SET NULL,
    review_note_md TEXT,
    dismiss_reason_md TEXT,
    raw_payload JSONB,
    summary_md TEXT,
    deduplication_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

await sql.query(
  `CREATE UNIQUE INDEX IF NOT EXISTS review_signals_dedup_idx ON review_signals(user_id, ticker, deduplication_key)`,
);
await sql.query(
  `CREATE INDEX IF NOT EXISTS review_signals_status_idx ON review_signals(user_id, status, event_date DESC)`,
);
await sql.query(
  `CREATE INDEX IF NOT EXISTS review_signals_ticker_idx ON review_signals(ticker, event_date DESC)`,
);

console.log("Creating cron_runs (if missing)...");
await sql.query(`
  CREATE TABLE IF NOT EXISTS cron_runs (
    id SERIAL PRIMARY KEY,
    job VARCHAR(50) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    ok BOOLEAN NOT NULL DEFAULT FALSE,
    processed_tickers INTEGER,
    inserted_signals INTEGER,
    error_count INTEGER,
    error_summary TEXT
  )
`);
await sql.query(
  `CREATE INDEX IF NOT EXISTS cron_runs_job_idx ON cron_runs(job, started_at DESC)`,
);

console.log("Done.");
