import { sql } from "@/lib/db";
import type { Tier } from "@/lib/verdict";

// Watchlist entry: pure tag, no fields. The user knows why they're
// watching a ticker — recording a reason is friction without payoff.
// Independent of cartera (a held position can also be on the watchlist).
export type WatchlistEntry = {
  id: number;
  user_id: number;
  ticker: string;
  last_touched_at: string;
  created_at: string;
};

export async function isOnWatchlist({
  userId,
  ticker,
}: {
  userId: string | number;
  ticker: string;
}): Promise<boolean> {
  const rows = (await sql`
    SELECT 1
    FROM watchlist_entries
    WHERE user_id = ${userId} AND ticker = ${ticker.toUpperCase()}
    LIMIT 1
  `) as unknown as Array<{ "?column?": number }>;
  return rows.length > 0;
}

export async function listWatchlist({
  userId,
}: {
  userId: string | number;
}): Promise<WatchlistEntry[]> {
  const rows = (await sql`
    SELECT id, user_id, ticker, last_touched_at, created_at
    FROM watchlist_entries
    WHERE user_id = ${userId}
    ORDER BY last_touched_at DESC
  `) as unknown as WatchlistEntry[];
  return rows;
}

export async function addToWatchlist({
  userId,
  ticker,
}: {
  userId: string | number;
  ticker: string;
}): Promise<WatchlistEntry> {
  const rows = (await sql`
    INSERT INTO watchlist_entries (user_id, ticker, last_touched_at)
    VALUES (${userId}, ${ticker.toUpperCase()}, NOW())
    ON CONFLICT (user_id, ticker) DO UPDATE
      SET last_touched_at = NOW()
    RETURNING id, user_id, ticker, last_touched_at, created_at
  `) as unknown as WatchlistEntry[];
  return rows[0];
}

export async function removeFromWatchlist({
  userId,
  ticker,
}: {
  userId: string | number;
  ticker: string;
}): Promise<void> {
  await sql`
    DELETE FROM watchlist_entries
    WHERE user_id = ${userId} AND ticker = ${ticker.toUpperCase()}
  `;
}

// WatchlistEntry enriched with cached quality tier + qualitative red flag
// counts + latest implied-return assumptions blob. Used by /dashboard/
// watchlist (renders tier + flags + base/stress CAGR). Tier is per-user
// (latest moatboard_analyses across this user's positions for the ticker,
// draft or live). Flag counts are per-ticker (qualitative_red_flags is
// shared across users).
export type EnrichedWatchlistEntry = WatchlistEntry & {
  business_tier: Tier | null;
  serious_flag_count: number;
  watch_flag_count: number;
  // Latest implied-return assumptions blob for live-recompute against
  // today's market cap via deriveLiveImpliedReturn(). Typed as `unknown`
  // to keep this lib free of impliedReturn dep — caller casts.
  valuation_assumptions: unknown | null;
};

export async function listWatchlistEnriched({
  userId,
}: {
  userId: string | number;
}): Promise<EnrichedWatchlistEntry[]> {
  const rows = (await sql`
    SELECT
      we.id, we.user_id, we.ticker, we.last_touched_at, we.created_at,
      (SELECT ma.tier
         FROM moatboard_analyses ma
         JOIN positions p ON p.id = ma.position_id
         WHERE p.user_id = ${userId} AND p.ticker = we.ticker
         ORDER BY ma.generated_at DESC
         LIMIT 1) AS business_tier,
      COALESCE((SELECT COUNT(*)::int
         FROM qualitative_red_flags qrf,
              jsonb_array_elements(qrf.flags) AS f
         WHERE qrf.ticker = we.ticker
           AND f->>'severity' = 'serious'), 0) AS serious_flag_count,
      COALESCE((SELECT COUNT(*)::int
         FROM qualitative_red_flags qrf,
              jsonb_array_elements(qrf.flags) AS f
         WHERE qrf.ticker = we.ticker
           AND f->>'severity' = 'watch'), 0) AS watch_flag_count,
      (SELECT v.assumptions
         FROM valuations v
         JOIN positions p ON p.id = v.position_id
         WHERE p.user_id = ${userId}
           AND p.ticker = we.ticker
           AND v.method = 'implied_return'
         ORDER BY v.generated_at DESC
         LIMIT 1) AS valuation_assumptions
    FROM watchlist_entries we
    WHERE we.user_id = ${userId}
    ORDER BY we.last_touched_at DESC
  `) as unknown as EnrichedWatchlistEntry[];
  return rows;
}
