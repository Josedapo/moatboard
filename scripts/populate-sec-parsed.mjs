// Run the SEC XBRL parser over every cached raw_facts payload and persist
// parsed_annual + parse_notes. Session 2 of the SEC EDGAR integration.
//
// Prereq: raw_facts must already be populated (see populate-sec-raw.mjs).
//
// The parser is TS. Node 23's native type stripping (on by default from
// 23.6+) lets us import the .ts file directly; type-only imports inside
// the parser are erased so the @/ path alias never needs to resolve.
//
// Usage:
//   node scripts/populate-sec-parsed.mjs
//   node scripts/populate-sec-parsed.mjs --force   # re-parse even if fresh

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";
import { parseFundamentals } from "../src/lib/secParser.ts";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
const FORCE = process.argv.includes("--force");

const rows = await sql`
  SELECT c.ticker, c.cik, c.status, c.raw_facts, c.parsed_annual, c.years_available
    FROM sec_fundamentals_cache c
   WHERE c.status = 'ok' AND c.raw_facts IS NOT NULL
     AND c.ticker IN (SELECT DISTINCT ticker FROM positions)
   ORDER BY c.ticker
`;

if (rows.length === 0) {
  console.log("No raw_facts rows to parse. Run populate-sec-raw.mjs first.");
  process.exit(0);
}

console.log(`Parsing ${rows.length} tickers...\n`);

const counts = { ok: 0, skipped: 0, parse_error: 0 };

for (const row of rows) {
  const label = row.ticker.padEnd(6);

  if (!FORCE && row.parsed_annual && row.years_available !== null) {
    counts.skipped++;
    console.log(`  ${label} skip (already parsed, years=${row.years_available})`);
    continue;
  }

  try {
    const parsed = parseFundamentals(row.raw_facts);

    if (parsed.yearsAvailable < 3) {
      await sql`
        UPDATE sec_fundamentals_cache
           SET status = 'parse_error',
               parsed_annual = NULL,
               parse_notes = ${JSON.stringify(parsed.parseNotes)},
               years_available = ${parsed.yearsAvailable},
               earliest_year = ${parsed.earliestYear},
               latest_year = ${parsed.latestYear}
         WHERE ticker = ${row.ticker}
      `;
      counts.parse_error++;
      console.log(
        `  ${label} parse_error (only ${parsed.yearsAvailable} usable years)`,
      );
      continue;
    }

    await sql`
      UPDATE sec_fundamentals_cache
         SET parsed_annual = ${JSON.stringify(parsed.years)},
             parse_notes = ${JSON.stringify(parsed.parseNotes)},
             years_available = ${parsed.yearsAvailable},
             earliest_year = ${parsed.earliestYear},
             latest_year = ${parsed.latestYear}
       WHERE ticker = ${row.ticker}
    `;
    counts.ok++;

    const revTrace = parsed.parseNotes.fields.revenue;
    const niTrace = parsed.parseNotes.fields.netIncome;
    const flags = [];
    if (revTrace?.fallbackTriggered)
      flags.push(`rev→${revTrace.tagsUsed.join(",")}`);
    if (niTrace?.fallbackTriggered)
      flags.push(`ni→${niTrace.tagsUsed.join(",")}`);
    console.log(
      `  ${label} ok  ${parsed.earliestYear}–${parsed.latestYear} (${parsed.yearsAvailable} usable)${
        flags.length > 0 ? " | " + flags.join(" ") : ""
      }`,
    );
  } catch (err) {
    await sql`
      UPDATE sec_fundamentals_cache
         SET status = 'parse_error',
             parsed_annual = NULL,
             parse_notes = ${JSON.stringify({ error: err.message })},
             years_available = NULL
       WHERE ticker = ${row.ticker}
    `;
    counts.parse_error++;
    console.log(`  ${label} parse_error (${err.message})`);
  }
}

console.log(
  `\nDone. ok=${counts.ok}, skipped=${counts.skipped}, parse_error=${counts.parse_error}`,
);
