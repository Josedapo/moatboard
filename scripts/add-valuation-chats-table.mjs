// One-shot additive migration: create valuation_chats. Stores the
// turn-by-turn conversation Joseda has with Moatboard about a
// ticker's valuation. Durable per (user_id, ticker) so it survives
// regeneration of the underlying valuations row — each turn carries
// its own snapshot of the valuation context at the moment, used by
// the UI to render version dividers when the math has changed.
//
// Run once: node scripts/add-valuation-chats-table.mjs

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

console.log("Creating valuation_chats (if missing)...");

await sql.query(`
  CREATE TABLE IF NOT EXISTS valuation_chats (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticker VARCHAR(10) NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    asked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    answered_with_model VARCHAR(50) NOT NULL,
    -- JSONB snapshot of the valuation context at the moment of asking
    -- (iv_base, method, current_price, mos_pct, iv_low, iv_high). Used
    -- by the UI to render "Sobre la valoración del X (IV $Y · method Z)"
    -- version dividers when the math has been regenerated since.
    snapshot JSONB NOT NULL
  )
`);

await sql.query(
  `CREATE INDEX IF NOT EXISTS idx_valuation_chats_user_ticker
     ON valuation_chats(user_id, ticker, asked_at)`,
);

console.log("Done.");
