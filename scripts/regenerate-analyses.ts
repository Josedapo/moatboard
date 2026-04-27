// Regenerate cached moatboard_analyses for one or more tickers across all
// the user's positions (draft + live). Useful after a change to the
// scorecard pipeline (new MultiYearScore field, new dispatch rule, etc.)
// when you want existing positions to reflect the new logic without
// re-running the full wizard.
//
// Run:
//   npx tsx scripts/regenerate-analyses.ts AAPL GOOGL ...
//   npx tsx scripts/regenerate-analyses.ts --user 1 AAPL

import { config } from "dotenv";
config({ path: ".env.local" });

const args = process.argv.slice(2);
const userIdArgIndex = args.indexOf("--user");
const filterUserId =
  userIdArgIndex !== -1 ? Number(args[userIdArgIndex + 1]) : null;
const tickers = args
  .filter((a, i) => {
    if (a.startsWith("--")) return false;
    if (i > 0 && args[i - 1] === "--user") return false;
    return true;
  })
  .map((t) => t.toUpperCase());

if (tickers.length === 0) {
  console.error(
    "Usage: npx tsx scripts/regenerate-analyses.ts [--user N] TICKER [TICKER ...]",
  );
  process.exit(1);
}

async function main() {
  const { neon } = await import("@neondatabase/serverless");
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);

  const { runAnalysis } = await import("../src/lib/analysis");
  const { saveAnalysis } = await import("../src/lib/moatboardAnalyses");

  let total = 0;
  let ok = 0;
  let failed = 0;

  for (const ticker of tickers) {
    const positions = (
      filterUserId !== null
        ? await sql`
            SELECT id, user_id, ticker
            FROM positions
            WHERE user_id = ${filterUserId} AND ticker = ${ticker}
          `
        : await sql`
            SELECT id, user_id, ticker
            FROM positions
            WHERE ticker = ${ticker}
          `
    ) as { id: number; user_id: number; ticker: string }[];

    if (positions.length === 0) {
      console.log(`${ticker}: no positions found, skip.`);
      continue;
    }

    console.log(`${ticker}: ${positions.length} position(s) to refresh.`);
    let result;
    try {
      result = await runAnalysis(ticker);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ runAnalysis failed: ${msg}`);
      failed += positions.length;
      continue;
    }

    for (const p of positions) {
      total += 1;
      try {
        await saveAnalysis({
          positionId: p.id,
          tier: result.tier,
          verdictReason: result.verdict_reason,
          scorecardSummary: result.scorecard_summary,
          moatStrength: result.moat_strength,
          moatArchetype: result.moat_archetype,
        });
        console.log(
          `  ✓ user=${p.user_id} pos=${p.id} tier=${result.tier}`,
        );
        ok += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ✗ user=${p.user_id} pos=${p.id} → ${msg}`);
        failed += 1;
      }
    }
  }

  console.log(`\nDone. ${ok} OK, ${failed} failed, ${total} total.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
