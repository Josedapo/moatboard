import type { Tier } from "@/lib/verdict";

const BUSINESS_TIER_CHIP: Record<
  Tier,
  { label: string; chip: string; dot: string }
> = {
  exceptional: {
    label: "Exceptional",
    chip: "bg-emerald-500/10 text-emerald-700",
    dot: "bg-emerald-700",
  },
  good: {
    label: "Good",
    chip: "bg-teal-500/10 text-teal-700",
    dot: "bg-teal-700",
  },
  mediocre: {
    label: "Mediocre",
    chip: "bg-amber-500/10 text-amber-700",
    dot: "bg-amber-700",
  },
  poor: {
    label: "Poor",
    chip: "bg-red-500/10 text-red-700",
    dot: "bg-red-700",
  },
};

export function BusinessTierChip({
  tier,
  notCoveredReason = null,
}: {
  tier: Tier | null;
  // When non-null and tier is null, render "no soportado" italic with
  // a tooltip — distinguishes "framework ran and rejected (SEC <5y,
  // <5 applicable dimensions, etc.)" from "nobody has looked at this
  // yet".
  notCoveredReason?: string | null;
}) {
  if (!tier) {
    if (notCoveredReason) {
      return (
        <span
          className="text-xs italic text-navy-400"
          title={notCoveredReason}
        >
          no soportado
        </span>
      );
    }
    return <span className="text-xs italic text-navy-300">—</span>;
  }
  const style = BUSINESS_TIER_CHIP[tier];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.chip}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  );
}

// Implied-return verdict — collapsed to binary Comprable / No comprable
// for at-a-glance scanning in list views (watchlist, future history).
// The full reason (caro / riesgo / ambos) lives in the title attribute
// for hover, and the calculator's Conclusión zone shows the verbose
// label. Color logic mirrors the calculator: emerald positive, amber
// negative — never red, anti-trading principle.
export type ValuationVerdict =
  | "comprable"
  | "no_comprable_caro"
  | "no_comprable_riesgo"
  | "no_comprable_ambos";

const VERDICT_TITLE: Record<ValuationVerdict, string> = {
  comprable: "Comprable a este precio",
  no_comprable_caro: "No comprable — precio caro para la calidad",
  no_comprable_riesgo: "No comprable — riesgo asimétrico",
  no_comprable_ambos: "No comprable — precio y riesgo no compensan",
};

export function ValuationVerdictChip({
  verdict,
}: {
  verdict: ValuationVerdict | null;
}) {
  if (!verdict) {
    return <span className="text-xs italic text-navy-300">—</span>;
  }
  const isBuyable = verdict === "comprable";
  const label = isBuyable ? "Comprable" : "No comprable";
  const chip = isBuyable
    ? "bg-emerald-500/10 text-emerald-700"
    : "bg-amber-500/10 text-amber-700";
  const dot = isBuyable ? "bg-emerald-700" : "bg-amber-700";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${chip}`}
      title={VERDICT_TITLE[verdict]}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

export function FlagsBadge({
  analyzed,
  serious,
  watch,
  withLabels = false,
}: {
  analyzed: boolean;
  serious: number;
  watch: number;
  withLabels?: boolean;
}) {
  if (!analyzed) {
    return <span className="text-xs italic text-navy-300">—</span>;
  }
  if (serious === 0 && watch === 0) {
    return <span className="text-xs italic text-navy-400">sin flags</span>;
  }
  return (
    <span className="inline-flex items-center gap-2.5 text-xs tabular-nums">
      {serious > 0 && (
        <span
          className="inline-flex items-center gap-1 text-red-700"
          title={`${serious} red flag${serious === 1 ? "" : "s"} grave${serious === 1 ? "" : "s"}`}
        >
          <SeriousFlagIcon />
          <span className="font-semibold">{serious}</span>
          {withLabels && (
            <span className="font-normal text-red-700/80">
              {serious === 1 ? "grave" : "graves"}
            </span>
          )}
        </span>
      )}
      {watch > 0 && (
        <span
          className="inline-flex items-center gap-1 text-navy-600"
          title={`${watch} flag${watch === 1 ? "" : "s"} a vigilar`}
        >
          <WatchFlagIcon />
          <span className="font-medium">{watch}</span>
          {withLabels && (
            <span className="font-normal text-navy-500">a vigilar</span>
          )}
        </span>
      )}
    </span>
  );
}

function SeriousFlagIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8 1.8l7 12.4H1L8 1.8z" />
      <line x1="8" y1="6.5" x2="8" y2="10" strokeLinecap="round" />
      <circle cx="8" cy="12.2" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}

function WatchFlagIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden
    >
      <circle cx="8" cy="8" r="5" />
      <circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
