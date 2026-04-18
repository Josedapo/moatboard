// One-off: add UNH, AGNC, RDDT to validate three routing paths.
//   UNH (Healthcare Plans)    → should route to Excess Returns Model (bank fix #1)
//   AGNC (REIT—Mortgage)      → should route to Excess Returns Model (bank fix #2)
//   RDDT (recent IPO, <3y)    → should trigger "Moatboard can't analyze" page

import { neon } from "@neondatabase/serverless";
import YahooFinance from "yahoo-finance2";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const USER_EMAIL = "jodapogo@gmail.com";
const TICKERS = ["UNH", "AGNC", "RDDT"];

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

const today = new Date().toISOString().slice(0, 10);

for (const ticker of TICKERS) {
  try {
    const quote = await yf.quote(ticker);
    const price = quote?.regularMarketPrice;
    if (!price) {
      console.error(`  ${ticker}: could not fetch price — skipped`);
      continue;
    }
    const rows = await sql`
      INSERT INTO positions (user_id, ticker, purchase_price, purchase_date)
      VALUES (${userId}, ${ticker}, ${price}, ${today})
      RETURNING id, ticker, purchase_price
    `;
    console.log(
      `  ${ticker}: inserted position #${rows[0].id} at $${Number(rows[0].purchase_price).toFixed(2)}`,
    );
  } catch (err) {
    console.error(`  ${ticker}: ${err.message}`);
  }
}
