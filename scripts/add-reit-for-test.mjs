// One-off: add a REIT position (Realty Income, O) to Joseda's portfolio so
// we can validate the AFFO-based DCF routing. Safe to delete after
// verification. Purchase price is set to the current market price.

import { neon } from "@neondatabase/serverless";
import YahooFinance from "yahoo-finance2";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const TICKER = "O";
const USER_EMAIL = "jodapogo@gmail.com";

const sql = neon(process.env.DATABASE_URL);
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const users = await sql`SELECT id FROM users WHERE email = ${USER_EMAIL} LIMIT 1`;
if (users.length === 0) {
  console.error(`User with email ${USER_EMAIL} not found.`);
  process.exit(1);
}
const userId = users[0].id;
console.log(`User ${USER_EMAIL} → id ${userId}`);

const quote = await yf.quote(TICKER);
const price = quote?.regularMarketPrice;
if (!price) {
  console.error(`Could not fetch current price for ${TICKER}.`);
  process.exit(1);
}
console.log(`${TICKER} current price: $${price.toFixed(2)}`);

const today = new Date().toISOString().slice(0, 10);

const rows = await sql`
  WITH new_position AS (
    INSERT INTO positions (user_id, ticker)
    VALUES (${userId}, ${TICKER})
    RETURNING id, ticker
  ),
  new_txn AS (
    INSERT INTO position_transactions
      (position_id, type, transaction_date, price, shares)
    SELECT id, 'buy', ${today}, ${price}, 1
    FROM new_position
    RETURNING id AS transaction_id, transaction_date, price
  )
  SELECT np.id, np.ticker, nt.transaction_date AS purchase_date, nt.price
  FROM new_position np
  JOIN new_txn nt ON nt.transaction_id IS NOT NULL
`;

console.log(`Inserted position:`, rows[0]);
