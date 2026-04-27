// SEC fundamentals cache warmup for the Discovery roster.
//
// Iterates every ticker held by ≥2 active funds in the Discovery
// leaderboard and ensures `sec_fundamentals_cache` has a row for it.
// This is the prerequisite for the pre-analysis gate (which needs
// years_available + latest_quarter_accession to filter candidates).
//
// Usage:
//   npx tsx scripts/warm-sec-cache.ts                # all tickers
//   npx tsx scripts/warm-sec-cache.ts --limit 50     # first N (smoke)
//   npx tsx scripts/warm-sec-cache.ts --skip-cached  # only uncached
//
// Throttle: serial with 250ms between fetches (SEC EDGAR allows
// 10 req/s with declared UA). Errors per ticker are isolated. The
// underlying ensureSecFundamentals already handles "no_cik" / "fetch
// _error" / "parse_error" gracefully and persists the status.

import { config } from "dotenv";
config({ path: ".env.local" });

const args = process.argv.slice(2);
const limitFlagIdx = args.indexOf("--limit");
const limit =
  limitFlagIdx >= 0 ? Number(args[limitFlagIdx + 1] ?? "0") : undefined;
const skipCached = args.includes("--skip-cached");
const dryRun = args.includes("--dry-run");

const SLEEP_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { sql } = await import("@/lib/db");
  const { warmSecCacheForTicker } = await import("@/lib/preAnalysisFlow");

  // Reuse the same fund_count ≥ 2 logic as listCandidateTickers but
  // without the SEC join — we want EVERY potential candidate, even
  // those not yet cached.
  const tickers = (await sql`
    WITH latest_filing_per_fund AS (
      SELECT DISTINCT ON (fund_id) id, fund_id
      FROM discovery_filings
      ORDER BY fund_id, period_of_report DESC
    )
    SELECT dh.ticker, COUNT(DISTINCT df.fund_id)::int AS fund_count
    FROM discovery_holdings dh
    JOIN latest_filing_per_fund lfpf ON lfpf.id = dh.filing_id
    JOIN discovery_filings df ON df.id = lfpf.id
    JOIN discovery_funds dfu ON dfu.id = df.fund_id
    WHERE dh.ticker IS NOT NULL AND dfu.active = TRUE
    GROUP BY dh.ticker
    HAVING COUNT(DISTINCT df.fund_id) >= 2
    ORDER BY dh.ticker
  `) as unknown as Array<{ ticker: string; fund_count: number }>;

  console.log(`Discovery candidates with ≥2 funds: ${tickers.length}`);

  let pool = tickers;
  if (skipCached) {
    const cached = (await sql`
      SELECT ticker FROM sec_fundamentals_cache
    `) as unknown as Array<{ ticker: string }>;
    const cachedSet = new Set(cached.map((r) => r.ticker.toUpperCase()));
    pool = pool.filter((t) => !cachedSet.has(t.ticker.toUpperCase()));
    console.log(`After --skip-cached filter: ${pool.length}`);
  }
  if (limit) {
    pool = pool.slice(0, limit);
    console.log(`After --limit ${limit}: ${pool.length}`);
  }

  if (dryRun) {
    console.log("\n--dry-run: would warm these tickers:");
    pool.forEach((t) => console.log(`  ${t.ticker} (${t.fund_count} funds)`));
    return;
  }

  console.log(
    `\nWarming SEC cache for ${pool.length} tickers (serial, ${SLEEP_MS}ms throttle)...\n`,
  );

  const stats = {
    ok: 0,
    no_cik: 0,
    fetch_error: 0,
    parse_error: 0,
    error: 0,
    total_years_distribution: {} as Record<string, number>,
  };
  const startedAt = Date.now();

  for (let i = 0; i < pool.length; i++) {
    const t = pool[i];
    process.stdout.write(`[${i + 1}/${pool.length}] ${t.ticker.padEnd(8)} `);

    const r = await warmSecCacheForTicker(t.ticker);

    if (r.errored) {
      stats.error++;
      console.log(`error: ${r.errorMessage?.slice(0, 80)}`);
    } else {
      switch (r.status) {
        case "ok":
          stats.ok++;
          break;
        case "no_cik":
          stats.no_cik++;
          break;
        case "fetch_error":
          stats.fetch_error++;
          break;
        case "parse_error":
          stats.parse_error++;
          break;
      }
      const yearsBucket =
        r.yearsAvailable === null
          ? "null"
          : r.yearsAvailable >= 10
            ? "≥10y"
            : r.yearsAvailable >= 5
              ? "5-9y"
              : "<5y";
      stats.total_years_distribution[yearsBucket] =
        (stats.total_years_distribution[yearsBucket] ?? 0) + 1;
      console.log(
        `${r.status.padEnd(13)} years=${r.yearsAvailable ?? "n/a"}`,
      );
    }

    if (i < pool.length - 1) await sleep(SLEEP_MS);
  }

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\n=== Done in ${elapsedSec}s ===`);
  console.log(`  ok:           ${stats.ok}`);
  console.log(`  no_cik:       ${stats.no_cik} (foreign filers, ADRs, OTC)`);
  console.log(`  fetch_error:  ${stats.fetch_error}`);
  console.log(`  parse_error:  ${stats.parse_error}`);
  console.log(`  error:        ${stats.error}`);
  console.log(`  Years available distribution:`);
  for (const [bucket, count] of Object.entries(stats.total_years_distribution)) {
    console.log(`    ${bucket}: ${count}`);
  }

  // Final candidate count after warmup.
  const final = (await sql`
    SELECT COUNT(*) AS n FROM sec_fundamentals_cache
    WHERE status = 'ok' AND years_available >= 5
  `) as unknown as Array<{ n: number }>;
  console.log(`\n  Total tickers passing covered gate (status=ok, years≥5): ${final[0].n}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
