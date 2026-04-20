import { sql } from "@/lib/db";

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
