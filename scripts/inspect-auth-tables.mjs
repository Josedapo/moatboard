// One-shot diagnostic for NextAuth tables. Shows what's in users,
// accounts, sessions so we can see whether the wipe left them consistent.
// Safe: read-only.

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });
const sql = neon(process.env.DATABASE_URL);

console.log("-- users --");
const users = await sql.query(
  `SELECT id, email, "emailVerified", created_at FROM users ORDER BY id`,
);
console.table(users);

console.log("\n-- accounts --");
const accounts = await sql.query(
  `SELECT id, "userId", provider, "providerAccountId" FROM accounts ORDER BY id`,
);
console.table(accounts);

console.log("\n-- sessions --");
const sessions = await sql.query(
  `SELECT id, "userId", expires FROM sessions ORDER BY id`,
);
console.table(sessions);
