// Regression script for the SEC EDGAR cutover. Two-phase: snapshot existing
// tiers + yearsAvailable, then clear the cached analyses + valuations so the
// next dashboard visit re-runs the full pipeline with SEC data. Compare
// `before.json` with the DB after the recompute to see tier shifts.
//
// Workflow:
//   1. Run: node scripts/recompute-all-analyses.mjs              (snapshot + clear)
//   2. Visit each position page in the app (`/dashboard/position/[id]`) to
//      trigger `ensureAnalysis` + `ensureValuation`.
//   3. Run: node scripts/recompute-all-analyses.mjs --diff        (compare)
//
// Not destructive beyond deleting per-position cached outputs: the raw
// fundamentals, positions themselves, and thesis notes are preserved.

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const DIFF = process.argv.includes("--diff");
const SNAPSHOT_PATH = "./.sec-regression-snapshot.json";

async function fetchCurrentState() {
  const rows = await sql`
    SELECT p.id AS position_id,
           p.ticker,
           a.tier,
           a.moat_strength,
           a.moat_archetype,
           a.scorecard_summary,
           sfc.years_available AS sec_years,
           sfc.status AS sec_status
      FROM positions p
      LEFT JOIN moatboard_analyses a ON a.position_id = p.id
      LEFT JOIN sec_fundamentals_cache sfc ON sfc.ticker = p.ticker
     ORDER BY p.ticker
  `;
  return rows;
}

function fmt(v) {
  return v === null || v === undefined ? "—" : String(v);
}

if (DIFF) {
  if (!existsSync(SNAPSHOT_PATH)) {
    console.error(`No snapshot found at ${SNAPSHOT_PATH}. Run without --diff first.`);
    process.exit(1);
  }
  const before = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf-8"));
  const after = await fetchCurrentState();
  const byTickerBefore = new Map(before.map((r) => [r.ticker, r]));

  console.log("Tier delta:\n");
  let shifts = 0;
  let stillMissing = 0;
  for (const row of after) {
    const prev = byTickerBefore.get(row.ticker);
    const prevTier = prev?.tier ?? null;
    const newTier = row.tier ?? null;
    const shifted = prevTier !== newTier;
    if (!newTier) stillMissing += 1;
    if (shifted) shifts += 1;

    const label = row.ticker.padEnd(6);
    const marker = shifted ? "Δ" : " ";
    console.log(
      `${marker} ${label} tier ${fmt(prevTier).padEnd(12)} → ${fmt(newTier).padEnd(12)}` +
        ` | sec_years ${fmt(prev?.sec_years).padStart(3)} → ${fmt(row.sec_years).padStart(3)}` +
        ` | status ${fmt(row.sec_status)}`,
    );
  }
  console.log(
    `\nSummary: ${shifts} tier shifts, ${stillMissing} positions still without tier (visit their page).`,
  );
  process.exit(0);
}

// -- Snapshot + clear phase --
const before = await fetchCurrentState();
console.log("Current state (before clear):\n");
for (const row of before) {
  console.log(
    `  ${row.ticker.padEnd(6)} tier=${fmt(row.tier).padEnd(12)} sec_years=${fmt(row.sec_years).padStart(3)} sec_status=${fmt(row.sec_status)}`,
  );
}

writeFileSync(SNAPSHOT_PATH, JSON.stringify(before, null, 2));
console.log(`\nSnapshot written to ${SNAPSHOT_PATH}.`);

const ids = before.map((r) => r.position_id);
if (ids.length === 0) {
  console.log("No positions — nothing to clear.");
  process.exit(0);
}

await sql`DELETE FROM moatboard_analyses WHERE position_id = ANY(${ids})`;
await sql`DELETE FROM valuations WHERE position_id = ANY(${ids})`;

console.log(
  `\nCleared ${ids.length} analyses + valuations. Visit each position page in the app to trigger recompute; then run this script with --diff.`,
);
