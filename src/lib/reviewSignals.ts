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
              raw_payload, summary_md, deduplication_key, created_at
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
             raw_payload, summary_md, deduplication_key, created_at
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
           raw_payload, summary_md, deduplication_key, created_at
    FROM review_signals
    WHERE user_id = ${userId}
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
