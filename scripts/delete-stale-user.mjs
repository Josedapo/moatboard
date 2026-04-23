// One-shot: delete the stale auth user row (id=2, jose.poveda@horizm.com)
// so that the next Google sign-in creates a fresh user with a correctly
// linked accounts row. User 1 (jodapogo@gmail.com) is left untouched in
// case it ever needs to be used as a fallback.
//
// Needs explicit --confirm to run.

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.argv.includes("--confirm")) {
  console.error("Refusing to run without --confirm. This deletes a user row.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// Sanity check the row we're about to delete before acting.
const target = await sql.query(
  `SELECT id, email FROM users WHERE id = 2`,
);
if (target.length === 0) {
  console.log("User id=2 not found — nothing to do.");
  process.exit(0);
}
const [u] = target;
if (u.email !== "jose.poveda@horizm.com") {
  console.error(
    `Safety stop: user id=2 email is "${u.email}", expected "jose.poveda@horizm.com". Aborting.`,
  );
  process.exit(1);
}

// Sessions + accounts reference users via "userId" with ON DELETE CASCADE
// in the @auth/neon-adapter default schema. Delete the user and the
// dependents go with it.
await sql.query(`DELETE FROM sessions WHERE "userId" = 2`);
await sql.query(`DELETE FROM accounts WHERE "userId" = 2`);
await sql.query(`DELETE FROM users WHERE id = 2`);

console.log("Deleted:");
console.log("  users.id = 2 (jose.poveda@horizm.com)");
console.log("  related sessions + accounts");
console.log();

const remaining = await sql.query(
  `SELECT id, email FROM users ORDER BY id`,
);
console.log("Remaining users:");
console.table(remaining);

console.log();
console.log(
  "Next Google sign-in with jose.poveda@horizm.com will create a fresh",
);
console.log("user row with a correctly linked accounts row.");
