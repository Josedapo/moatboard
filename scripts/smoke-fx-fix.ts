// Smoke test the FX conversion fix end-to-end via the actual functions.
// Runs fetchQuoteAndFundamentals + fetchMultiYearFundamentals against a
// mix of foreign filers (TSM/TM/ASML/BABA) and pure-USD reporters
// (AAPL/MSFT/V) to confirm:
//   - foreign filers' FCF Yield collapses to realistic levels
//   - USD reporters are untouched (regression guard)
//
// Run from moatboard-app/: npx tsx scripts/smoke-fx-fix.ts

import {
  fetchQuoteAndFundamentals,
  fetchMultiYearFundamentals,
} from "../src/lib/financial";

const TICKERS = [
  "TSM",  // TWD — was 35.29% phantom
  "TM",   // JPY — was -22.95% phantom
  "ASML", // EUR — was 1.49% (slightly off)
  "BABA", // CNY — was -8.03% phantom
  "NVO",  // DKK — was 0.20% phantom (under-reported)
  // Sanity: pure USD reporters should be unchanged
  "AAPL",
  "MSFT",
  "V",
];

async function main() {
console.log(
  "Ticker | FCF (USD)        | MarketCap (USD)  | FCF Yield | MultiY FCF latest (USD) | MultiY revenue latest (USD)",
);
console.log("-".repeat(140));

for (const ticker of TICKERS) {
  try {
    const [qaf, multi] = await Promise.all([
      fetchQuoteAndFundamentals(ticker),
      fetchMultiYearFundamentals(ticker),
    ]);
    const fcf = qaf.fundamentals?.freeCashflow ?? null;
    const mcap = qaf.quote?.marketCap ?? null;
    const yield_ =
      fcf !== null && mcap !== null && mcap > 0
        ? ((fcf / mcap) * 100).toFixed(2) + "%"
        : "N/A";
    const fmt = (v: number | null) =>
      v !== null ? (v / 1e9).toFixed(1) + "B" : "null";
    const latestYr = multi?.years[multi.years.length - 1] ?? null;
    console.log(
      `${ticker.padEnd(6)}| ${fmt(fcf).padEnd(17)}| ${fmt(mcap).padEnd(17)}| ${yield_.padEnd(10)}| ${fmt(latestYr?.freeCashFlow ?? null).padEnd(24)}| ${fmt(latestYr?.revenue ?? null)}`,
    );
  } catch (err) {
    console.log(`${ticker.padEnd(6)}| ERROR: ${(err as Error).message}`);
  }
  await new Promise((r) => setTimeout(r, 300));
}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
