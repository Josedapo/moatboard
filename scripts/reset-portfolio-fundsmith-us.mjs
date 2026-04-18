// Reset the dogfooding portfolio to Fundsmith's US-listed holdings as of
// March 2026 factsheet (top 10) + 2025 annual letter additions. Used as a
// validation corpus: these are quality businesses Terry Smith's team owns,
// so Moatboard's framework should classify most of them as Good or
// Exceptional. Outliers (Poor / can't analyze) are real signals — either
// an issue with the framework or a Smith-specific view the framework
// doesn't capture.
//
// Safe to re-run: deletes the user's existing positions (cascades analyses,
// valuations, theses) before re-inserting.

import { neon } from "@neondatabase/serverless";
import YahooFinance from "yahoo-finance2";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const USER_EMAIL = "jodapogo@gmail.com";

// US-listed Fundsmith holdings confirmed as of March 2026 factsheet +
// 2025 annual letter. Order loosely reflects visibility (top 10 first,
// then additions).
const TICKERS = [
  // Top 10 (March 2026 factsheet, US-listed only)
  "MAR",   // Marriott
  "SYK",   // Stryker
  "WAT",   // Waters
  "V",     // Visa
  "PM",    // Philip Morris
  "IDXX",  // IDEXX
  "GOOGL", // Alphabet
  // 2025 annual letter additions
  "ZTS",   // Zoetis
  "INTU",  // Intuit
  "FTNT",  // Fortinet
  // Confirmed holding via March 2026 detractor list
  "META",  // Meta Platforms
];

const sql = neon(process.env.DATABASE_URL);
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const users =
  await sql`SELECT id FROM users WHERE email = ${USER_EMAIL} LIMIT 1`;
if (users.length === 0) {
  console.error(`User with email ${USER_EMAIL} not found.`);
  process.exit(1);
}
const userId = users[0].id;
console.log(`User ${USER_EMAIL} → id ${userId}\n`);

// Count existing positions before deletion so we know what we're removing.
const before = await sql`
  SELECT ticker FROM positions WHERE user_id = ${userId} ORDER BY id
`;
console.log(
  `Removing ${before.length} existing positions: ${before.map((r) => r.ticker).join(", ") || "(none)"}\n`,
);

await sql`DELETE FROM positions WHERE user_id = ${userId}`;

const today = new Date().toISOString().slice(0, 10);

console.log(`Inserting ${TICKERS.length} Fundsmith US holdings at current prices:`);
for (const ticker of TICKERS) {
  try {
    const quote = await yf.quote(ticker);
    const price = quote?.regularMarketPrice;
    if (!price) {
      console.log(`  ${ticker}: no price — skipped`);
      continue;
    }
    const rows = await sql`
      INSERT INTO positions (user_id, ticker, purchase_price, purchase_date)
      VALUES (${userId}, ${ticker}, ${price}, ${today})
      RETURNING id, ticker, purchase_price
    `;
    console.log(
      `  ${ticker.padEnd(6)} → #${rows[0].id} at $${Number(rows[0].purchase_price).toFixed(2)}`,
    );
  } catch (err) {
    console.log(`  ${ticker}: ${err.message}`);
  }
}

const after = await sql`SELECT COUNT(*)::int AS c FROM positions WHERE user_id = ${userId}`;
console.log(`\nPortfolio now has ${after[0].c} positions.`);
