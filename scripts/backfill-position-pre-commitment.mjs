// Backfill positions.pre_commitment_md from the first transaction's
// pre_commitment_md for legacy positions created before the split.
//
// Before the split, the wizard wrote one combined "pre-commitment" text
// directly into position_transactions.pre_commitment_md (per-tx). After the
// split, position-level commitments live on positions.pre_commitment_md and
// the per-tx column means "operation note". For positions created before
// the migration, the user's intended commitment is sitting on the first buy
// row, leaving the position-level field NULL.
//
// This script moves it into the right place and clears the first-buy note
// so it doesn't show up duplicated.
//
// Run: node scripts/backfill-position-pre-commitment.mjs

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// Preview — show which positions would be affected before touching anything.
const candidates = await sql`
  WITH first_tx AS (
    SELECT DISTINCT ON (position_id)
      position_id, id AS tx_id, pre_commitment_md
    FROM position_transactions
    ORDER BY position_id, transaction_date ASC, id ASC
  )
  SELECT p.id AS position_id, p.ticker, p.user_id, ft.tx_id,
         ft.pre_commitment_md AS text
  FROM positions p
  JOIN first_tx ft ON ft.position_id = p.id
  WHERE p.pre_commitment_md IS NULL
    AND ft.pre_commitment_md IS NOT NULL
    AND length(trim(ft.pre_commitment_md)) > 0
`;

if (candidates.length === 0) {
  console.log("No legacy positions to backfill. Nothing to do.");
  process.exit(0);
}

console.log(`Found ${candidates.length} legacy position(s) to backfill:`);
for (const row of candidates) {
  const preview = row.text.replace(/\s+/g, " ").slice(0, 80);
  console.log(`  · ${row.ticker} (position ${row.position_id}): "${preview}${row.text.length > 80 ? "…" : ""}"`);
}

console.log("\nApplying backfill…");

// Single transaction so the two updates can't desync.
await sql.transaction([
  sql`
    WITH first_tx AS (
      SELECT DISTINCT ON (position_id)
        position_id, id AS tx_id, pre_commitment_md
      FROM position_transactions
      ORDER BY position_id, transaction_date ASC, id ASC
    )
    UPDATE positions p
    SET pre_commitment_md = ft.pre_commitment_md,
        pre_commitment_edited_at = NOW()
    FROM first_tx ft
    WHERE ft.position_id = p.id
      AND p.pre_commitment_md IS NULL
      AND ft.pre_commitment_md IS NOT NULL
      AND length(trim(ft.pre_commitment_md)) > 0
  `,
  sql`
    WITH first_tx AS (
      SELECT DISTINCT ON (position_id)
        position_id, id AS tx_id, pre_commitment_md
      FROM position_transactions
      ORDER BY position_id, transaction_date ASC, id ASC
    )
    UPDATE position_transactions t
    SET pre_commitment_md = NULL
    FROM first_tx ft, positions p
    WHERE t.id = ft.tx_id
      AND p.id = ft.position_id
      AND p.pre_commitment_md IS NOT NULL
      AND ft.pre_commitment_md IS NOT NULL
  `,
]);

console.log(`Backfilled ${candidates.length} position(s). Done.`);
