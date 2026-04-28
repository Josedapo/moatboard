// DESTRUCTIVE one-shot: wipe Joseda's personal data + per-ticker AI caches
// to start real-use from a clean slate (2026-04-23 decision).
//
// What this DELETES:
//   Personal data:
//     positions, position_transactions, fundamentals_snapshots,
//     watchlist_entries, analysis_sessions, moatboard_analyses, valuations,
//     theses, moat_validations, review_signals
//   Per-ticker AI caches (regenerate on first analysis):
//     business_understanding, qualitative_red_flags,
//     moat_assessments, valuation_guides
//
// What this PRESERVES:
//   NextAuth: users, accounts, sessions, verification_token
//   External data caches (expensive to rebuild):
//     sec_ticker_cik, sec_fundamentals_cache
//   Discovery infrastructure (31 curated funds + their 13Fs):
//     discovery_funds, discovery_filings, discovery_holdings,
//     discovery_cusip_ticker, discovery_filing_dismissals
//   Insider transactions, cron runs heartbeat log
//
// Order matters: tables with FKs to other wipe-list tables must be
// TRUNCATE-able in one go — CASCADE handles it.
//
// Run: node scripts/wipe-user-data.mjs --confirm
// Without --confirm the script refuses to act.

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

if (!process.argv.includes("--confirm")) {
  console.error(
    "Refusing to run without --confirm. This is a destructive operation.",
  );
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// TRUNCATE ... CASCADE cascades to dependent tables automatically. We still
// list them explicitly so the intent is visible.
const tables = [
  // Personal data (children first — CASCADE handles it but be explicit)
  "review_signals",
  "moat_validations",
  "fundamentals_snapshots",
  "theses",
  "valuations",
  "moatboard_analyses",
  "analysis_sessions",
  "watchlist_entries",
  "position_transactions",
  "positions",
  // Per-ticker AI caches
  "business_understanding",
  "qualitative_red_flags",
  "moat_assessments",
  "valuation_guides",
];

console.log("Tables about to be truncated:");
for (const t of tables) console.log("  -", t);
console.log();

for (const t of tables) {
  try {
    await sql.query(`TRUNCATE TABLE ${t} RESTART IDENTITY CASCADE`);
    console.log(`✓ truncated ${t}`);
  } catch (err) {
    console.error(`✗ failed on ${t}:`, err.message);
    process.exit(1);
  }
}

// Sanity check — none of the preserved tables should be empty
const checks = [
  ["users", "your NextAuth row"],
  ["discovery_funds", "31 curated funds"],
  ["discovery_holdings", "fund holdings"],
  ["sec_fundamentals_cache", "SEC XBRL cache"],
];

console.log();
console.log("Preservation check:");
for (const [tbl, label] of checks) {
  const rows = (await sql.query(`SELECT COUNT(*)::INTEGER AS c FROM ${tbl}`));
  const c = rows[0]?.c ?? 0;
  const ok = c > 0 ? "✓" : "✗";
  console.log(`  ${ok} ${tbl}: ${c} rows (${label})`);
}

console.log();
console.log("Wipe complete. The observatory is empty — ready for real use.");
