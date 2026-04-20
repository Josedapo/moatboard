import { sql } from "@/lib/db";
import type {
  SignalSource,
  SignalSeverity,
  SignalEventType,
} from "@/lib/signalClassifier";

export type SignalStatus = "new" | "reviewed" | "dismissed" | "expired";

export type ReviewSignal = {
  id: number;
  user_id: number;
  ticker: string;
  source: SignalSource;
  event_type: SignalEventType;
  event_date: string;
  source_ref: string;
  source_url: string | null;
  severity: SignalSeverity;
  status: SignalStatus;
  reviewed_at: string | null;
  reviewed_by_snapshot_id: number | null;
  review_note_md: string | null;
  dismiss_reason_md: string | null;
  raw_payload: unknown | null;
  summary_md: string | null;
  summarized_at: string | null;
  summarized_with_model: string | null;
  deduplication_key: string;
  created_at: string;
};

// Idempotent insert: same (user, ticker, dedup_key) never duplicates.
// Returns the row if inserted, null if already existed.
export async function createSignalIfMissing(input: {
  userId: string | number;
  ticker: string;
  source: SignalSource;
  eventType: SignalEventType;
  eventDate: string;
  sourceRef: string;
  sourceUrl: string | null;
  severity: SignalSeverity;
  rawPayload?: unknown;
  deduplicationKey: string;
}): Promise<ReviewSignal | null> {
  const rows = (await sql`
    INSERT INTO review_signals (
      user_id, ticker, source, event_type, event_date,
      source_ref, source_url, severity, raw_payload, deduplication_key
    ) VALUES (
      ${input.userId},
      ${input.ticker.toUpperCase()},
      ${input.source},
      ${input.eventType},
      ${input.eventDate},
      ${input.sourceRef},
      ${input.sourceUrl},
      ${input.severity},
      ${input.rawPayload ? JSON.stringify(input.rawPayload) : null}::jsonb,
      ${input.deduplicationKey}
    )
    ON CONFLICT (user_id, ticker, deduplication_key) DO NOTHING
    RETURNING id, user_id, ticker, source, event_type, event_date,
              source_ref, source_url, severity, status,
              reviewed_at, reviewed_by_snapshot_id, review_note_md, dismiss_reason_md,
              raw_payload, summary_md, summarized_at, summarized_with_model,
           deduplication_key, created_at
  `) as unknown as ReviewSignal[];
  return rows[0] ?? null;
}

// List signals for a user, optionally filtered by status. Default sort:
// new first (by event_date desc), then reviewed/dismissed/expired pushed
// to the back. For the dashboard inbox we'll usually call with
// status='new' to keep it tight.
export async function listSignalsForUser({
  userId,
  status,
  limit = 100,
}: {
  userId: string | number;
  status?: SignalStatus;
  limit?: number;
}): Promise<ReviewSignal[]> {
  if (status) {
    const rows = (await sql`
      SELECT id, user_id, ticker, source, event_type, event_date,
             source_ref, source_url, severity, status,
             reviewed_at, reviewed_by_snapshot_id, review_note_md, dismiss_reason_md,
             raw_payload, summary_md, summarized_at, summarized_with_model,
           deduplication_key, created_at
      FROM review_signals
      WHERE user_id = ${userId} AND status = ${status}
      ORDER BY event_date DESC, id DESC
      LIMIT ${limit}
    `) as unknown as ReviewSignal[];
    return rows;
  }
  const rows = (await sql`
    SELECT id, user_id, ticker, source, event_type, event_date,
           source_ref, source_url, severity, status,
           reviewed_at, reviewed_by_snapshot_id, review_note_md, dismiss_reason_md,
           raw_payload, summary_md, summarized_at, summarized_with_model,
           deduplication_key, created_at
    FROM review_signals
    WHERE user_id = ${userId}
    ORDER BY event_date DESC, id DESC
    LIMIT ${limit}
  `) as unknown as ReviewSignal[];
  return rows;
}

