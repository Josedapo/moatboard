// Additive migration: create waitlist_emails to back the "Request an
// invitation" form on the homepage. Safe to re-run.
//
// Run once: node scripts/add-waitlist-emails-table.mjs

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

console.log("Creating waitlist_emails (if missing)...");

await sql.query(`
  CREATE TABLE IF NOT EXISTS waitlist_emails (
    id SERIAL PRIMARY KEY,
    email VARCHAR(320) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source VARCHAR(40) NOT NULL DEFAULT 'homepage'
  )
`);

// Unique on email so the same person submitting twice doesn't double-list.
// NOT UNIQUE on (email, source) because across campaigns we may re-invite.
await sql.query(
  `CREATE UNIQUE INDEX IF NOT EXISTS waitlist_emails_email_idx ON waitlist_emails(LOWER(email))`,
);

console.log("Done.");
