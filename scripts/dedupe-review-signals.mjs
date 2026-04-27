// Dedupe review_signals across share-class duplicates.
//
// SEC files at the CIK level — Alphabet's 10-Q produces one accession,
// not two. But the daily cron iterates active tickers (positions ∪
// watchlist) and inserts a row per (user, ticker, accession). Before
// canonicalization, a user with both GOOG and GOOGL in their active
// set would get two identical signals per filing.
//
// After ticker_states canonicalization (canonicalize-ticker-states.mjs)
// the active set collapses, and going forward the cron only writes one
// signal per filing. This script cleans up the historical duplicates.
//
// Logic:
//   For each (user_id, canonical_ticker, deduplication_key) group:
//     - If multiple rows exist, keep the most-recent and DELETE the rest.
//     - The "most recent" wins on (status='reviewed' first → reviewed_at
//       desc → created_at desc) so a reviewed signal isn't lost.
//     - Update the survivor's ticker to the canonical (so future writes
//       hit it under the canonical key).
//
// Dry-run by default. Pass --apply to commit.
//
//   node scripts/dedupe-review-signals.mjs           # dry-run
//   node scripts/dedupe-review-signals.mjs --apply   # commit

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const apply = process.argv.includes("--apply");

const aliasRows = await sql`SELECT ticker, canonical_ticker FROM ticker_aliases`;
if (aliasRows.length === 0) {
  console.log("No aliases configured. Nothing to dedupe.");
  process.exit(0);
}

const aliasMap = new Map();
for (const r of aliasRows) aliasMap.set(r.ticker, r.canonical_ticker);
const aliasTickers = [...aliasMap.keys()];

// Pull every signal whose ticker is an alias OR a canonical we care about.
const allTouchedTickers = new Set(aliasTickers);
for (const r of aliasRows) allTouchedTickers.add(r.canonical_ticker);

const rows = await sql`
  SELECT id, user_id, ticker, deduplication_key, status, reviewed_at, created_at
  FROM review_signals
  WHERE ticker = ANY(${[...allTouchedTickers]})
  ORDER BY user_id, deduplication_key, created_at
`;

if (rows.length === 0) {
  console.log("No relevant review_signals rows. Nothing to do.");
  process.exit(0);
}

// Group by (user_id, canonical_ticker, deduplication_key).
const groups = new Map();
for (const r of rows) {
  const canonical = aliasMap.get(r.ticker) ?? r.ticker;
  const key = `${r.user_id}|${canonical}|${r.deduplication_key}`;
  const list = groups.get(key) ?? [];
  list.push({ ...r, canonical });
  groups.set(key, list);
}

console.log(
  `${apply ? "APPLY" : "DRY-RUN"} — ${groups.size} group(s) of (user, canonical_ticker, dedup_key) to inspect.\n`,
);

const deletes = [];
const updates = [];

for (const [key, list] of groups) {
  if (list.length === 1) {
    const only = list[0];
    if (only.ticker !== only.canonical) {
      updates.push({ id: only.id, to: only.canonical });
      console.log(
        `  ${key}: 1 row, alias-keyed → UPDATE id=${only.id} ${only.ticker} → ${only.canonical}`,
      );
    }
    continue;
  }

  // Multiple rows — pick survivor.
  const survivor = [...list].sort((a, b) => {
    if (a.status === "reviewed" && b.status !== "reviewed") return -1;
    if (b.status === "reviewed" && a.status !== "reviewed") return 1;
    const aRev = a.reviewed_at ? new Date(a.reviewed_at).getTime() : 0;
    const bRev = b.reviewed_at ? new Date(b.reviewed_at).getTime() : 0;
    if (aRev !== bRev) return bRev - aRev;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  })[0];

  console.log(
    `  ${key}: ${list.length} duplicates → keep id=${survivor.id} (${survivor.ticker}, status=${survivor.status})`,
  );
  for (const r of list) {
    if (r.id === survivor.id) continue;
    deletes.push({ id: r.id, ticker: r.ticker, status: r.status });
    console.log(`    DELETE id=${r.id} (${r.ticker}, status=${r.status})`);
  }
  if (survivor.ticker !== survivor.canonical) {
    updates.push({ id: survivor.id, to: survivor.canonical });
    console.log(`    UPDATE id=${survivor.id} ${survivor.ticker} → ${survivor.canonical}`);
  }
}

console.log(`\nSummary: ${deletes.length} DELETE, ${updates.length} UPDATE.`);

if (!apply) {
  console.log("Dry-run only — nothing written. Re-run with --apply to commit.");
  process.exit(0);
}

// Delete first to free the unique-index slot before re-keying survivors.
for (const d of deletes) {
  await sql`DELETE FROM review_signals WHERE id = ${d.id}`;
}
for (const u of updates) {
  await sql`UPDATE review_signals SET ticker = ${u.to} WHERE id = ${u.id}`;
}
console.log("Done.");