// All signals for a (user, ticker) pair, restricted to the lifecycle
// states the Presentaciones tab surfaces (new + reviewed). Reviewed
// first by default? No — chronological by event_date desc reads like a
// timeline. Status filtering is explicit so legacy `dismissed`/`expired`
// rows stay hidden without needing a data migration.
export async function listSignalsForTicker({
  userId,
  ticker,
  statuses = ["new", "reviewed"],
  limit = 200,
}: {
  userId: string | number;
  ticker: string;
  statuses?: SignalStatus[];
  limit?: number;
}): Promise<ReviewSignal[]> {
  const rows = (await sql`
    SELECT id, user_id, ticker, source, event_type, event_date,
           source_ref, source_url, severity, status,
           reviewed_at, reviewed_by_snapshot_id, review_note_md, dismiss_reason_md,
           raw_payload, summary_md, summarized_at, summarized_with_model,
           deduplication_key, created_at
    FROM review_signals
    WHERE user_id = ${userId}
      AND ticker = ${ticker.toUpperCase()}
      AND status = ANY(${statuses}::text[])
    ORDER BY event_date DESC, id DESC
    LIMIT ${limit}
  `) as unknown as ReviewSignal[];
  return rows;
}

// Per-ticker count of `new` signals, used by the dashboard badge.
export async function countNewSignalsByTicker(
  userId: string | number,
): Promise<Record<string, number>> {
  const rows = (await sql`
    SELECT ticker, COUNT(*)::INTEGER AS count
    FROM review_signals
    WHERE user_id = ${userId} AND status = 'new'
    GROUP BY ticker
  `) as unknown as { ticker: string; count: number }[];
  const map: Record<string, number> = {};
  for (const r of rows) map[r.ticker] = r.count;
  return map;
}

// Mark as reviewed. Optional: link to a snapshot (10-Q floor satisfied
// by opening /trajectory) or carry a note. Callers must guarantee the
// signal belongs to the requesting user — enforced at the action layer.
export async function markSignalReviewed({
  signalId,
  userId,
  reviewedBySnapshotId,
  note,
}: {
  signalId: number;
  userId: string | number;
  reviewedBySnapshotId?: number | null;
  note?: string | null;
}): Promise<void> {
  await sql`
    UPDATE review_signals
    SET status = 'reviewed',
        reviewed_at = NOW(),
        reviewed_by_snapshot_id = ${reviewedBySnapshotId ?? null},
        review_note_md = ${note ?? null}
    WHERE id = ${signalId} AND user_id = ${userId}
  `;
}

export async function dismissSignal({
  signalId,
  userId,
  reason,
}: {
  signalId: number;
  userId: string | number;
  reason?: string | null;
}): Promise<void> {
  await sql`
    UPDATE review_signals
    SET status = 'dismissed',
        reviewed_at = NOW(),
        dismiss_reason_md = ${reason ?? null}
    WHERE id = ${signalId} AND user_id = ${userId}
  `;
}

// Restore a signal back to `new`. Used by the inbox tabs so the user
// can undo an accidental review/dismiss or re-process something when
// new information arrives. Clears the reviewed/dismissed metadata but
// keeps the summary (filing is immutable, the plain-language read is
// still valid).
export async function reopenSignal({
  signalId,
  userId,
}: {
  signalId: number;
  userId: string | number;
}): Promise<void> {
  await sql`
    UPDATE review_signals
    SET status = 'new',
        reviewed_at = NULL,
        reviewed_by_snapshot_id = NULL,
        review_note_md = NULL,
        dismiss_reason_md = NULL
    WHERE id = ${signalId} AND user_id = ${userId}
  `;
}

// Counts per status for the inbox tab badges. One query, ordered map.
export async function countSignalsByStatus(
  userId: string | number,
): Promise<Record<SignalStatus, number>> {
  const rows = (await sql`
    SELECT status, COUNT(*)::INTEGER AS c
    FROM review_signals
    WHERE user_id = ${userId}
    GROUP BY status
  `) as unknown as { status: SignalStatus; c: number }[];
  const map: Record<SignalStatus, number> = {
    new: 0,
    reviewed: 0,
    dismissed: 0,
    expired: 0,
  };
  for (const r of rows) map[r.status] = r.c;
  return map;
}

