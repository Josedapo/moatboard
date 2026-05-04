// Batch-runs the same pipeline as the "Analizar calidad" button on the
// unified ficha (`/dashboard/ticker/[symbol]`, Quality tab) for one or
// more tickers. Mirrors `analyzeQualityAction` exactly: ensures a draft
// position, runs `ensureAnalysis` (scorecard + moat + tier + verdict
// prose), and propagates to the shared per-ticker `discovery_pre_analyses`
// cache.
//
// Run examples:
//   # Single ticker against prod, using Sonnet via API (matches what the
//   # button does on moatboard.com):
//   DATABASE_URL=$DATABASE_URL_PROD MOATBOARD_AI_MODE=remote \
//     npx tsx scripts/batch-analyze-quality.ts ORCL
//
//   # Several tickers (sequential, 2s sleep between to be polite to SEC):
//   DATABASE_URL=$DATABASE_URL_PROD MOATBOARD_AI_MODE=remote \
//     npx tsx scripts/batch-analyze-quality.ts ORCL ADBE NOW
//
//   # Override the resolved user (default: lookup by email):
//   ... npx tsx scripts/batch-analyze-quality.ts --user 1 ORCL
//
//   # Override the email used for lookup (default: jodapogo@gmail.com):
//   ... npx tsx scripts/batch-analyze-quality.ts --email someone@example.com ORCL
//
//   # Adjust sleep between tickers (default 2000ms):
//   ... npx tsx scripts/batch-analyze-quality.ts --sleep 5000 ORCL ADBE
//
// All writes are additive: a draft `positions` row (no transactions, hidden
// from Dashboard), a `moatboard_analyses` row, a `moat_assessments` row
// (shared per-ticker), and a `discovery_pre_analyses` row (shared
// per-ticker). Idempotent — re-running on a ticker with a fresh analysis
// is a no-op (returns the cached row).

import { config } from "dotenv";
config({ path: ".env.local" });

const DEFAULT_EMAIL = "jodapogo@gmail.com";
const DEFAULT_SLEEP_MS = 2000;

type Args = {
  tickers: string[];
  userId: number | null;
  email: string;
  sleepMs: number;
};

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  let userId: number | null = null;
  let email = DEFAULT_EMAIL;
  let sleepMs = DEFAULT_SLEEP_MS;
  const tickers: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === "--user") {
      userId = Number(raw[++i]);
      if (Number.isNaN(userId)) {
        console.error("--user requires a numeric id");
        process.exit(1);
      }
    } else if (a === "--email") {
      email = raw[++i];
    } else if (a === "--sleep") {
      sleepMs = Number(raw[++i]);
      if (Number.isNaN(sleepMs)) {
        console.error("--sleep requires a numeric ms value");
        process.exit(1);
      }
    } else if (a.startsWith("--")) {
      console.error(`Unknown flag: ${a}`);
      process.exit(1);
    } else {
      tickers.push(a.toUpperCase());
    }
  }

  if (tickers.length === 0) {
    console.error(
      "Usage: npx tsx scripts/batch-analyze-quality.ts [--user N] [--email X] [--sleep MS] TICKER [TICKER ...]",
    );
    process.exit(1);
  }
  return { tickers, userId, email, sleepMs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const { tickers, userId: cliUserId, email, sleepMs } = parseArgs();

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }
  const dbHost = new URL(process.env.DATABASE_URL).host;
  const aiMode = process.env.MOATBOARD_AI_MODE ?? "remote";
  console.log(`DB host:  ${dbHost}`);
  console.log(`AI mode:  ${aiMode}`);
  console.log(`Tickers:  ${tickers.join(", ")}`);
  console.log("");

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL);

  let userId = cliUserId;
  if (userId === null) {
    const rows = (await sql`
      SELECT id FROM users WHERE email = ${email} LIMIT 1
    `) as { id: number }[];
    if (!rows[0]) {
      console.error(`No user found with email=${email}`);
      process.exit(1);
    }
    userId = rows[0].id;
  }
  console.log(`Resolved userId=${userId} (${email})\n`);

  const { ensureDraftPosition } = await import("../src/lib/positions");
  const { ensureAnalysis } = await import("../src/lib/positionFlow");
  const { upsertPreAnalysisFromExisting } = await import(
    "../src/lib/preAnalysisFlow"
  );
  const { invalidateLeaderboardCache } = await import(
    "../src/lib/discoveryLeaderboard"
  );

  let ok = 0;
  let failed = 0;

  for (let i = 0; i < tickers.length; i++) {
    const ticker = tickers[i];
    const idx = `[${i + 1}/${tickers.length}]`;
    console.log(`${idx} ${ticker} — starting…`);
    const t0 = Date.now();

    try {
      const draft = await ensureDraftPosition(userId, ticker);
      const analysis = await ensureAnalysis(draft.id, ticker);
      await upsertPreAnalysisFromExisting(ticker).catch((err) => {
        console.warn(
          `   warn: upsertPreAnalysisFromExisting failed: ${(err as Error).message}`,
        );
      });
      invalidateLeaderboardCache(userId);

      const dpaRows = (await sql`
        SELECT status, tier, applicable_dimensions, last_10k_accession,
               serious_red_flags_count, watch_red_flags_count, not_covered_reason
        FROM discovery_pre_analyses
        WHERE ticker = ${ticker}
        LIMIT 1
      `) as Array<{
        status: string;
        tier: string | null;
        applicable_dimensions: number | null;
        last_10k_accession: string | null;
        serious_red_flags_count: number | null;
        watch_red_flags_count: number | null;
        not_covered_reason: string | null;
      }>;
      const dpa = dpaRows[0];
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(
        `   ✓ position_id=${draft.id} tier=${analysis.tier} moat=${analysis.moat_strength}/${analysis.moat_archetype} ` +
          `(${elapsed}s)`,
      );
      if (dpa) {
        console.log(
          `     DPA: status=${dpa.status} tier=${dpa.tier} applicable=${dpa.applicable_dimensions} ` +
            `red(serious/watch)=${dpa.serious_red_flags_count}/${dpa.watch_red_flags_count} ` +
            `accession=${dpa.last_10k_accession ?? "—"}` +
            (dpa.not_covered_reason ? ` reason="${dpa.not_covered_reason}"` : ""),
        );
      } else {
        console.log(`     DPA: no row written (unexpected — investigate)`);
      }
      ok += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `   ✗ ${(err as Error).message}\n${(err as Error).stack ?? ""}`,
      );
    }

    if (i < tickers.length - 1) {
      await sleep(sleepMs);
    }
  }

  console.log(`\nDone. ${ok} ok, ${failed} failed, ${tickers.length} total.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
