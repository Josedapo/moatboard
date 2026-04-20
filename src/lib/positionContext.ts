import { sql } from "@/lib/db";
import { getTickerState } from "@/lib/tickerStates";
import { getCurrentUnderstanding } from "@/lib/businessUnderstanding";
import type { AnalysisSession, UnderstoodFlag } from "@/lib/analysisSessions";

// Conditions worth surfacing on a position page above the body content.
// Each field is non-null only when the condition holds — render the strip
// only when at least one is set.
export type DecisionContext = {
  // Prior reason from a discarded / watchlist / outside_circle state that
  // was overwritten when the user invested. Preserved on ticker_states by
  // decideInvestAction.
  priorReasonOnInvestMd: string | null;
  // The most recent invested session reached the Decision step with a
  // non-default understood_flag. We surface 'doubts_resolved' as a calm
  // reminder and 'not_understood' as a louder warning (should be impossible
  // by design but defended against).
  investedUnderstoodFlag: UnderstoodFlag | null;
  // The user's invested session decision date — anchors the prose.
  investedAt: string | null;
  // When the current business_understanding version differs from the one
  // recorded in the invested session. Surfaces a "regenerated since you
  // bought" link to the historical version.
  understandingDrift: {
    currentVersion: number;
    versionAtInvest: number;
  } | null;
};

export async function computeDecisionContext({
  userId,
  ticker,
}: {
  userId: string | number;
  ticker: string;
}): Promise<DecisionContext> {
  const upper = ticker.toUpperCase();

  // Run reads in parallel — all three are small index lookups.
  const [tickerState, investedSession, understanding] = await Promise.all([
    getTickerState({ userId, ticker: upper }),
    getMostRecentInvestedSession({ userId, ticker: upper }),
    getCurrentUnderstanding(upper),
  ]);

  let understandingDrift: DecisionContext["understandingDrift"] = null;
  if (
    understanding &&
    investedSession?.business_understanding_version &&
    understanding.version > investedSession.business_understanding_version
  ) {
    understandingDrift = {
      currentVersion: understanding.version,
      versionAtInvest: investedSession.business_understanding_version,
    };
  }

  // Surface non-default understood_flag only when the user actually flagged
  // doubts at decision time. 'understood' is the default and would just be
  // noise.
  const investedUnderstoodFlag =
    investedSession?.understood_flag &&
    investedSession.understood_flag !== "understood"
      ? investedSession.understood_flag
      : null;

  return {
    priorReasonOnInvestMd: tickerState?.prior_reason_on_invest_md ?? null,
    investedUnderstoodFlag,
    investedAt:
      investedSession?.completed_at ?? investedSession?.last_active_at ?? null,
    understandingDrift,
  };
}

async function getMostRecentInvestedSession({
  userId,
  ticker,
}: {
  userId: string | number;
  ticker: string;
}): Promise<AnalysisSession | null> {
  const rows = (await sql`
    SELECT id, user_id, ticker, current_step, furthest_step, started_at,
           last_active_at, completed_at, outcome,
           business_understanding_version, understood_flag
    FROM analysis_sessions
    WHERE user_id = ${userId}
      AND ticker = ${ticker.toUpperCase()}
      AND outcome = 'invested'
    ORDER BY completed_at DESC NULLS LAST
    LIMIT 1
  `) as unknown as AnalysisSession[];
  return rows[0] ?? null;
}

export function hasAnyDecisionContext(ctx: DecisionContext): boolean {
  return (
    ctx.priorReasonOnInvestMd !== null ||
    ctx.investedUnderstoodFlag !== null ||
    ctx.understandingDrift !== null
  );
}