// Returns the oldest unrreviewed floor signal (10-Q/10-K) for a ticker
// that's been sitting in `new` status longer than `thresholdDays`. Used
// by the position ficha to show the amber "release pendiente de revisar"
// banner. Returns null when the floor is clean.
export async function getStalestUnreviewedFloorSignal({
  userId,
  ticker,
  thresholdDays = 14,
}: {
  userId: string | number;
  ticker: string;
  thresholdDays?: number;
}): Promise<ReviewSignal | null> {
  const rows = (await sql`
    SELECT id, user_id, ticker, source, event_type, event_date,
           source_ref, source_url, severity, status,
           reviewed_at, reviewed_by_snapshot_id, review_note_md, dismiss_reason_md,
           raw_payload, summary_md, summarized_at, summarized_with_model,
           deduplication_key, created_at
    FROM review_signals
    WHERE user_id = ${userId}
      AND ticker = ${ticker.toUpperCase()}
      AND severity = 'floor'
      AND status = 'new'
      AND event_date < NOW() - (${thresholdDays} || ' days')::INTERVAL
    ORDER BY event_date ASC
    LIMIT 1
  `) as unknown as ReviewSignal[];
  return rows[0] ?? null;
}

export async function getSignalById({
  signalId,
  userId,
}: {
  signalId: number;
  userId: string | number;
}): Promise<ReviewSignal | null> {
  const rows = (await sql`
    SELECT id, user_id, ticker, source, event_type, event_date,
           source_ref, source_url, severity, status,
           reviewed_at, reviewed_by_snapshot_id, review_note_md, dismiss_reason_md,
           raw_payload, summary_md, summarized_at, summarized_with_model,
           deduplication_key, created_at
    FROM review_signals
    WHERE id = ${signalId} AND user_id = ${userId}
    LIMIT 1
  `) as unknown as ReviewSignal[];
  return rows[0] ?? null;
}

// Persist an AI-generated summary on the signal row. Always overwrites —
// regeneration is an explicit user action, and filings are immutable so
// only the prompt / model matter for why the output changed.
export async function saveSignalSummary({
  signalId,
  userId,
  summaryMd,
  model,
}: {
  signalId: number;
  userId: string | number;
  summaryMd: string;
  model: string;
}): Promise<void> {
  await sql`
    UPDATE review_signals
    SET summary_md = ${summaryMd},
        summarized_at = NOW(),
        summarized_with_model = ${model}
    WHERE id = ${signalId} AND user_id = ${userId}
  `;
}

// Heuristic: infer whether the next earnings release will be the
// annual (10-K) or a quarterly (10-Q) by anchoring on the most recent
// 10-K we've recorded. If the forecasted date lands ~1 year after the
// last 10-K (±45 days) it's the next annual filing; anything else is
// treated as a quarterly. Returns null when we have no history and
// can't make an educated guess.
export async function inferNextReportType({
  userId,
  ticker,
  nextEarningsDate,
}: {
  userId: string | number;
  ticker: string;
  nextEarningsDate: string | Date;
}): Promise<"10-K" | "10-Q" | null> {
  const rows = (await sql`
    SELECT event_date
    FROM review_signals
    WHERE user_id = ${userId}
      AND ticker = ${ticker.toUpperCase()}
      AND source = 'sec_10k'
    ORDER BY event_date DESC
    LIMIT 1
  `) as unknown as { event_date: string | Date }[];
  if (rows.length === 0) return null;

  const last10kMs = new Date(rows[0].event_date).getTime();
  const nextMs = new Date(nextEarningsDate).getTime();
  if (!Number.isFinite(last10kMs) || !Number.isFinite(nextMs)) return null;

  const dayMs = 24 * 60 * 60 * 1000;
  const daysBetween = Math.round((nextMs - last10kMs) / dayMs);
  if (daysBetween >= 330 && daysBetween <= 400) return "10-K";
  return "10-Q";
}

// Background job: flip signals older than the threshold to `expired`.
// Exported so the cron can call it as the last step of every run.
// `expired` ≠ `reviewed`: it means the user never processed the row,
// which is a signal about the detection threshold being too noisy.
export async function expireOldSignals(daysOld = 90): Promise<number> {
  const rows = (await sql`
    UPDATE review_signals
    SET status = 'expired'
    WHERE status = 'new'
      AND created_at < NOW() - (${daysOld} || ' days')::INTERVAL
    RETURNING id
  `) as unknown as { id: number }[];
  return rows.length;
}
