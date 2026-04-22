"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import type { ReviewSignal } from "@/lib/reviewSignals";
import {
  EVENT_TYPE_LABEL,
  SOURCE_LABEL,
  SEVERITY_SPEC,
} from "@/lib/signalLabels";
import {
  markSignalReviewedAction,
  summarizeSignalAction,
  reopenSignalAction,
} from "@/app/dashboard/actions";
import type { SignalStatus } from "@/lib/reviewSignals";

// Inbox card. Expands in place with two actions: "Marcar revisada"
// (with optional note) and "Descartar" (with optional reason). No
// required artefact at this MLP stage — if the inbox ends up noisy we
// tighten the contract later (e.g. floor requires trajectory +
// moat validation).
export default function SignalCard({
  signal,
  positionId,
  mode = "new",
}: {
  signal: ReviewSignal;
  // When the signal's ticker matches a live position, we pass its id so
  // the "Abrir ficha" link takes the user straight there. null for
  // watchlist tickers (no position id yet).
  positionId: number | null;
  // Current inbox tab. Drives which actions appear at the foot.
  mode?: SignalStatus;
}) {
  // "review" expands a textarea for the optional review note. No
  // dismiss option — signals only have two lifecycle states: new and
  // reviewed. Discarding was removed 2026-04-20; the per-ticker
  // Presentaciones tab is the durable store of reviewed history.
  const [actionMode, setActionMode] = useState<"idle" | "review">("idle");
  const [text, setText] = useState("");
  const [isPending, startTransition] = useTransition();

  // Local state for the AI summary so regenerating or summarising for
  // the first time doesn't require a full page revalidate to reflect
  // the result. Initialised from the server-side signal row.
  const [summaryMd, setSummaryMd] = useState<string | null>(
    signal.summary_md,
  );
  const [summarizedAt, setSummarizedAt] = useState<string | null>(
    signal.summarized_at,
  );
  const [summaryModel, setSummaryModel] = useState<string | null>(
    signal.summarized_with_model,
  );
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [isSummarising, startSummariseTransition] = useTransition();
  // Collapsed by default when the summary already existed at page load
  // — keeps the grid tidy when several cards have long summaries. Auto-
  // expands the moment the user generates a fresh one (they clearly
  // want to read it).
  const [summaryExpanded, setSummaryExpanded] = useState(false);

  const spec = SEVERITY_SPEC[signal.severity];
  const formattedDate = formatDate(signal.event_date);

  const submit = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.append("signalId", String(signal.id));
      fd.append("note", text);
      await markSignalReviewedAction(fd);
      setActionMode("idle");
      setText("");
    });
  };

  const [isReopening, startReopenTransition] = useTransition();
  const reopen = () => {
    startReopenTransition(async () => {
      const fd = new FormData();
      fd.append("signalId", String(signal.id));
      await reopenSignalAction(fd);
    });
  };

  const summarise = () => {
    setSummaryError(null);
    startSummariseTransition(async () => {
      const fd = new FormData();
      fd.append("signalId", String(signal.id));
      const res = await summarizeSignalAction(fd);
      if (res.ok) {
        setSummaryMd(res.summaryMd);
        setSummarizedAt(res.summarizedAt);
        setSummaryModel(res.model);
        setSummaryExpanded(true);
      } else {
        setSummaryError(res.error);
      }
    });
  };

  // Informational severity doesn't warrant a dedicated chip — the
  // frame color is calm and the label "Informativo" just adds noise.
  // Floor and material do earn the emphasis.
  const showSeverityChip = signal.severity !== "informational";

  // Reviewed cards desaturate: the severity frame is muted to gray,
  // contents lose visual weight, and a ✓ badge tags the ticker. Keeps
  // the history readable as context without competing for attention
  // with anything still pending.
  const isReviewed = mode === "reviewed";
  const frameClass = isReviewed
    ? "border-navy-100 bg-navy-50/40"
    : spec.frameClass;
  const contentOpacity = isReviewed ? "opacity-80" : "";

  return (
    <article
      className={`flex h-full flex-col rounded-xl border p-4 ${frameClass} ${contentOpacity}`}
    >
      <header className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-md bg-navy-900 px-1.5 py-0.5 text-[11px] font-bold text-white">
          {isReviewed && (
            <span aria-hidden className="text-emerald-300">
              ✓
            </span>
          )}
          {signal.ticker}
        </span>
        <span className="rounded-md border border-navy-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-navy-700">
          {SOURCE_LABEL[signal.source]}
        </span>
        {showSeverityChip && !isReviewed && (
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${spec.chipClass}`}
          >
            {spec.label}
          </span>
        )}
        {isReviewed && signal.reviewed_at && (
          <span className="text-[10px] uppercase tracking-wider text-emerald-700">
            Revisada {formatShortReviewDate(signal.reviewed_at)}
          </span>
        )}
        <span className="ml-auto text-[11px] text-navy-500">
          {formattedDate}
        </span>
      </header>

      <h4 className="mt-2 text-sm font-semibold leading-snug text-navy-900">
        {EVENT_TYPE_LABEL[signal.event_type]}
      </h4>

      {signal.event_type === "material_fundamentals_change" && (
        <DeltaChangeBlock payload={signal.raw_payload} />
      )}

      {signal.source === "discovery_13f" && (
        <FundMovementBlock payload={signal.raw_payload} />
      )}

      {(signal.source_url || positionId !== null) && (
        <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px]">
          {signal.source_url && signal.source === "discovery_13f" ? (
            <Link
              href={signal.source_url}
              className="text-navy-600 hover:text-navy-900"
            >
              Ver ficha del fondo →
            </Link>
          ) : signal.source_url ? (
            <a
              href={signal.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-navy-600 hover:text-navy-900"
            >
              EDGAR ↗
            </a>
          ) : null}
          {positionId !== null && (
            <Link
              href={`/dashboard/position/${positionId}/trajectory`}
              className="text-navy-600 hover:text-navy-900"
            >
              Evolución →
            </Link>
          )}
        </div>
      )}

      {/* AI summary block — collapsible. Header is a toggle button; the
          body mounts only when expanded so the grid stays compact when
          many cards carry long summaries. */}
      {summaryMd && (
        <div className="mt-3 overflow-hidden rounded-lg border border-navy-200 bg-navy-100/60 ring-1 ring-navy-100">
          <button
            type="button"
            onClick={() => setSummaryExpanded((v) => !v)}
            className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-navy-700 hover:bg-navy-100 hover:text-navy-900"
          >
            <span aria-hidden className="text-navy-400">
              {summaryExpanded ? "▾" : "▸"}
            </span>
            <span>Resumen con IA</span>
            {summarizedAt && !summaryExpanded && (
              <span className="ml-auto text-[10px] font-normal normal-case tracking-normal text-navy-400">
                {formatSummaryDate(summarizedAt)}
              </span>
            )}
          </button>
          {summaryExpanded && (
            <div className="border-t border-navy-200 bg-white/60 px-3 pb-3 pt-2">
              <SummaryBody markdown={summaryMd} />
              <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-navy-500">
                <span>
                  Generado{" "}
                  {summarizedAt ? formatSummaryDate(summarizedAt) : "—"}
                  {summaryModel ? ` · ${summaryModel}` : ""}
                </span>
                <button
                  type="button"
                  onClick={summarise}
                  disabled={isSummarising}
                  className="text-navy-500 hover:text-navy-800 disabled:opacity-50"
                >
                  {isSummarising ? "Regenerando…" : "Regenerar"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reviewed note — only shown when the signal is already
          reviewed and Joseda left a note. Mirrors the "qué mirado"
          context forward into the Presentaciones tab. */}
      {mode === "reviewed" && signal.review_note_md && (
        <div className="mt-3 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-xs text-navy-700">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
            Nota de revisión
          </div>
          <div className="whitespace-pre-line">{signal.review_note_md}</div>
        </div>
      )}

      {/* Actions row at the foot. mt-auto keeps cards aligned in grid. */}
      {actionMode === "idle" && (
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
          {!summaryMd &&
            signal.source !== "snapshot_diff" &&
            signal.source !== "discovery_13f" && (
            <button
              type="button"
              onClick={summarise}
              disabled={isSummarising || !signal.source_url}
              className="inline-flex items-center gap-1.5 rounded-md border border-navy-200 bg-white px-2.5 py-1 text-xs font-medium text-navy-700 hover:border-navy-300 hover:bg-navy-50 hover:text-navy-900 disabled:opacity-50"
              title={
                !signal.source_url
                  ? "Esta señal no tiene documento asociado"
                  : "Genera un resumen ejecutivo en lenguaje llano"
              }
            >
              {isSummarising ? (
                <>Resumiendo…</>
              ) : (
                <>
                  <span aria-hidden>✨</span>
                  Resumir con IA
                </>
              )}
            </button>
          )}
          {mode === "new" ? (
            <button
              type="button"
              onClick={() => setActionMode("review")}
              disabled={isPending}
              className="ml-auto rounded-md border border-navy-200 bg-white px-2.5 py-1 text-xs font-medium text-navy-700 hover:border-navy-300 hover:bg-navy-50 hover:text-navy-900 disabled:opacity-50"
            >
              Marcar revisada
            </button>
          ) : (
            <button
              type="button"
              onClick={reopen}
              disabled={isReopening}
              className="ml-auto rounded-md border border-transparent px-2.5 py-1 text-xs font-medium text-navy-500 hover:text-navy-700 disabled:opacity-50"
            >
              {isReopening ? "Reabriendo…" : "Reabrir"}
            </button>
          )}
          {summaryError && (
            <span className="mt-1 basis-full text-[11px] text-red-700">
              {summaryError}
            </span>
          )}
        </div>
      )}

      {actionMode === "review" && (
        <div className="mt-3 space-y-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Nota (opcional) — qué has mirado, conclusión, próximo paso"
            rows={2}
            className="w-full rounded-md border border-navy-200 bg-white px-3 py-2 text-xs text-navy-800 placeholder-navy-400 focus:border-navy-400 focus:outline-none"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={isPending}
              className="rounded-md bg-navy-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-navy-800 disabled:opacity-50"
            >
              {isPending ? "Guardando…" : "Confirmar revisada"}
            </button>
            <button
              type="button"
              onClick={() => {
                setActionMode("idle");
                setText("");
              }}
              disabled={isPending}
              className="text-xs text-navy-500 hover:text-navy-700 disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Delta-change block — renders a compact, text-only summary of what the
// quality framework detected between two snapshots. No AI calls; the
// payload from snapshotFlow already carries the structured diff.
// ─────────────────────────────────────────────────────────────────────────

type DeltaPayload = {
  from_snapshot_id?: number;
  to_snapshot_id?: number;
  filing_accession?: string;
  filing_form?: string;
  filing_period_end?: string | null;
  tier?: {
    before: string | null;
    after: string | null;
    levelsDropped: number;
  };
  gate?: {
    applicableBefore: number;
    applicableAfter: number;
    activated: boolean;
  };
  dimension_drops?: Array<{
    dimension: string;
    before: string;
    after: string;
    levels: number;
  }>;
};

const TIER_LABEL: Record<string, string> = {
  exceptional: "Exceptional",
  good: "Good",
  mediocre: "Mediocre",
  poor: "Poor",
};

const DIMENSION_LABEL: Record<string, string> = {
  returnOnInvestedCapital: "ROIC",
  fcfMargin: "FCF margin",
  grossMargin: "Gross margin",
  shareCountTrend: "Share count trend",
  operatingMargins: "Operating margin",
  debtToEquity: "D/E",
  revenueGrowth: "Revenue growth",
  returnOnEquity: "ROE",
  returnOnAssets: "ROA",
  bookValuePerShareCagr: "BV/share CAGR",
  affoPayoutRatio: "AFFO payout",
  netDebtToEbitda: "Net Debt/EBITDA",
  affoPerShareCagr: "AFFO/share CAGR",
};

// ─────────────────────────────────────────────────────────────────────────
// Fund movement block — renders the per-fund 13F movement (NEW / ADD /
// TRIM / EXIT) when the signal source is `discovery_13f`. Payload is
// written by generateCrossSignalsForFiling in discoveryCrossSignals.ts.
// ─────────────────────────────────────────────────────────────────────────

type FundMovementPayload = {
  fund_id?: number;
  fund_cik?: string;
  fund_display_name?: string;
  fund_tier?: "A" | "B" | "C" | "D" | "E";
  movement?: "new" | "add" | "trim" | "exit";
  prior_shares?: string;
  latest_shares?: string;
  shares_pct_change?: number | null;
  latest_weight?: number;
  prior_weight?: number;
  period_of_report?: string;
  prior_period_of_report?: string;
};

const FUND_TIER_CHIP: Record<"A" | "B" | "C" | "D" | "E", string> = {
  A: "border-emerald-300 bg-emerald-100 text-emerald-800",
  B: "border-teal-300 bg-teal-100 text-teal-800",
  C: "border-amber-300 bg-amber-100 text-amber-800",
  D: "border-amber-300 bg-amber-100 text-amber-800",
  E: "border-navy-200 bg-navy-100 text-navy-700",
};

const MOVEMENT_BADGE: Record<
  "new" | "add" | "trim" | "exit",
  { label: (pct: number | null | undefined) => string; className: string }
> = {
  new: {
    label: () => "NEW",
    className: "bg-emerald-600 text-white",
  },
  add: {
    label: (pct) =>
      pct != null && Number.isFinite(pct) ? `+${Math.round(pct)}%` : "+",
    className: "bg-emerald-500 text-white",
  },
  trim: {
    label: (pct) =>
      pct != null && Number.isFinite(pct) ? `${Math.round(pct)}%` : "−",
    className: "bg-amber-500 text-white",
  },
  exit: {
    label: () => "EXIT",
    className: "bg-red-600 text-white",
  },
};

function formatQuarter(ymd?: string): string {
  if (!ymd) return "—";
  const [yStr, mStr] = ymd.split("-");
  const month = Number(mStr);
  const q = month <= 3 ? "Q1" : month <= 6 ? "Q2" : month <= 9 ? "Q3" : "Q4";
  return `${q} ${yStr}`;
}

function FundMovementBlock({ payload }: { payload: unknown }) {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as FundMovementPayload;
  if (!p.fund_display_name || !p.fund_tier || !p.movement) return null;

  const badge = MOVEMENT_BADGE[p.movement];
  const weightText =
    p.latest_weight != null && p.latest_weight > 0
      ? `${p.latest_weight.toFixed(2)}% del fondo`
      : p.prior_weight != null && p.prior_weight > 0
        ? `era ${p.prior_weight.toFixed(2)}% del fondo`
        : null;

  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-navy-200 bg-white/70 px-3 py-2 text-xs text-navy-800">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${FUND_TIER_CHIP[p.fund_tier]}`}
        >
          Tier {p.fund_tier}
        </span>
        <span className="font-semibold text-navy-900">
          {p.fund_display_name}
        </span>
        <span
          className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badge.className}`}
        >
          {badge.label(p.shares_pct_change)}
        </span>
      </div>
      <div className="text-[11px] text-navy-600">
        13F de {formatQuarter(p.period_of_report)}
        {p.prior_period_of_report && (
          <> · vs. {formatQuarter(p.prior_period_of_report)}</>
        )}
        {weightText && <> · {weightText}</>}
      </div>
    </div>
  );
}

function DeltaChangeBlock({ payload }: { payload: unknown }) {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as DeltaPayload;
  const tier = p.tier;
  const gate = p.gate;
  const drops = Array.isArray(p.dimension_drops) ? p.dimension_drops : [];

  const hasTierDrop =
    tier && tier.before && tier.after && tier.levelsDropped > 0;
  const hasGateActivated = gate?.activated === true;

  if (!hasTierDrop && !hasGateActivated && drops.length === 0) return null;

  return (
    <div className="mt-2 space-y-1.5 rounded-lg border border-navy-200 bg-white/70 px-3 py-2 text-xs text-navy-800">
      {hasTierDrop && tier && tier.before && tier.after && (
        <div>
          <span className="font-semibold">Tier:</span>{" "}
          {TIER_LABEL[tier.before] ?? tier.before} →{" "}
          {TIER_LABEL[tier.after] ?? tier.after}{" "}
          <span className="text-navy-500">
            (−{tier.levelsDropped} {tier.levelsDropped === 1 ? "nivel" : "niveles"})
          </span>
        </div>
      )}
      {hasGateActivated && gate && (
        <div className="text-red-700">
          <span className="font-semibold">Marco analítico:</span> la empresa
          salió del marco ({gate.applicableBefore} → {gate.applicableAfter}{" "}
          dimensiones aplicables)
        </div>
      )}
      {drops.length > 0 && (
        <div>
          <span className="font-semibold">Dimensiones que empeoraron:</span>
          <ul className="mt-1 ml-4 list-disc space-y-0.5">
            {drops.map((d, i) => (
              <li key={i}>
                {DIMENSION_LABEL[d.dimension] ?? d.dimension}:{" "}
                <span className="text-navy-500">
                  {d.before} → {d.after}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatDate(value: string | Date): string {
  try {
    const d = value instanceof Date ? value : new Date(value);
    return d.toLocaleDateString("es-ES", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return typeof value === "string" ? value.slice(0, 10) : String(value);
  }
}

function formatShortReviewDate(value: string | Date): string {
  try {
    const d = value instanceof Date ? value : new Date(value);
    return d.toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      year: "2-digit",
    });
  } catch {
    return typeof value === "string" ? value.slice(0, 10) : String(value);
  }
}

function formatSummaryDate(value: string | Date): string {
  try {
    const d = value instanceof Date ? value : new Date(value);
    return d.toLocaleString("es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return typeof value === "string" ? value.slice(0, 10) : String(value);
  }
}

// Minimal markdown renderer for the Spanish AI summaries. Claude emits
// a constrained format: section headers as `**Título**`, paragraphs,
// and bullet lists starting with `- `. No need for a full markdown
// library — we parse the specific shapes the prompt requests and
// style them in navy prose.
function SummaryBody({ markdown }: { markdown: string }) {
  const blocks = markdown
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);

  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-navy-800">
      {blocks.map((block, i) => {
        // Bold heading — used by the prompt for "Qué ha pasado", etc.
        const headingMatch = block.match(/^\*\*(.+?)\*\*\s*$/);
        if (headingMatch) {
          return (
            <h4
              key={i}
              className="text-[11px] font-semibold uppercase tracking-wider text-navy-500"
            >
              {headingMatch[1]}
            </h4>
          );
        }

        // Bullet list — lines starting with `- ` or `* `.
        const looksLikeList = /^\s*[-*]\s+/m.test(block);
        if (looksLikeList) {
          const items = block
            .split(/\n/)
            .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
            .filter(Boolean);
          return (
            <ul key={i} className="ml-4 list-disc space-y-1">
              {items.map((item, j) => (
                <li key={j}>{renderInline(item)}</li>
              ))}
            </ul>
          );
        }

        // Heading glued to first paragraph (Claude sometimes emits
        // "**Qué ha pasado**\nTexto..." in the same block). Split.
        const glued = block.match(/^\*\*(.+?)\*\*\s*\n([\s\S]+)$/);
        if (glued) {
          return (
            <div key={i}>
              <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-navy-500">
                {glued[1]}
              </h4>
              <p>{renderInline(glued[2])}</p>
            </div>
          );
        }

        return <p key={i}>{renderInline(block)}</p>;
      })}
    </div>
  );
}

// Inline markdown for **bold** inside paragraphs / bullets. Kept tiny
// on purpose; the summary prompt doesn't use italics or links.
function renderInline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    const m = p.match(/^\*\*(.+?)\*\*$/);
    if (m) {
      return (
        <strong key={i} className="font-semibold text-navy-900">
          {m[1]}
        </strong>
      );
    }
    return <span key={i}>{p}</span>;
  });
}
