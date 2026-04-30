// Scan a list of foreign-filer-suspect tickers + DB content for currency mismatches
import YahooFinance from 'yahoo-finance2';
const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// Foreign filers / ADRs that report in non-USD: a defensible sample
const SUSPECTS = [
  'TSM',  // Taiwan, TWD
  'ASML', // Netherlands, EUR
  'NVO',  // Denmark, DKK
  'BABA', // China, CNY
  'TM',   // Japan, JPY
  'SAP',  // Germany, EUR
  'NVS',  // Switzerland, CHF
  'AZN',  // UK, USD (multi-listed)
  'BN',   // Canada, USD (Brookfield)
  'SHOP', // Canada, USD
  'UL',   // UK, EUR
  'RIO',  // UK/Australia, USD
  'BHP',  // Australia, USD
  'DEO',  // UK, GBP
];

console.log('Ticker | priceCcy | finCcy | mismatch? | FCF Yield (Moatboard) | FCF (raw)');
console.log('-'.repeat(95));

for (const ticker of SUSPECTS) {
  try {
    const r = await yf.quoteSummary(ticker, {
      modules: ['price', 'financialData'],
    });
    const priceCcy = r.price?.currency ?? '?';
    const finCcy = r.financialData?.financialCurrency ?? '?';
    const mismatch = priceCcy !== finCcy ? 'YES ⚠️' : 'no';
    const fcf = r.financialData?.freeCashflow ?? 0;
    const mcap = r.price?.marketCap ?? 0;
    const yield_ = mcap > 0 ? (fcf / mcap * 100).toFixed(2) + '%' : 'N/A';
    const fcfFmt = fcf ? (fcf / 1e9).toFixed(1) + 'B' : 'null';
    console.log(
      `${ticker.padEnd(6)}| ${priceCcy.padEnd(8)} | ${finCcy.padEnd(6)} | ${mismatch.padEnd(9)} | ${yield_.padEnd(20)} | ${fcfFmt}`,
    );
  } catch (err) {
    console.log(`${ticker.padEnd(6)}| ERROR: ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 200));
}
