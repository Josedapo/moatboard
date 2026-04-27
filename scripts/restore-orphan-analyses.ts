// Restore moatboard_analyses rows that were cascade-deleted when a draft
// position was removed on Watchlist/Discard/Outside-circle decisions
// (bug fixed on 2026-04-24: decide*Action no longer deletes the draft).
//
// For every (user, ticker) where ticker_states is terminal and no
// position+analysis pair exists, recreate a draft position and run
// `ensureAnalysis` against it. The tier, scorecard, moat are all
// deterministic (+ at most one cached AI call for the moat assessment,
// which is shared per-ticker and already cached for most names). No
// AI spend for re-runs against tickers with cached moat.
//
// Dry-run by default. Pass --apply to write.
//
// Run:
//   npx tsx scripts/restore-orphan-analyses.ts           # dry-run
//   npx tsx scripts/restore-orphan-analyses.ts --apply   # commit

import { config } from "dotenv";
config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");

async function main() {
  const { neon } = await import("@neondatabase/serverless");
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const sql = neon(process.env.DATABASE_URL);

  // Find orphaned tickers: terminal state with no analysis row.
  const orphans = (await sql`
    SELECT ts.user_id, ts.ticker, ts.status
    FROM ticker_states ts
    WHERE ts.status IN ('discarded', 'watchlist', 'outside_circle')
      AND NOT EXISTS (
        SELECT 1
          FROM positions p
          JOIN moatboard_analyses ma ON ma.position_id = p.id
         WHERE p.user_id = ts.user_id AND p.ticker = ts.ticker
      )
    ORDER BY ts.last_touched_at
  `) as { user_id: number; ticker: string; status: string }[];

  if (orphans.length === 0) {
    console.log("Nothing to restore.");
    return;
  }

  console.log(
    `${APPLY ? "APPLY" : "DRY-RUN"} — ${orphans.length} orphaned row(s):\n`,
  );
  for (const o of orphans) {
    console.log(`  user=${o.user_id} ticker=${o.ticker.padEnd(6)} state=${o.status}`);
  }
  console.log("");

  if (!APPLY) {
    console.log("Dry-run only. Re-run with --apply to restore.");
    return;
  }

  // Dynamic imports so dotenv loads first.
  const { createPosition, getDraftPositionByTicker } = await import(
    "../src/lib/positions"
  );
  const { ensureAnalysis } = await import("../src/lib/positionFlow");

  const results: { ticker: string; tier: string | null; error?: string }[] = [];
  for (const o of orphans) {
    try {
      // Re-use a draft position if one somehow lingers; otherwise create.
      let draft = await getDraftPositionByTicker(o.user_id, o.ticker);
      if (!draft) {
        draft = await createPosition({ userId: o.user_id, ticker: o.ticker });
      }
      const analysis = await ensureAnalysis(draft.id, o.ticker);
      results.push({ ticker: o.ticker, tier: analysis.tier });
      console.log(`  ✓ ${o.ticker.padEnd(6)} → tier=${analysis.tier}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ ticker: o.ticker, tier: null, error: msg });
      console.log(`  ✗ ${o.ticker.padEnd(6)} → ${msg}`);
    }
  }

  const ok = results.filter((r) => r.tier).length;
  const failed = results.length - ok;
  console.log(`\nRestored ${ok} / ${results.length}. Failed: ${failed}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
