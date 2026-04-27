"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { FundamentalsSnapshot } from "@/lib/snapshotDiff";
import { diffSnapshots } from "@/lib/snapshotDiff";
import type { Tier } from "@/lib/verdict";
import type { Quality, MultiYearScore } from "@/lib/scorecard";
import type { ValuationMethod } from "@/lib/valuations";
import type { TransactionType } from "@/lib/positionTransactions";
import type { MoatValidation } from "@/lib/moatValidations";
import ScorecardCard from "@/components/ScorecardCard";
import MoatValidationPanel from "@/components/position/MoatValidationPanel";

const TIER_LABEL: Record<Tier, string> = {
  exceptional: "Exceptional",
  good: "Good",
  mediocre: "Mediocre",
  poor: "Poor",
};

const TIER_CLASSES: Record<Tier, string> = {
  exceptional: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  good: "bg-teal-50 text-teal-700 ring-teal-200",
  mediocre: "bg-amber-50 text-amber-700 ring-amber-200",
  poor: "bg-red-50 text-red-700 ring-red-200",
};

const TIER_RANK: Record<Tier, number> = {
  poor: 1,
  mediocre: 2,
  good: 3,
  exceptional: 4,
};

const METHOD_LABEL: Record<ValuationMethod, string> = {
  implied_return: "Retorno implícito",
  dcf: "Owner-earnings DCF",
  affo_dcf: "AFFO DCF",
  excess_returns: "Excess Returns",
  ai_multiples: "AI multiples",
};

const QUALITY_RANK: Record<Quality, number> = {
  neutral: 0,
  weak: 1,
  acceptable: 2,
  strong: 3,
};

type Direction = "improved" | "worsened" | "maintained";

// A single dimension card extracted from a snapshot's scorecard. Same
// shape for both snapshots so pair alignment is a simple `.find(c => c.key)`.
// `key` is stable across snapshots (identifies the dimension); `label` is
// Spanish display; `value` is pre-formatted (e.g. "18.2%", "+4.1%/yr").
type DimensionCard = {
  key: string;
  label: string;
  value: string;
  quality: Quality;
  hint: string;
};

// Extract scored dimensions from a snapshot, mirroring the shape the live
// Quality Scorecard renders on the position page so the trajectory view
// speaks the same visual language. Only dimensions with a frozen numeric
// value are included — `debtToEquity` is deliberately skipped because the
// snapshot stores its Quality label but not the trailing D/E number that
// drove it, so an antes→después card for it would be dishonest.
function buildSnapshotDimensionCards(
  snapshot: FundamentalsSnapshot,
): DimensionCard[] {
  const s = snapshot.scorecard_summary;
  if (!s) return [];
  const cards: DimensionCard[] = [];
  const my = s.multiYear;
  const d = s.dimensions;

  if (d.returnOnInvestedCapital !== "neutral") {
    cards.push({
      key: "roic",
      label: "ROIC",
      value: formatPct(my.returnOnInvestedCapital?.median ?? null),
      quality: d.returnOnInvestedCapital,
      hint: multiYearHint(my.returnOnInvestedCapital),
    });
  }
  if (d.grossMargin !== "neutral") {
    cards.push({
      key: "grossMargin",
      label: "Gross Margin",
      value: formatPct(my.grossMargin?.median ?? null),
      quality: d.grossMargin,
      hint: multiYearHint(my.grossMargin),
    });
  }
  if (d.fcfMargin !== "neutral") {
    cards.push({
      key: "fcfMargin",
      label: "FCF Margin",
      value: formatPct(my.fcfMargin?.median ?? null),
      quality: d.fcfMargin,
      hint: multiYearHint(my.fcfMargin),
    });
  }
  if (d.operatingMargins !== "neutral") {
    cards.push({
      key: "operatingMargin",
      label: "Operating Margin",
      value: formatPct(my.operatingMargin?.median ?? null),
      quality: d.operatingMargins,
      hint: multiYearHint(my.operatingMargin),
    });
  }
  if (d.shareCountTrend !== "neutral") {
    cards.push({
      key: "shareCountTrend",
      label: "Share Count Trend",
      value: formatCagr(my.shareCountTrend?.median ?? null),
      quality: d.shareCountTrend,
      hint: shareCountHint(my.shareCountTrend),
    });
  }
  if (d.revenueGrowth !== "neutral") {
    cards.push({
      key: "revenueGrowth",
      label: "Revenue Growth",
      value: formatCagr(my.revenueGrowth?.median ?? null),
      quality: d.revenueGrowth,
      hint: multiYearHint(my.revenueGrowth),
    });
  }
  if (d.returnOnEquity !== "neutral") {
    cards.push({
      key: "roe",
      label: "ROE (multi-year)",
      value: formatPct(my.returnOnEquity?.median ?? null),
      quality: d.returnOnEquity,
      hint: multiYearHint(my.returnOnEquity),
    });
  }
  if (d.returnOnAssets !== "neutral") {
    cards.push({
      key: "roa",
      label: "ROA (multi-year)",
      value: formatPct(my.returnOnAssets?.median ?? null),
      quality: d.returnOnAssets,
      hint: multiYearHint(my.returnOnAssets),
    });
  }
  if (d.bookValuePerShareCagr !== "neutral") {
    cards.push({
      key: "bvCagr",
      label: "BV/share 5y CAGR",
      value: formatCagr(my.bookValuePerShareCagr?.median ?? null),
      quality: d.bookValuePerShareCagr,
      hint: multiYearHint(my.bookValuePerShareCagr),
    });
  }
  if (d.affoPerShareCagr !== "neutral") {
    cards.push({
      key: "affoCagr",
      label: "AFFO/share 5y CAGR",
      value: formatCagr(my.affoPerShareCagr?.median ?? null),
      quality: d.affoPerShareCagr,
      hint: multiYearHint(my.affoPerShareCagr),
    });
  }
  if (d.affoPayoutRatio !== "neutral" && s.reit?.affoPayoutRatio) {
    cards.push({
      key: "affoPayout",
      label: "AFFO Payout Ratio",
      value: formatPct(s.reit.affoPayoutRatio.value ?? null),
      quality: d.affoPayoutRatio,
      hint: "Dividend / AFFO (latest)",
    });
  }
  if (d.netDebtToEbitda !== "neutral" && s.reit?.netDebtToEbitda) {
    cards.push({
      key: "netDebtEbitda",
      label: "Net Debt / EBITDA",
      value: formatMultiple(s.reit.netDebtToEbitda.value ?? null),
      quality: d.netDebtToEbitda,
      hint: "Net debt / EBITDA (latest)",
    });
  }

  return cards;
}

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function formatCagr(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "+";
  return `${sign}${Math.abs(value * 100).toFixed(1)}%/yr`;
}

