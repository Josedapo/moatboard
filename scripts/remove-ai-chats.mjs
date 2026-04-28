// One-shot cleanup migration: remove the in-product AI chat surfaces.
//
// Two operations:
//   1. Strip `user_followup` Q&As from business_understanding.questions_and_answers
//      JSONB. Pregenerated entries (the 5-7 typical questions written next to
//      the summary) stay untouched.
//   2. Drop the `valuation_chats` table (and its index) — the position-page
//      valuation chat was wired but never user-facing, this just clears the
//      DB residue.
//
// Run once: node scripts/remove-ai-chats.mjs

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

console.log("1/2 — Stripping user_followup Q&As from business_understanding…");

const stripResult = await sql.query(`
  UPDATE business_understanding
  SET questions_and_answers = COALESCE(
    (
      SELECT jsonb_agg(qa)
      FROM jsonb_array_elements(questions_and_answers) AS qa
      WHERE qa->>'type' IS DISTINCT FROM 'user_followup'
    ),
    '[]'::jsonb
  )
  WHERE EXISTS (
    SELECT 1
    FROM jsonb_array_elements(questions_and_answers) AS qa
    WHERE qa->>'type' = 'user_followup'
  )
  RETURNING ticker, version
`);

console.log(`   updated ${stripResult.length} business_understanding rows`);
for (const row of stripResult) {
  console.log(`     · ${row.ticker} v${row.version}`);
}

console.log("2/2 — Dropping valuation_chats table…");

await sql.query("DROP TABLE IF EXISTS valuation_chats CASCADE");

console.log("Done.");
