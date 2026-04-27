import { sql } from "@/lib/db";

export type AnalysisStep =
  | "understanding"
  | "red_flags"
  | "quality"
  | "valuation"
  | "decision"
  | "completed";

export type AnalysisOutcome =
  | "invested"
  | "watchlist"
  | "discarded"
  | "outside_circle"
  | "abandoned";

export type UnderstoodFlag =
  | "understood"
  | "doubts_resolved"
  | "not_understood";

export type AnalysisSession = {
  id: number;
  user_id: number;
  ticker: string;
  current_step: AnalysisStep;
  furthest_step: AnalysisStep;
  started_at: string;
  last_active_at: string;
  completed_at: string | null;
  outcome: AnalysisOutcome | null;
  business_understanding_version: number | null;
  understood_flag: UnderstoodFlag | null;
};

// Canonical step order. Used to compute furthest_step as max(prev, new) when
// advancing, and to decide which steps are clickable in the indicator.
//
// Quality runs first so that tickers failing the scorecard tier bar are
// discarded before spending Claude tokens on Understanding + Red flags
// (both of which read the full 10-K). The "Moatboard can't analyze this
// business" gate (<5 applicable dimensions) now also fires at step 1,
// avoiding AI calls entirely for unsupported businesses.
export const STEP_ORDER: AnalysisStep[] = [
  "quality",
  "understanding",
  "red_flags",
  "valuation",
  "decision",
  "completed",
];

export function stepIndex(step: AnalysisStep): number {
  return STEP_ORDER.indexOf(step);
}

export async function getActiveSession({
  userId,
  ticker,
}: {
  userId: string | number;
  ticker: string;
}): Promise<AnalysisSession | null> {
  const rows = (await sql`
    SELECT id, user_id, ticker, current_step, furthest_step, started_at, last_active_at,
           completed_at, outcome, business_understanding_version, understood_flag
    FROM analysis_sessions
    WHERE user_id = ${userId}
      AND ticker = ${ticker.toUpperCase()}
      AND completed_at IS NULL
    LIMIT 1
  `) as unknown as AnalysisSession[];
  return rows[0] ?? null;
}

export async function listSessionsForTicker({
  userId,
  ticker,
}: {
  userId: string | number;
  ticker: string;
}): Promise<AnalysisSession[]> {
  const rows = (await sql`
    SELECT id, user_id, ticker, current_step, furthest_step, started_at, last_active_at,
           completed_at, outcome, business_understanding_version, understood_flag
    FROM analysis_sessions
    WHERE user_id = ${userId} AND ticker = ${ticker.toUpperCase()}
    ORDER BY started_at DESC
  `) as unknown as AnalysisSession[];
  return rows;
}

// Start a new session. If an active one exists, return it (idempotent —
// the partial unique index on (user_id, ticker) WHERE completed_at IS NULL
// guarantees at most one active session per ticker, so resuming is the right
// behavior).
export async function startSession({
  userId,
  ticker,
}: {
  userId: string | number;
  ticker: string;
}): Promise<AnalysisSession> {
  const existing = await getActiveSession({ userId, ticker });
  if (existing) return existing;
  const rows = (await sql`
    INSERT INTO analysis_sessions (user_id, ticker, current_step, furthest_step)
    VALUES (${userId}, ${ticker.toUpperCase()}, 'quality', 'quality')
    RETURNING id, user_id, ticker, current_step, furthest_step, started_at, last_active_at,
              completed_at, outcome, business_understanding_version, understood_flag
  `) as unknown as AnalysisSession[];
  return rows[0];
}

export async function advanceSession({
  sessionId,
  step,
  understoodFlag,
  businessUnderstandingVersion,
  furthestStep,
}: {
  sessionId: number;
  step: AnalysisStep;
  understoodFlag?: UnderstoodFlag | null;
  businessUnderstandingVersion?: number | null;
  // When moving forward, pass the new furthest_step (callers compute
  // max(prev_furthest, step) in JS and pass it here). When navigating
  // backward, omit this — the DB keeps the previously-reached maximum so
  // steps the user already completed remain accessible in the indicator.
  furthestStep?: AnalysisStep | null;
}): Promise<AnalysisSession> {
  const rows = (await sql`
    UPDATE analysis_sessions
    SET current_step = ${step},
        furthest_step = COALESCE(${furthestStep ?? null}, furthest_step),
        last_active_at = NOW(),
        understood_flag = COALESCE(${understoodFlag ?? null}, understood_flag),
        business_understanding_version = COALESCE(
          ${businessUnderstandingVersion ?? null}, business_understanding_version
        )
    WHERE id = ${sessionId}
    RETURNING id, user_id, ticker, current_step, furthest_step, started_at, last_active_at,
              completed_at, outcome, business_understanding_version, understood_flag
  `) as unknown as AnalysisSession[];
  return rows[0];
}

export async function completeSession({
  sessionId,
  outcome,
}: {
  sessionId: number;
  outcome: AnalysisOutcome;
}): Promise<AnalysisSession> {
  const rows = (await sql`
    UPDATE analysis_sessions
    SET current_step = 'completed',
        completed_at = NOW(),
        last_active_at = NOW(),
        outcome = ${outcome}
    WHERE id = ${sessionId}
    RETURNING id, user_id, ticker, current_step, furthest_step, started_at, last_active_at,
              completed_at, outcome, business_understanding_version, understood_flag
  `) as unknown as AnalysisSession[];
  return rows[0];
}

export async function abandonActiveSession({
  userId,
  ticker,
}: {
  userId: string | number;
  ticker: string;
}): Promise<void> {
  await sql`
    UPDATE analysis_sessions
    SET completed_at = NOW(),
        outcome = 'abandoned',
        current_step = 'completed'
    WHERE user_id = ${userId}
      AND ticker = ${ticker.toUpperCase()}
      AND completed_at IS NULL
  `;
}