function formatMultiple(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(2)}x`;
}

function multiYearHint(score: MultiYearScore | undefined): string {
  if (!score) return "—";
  if (score.note) return score.note;
  if (score.yearsUsed === 0) return "No annual data available";
  return `${score.yearsUsed}y median`;
}

function shareCountHint(score: MultiYearScore | undefined): string {
  if (!score) return "—";
  if (score.note) return score.note;
  if (score.yearsUsed < 2) return "Insufficient history";
  return `${score.yearsUsed}y CAGR · negative = buybacks`;
}

// Per-transaction-type trigger label. `transaction` trigger + tx type =
// human-readable. Non-transaction triggers have fixed labels.
function triggerLabel(
  snapshot: FundamentalsSnapshot,
  transactionTypes: Record<number, TransactionType>,
): string {
  if (snapshot.trigger === "quarterly_10q") return "Trimestral · 10-Q";
  if (snapshot.trigger === "annual_10k") return "Anual · 10-K";
  const txType =
    snapshot.transaction_id != null
      ? transactionTypes[snapshot.transaction_id]
      : undefined;
  switch (txType) {
    case "buy":
      return "Compra";
    case "add":
      return "Ampliación";
    case "trim":
      return "Recorte";
    case "sell":
      return "Venta";
    default:
      return "Transacción";
  }
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

function formatSignedPct(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

export default function TrajectoryExplorer({
  positionId,
  ticker,
  snapshots,
  transactionTypes,
  todayId,
  buyId,
  moatValidations,
  preCommitment,
}: {
  positionId: number;
  ticker: string;
  snapshots: FundamentalsSnapshot[];
  transactionTypes: Record<number, TransactionType>;
  // `todayId` identifies the synthetic "hoy" entry (a pseudo-snapshot
  // computed at page load, not persisted). Null when analysis or valuation
  // couldn't be computed.
  todayId: number | null;
  // `buyId` identifies the snapshot attached to the first buy transaction
  // — the "compra" anchor. Null when no buy exists yet (shouldn't happen
  // for live positions, defensive).
  buyId: number | null;
  // Lookup from_snapshot_id → latest moat validation. Preloaded server-
  // side so toggling the "Desde" anchor hydrates the panel instantly
  // without re-running the AI.
  moatValidations: Record<number, MoatValidation>;
  // Position-level exit commitment. Read from the live `positions` row,
  // not from snapshots — snapshots don't freeze it, so we only know the
  // current text and the timestamp of the last edit.
  preCommitment: {
    text: string | null;
    editedAt: string | Date | null;
  };
}) {
  // snapshots arrive oldest → newest.
  const sorted = snapshots;
  const hasMultiple = sorted.length >= 2;

  // Defaults: Desde = compra (anchor anterior), Hasta = hoy (anchor actual).
  // Fallback to oldest/newest when anchors are unknown.
  const defaultFromId = buyId ?? sorted[0].id;
  const defaultToId = todayId ?? sorted[sorted.length - 1].id;

  const [fromId, setFromId] = useState<number>(defaultFromId);
  const [toId, setToId] = useState<number>(defaultToId);
  const [expanded, setExpanded] = useState(false);

  // Resolve into earlier/later by date so the diff reads chronologically
  // regardless of which radio the user touched.
  const { earlier, later } = useMemo(() => {
    const a = sorted.find((s) => s.id === fromId) ?? sorted[0];
    const b =
      sorted.find((s) => s.id === toId) ?? sorted[sorted.length - 1];
    return new Date(a.taken_at) <= new Date(b.taken_at)
      ? { earlier: a, later: b }
      : { earlier: b, later: a };
  }, [sorted, fromId, toId]);

  const sameSnapshot = fromId === toId;

  // Timeline ordered newest → oldest: HOY on top, COMPRA at bottom.
  // Intermediates live between them, collapsed by default.
  const reversed = useMemo(() => [...sorted].reverse(), [sorted]);
  const todayEntry =
    todayId != null ? reversed.find((s) => s.id === todayId) ?? null : null;
  const buyEntry =
    buyId != null ? reversed.find((s) => s.id === buyId) ?? null : null;
  const intermediates = reversed.filter(
    (s) => s.id !== todayId && s.id !== buyId,
  );

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-navy-900">
            Elige el rango a comparar
          </h3>
          <span className="text-xs text-navy-500">
            Por defecto: compra → hoy
          </span>
        </div>

        <ol className="space-y-2">
          {todayEntry && (
            <SelectorRow
              entry={todayEntry}
              role="today"
              transactionTypes={transactionTypes}
              fromId={fromId}
              setFromId={setFromId}
              toId={toId}
              setToId={setToId}
            />
          )}

          {intermediates.length > 0 && (
            <li>
              <IntermediatesBlock
                entries={intermediates}
                expanded={expanded}
                onToggle={() => setExpanded((v) => !v)}
                transactionTypes={transactionTypes}
                fromId={fromId}
                setFromId={setFromId}
                toId={toId}
                setToId={setToId}
              />
            </li>
          )}

          {buyEntry && buyEntry.id !== todayEntry?.id && (
            <SelectorRow
              entry={buyEntry}
              role="buy"
              transactionTypes={transactionTypes}
              fromId={fromId}
              setFromId={setFromId}
              toId={toId}
              setToId={setToId}
            />
          )}

          {/* Defensive fallback: no anchors identified at all (shouldn't
              happen for a live position, but keeps the selector usable if
              it does — e.g. legacy data with no "buy" row). */}
          {!todayEntry && !buyEntry &&
            reversed.map((s) => (
              <SelectorRow
                key={s.id}
                entry={s}
                role="intermediate"
                transactionTypes={transactionTypes}
                fromId={fromId}
                setFromId={setFromId}
                toId={toId}
                setToId={setToId}
              />
            ))}
        </ol>
      </section>

      {!hasMultiple ? (
        <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-navy-900">Comparación</h2>
          <p className="mt-2 text-sm text-navy-600">
            La evolución aparecerá con el próximo snapshot trimestral o la
            próxima operación.
          </p>
        </section>
      ) : sameSnapshot ? (
        <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-navy-900">Comparación</h2>
          <p className="mt-2 text-sm text-navy-600">
            Selecciona dos snapshots distintos (Desde / Hasta) para ver qué
            cambió.
          </p>
        </section>
      ) : (
        <DiffPanel
          earlier={earlier}
          later={later}
          positionId={positionId}
          ticker={ticker}
          existingMoatValidation={moatValidations[earlier.id] ?? null}
          preCommitment={preCommitment}
        />
      )}
    </div>
  );
}

type SelectorRole = "today" | "buy" | "intermediate";

// One row in the trajectory selector. `role` drives the visual weight:
// anchors (today / buy) render as prominent cards with a filled marker
// dot and bold label; intermediates render smaller and more muted. All
// rows share the same radio selection shape so Desde/Hasta can move to
// any point in the timeline.
function SelectorRow({
  entry,
  role,
  transactionTypes,
  fromId,
  setFromId,
  toId,
  setToId,
}: {
  entry: FundamentalsSnapshot;
  role: SelectorRole;
  transactionTypes: Record<number, TransactionType>;
  fromId: number;
  setFromId: (id: number) => void;
  toId: number;
  setToId: (id: number) => void;
}) {
  const isToday = role === "today";
  const isBuy = role === "buy";
  const isAnchor = isToday || isBuy;

  const marker = isToday
    ? "h-5 w-5 border-4 border-emerald-500 bg-white"
    : isBuy
      ? "h-5 w-5 border-4 border-navy-700 bg-white"
      : "ml-1 h-3 w-3 border-2 border-navy-300 bg-white";

  const card = isToday
    ? "border-emerald-200 bg-emerald-50/40"
    : isBuy
      ? "border-navy-200 bg-white shadow-sm"
      : "border-navy-100 bg-navy-50/30";

  const label = isToday
    ? "HOY"
    : isBuy
      ? "COMPRA"
      : triggerLabel(entry, transactionTypes);

  const labelClass = isAnchor
    ? "text-[11px] font-bold uppercase tracking-[0.18em] text-navy-900"
    : "text-[11px] font-medium uppercase tracking-wider text-navy-600";

  return (
    <li className="flex items-center gap-3">
      <span
        className={`inline-block flex-none rounded-full ${marker}`}
        aria-hidden
      />
      <div
        className={`flex flex-1 flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${card}`}
      >
        <div className="min-w-0 flex-1">
          <div className={labelClass}>{label}</div>
          <div className="mt-0.5 text-xs text-navy-500">
            {formatDate(entry.taken_at)}
          </div>
        </div>
        {entry.tier && (
          <span
            className={`inline-flex flex-none items-center rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ring-1 ${TIER_CLASSES[entry.tier]}`}
          >
            {TIER_LABEL[entry.tier]}
          </span>
        )}
        <div className="flex flex-none items-center gap-4">
          <RadioColumn
            label="Desde"
            name="trajectory-from"
            checked={fromId === entry.id}
            onChange={() => setFromId(entry.id)}
            ariaLabel={`Desde ${formatDate(entry.taken_at)}`}
          />
          <RadioColumn
            label="Hasta"
            name="trajectory-to"
            checked={toId === entry.id}
            onChange={() => setToId(entry.id)}
            ariaLabel={`Hasta ${formatDate(entry.taken_at)}`}
          />
        </div>
      </div>
    </li>
  );
}

function RadioColumn({
  label,
  name,
  checked,
  onChange,
  ariaLabel,
}: {
  label: string;
  name: string;
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <label className="flex cursor-pointer flex-col items-center gap-1">
      <span className="text-[10px] font-medium uppercase tracking-wider text-navy-500">
        {label}
      </span>
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel}
        className="h-4 w-4 cursor-pointer accent-navy-700"
      />
    </label>
  );
}

// Compact block for the operations between the two anchors. Hidden by
// default — Joseda's default view is compra → hoy, and unfolding the
// middle is explicit. The toggle reports the count so he knows what's in
// there before deciding to expand.
function IntermediatesBlock({
  entries,
  expanded,
  onToggle,
  transactionTypes,
  fromId,
  setFromId,
  toId,
  setToId,
}: {
  entries: FundamentalsSnapshot[];
  expanded: boolean;
  onToggle: () => void;
  transactionTypes: Record<number, TransactionType>;
  fromId: number;
  setFromId: (id: number) => void;
  toId: number;
  setToId: (id: number) => void;
}) {
  const count = entries.length;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-2 py-1 pl-9 text-xs font-medium text-navy-600 hover:text-navy-900"
      >
        <span aria-hidden className="inline-block w-3 text-center">
          {expanded ? "▾" : "▸"}
        </span>
        <span>
          {count}{" "}
          {count === 1
            ? "operación intermedia"
            : "operaciones intermedias"}
        </span>
      </button>
      {expanded && (
        <ol className="mt-2 space-y-2">
          {entries.map((e) => (
            <SelectorRow
              key={e.id}
              entry={e}
              role="intermediate"
              transactionTypes={transactionTypes}
              fromId={fromId}
              setFromId={setFromId}
              toId={toId}
              setToId={setToId}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function DiffPanel({
  earlier,
  later,
  positionId,
  ticker,
  existingMoatValidation,
  preCommitment,
}: {
  earlier: FundamentalsSnapshot;
  later: FundamentalsSnapshot;
  positionId: number;
  ticker: string;
  existingMoatValidation: MoatValidation | null;
  preCommitment: {
    text: string | null;
    editedAt: string | Date | null;
  };
}) {
  const diff = diffSnapshots(earlier, later);

  const methodChanged =
    earlier.valuation_method !== later.valuation_method &&
    (earlier.valuation_method !== null || later.valuation_method !== null);
  const buVersionChanged =
    earlier.business_understanding_version !==
      later.business_understanding_version &&
    earlier.business_understanding_version !== null &&
    later.business_understanding_version !== null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-navy-900">
          Cambios del {formatDate(earlier.taken_at)} al{" "}
          {formatDate(later.taken_at)}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {(() => {
            const span = spanLabel(earlier.taken_at, later.taken_at);
            return span ? (
              <span className="inline-flex items-center rounded-full border border-navy-100 bg-navy-50/60 px-2.5 py-1 text-xs font-medium text-navy-600">
                {span}
              </span>
            ) : null;
          })()}
          <PriceDeltaChip
            before={diff.price.before}
            after={diff.price.after}
            pctChange={diff.price.pct_change}
          />
        </div>
      </div>

      {/* Context note — when the AI business understanding was regenerated
          between the two snapshots the reader needs to know *before* they
          start comparing: the narrative frame isn't the same on both sides.
          Sits at the top for this reason. */}
      {buVersionChanged && (
        <div className="rounded-xl border border-navy-100 bg-navy-50/50 px-5 py-3">
          <p className="text-sm text-navy-700">
            {buNoteCopy(
              earlier.business_understanding_version,
              later.business_understanding_version,
            )}
          </p>
        </div>
      )}

      {/* Compromise (exit-thesis) card. Sits above Calidad because it's
          the first lens the user should read the diff through — "what did
          I say would make me exit?" — and because changes to it are
          themselves information. Read from the live positions row, since
          snapshots don't freeze the commitment. */}
      <CompromiseCard
        text={preCommitment.text}
        editedAt={preCommitment.editedAt}
        rangeStart={earlier.taken_at}
        rangeEnd={later.taken_at}
      />

      {/* Section 1 — Calidad del negocio (primary).
          Tier banner + Moat strength + per-dimension table. This is the
          section Joseda actually watches for deterioration, so it gets
          visual prominence and a dedicated banner when the tier changes. */}
      <section className="rounded-2xl border border-navy-100 bg-white shadow-sm">
        {/* Tier rides along the section header as a compact summary —
            it's two chips + a direction circle, which fits next to the
            section title without needing its own card. Frees the body
            below to give the moat a full-width card for its reasoning. */}
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-100 px-6 py-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-navy-500">
            Calidad del negocio
          </h3>
          <TierInline before={earlier.tier} after={later.tier} />
        </header>

        <div className="space-y-5 px-6 py-5">
          <MoatValidationPanel
            // Reset local state when the Desde anchor moves — the panel
            // has no effect (besides a fresh Claude call) tying it to a
            // specific `fromSnapshotId`, so the cleanest reset is to
            // remount on id change.
            key={earlier.id}
            positionId={positionId}
            ticker={ticker}
            fromSnapshotId={earlier.id}
            originalMoat={earlier.moat}
            originalRecordedAt={earlier.taken_at}
            existingValidation={existingMoatValidation}
          />

          <div>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-navy-500">
              Dimensiones aplicables
            </h4>
            <DimensionComparison earlier={earlier} later={later} />
          </div>
        </div>
      </section>

      {/* Section 2 — Valoración (secondary). IV, price, MoS, method.
          Not the deterioration-watch section — these move every day; the
          quality section above is what triggers a real thesis rethink. */}
      <section className="rounded-2xl border border-navy-100 bg-white shadow-sm">
        <header className="border-b border-navy-100 px-6 py-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-navy-500">
            Valoración
          </h3>
        </header>

        <div className="px-6 py-5">
          <ValuationToolGrid earlier={earlier} later={later} />
          {methodChanged && (
            <p className="mt-4 text-xs text-navy-500">
              Método base cambió:{" "}
              <span className="font-medium text-navy-700">
                {earlier.valuation_method
                  ? METHOD_LABEL[earlier.valuation_method]
                  : "—"}
              </span>{" "}
              →{" "}
              <span className="font-medium text-navy-700">
                {later.valuation_method
                  ? METHOD_LABEL[later.valuation_method]
                  : "—"}
              </span>
            </p>
          )}
        </div>
      </section>

    </div>
  );
}

// Plain-language copy for the "Claude reescribió tu resumen" note that sits
// above the comparison. Uses explicit wording instead of the version-diff
// shorthand ("v1 → v3") so the reader understands what happened between the
// two snapshots.
function buNoteCopy(
  earlierVersion: number | null,
  laterVersion: number | null,
): string {
  if (earlierVersion === null || laterVersion === null) return "";
  const regens = laterVersion - earlierVersion;
  if (regens <= 0) return "";
  const timesLabel = regens === 1 ? "1 vez" : `${regens} veces`;
  return `Entre estos dos puntos Claude reescribió tu resumen del negocio ${timesLabel} (v${earlierVersion} → v${laterVersion}).`;
}

// Inline tier summary rendered inside the Calidad section header. Kept to
// a single row of chips + a direction circle — no card frame, no label —
// so it reads as metadata of the section title, not as its own block.
// Severity semantics match TierPairCard's: landing in `poor` is the
// "outside the quality bar" signal that earns the red circle; every other
// downgrade is amber.
function TierInline({
  before,
  after,
}: {
  before: Tier | null;
  after: Tier | null;
}) {
  if (after === null) {
    return (
      <span className="text-xs text-navy-500">Sin tier en el snapshot</span>
    );
  }

  const direction: Direction | null =
    before === null
      ? null
      : TIER_RANK[after] > TIER_RANK[before]
        ? "improved"
        : TIER_RANK[after] < TIER_RANK[before]
          ? "worsened"
          : "maintained";

  const severe = after === "poor";

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-widest text-navy-500">
        Tier
      </span>
      {before && <TierChip tier={before} />}
      {before && (
        <span className="text-navy-400" aria-hidden>
          →
        </span>
      )}
      <TierChip tier={after} />
      <DirectionCircle direction={direction} severeWhenWorsened={severe} />
    </div>
  );
}

function TierChip({ tier }: { tier: Tier }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ring-1 ${TIER_CLASSES[tier]}`}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}

