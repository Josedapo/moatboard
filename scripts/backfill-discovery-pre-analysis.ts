// Backfill Discovery pre-analysis for tickers that pass the covered
// gate. Driver around runDiscoveryPreAnalysisJob — same pipeline the
// weekly cron runs, but invokable manually for the initial population
// or for chunked runs (e.g. --limit 20 to validate before unleashing).
//
// Usage:
//   npx tsx scripts/backfill-discovery-pre-analysis.ts                 # all candidates
//   npx tsx scripts/backfill-discovery-pre-analysis.ts --limit 10      # first 10 work items
//   npx tsx scripts/backfill-discovery-pre-analysis.ts --dry-run       # list work items without running
//
// Per ticker: runs Quality + Moat (which downloads the 10-K via
// prepareMoatFiling) + Red flags (Item 1A or fallback). 3 model calls
// per ticker on a fresh run; cached moat / cached fundamentals reduce
// that. With dual-mode local (Opus Max) → zero API spend.

import { config } from "dotenv";
config({ path: ".env.local" });

const args = process.argv.slice(2);
const limitFlagIdx = args.indexOf("--limit");
const limit =
  limitFlagIdx >= 0 ? Number(args[limitFlagIdx + 1] ?? "0") : undefined;
const dryRun = args.includes("--dry-run");

async function main() {
  const { listWorkItems } = await import("@/lib/discoveryPreAnalysis");
  const { runDiscoveryPreAnalysisJob } = await import("@/lib/preAnalysisFlow");

  const work = await listWorkItems();
  console.log(`Work items pending: ${work.length}`);

  let scope = work;
  if (limit) {
    scope = scope.slice(0, limit);
    console.log(`After --limit ${limit}: ${scope.length}`);
  }

  if (dryRun) {
    console.log("\n--dry-run: would process these tickers:");
    scope.forEach((w) =>
      console.log(
        `  ${w.ticker.padEnd(8)} reason=${w.reason}  funds=${w.fund_count}  years=${w.years_available}`,
      ),
    );
    return;
  }

  const startedAt = Date.now();
  console.log(
    `\nRunning pre-analysis job (serial, ~30-90s per ticker depending on cache)...\n`,
  );

  const result = await runDiscoveryPreAnalysisJob({ maxItems: limit });

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\n=== Done in ${elapsedSec}s (cron_runs id=${result.cronRunId}) ===`);
  console.log(`  total processed: ${result.total}`);
  console.log(`  covered:         ${result.covered}`);
  console.log(`  not_covered:     ${result.not_covered}`);
  console.log(`  errored:         ${result.errored}`);

  if (result.covered > 0) {
    const tierBreakdown: Record<string, number> = {};
    const flagBreakdown = { serious: 0, watch: 0 };
    for (const item of result.items) {
      if (item.outcome !== "covered") continue;
      const tier = item.tier ?? "?";
      tierBreakdown[tier] = (tierBreakdown[tier] ?? 0) + 1;
      flagBreakdown.serious += item.seriousFlags ?? 0;
      flagBreakdown.watch += item.watchFlags ?? 0;
    }
    console.log(`\n  Tier breakdown:`);
    for (const [tier, n] of Object.entries(tierBreakdown)) {
      console.log(`    ${tier}: ${n}`);
    }
    console.log(`\n  Red flags totals:`);
    console.log(`    serious: ${flagBreakdown.serious}`);
    console.log(`    watch:   ${flagBreakdown.watch}`);
  }

  if (result.errored > 0) {
    console.log(`\n  Errors:`);
    for (const item of result.items) {
      if (item.outcome === "error") {
        console.log(`    ${item.ticker}: ${item.errorMessage?.slice(0, 100)}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
