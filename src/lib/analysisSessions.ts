import { sql } from "@/lib/db";

// The wizard is now 4 linear steps + 'completed' for legacy rows that
// were terminated under the pre-2026-04-28 model. New sessions never
// transition to 'completed' — closing the wizard is purely a UI gesture
// and the row stays resumable forever.
export type AnalysisStep =
  | "understanding"
  | "red_flags"
  | "quality"
  | "valuation"
  | "completed";

export type UnderstoodFlag =
  | "understood"
  | "doubts_resolved"
  | "not_understood";

// Post-2026-04-28: completed_at + outcome columns dropped. One eternal
// session per (user, ticker) — never explicitly terminated, just
// resumable forever.
export type AnalysisSession = {
  id: number;
  user_id: number;
  ticker: string;
  current_step: AnalysisStep;
  furthest_step: AnalysisStep;
  started_at: string;
  last_active_at: string;
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
  "completed",
];

export function stepIndex(step: AnalysisStep): number {
  return STEP_ORDER.indexOf(step);
}

const SESSION_COLUMNS = `
  id, user_id, ticker, current_step, furthest_step, started_at,
  last_active_at, business_understanding_version, understood_flag
`;

export async function getActiveSession({
  userId,
  ticker,
}: {
  userId: string | number;
  ticker: string;
}): Promise<AnalysisSession | null> {
  const rows = (await sql`
    SELECT id, user_id, ticker, current_step, furthest_step, started_at,
           last_active_at, business_understanding_version, understood_flag
    FROM analysis_sessions
    WHERE user_id = ${userId}
      AND ticker = ${ticker.toUpperCase()}
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
    SELECT id, user_id, ticker, current_step, furthest_step, started_at,
           last_active_at, business_understanding_version, understood_flag
    FROM analysis_sessions
    WHERE user_id = ${userId} AND ticker = ${ticker.toUpperCase()}
    ORDER BY started_at DESC
  `) as unknown as AnalysisSession[];
  return rows;
}

// Start a new session. If one exists for (user, ticker), return it
// (idempotent — the unique index guarantees at most one row per pair,
// so resuming is the right behavior).
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
    RETURNING id, user_id, ticker, current_step, furthest_step, started_at,
              last_active_at, business_understanding_version, understood_flag
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
    RETURNING id, user_id, ticker, current_step, furthest_step, started_at,
              last_active_at, business_understanding_version, understood_flag
  `) as unknown as AnalysisSession[];
  return rows[0];
}

// Wipe the session for (user, ticker). Used by restartAnalysisAction
// when the user wants to walk the wizard from scratch. Cached pieces
// (moatboard_analyses, qualitative_red_flags, business_understanding)
// survive — they're per-ticker, not per-session — so the next run
// hits cache. Only the cursor (current_step / furthest_step) resets.
export async function deleteSession({
  userId,
  ticker,
}: {
  userId: string | number;
  ticker: string;
}): Promise<void> {
  await sql`
    DELETE FROM analysis_sessions
    WHERE user_id = ${userId}
      AND ticker = ${ticker.toUpperCase()}
  `;
}

void SESSION_COLUMNS;