// Renders a grid of per-dimension comparison cards. Each card mirrors the
// visual language of the live Quality Scorecard (same ScorecardCard
// component) so antes/después reads in the same grammar Joseda already
// knows. Dimensions that are `neutral` in both snapshots are excluded
// (they don't apply to this business type); `debtToEquity` is excluded
// even when applicable because the numeric value isn't frozen on the
// snapshot.
// Valuation tools comparison grid. Iterates over the primary + secondary
// tools declared in the "Hasta" snapshot's valuation_guide and renders a
// dedicated card per tool with its antes→después values. "Interpret with
// care" tools are excluded — they're noise for the deterioration-watch
// purpose the trajectory serves.
function ValuationToolGrid({
  earlier,
  later,
}: {
  earlier: FundamentalsSnapshot;
  later: FundamentalsSnapshot;
}) {
  const guideLater = (later.valuation_guide ?? null) as StoredGuide | null;
  const guideEarlier = (earlier.valuation_guide ?? null) as StoredGuide | null;

  // Source of truth for which tools to show: the most recent guide.
  // Fall back to the earlier guide, then to a default "dcf-only" view so
  // there's always something useful to see.
  const primary = guideLater?.primary_tool ?? guideEarlier?.primary_tool ?? "dcf";
  const secondary =
    guideLater?.secondary_tool ?? guideEarlier?.secondary_tool ?? null;

  const earlierContext = buildToolContext(earlier);
  const laterContext = buildToolContext(later);

  const cards: ReactNode[] = [];
  const primaryCard = renderToolCard(
    primary,
    "primary",
    earlierContext,
    laterContext,
  );
  if (primaryCard) cards.push(primaryCard);
  if (secondary && secondary !== primary) {
    const secondaryCard = renderToolCard(
      secondary,
      "secondary",
      earlierContext,
      laterContext,
    );
    if (secondaryCard) cards.push(secondaryCard);
  }

  if (cards.length === 0) {
    return (
      <p className="text-sm text-navy-500">
        No hay guía de valoración disponible para comparar.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">{cards}</div>
  );
}

type StoredGuide = {
  primary_tool: ToolId;
  secondary_tool: ToolId | null;
  cautious_tool: ToolId | null;
  reasoning?: string;
};

type ToolId = "dcf" | "pe" | "pfcf" | "pb" | "cash_yield";

type DistributionMetric = {
  current: number | null;
  min: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  max: number | null;
};

type ToolContext = {
  takenAt: string;
  // Price at the time of the snapshot — the marker for absolute tools.
  price: number | null;
  // Bear / Base / Bull range from the valuation engine. All three may be
  // null when valuation failed to compute.
  iv: { low: number | null; base: number | null; high: number | null };
  // Pretty label for the absolute method that ran (Owner-earnings DCF,
  // AFFO DCF, Excess Returns, AI multiples). Null when valuation_method
  // was missing on the snapshot.
  absoluteMethodLabel: string | null;
  // Relative-method distributions. Null when the tool's distribution
  // wasn't computable at the time of the snapshot.
  pe: DistributionMetric | null;
  pfcf: DistributionMetric | null;
  pb: DistributionMetric | null;
  // Period covered by the relative distributions. Shared across pe / pfcf
  // / pb because they're computed from the same underlying history. Null
  // when the snapshot is legacy (saved before the period fields existed).
  relativePeriod: {
    start: string;
    end: string;
    years: number;
  } | null;
};

function buildToolContext(snapshot: FundamentalsSnapshot): ToolContext {
  const price =
    snapshot.current_price !== null ? Number(snapshot.current_price) : null;
  const ivLow =
    snapshot.valuation_intrinsic_value_low !== null
      ? Number(snapshot.valuation_intrinsic_value_low)
      : null;
  const ivBase =
    snapshot.valuation_intrinsic_value !== null
      ? Number(snapshot.valuation_intrinsic_value)
      : null;
  const ivHigh =
    snapshot.valuation_intrinsic_value_high !== null
      ? Number(snapshot.valuation_intrinsic_value_high)
      : null;

  // `valuation_assumptions` is JSONB on the snapshot (typed as unknown in
  // the FundamentalsSnapshot shape). Narrow it here to the relative_valuation
  // surface we care about; anything else we ignore.
  const assumptions = snapshot.valuation_assumptions as
    | { relative_valuation?: StoredRelativeSnapshot }
    | null;
  const rel = assumptions?.relative_valuation;

  const relativePeriod =
    rel?.period_start && rel?.period_end
      ? {
          start: rel.period_start,
          end: rel.period_end,
          years: rel.years_of_data ?? 0,
        }
      : null;

  return {
    takenAt: snapshot.taken_at,
    price,
    iv: { low: ivLow, base: ivBase, high: ivHigh },
    absoluteMethodLabel:
      snapshot.valuation_method !== null
        ? METHOD_LABEL[snapshot.valuation_method]
        : null,
    pe: readDistribution(rel?.pe),
    // Stored snapshot carries FCF yield (FCF/price) because yield is the
    // natural reporting form. Invert to P/FCF (price/FCF) so "lower =
    // cheaper" holds the same way as PE and P/B. Quartile labels also
    // swap — q1 of the yield becomes q3 of the multiple.
    pfcf: invertYieldDistribution(rel?.fcf_yield),
    pb: readDistribution(rel?.pb),
    relativePeriod,
  };
}

type StoredRelMetric = {
  current: number | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
  min: number | null;
  max: number | null;
  current_percentile: number | null;
};

type StoredRelativeSnapshot = {
  pe?: StoredRelMetric;
  fcf_yield?: StoredRelMetric;
  pb?: StoredRelMetric;
  period_start?: string;
  period_end?: string;
  years_of_data?: number;
};

function readDistribution(
  s: StoredRelMetric | undefined,
): DistributionMetric | null {
  if (!s || s.current === null) return null;
  return {
    current: s.current,
    min: s.min,
    q1: s.q1,
    median: s.median,
    q3: s.q3,
    max: s.max,
  };
}

function invertYieldDistribution(
  s: StoredRelMetric | undefined,
): DistributionMetric | null {
  if (!s || s.current === null) return null;
  const inv = (y: number | null) =>
    y === null || !Number.isFinite(y) || y === 0 ? null : 1 / y;
  return {
    current: inv(s.current),
    // Highest yield = lowest P/FCF, so the stored `max` becomes the
    // displayed `min` of the multiple distribution, and vice versa.
    min: inv(s.max),
    q1: inv(s.q3),
    median: inv(s.median),
    q3: inv(s.q1),
    max: inv(s.min),
  };
}

function renderToolCard(
  tool: ToolId,
  rank: "primary" | "secondary",
  earlier: ToolContext,
  later: ToolContext,
): ReactNode {
  switch (tool) {
    case "dcf":
      return (
        <AbsoluteToolCard
          key={`${rank}-${tool}`}
          rank={rank}
          // Use the actual method that ran on the Hasta snapshot (falls
          // back to the earlier one if Hasta wasn't computed). Keeps the
          // card title in the same English vocabulary the live Valuation
          // page uses — Owner-earnings DCF / AFFO DCF / Excess Returns /
          // AI multiples.
          label={
            later.absoluteMethodLabel ??
            earlier.absoluteMethodLabel ??
            "Intrinsic value"
          }
          earlier={earlier}
          later={later}
        />
      );
    case "pe":
      return (
        <RelativeToolCard
          key={`${rank}-${tool}`}
          rank={rank}
          label="PE ratio vs own history"
          unitSuffix="x"
          earlier={{ context: earlier, metric: earlier.pe }}
          later={{ context: later, metric: later.pe }}
        />
      );
    case "pfcf":
      return (
        <RelativeToolCard
          key={`${rank}-${tool}`}
          rank={rank}
          label="P/FCF vs own history"
          unitSuffix="x"
          earlier={{ context: earlier, metric: earlier.pfcf }}
          later={{ context: later, metric: later.pfcf }}
        />
      );
    case "pb":
      return (
        <RelativeToolCard
          key={`${rank}-${tool}`}
          rank={rank}
          label="P/B vs own history"
          unitSuffix="x"
          earlier={{ context: earlier, metric: earlier.pb }}
          later={{ context: later, metric: later.pb }}
        />
      );
    case "cash_yield":
      // Retired from the valuation toolkit in 2026-04-18; kept in the
      // ToolId union for legacy guide rows. If a guide still recommends
      // it, silently drop — the trajectory view is where the user looks
      // for actionable deltas, not legacy signals.
      return null;
  }
}

function AbsoluteToolCard({
  rank,
  label,
  earlier,
  later,
}: {
  rank: "primary" | "secondary";
  label: string;
  earlier: ToolContext;
  later: ToolContext;
}) {
  // Valuation in Moatboard is information, not a verdict — "cheaper"
  // isn't a green light without the quality thesis behind it. Card frame
  // stays neutral and no DirectionCircle is rendered; the user reads the
  // marker positions and makes the call. (Quality dimensions still get
  // semantic color; valuation deliberately does not.)
  const frame = "border-navy-100 bg-white";

  // Anchor points come from the Hasta snapshot's IV range — the most
  // recent estimate of what the business is worth at three hurdle rates.
  const anchors = [
    later.iv.low !== null ? { label: "Bear", value: later.iv.low } : null,
    later.iv.base !== null ? { label: "Base", value: later.iv.base } : null,
    later.iv.high !== null ? { label: "Bull", value: later.iv.high } : null,
  ].filter((a): a is { label: string; value: number } => a !== null);

  const hasMarkers = earlier.price !== null || later.price !== null;

  return (
    <div className={`rounded-xl border p-4 ${frame}`}>
      <ToolHeader rank={rank} label={label} />

      {anchors.length >= 2 && hasMarkers ? (
        <RangeBar
          anchors={anchors}
          markers={[
            earlier.price !== null
              ? {
                  label: formatShortDate(earlier.takenAt),
                  value: earlier.price,
                  variant: "earlier",
                }
              : null,
            later.price !== null
              ? {
                  label: formatShortDate(later.takenAt),
                  value: later.price,
                  variant: "later",
                }
              : null,
          ].filter(
            (m): m is {
              label: string;
              value: number;
              variant: "earlier" | "later";
            } => m !== null,
          )}
          format={formatMoney}
          markerLegend={{
            earlier: "Precio · Desde",
            later: "Precio · Hasta",
          }}
        />
      ) : (
        <p className="text-sm text-navy-500">
          Rango de valoración no disponible.
        </p>
      )}
    </div>
  );
}

function RelativeToolCard({
  rank,
  label,
  unitSuffix,
  earlier,
  later,
}: {
  rank: "primary" | "secondary";
  label: string;
  unitSuffix: string;
  earlier: { context: ToolContext; metric: DistributionMetric | null };
  later: { context: ToolContext; metric: DistributionMetric | null };
}) {
  const earlierCurrent = earlier.metric?.current ?? null;
  const laterCurrent = later.metric?.current ?? null;

  // Neutral frame — valuation is information, not a verdict (see
  // AbsoluteToolCard for the rationale).
  const frame = "border-navy-100 bg-white";

  if (!earlier.metric && !later.metric) {
    return (
      <div className="rounded-xl border border-navy-100 bg-white p-4">
        <ToolHeader rank={rank} label={label} />
        <p className="text-sm text-navy-500">
          Distribución no disponible en ninguno de los dos snapshots.
        </p>
      </div>
    );
  }

  // Distribution anchors come from the most recent snapshot with data;
  // fall back to the earlier if later didn't carry the tool.
  const source = later.metric ?? earlier.metric!;
  const anchors = [
    source.min !== null ? { label: "Min", value: source.min } : null,
    source.q1 !== null ? { label: "Q1", value: source.q1 } : null,
    source.median !== null ? { label: "Median", value: source.median } : null,
    source.q3 !== null ? { label: "Q3", value: source.q3 } : null,
    source.max !== null ? { label: "Max", value: source.max } : null,
  ].filter((a): a is { label: string; value: number } => a !== null);

  const fmt = (v: number) => `${v.toFixed(1)}${unitSuffix}`;

  // Prefer the later snapshot's period (most relevant distribution), fall
  // back to earlier if Hasta's didn't carry it. Legacy snapshots won't have
  // it at all — subtitle stays hidden in that case.
  const period =
    later.context.relativePeriod ?? earlier.context.relativePeriod;
  const periodLabel = period
    ? formatPeriodRange(period.start, period.end)
    : null;
  const periodSubtitle =
    period && periodLabel
      ? `${periodLabel} · ${period.years.toFixed(1)}y history`
      : null;

  return (
    <div className={`rounded-xl border p-4 ${frame}`}>
      <ToolHeader rank={rank} label={label} />
      {periodSubtitle && (
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-navy-500">
          {periodSubtitle}
        </p>
      )}

      {anchors.length >= 2 ? (
        <RangeBar
          anchors={anchors}
          markers={[
            earlierCurrent !== null
              ? {
                  label: formatShortDate(earlier.context.takenAt),
                  value: earlierCurrent,
                  variant: "earlier",
                }
              : null,
            laterCurrent !== null
              ? {
                  label: formatShortDate(later.context.takenAt),
                  value: laterCurrent,
                  variant: "later",
                }
              : null,
          ].filter(
            (m): m is {
              label: string;
              value: number;
              variant: "earlier" | "later";
            } => m !== null,
          )}
          format={fmt}
          markerLegend={{
            earlier: "Desde",
            later: "Hasta",
          }}
        />
      ) : (
        <p className="text-sm text-navy-500">
          Distribución sin suficientes puntos.
        </p>
      )}
    </div>
  );
}

function ToolHeader({
  rank,
  label,
}: {
  rank: "primary" | "secondary";
  label: string;
}) {
  // Intentionally no DirectionCircle on valuation tools — the whole
  // section is informational, the user reads the pins on the bar and
  // forms their own view. Only the rank chip (Primary/Secondary from the
  // AI Valuation Guide) and the method label are shown.
  return (
    <header className="mb-4 flex flex-wrap items-center gap-2">
      <span
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${rank === "primary" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-teal-50 text-teal-700 ring-teal-200"}`}
      >
        {rank === "primary" ? "Primary" : "Secondary"}
      </span>
      <h5 className="text-sm font-semibold text-navy-900">{label}</h5>
    </header>
  );
}

// Horizontal range bar with a highlighted band spanning the first→last
// anchors and two pin markers (earlier + later). The visual axis always
// expands to include the markers so values "off the historical range"
// still render honestly — a price above Bull, or a PE above its own Max,
// sits outside the band on its own, which is the signal the user wants.
function RangeBar({
  anchors,
  markers,
  format,
  markerLegend,
}: {
  anchors: Array<{ label: string; value: number }>;
  markers: Array<{ label: string; value: number; variant: "earlier" | "later" }>;
  format: (v: number) => string;
  markerLegend: { earlier: string; later: string };
}) {
  const anchorValues = anchors.map((a) => a.value);
  const markerValues = markers.map((m) => m.value);
  const all = [...anchorValues, ...markerValues];
  const rawMin = Math.min(...all);
  const rawMax = Math.max(...all);
  const range = rawMax - rawMin || 1;
  // 8% of range on each side so markers and labels don't sit on the edge.
  const pad = range * 0.08;
  const axisMin = rawMin - pad;
  const axisMax = rawMax + pad;
  const axisRange = axisMax - axisMin;

  const pctOf = (v: number) => ((v - axisMin) / axisRange) * 100;

  const bandStart = pctOf(anchors[0].value);
  const bandEnd = pctOf(anchors[anchors.length - 1].value);

  return (
    <div>
      {/* Bar with band + anchor ticks + markers */}
      <div className="relative mt-1 pt-4 pb-3">
        {/* Track */}
        <div className="relative h-2 rounded-full bg-navy-100">
          {/* Emphasised band between first and last anchor */}
          <div
            className="absolute top-0 h-full rounded-full bg-navy-200"
            style={{
              left: `${bandStart}%`,
              width: `${Math.max(0, bandEnd - bandStart)}%`,
            }}
          />

          {/* Anchor tick marks (small vertical lines) */}
          {anchors.map((a) => (
            <div
              key={`tick-${a.label}`}
              className="absolute top-[-4px] h-[16px] w-px bg-navy-400"
              style={{ left: `${pctOf(a.value)}%` }}
              aria-hidden
            />
          ))}

          {/* Markers */}
          {markers.map((m) => (
            <RangeMarker
              key={`marker-${m.variant}`}
              pctLeft={pctOf(m.value)}
              variant={m.variant}
            />
          ))}
        </div>

        {/* Anchor labels below the track */}
        <div className="relative mt-2 h-7">
          {anchors.map((a) => (
            <div
              key={`lbl-${a.label}`}
              className="absolute -translate-x-1/2 text-center"
              style={{ left: `${pctOf(a.value)}%` }}
            >
              <div className="text-[10px] uppercase tracking-wider text-navy-500">
                {a.label}
              </div>
              <div className="text-[11px] font-medium tabular-nums text-navy-700">
                {format(a.value)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Legend + marker values */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-navy-100 pt-3">
        {markers.map((m) => (
          <div key={`legend-${m.variant}`} className="flex items-center gap-2">
            <MarkerDot variant={m.variant} />
            <div className="text-xs">
              <div className="text-[10px] uppercase tracking-wider text-navy-500">
                {m.variant === "earlier"
                  ? markerLegend.earlier
                  : markerLegend.later}
              </div>
              <div className="text-sm font-semibold text-navy-900 tabular-nums">
                {format(m.value)}
              </div>
              <div className="text-[10px] text-navy-500">{m.label}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RangeMarker({
  pctLeft,
  variant,
}: {
  pctLeft: number;
  variant: "earlier" | "later";
}) {
  // Pin stays within 0–100 of the bar width; axis padding already includes
  // markers in its range, so clamping here is a defensive no-op most of
  // the time.
  const left = Math.max(0, Math.min(100, pctLeft));
  // "Desde" = hollow (outlined navy), "Hasta" = solid navy. Both in the
  // same hue on purpose — valuation markers shouldn't imply better/worse,
  // only earlier/later.
  const outlineClass =
    variant === "earlier"
      ? "border-navy-700 bg-white"
      : "border-navy-900 bg-navy-900";
  return (
    <div
      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${left}%` }}
    >
      <div
        className={`h-3.5 w-3.5 rounded-full border-[2.5px] shadow-sm ${outlineClass}`}
        aria-hidden
      />
    </div>
  );
}

function MarkerDot({ variant }: { variant: "earlier" | "later" }) {
  const cls =
    variant === "earlier"
      ? "border-navy-700 bg-white"
      : "border-navy-900 bg-navy-900";
  return (
    <span
      className={`inline-block h-3 w-3 flex-none rounded-full border-[2px] ${cls}`}
      aria-hidden
    />
  );
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function DimensionComparison({
  earlier,
  later,
}: {
  earlier: FundamentalsSnapshot;
  later: FundamentalsSnapshot;
}) {
  const earlierCards = buildSnapshotDimensionCards(earlier);
  const laterCards = buildSnapshotDimensionCards(later);

  // Pair cards by stable key. If a dimension only exists on one side (rare:
  // business classification changed between snapshots), skip it — an
  // unpaired comparison has no direction to signal.
  const byKey = new Map<
    string,
    { earlier?: DimensionCard; later?: DimensionCard }
  >();
  for (const c of earlierCards) byKey.set(c.key, { earlier: c });
  for (const c of laterCards) {
    const prev = byKey.get(c.key) ?? {};
    byKey.set(c.key, { ...prev, later: c });
  }

  const pairs = Array.from(byKey.entries())
    .map(([key, p]) => ({ key, earlier: p.earlier, later: p.later }))
    .filter(
      (p): p is { key: string; earlier: DimensionCard; later: DimensionCard } =>
        !!p.earlier && !!p.later,
    );

  if (pairs.length === 0) {
    return (
      <p className="text-sm text-navy-500">
        Sin dimensiones comparables entre los dos snapshots.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {pairs.map((p) => (
        <DimensionPairCard
          key={p.key}
          earlier={p.earlier}
          later={p.later}
          earlierDateLabel={formatShortDate(earlier.taken_at)}
          laterDateLabel={formatShortDate(later.taken_at)}
        />
      ))}
    </div>
  );
}

function DimensionPairCard({
  earlier,
  later,
  earlierDateLabel,
  laterDateLabel,
}: {
  earlier: DimensionCard;
  later: DimensionCard;
  earlierDateLabel: string;
  laterDateLabel: string;
}) {
  const direction = compareQuality(earlier.quality, later.quality);
  const severe = later.quality === "weak";

  // Frame emphasis mirrors the Quality Scorecard's language: red frame when
  // the dimension just dropped into weak (the algorithm's "this is a
  // concern now" signal), amber when it deteriorated but stayed scored,
  // emerald when it improved, navy-neutral when the Quality label stayed
  // put (including value-only changes inside the same band).
  const frame =
    direction === "worsened" && severe
      ? "border-red-200 bg-red-50/50"
      : direction === "worsened"
        ? "border-amber-200 bg-amber-50/40"
        : direction === "improved"
          ? "border-emerald-200 bg-emerald-50/40"
          : "border-navy-100 bg-white";

  return (
    <div className={`rounded-xl border p-4 ${frame}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h5 className="text-sm font-semibold text-navy-900">{earlier.label}</h5>
        <DirectionBadge direction={direction} severeWhenWorsened={severe} />
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
        <ScorecardCard
          compact
          label={earlierDateLabel}
          value={earlier.value}
          hint={earlier.hint}
          quality={earlier.quality}
        />
        <span className="self-center text-navy-400">→</span>
        <ScorecardCard
          compact
          label={laterDateLabel}
          value={later.value}
          hint={later.hint}
          quality={later.quality}
        />
      </div>
    </div>
  );
}

function formatShortDate(value: string | Date): string {
  try {
    const d = value instanceof Date ? value : new Date(value);
    return d.toLocaleDateString("es-ES", {
      year: "2-digit",
      month: "short",
      day: "numeric",
    });
  } catch {
    return typeof value === "string" ? value.slice(0, 10) : String(value);
  }
}

// "Mar 2019 – Apr 2026" — matches the subtitle used on the main Valuation
// section so the reader sees the same period format in both surfaces.
// Returns null when the dates don't parse.
function formatPeriodRange(start: string, end: string): string | null {
  const s = new Date(start);
  const e = new Date(end);
  if (!Number.isFinite(s.getTime()) || !Number.isFinite(e.getTime())) {
    return null;
  }
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return `${fmt(s)} – ${fmt(e)}`;
}

// Bare circular indicator — just the glyph in a colored circle. Reusable
// primitive for any before→after comparison that needs a quick visual cue
// without the "mejora/empeora" text tail. Tier-in-header, moat verdict,
// dimension card all compose over this.
function DirectionCircle({
  direction,
  severeWhenWorsened,
}: {
  direction: Direction | null;
  severeWhenWorsened?: boolean;
}) {
  if (direction === null) return null;

  if (direction === "maintained") {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-emerald-300 bg-emerald-100 text-xs font-semibold leading-none text-emerald-700"
        aria-label="Sin cambios"
        title="Sin cambios"
      >
        ✓
      </span>
    );
  }

  const icon = direction === "improved" ? "↑" : severeWhenWorsened ? "⚠" : "↓";
  const chipBg =
    direction === "improved"
      ? "bg-emerald-500"
      : severeWhenWorsened
        ? "bg-red-500"
        : "bg-amber-500";
  const title =
    direction === "improved"
      ? "Mejora"
      : severeWhenWorsened
        ? "Empeora · bajó a weak"
        : "Empeora";

  return (
    <span
      className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold leading-none text-white ${chipBg}`}
      aria-hidden
      title={title}
    >
      {icon}
    </span>
  );
}

// Visual indicator for a dimension's before→after change. Core piece is a
// DirectionCircle with a short text tail for "mejora / empeora"; the text
// is dropped on "maintained" so the page stays calm when 9 out of 10
// metrics didn't move. See propuesta agreed 2026-04-20.
function DirectionBadge({
  direction,
  severeWhenWorsened,
}: {
  direction: Direction | null;
  severeWhenWorsened?: boolean;
}) {
  if (direction === null) return <span className="w-[96px]" aria-hidden />;

  if (direction === "maintained") {
    return (
      <span className="inline-flex w-[96px] items-center justify-end">
        <DirectionCircle direction={direction} />
      </span>
    );
  }

  const label = direction === "improved" ? "mejora" : "empeora";
  const textTone =
    direction === "improved"
      ? "text-emerald-700"
      : severeWhenWorsened
        ? "text-red-700"
        : "text-amber-700";

  return (
    <span className="inline-flex w-[96px] items-center justify-end gap-1.5">
      <DirectionCircle
        direction={direction}
        severeWhenWorsened={severeWhenWorsened}
      />
      <span className={`text-xs font-medium ${textTone}`}>{label}</span>
    </span>
  );
}

function compareQuality(before: Quality, after: Quality): Direction {
  const rb = QUALITY_RANK[before];
  const ra = QUALITY_RANK[after];
  if (ra > rb) return "improved";
  if (ra < rb) return "worsened";
  return "maintained";
}

// Compact header chip with the market-price delta over the selected range.
// Deliberately styled in navy (no emerald/red) because price movement is
// not a quality signal — it's a market fact Moatboard surfaces for context
// without endorsing it as "good" or "bad". The arrow gives direction; the
// color stays neutral so the user reads the number, not the tone.
// Exit-commitment card. Shows the current text of the user's
// `pre_commitment_md` as the lens through which they should read the
// diff, and flags — in an amber chip — when the commitment itself was
// edited during the selected range. Chip tone is intentionally muted
// (amber, not red): a revised thesis isn't necessarily wrong, but it's
// information the user should register before drawing conclusions from
// the rest of the diff.
function CompromiseCard({
  text,
  editedAt,
  rangeStart,
  rangeEnd,
}: {
  text: string | null;
  editedAt: string | Date | null;
  rangeStart: string | Date;
  rangeEnd: string | Date;
}) {
  const editedAtIso = editedAt ? normaliseToIso(editedAt) : null;
  const rangeStartMs = new Date(normaliseToIso(rangeStart)).getTime();
  const rangeEndMs = new Date(normaliseToIso(rangeEnd)).getTime();
  const editedMs = editedAtIso ? new Date(editedAtIso).getTime() : null;

  // Revised "inside the range" = edited AFTER the Desde snapshot and at
  // or before the Hasta snapshot. Strict `>` on Desde avoids counting the
  // initial commitment at purchase time (which lands on the buy snapshot's
  // timestamp) as a revision.
  const revisedInRange =
    editedMs !== null && editedMs > rangeStartMs && editedMs <= rangeEndMs;

  if (!text) {
    return (
      <section className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm">
        <header className="mb-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-navy-500">
            Compromiso de salida
          </h3>
        </header>
        <p className="text-sm text-navy-500">
          Aún no has definido un compromiso de salida para esta posición.
          Edítalo desde la ficha para tenerlo a la vista cuando revises la
          evolución.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-navy-100 bg-white p-5 shadow-sm">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-navy-500">
          Compromiso de salida
        </h3>
        {revisedInRange && editedAtIso && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700">
            <span aria-hidden>↻</span>
            Revisado el {formatShortDateCompromise(editedAtIso)}
          </span>
        )}
      </header>

      <blockquote className="border-l-2 border-navy-200 pl-4 text-sm leading-relaxed text-navy-800 whitespace-pre-line">
        {text}
      </blockquote>

      {editedAtIso && !revisedInRange && (
        <p className="mt-3 text-[11px] text-navy-500">
          Última edición: {formatShortDateCompromise(editedAtIso)} · sin
          revisiones entre los snapshots comparados.
        </p>
      )}
    </section>
  );
}

function normaliseToIso(value: string | Date): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function formatShortDateCompromise(value: string): string {
  try {
    const d = new Date(value);
    return d.toLocaleDateString("es-ES", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return value.slice(0, 10);
  }
}

function PriceDeltaChip({
  before,
  after,
  pctChange,
}: {
  before: number | null;
  after: number | null;
  pctChange: number | null;
}) {
  if (before === null || after === null) return null;
  const arrow = pctChange === null || pctChange === 0 ? "·" : pctChange > 0 ? "↑" : "↓";
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-navy-100 bg-navy-50/60 px-2.5 py-1 text-xs font-medium text-navy-700">
      <span className="uppercase tracking-wider text-[10px] text-navy-500">
        Precio
      </span>
      <span className="tabular-nums text-navy-800">
        ${before.toFixed(2)}
      </span>
      <span className="text-navy-400" aria-hidden>
        →
      </span>
      <span className="tabular-nums font-semibold text-navy-900">
        ${after.toFixed(2)}
      </span>
      {pctChange !== null && (
        <span className="inline-flex items-center gap-0.5 text-navy-600">
          <span aria-hidden>{arrow}</span>
          <span className="tabular-nums">{formatSignedPct(pctChange)}</span>
        </span>
      )}
    </span>
  );
}

// Returns null when the two snapshots fall on the same calendar day —
// the "mismo día" badge doesn't add signal (typical of a brand-new buy
// compared against today) and ends up being visual noise.
function spanLabel(a: string, b: string): string | null {
  const d1 = new Date(a).getTime();
  const d2 = new Date(b).getTime();
  const days = Math.max(0, Math.round((d2 - d1) / (1000 * 60 * 60 * 24)));
  if (days < 1) return null;
  if (days === 1) return "1 día";
  if (days < 60) return `${days} días`;
  const months = Math.round(days / 30);
  if (months < 24) return `${months} meses`;
  const years = (days / 365).toFixed(1);
  return `${years} años`;
}
