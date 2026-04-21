// One-time backfill for Discovery: iterate every active fund, ingest
// the latest 13F-HR filing. Idempotent — re-running only hits funds
// whose latest filing changed.
//
// Run: npx tsx scripts/backfill-discovery.ts

import { config } from "dotenv";
config({ path: ".env.local" });

const SEC_PACE_MS = 300; // well below SEC's 10 req/s
// How many most-recent 13F-HR filings to ingest per fund. 2 is the
// minimum for quarter-over-quarter deltas; bump later if we want
// longer trajectories.
const QUARTERS_PER_FUND = 2;

async function main() {
  // Dynamic import so dotenv loads before db.ts reads process.env.
  const { listActiveFunds, ingestRecentFilings } = await import(
    "../src/lib/discoveryFlow"
  );
  const funds = await listActiveFunds();
  console.log(
    `Backfilling ${funds.length} active funds × ${QUARTERS_PER_FUND} quarters.\n`,
  );

  const counts: Record<string, number> = {
    ok_new: 0,
    ok_cached: 0,
    no_filing: 0,
    error: 0,
  };
  const errors: string[] = [];

  for (const fund of funds) {
    const label = `[${fund.tier}] ${fund.display_name} (CIK ${fund.cik})`;
    try {
      const results = await ingestRecentFilings(fund.id, QUARTERS_PER_FUND);
      for (const result of results) {
        counts[result.status] = (counts[result.status] ?? 0) + 1;
        if (result.status === "ok_new") {
          console.log(
            `${label}: NEW — ${result.periodOfReport}, ${result.holdingsCount} holdings, $${(result.totalValueUsd / 1e9).toFixed(2)}B, ${result.unresolvedCusips} unresolved`,
          );
        } else if (result.status === "ok_cached") {
          console.log(`${label}: cached ${result.accession}`);
        } else if (result.status === "no_filing") {
          console.log(`${label}: no 13F-HR found`);
        } else {
          console.log(`${label}: ERROR — ${result.message}`);
          errors.push(`${fund.display_name}: ${result.message}`);
        }
      }
    } catch (err) {
      counts.error += 1;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`${label}: EXCEPTION — ${msg}`);
      errors.push(`${fund.display_name}: ${msg}`);
    }
    await new Promise((r) => setTimeout(r, SEC_PACE_MS));
  }

  console.log("\n--- Summary ---");
  console.log(`New filings ingested: ${counts.ok_new}`);
  console.log(`Already cached: ${counts.ok_cached}`);
  console.log(`No filing found: ${counts.no_filing}`);
  console.log(`Errors: ${counts.error}`);

  if (errors.length > 0) {
    console.log("\nErrors:");
    for (const e of errors) console.log(`  - ${e}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
