import { sql } from "@/lib/db";
import type { Tier } from "@/lib/verdict";

export type TickerStatus =
  | "in_portfolio"
  | "watchlist"
  | "discarded"
  | "outside_circle";

export type TickerState = {
  id: number;
  user_id: number;
  ticker: string;
  status: TickerStatus;
  reason_md: string | null;
  review_when: string | null;
  // Set when a non-portfolio state (discarded/watchlist/outside_circle) is
  // overwritten by an Invest decision — preserves the prior reason_md so the
  // position page can show "you had discarded this on X because Y before
  // changing your mind". NULL when the ticker has never been bought, or when
  // the prior state was already in_portfolio.
  prior_reason_on_invest_md: string | null;
  last_touched_at: string;
  created_at: string;
};

export async function getTickerState({
  userId,
  ticker,
}: {
  userId: string | number;
  ticker: string;
}): Promise<TickerState | null> {
  const rows = (await sql`
    SELECT id, user_id, ticker, status, reason_md, review_when,
           prior_reason_on_invest_md, last_touched_at, created_at
    FROM ticker_states
    WHERE user_id = ${userId} AND ticker = ${ticker.toUpperCase()}
    LIMIT 1
  `) as unknown as TickerState[];
  return rows[0] ?? null;
}

export async function listTickerStates({
  userId,
  status,
}: {
  userId: string | number;
  status?: TickerStatus;
}): Promise<TickerState[]> {
  if (status) {
    const rows = (await sql`
      SELECT id, user_id, ticker, status, reason_md, review_when,
             prior_reason_on_invest_md, last_touched_at, created_at
      FROM ticker_states
      WHERE user_id = ${userId} AND status = ${status}
      ORDER BY last_touched_at DESC
    `) as unknown as TickerState[];
    return rows;
  }
  const rows = (await sql`
    SELECT id, user_id, ticker, status, reason_md, review_when,
           prior_reason_on_invest_md, last_touched_at, created_at
    FROM ticker_states
    WHERE user_id = ${userId}
    ORDER BY last_touched_at DESC
  `) as unknown as TickerState[];
  return rows;
}

export async function upsertTickerState({
  userId,
  ticker,
  status,
  reasonMd,
  reviewWhen,
  priorReasonOnInvestMd,
}: {
  userId: string | number;
  ticker: string;
  status: TickerStatus;
  reasonMd?: string | null;
  reviewWhen?: string | null;
  // Only meaningful when status='in_portfolio' and there was a previous
  // non-portfolio row. Caller is responsible for computing this (read prior
  // row, decide if its reason_md is worth preserving).
  priorReasonOnInvestMd?: string | null;
}): Promise<TickerState> {
  const rows = (await sql`
    INSERT INTO ticker_states
      (user_id, ticker, status, reason_md, review_when,
       prior_reason_on_invest_md, last_touched_at)
    VALUES
      (${userId}, ${ticker.toUpperCase()}, ${status},
       ${reasonMd ?? null}, ${reviewWhen ?? null},
       ${priorReasonOnInvestMd ?? null}, NOW())
    ON CONFLICT (user_id, ticker) DO UPDATE
      SET status = EXCLUDED.status,
          reason_md = EXCLUDED.reason_md,
          review_when = EXCLUDED.review_when,
          prior_reason_on_invest_md = EXCLUDED.prior_reason_on_invest_md,
          last_touched_at = NOW()
    RETURNING id, user_id, ticker, status, reason_md, review_when,
              prior_reason_on_invest_md, last_touched_at, created_at
  `) as unknown as TickerState[];
  return rows[0];
}

// TickerState row enriched with the cached quality verdict and the count of
// qualitative red flags by severity. Used by /dashboard/watchlist (renders
// tier + flags) and /dashboard/history (renders only tier, flags often
// missing for tickers parked from the wizard's skip-to-decision shortcut).
// Tier is per-user (latest moatboard_analyses across this user's positions
// for the ticker, draft or live). Flag counts are per-ticker
// (qualitative_red_flags is shared across users since the source 10-K is
// the same). Flag subqueries are cheap at watchlist/history scale (<20
// tickers); always computed even when the caller doesn't render them.
export type EnrichedTickerState = TickerState & {
  business_tier: Tier | null;
  serious_flag_count: number;
  watch_flag_count: number;
};

export async function listTickerStatesEnriched({
  userId,
  status,
}: {
  userId: string | number;
  status: TickerStatus;
}): Promise<EnrichedTickerState[]> {
  const rows = (await sql`
    SELECT
      ts.id, ts.user_id, ts.ticker, ts.status, ts.reason_md, ts.review_when,
      ts.prior_reason_on_invest_md, ts.last_touched_at, ts.created_at,
      (SELECT ma.tier
         FROM moatboard_analyses ma
         JOIN positions p ON p.id = ma.position_id
         WHERE p.user_id = ${userId} AND p.ticker = ts.ticker
         ORDER BY ma.generated_at DESC
         LIMIT 1) AS business_tier,
      COALESCE((SELECT COUNT(*)::int
         FROM qualitative_red_flags qrf,
              jsonb_array_elements(qrf.flags) AS f
         WHERE qrf.ticker = ts.ticker
           AND f->>'severity' = 'serious'), 0) AS serious_flag_count,
      COALESCE((SELECT COUNT(*)::int
         FROM qualitative_red_flags qrf,
              jsonb_array_elements(qrf.flags) AS f
         WHERE qrf.ticker = ts.ticker
           AND f->>'severity' = 'watch'), 0) AS watch_flag_count
    FROM ticker_states ts
    WHERE ts.user_id = ${userId} AND ts.status = ${status}
    ORDER BY ts.last_touched_at DESC
  `) as unknown as EnrichedTickerState[];
  return rows;
}

export async function deleteTickerState({
  userId,
  ticker,
}: {
  userId: string | number;
  ticker: string;
}): Promise<void> {
  await sql`
    DELETE FROM ticker_states
    WHERE user_id = ${userId} AND ticker = ${ticker.toUpperCase()}
  `;
}
