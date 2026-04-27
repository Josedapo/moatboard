// Regenerate the cached valuation for one or more tickers across all
// the user's positions (draft + live). Useful after a change to the
// valuation pipeline (window cap, new dispatch rule, prompt update)
// when you want existing positions to reflect the new logic without
// re-running the full wizard.
//
// Per ticker:
//   1. Find every position (user_id, ticker) — both drafts (the
//      watchlist/discarded anchor) and live (transactional). Iterates
//      across all users so a multi-user dogfood deploy refreshes
//      everyone in one run.
//   2. Fetch quote + fundamentals from yfinance once per ticker (the
//      canonicalization in sec.ts means SEC fundamentals are looked
//      up under the canonical key automatically).
//   3. Call computeAndSaveValuation per position. Sector-aware
//      dispatch (banks → Excess Returns, REITs → AFFO, rest → DCF)
//      lives in positionFlow, so this script doesn't need to know.
//
// Side effects on the per-position `valuations` row: method,
// intrinsic_value range, current_price, hurdle rates, relative_valuation
// snapshot. The shared `valuation_guides` cache (per canonical ticker)
// is also refreshed if stale.
//
// Run:
//   npx tsx scripts/regenerate-valuations.ts GOOGL BRK-A AAPL
//   npx tsx scripts/regenerate-valuations.ts --user 1 GOOGL

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
    "Usage: npx tsx scripts/regenerate-valuations.ts [--user N] TICKER [TICKER ...]",
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

  // Dynamic imports so dotenv loads first (yfinance + sec.ts both read
  // env at module init).
  const { fetchQuoteAndFundamentals } = await import("../src/lib/financial");
  const { computeAndSaveValuation } = await import("../src/lib/positionFlow");

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
    const { quote, fundamentals } = await fetchQuoteAndFundamentals(ticker);
    if (!quote || quote.regularMarketPrice == null) {
      console.log(`  ✗ no current market price — skip ticker.`);
      failed += positions.length;
      continue;
    }

    for (const p of positions) {
      total += 1;
      try {
        const v = await computeAndSaveValuation(p.id, ticker, quote, fundamentals);
        if (v) {
          const iv =
            v.intrinsic_value !== null && v.intrinsic_value !== undefined
              ? Number(v.intrinsic_value).toFixed(2)
              : "—";
          console.log(
            `  ✓ user=${p.user_id} pos=${p.id} method=${v.method} IV=${iv} px=${quote.regularMarketPrice}`,
          );
          ok += 1;
        } else {
          console.log(`  · user=${p.user_id} pos=${p.id} → null (not computable)`);
        }
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
