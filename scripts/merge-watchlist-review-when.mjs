// Merge ticker_states.review_when into reason_md for watchlist entries.
//
// The wizard used to collect two separate fields (reason + when to revisit).
// They now live as a single free-form text in reason_md. This script
// concatenates legacy rows so the single-field UI shows the full context.
//
// After merging, review_when is set to NULL for those rows.
//
// Dry-run by default: prints the before/after diff, writes nothing.
// Pass --apply to actually update the rows.
//
// Run:
//   node scripts/merge-watchlist-review-when.mjs           # dry-run
//   node scripts/merge-watchlist-review-when.mjs --apply   # commit

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const apply = process.argv.includes("--apply");

const candidates = await sql`
  SELECT id, user_id, ticker, status, reason_md, review_when
  FROM ticker_states
  WHERE status = 'watchlist'
    AND review_when IS NOT NULL
    AND LENGTH(TRIM(review_when)) > 0
  ORDER BY id
`;

if (candidates.length === 0) {
  console.log("Nothing to merge — no watchlist rows with a review_when.");
  process.exit(0);
}

console.log(
  `${apply ? "APPLY" : "DRY-RUN"} — ${candidates.length} watchlist row(s) to merge:\n`,
);
for (const row of candidates) {
  const existing = (row.reason_md ?? "").trim();
  const when = row.review_when.trim();
  const merged = existing
    ? `${existing}\n\nRevisar cuando: ${when}`
    : `Revisar cuando: ${when}`;

  console.log(`— [${row.ticker}] id=${row.id}`);
  console.log("  BEFORE reason_md  :", JSON.stringify(existing));
  console.log("  BEFORE review_when:", JSON.stringify(when));
  console.log("  AFTER  reason_md  :", JSON.stringify(merged));
  console.log("");

  if (apply) {
    await sql`
      UPDATE ticker_states
      SET reason_md = ${merged},
          review_when = NULL
      WHERE id = ${row.id}
    `;
  }
}

console.log(
  apply
    ? `Done. Merged ${candidates.length} row(s).`
    : `Dry-run only — nothing written. Re-run with --apply to commit.`,
);
