// Primary multiple selection — picks which P/X distribution drives the
// implied-return verdict for a given business.
//
// Selection rule:
//   1. AI valuation guide's primary_tool when available and valid
//      ('pe' | 'pfcf' | 'pb'). The same multiple the user sees as
//      "Primary" in the Valuation toolkit, so the implied-return verdict
//      is consistent with what we tell them is the most informative tool.
//   2. Fallback to deterministic business-type dispatch when the guide is
//      missing, stale, or recommends a non-multiple tool ('dcf' / 'cash_yield'):
//        - balance-sheet business (banks, insurers, mortgage REITs) → P/B
//        - real-estate (equity REITs)                              → P/FCF
//        - product business (default)                              → P/FCF
//
// The selected snapshot is normalized to a unit-agnostic { current, median, q1 }
// where lower = cheaper. P/FCF is derived by inverting the persisted yield
// snapshot (1/yield) — see note below on the median(1/x) ≠ 1/median(x) caveat.
//
// Returns null when no usable snapshot exists in either path.

import type { ValuationGuide } from "@/lib/valuationGuides";
import type { ToolId } from "@/lib/valuationGuideAi";
import type {
  RelativeMetricSnapshot,
  RelativeValuationSnapshot,
} from "@/lib/valuations";
import type { MultipleSnapshot } from "@/lib/impliedReturn";
import { isBalanceSheetBusiness, isRealEstate } from "@/lib/scorecard";

export type PrimaryMultipleLabel = "P/E" | "P/FCF" | "P/B";
export type PrimaryMultipleSource = "ai_guide" | "deterministic_fallback";

export type PrimaryMultipleSelection = {
  snapshot: MultipleSnapshot;
  label: PrimaryMultipleLabel;
  source: PrimaryMultipleSource;
  // The full quartile picture — kept so the UI can show "27.5x mediana,
  // 18.2x Q1" without needing the raw RelativeMetricSnapshot.
  current: number | null;
  median: number | null;
  q1: number | null;
};

export function selectPrimaryMultipleSnapshot({
  guide,
  relative,
  sector,
  industry,
}: {
  guide: ValuationGuide | null;
  relative: RelativeValuationSnapshot | undefined;
  sector: string | null;
  industry: string | null;
}): PrimaryMultipleSelection | null {
  if (!relative) return null;

  // Step 1 — try AI guide.
  const guideTool: ToolId | null = guide?.primary_tool ?? null;
  if (guideTool && (guideTool === "pe" || guideTool === "pfcf" || guideTool === "pb")) {
    const fromGuide = pickByTool(guideTool, relative);
    if (fromGuide) {
      return { ...fromGuide, source: "ai_guide" };
    }
    // Guide recommended a tool whose snapshot is unusable — fall through.
  }

  // Step 2 — deterministic dispatch by business type.
  const deterministic = pickDeterministic(relative, sector, industry);
  if (deterministic) {
    return { ...deterministic, source: "deterministic_fallback" };
  }

  // Step 3 — last resort: PE if present, else null.
  const fromPe = pickByTool("pe", relative);
  if (fromPe) return { ...fromPe, source: "deterministic_fallback" };

  return null;
}

function pickDeterministic(
  relative: RelativeValuationSnapshot,
  sector: string | null,
  industry: string | null,
): Omit<PrimaryMultipleSelection, "source"> | null {
  if (isBalanceSheetBusiness(sector, industry)) {
    const pb = pickByTool("pb", relative);
    if (pb) return pb;
    // Bank/insurer with broken P/B (negative equity, missing data) — fall
    // back to P/E as the next-best balance-sheet proxy.
    const pe = pickByTool("pe", relative);
    if (pe) return pe;
    return null;
  }
  if (isRealEstate(sector)) {
    // P/AFFO would be ideal here; until we persist that snapshot, P/FCF
    // is the closest proxy (FCF ≈ AFFO for equity REITs in practice).
    const pfcf = pickByTool("pfcf", relative);
    if (pfcf) return pfcf;
    return pickByTool("pe", relative);
  }
  // Default: product business — P/FCF preferred over P/E because SBC and
  // capex make earnings noisy for mega-cap compounders.
  const pfcf = pickByTool("pfcf", relative);
  if (pfcf) return pfcf;
  return pickByTool("pe", relative);
}

function pickByTool(
  tool: "pe" | "pfcf" | "pb",
  relative: RelativeValuationSnapshot,
): Omit<PrimaryMultipleSelection, "source"> | null {
  if (tool === "pe") {
    const pe = relative.pe;
    if (!isUsable(pe)) return null;
    return {
      label: "P/E",
      snapshot: { current: pe.current, median: pe.median, q1: pe.q1 },
      current: pe.current,
      median: pe.median,
      q1: pe.q1,
    };
  }
  if (tool === "pb") {
    const pb = relative.pb;
    if (!pb || !isUsable(pb)) return null;
    return {
      label: "P/B",
      snapshot: { current: pb.current, median: pb.median, q1: pb.q1 },
      current: pb.current,
      median: pb.median,
      q1: pb.q1,
    };
  }
  // pfcf — invert FCF yield snapshot to a P/FCF multiple.
  // Note: median(1/x) ≠ 1/median(x) in general. For our purposes we treat
  // 1/yield_median as a proxy for the median P/FCF, accepting that the
  // ordering is preserved (cheap stays cheap, expensive stays expensive)
  // and the magnitude is close enough on the typical FCF-yield distribution.
  // q1 of the multiple = 1/q3 of the yield (cheap multiple = high yield).
  const fcfYield = relative.fcf_yield;
  if (!fcfYield) return null;
  const current =
    fcfYield.current !== null && fcfYield.current > 0
      ? 1 / fcfYield.current
      : null;
  const median =
    fcfYield.median !== null && fcfYield.median > 0
      ? 1 / fcfYield.median
      : null;
  // q1 of P/FCF (cheap end) corresponds to q3 of yield (high yield).
  const q1 =
    fcfYield.q3 !== null && fcfYield.q3 > 0 ? 1 / fcfYield.q3 : null;
  if (current === null || median === null || q1 === null) return null;
  return {
    label: "P/FCF",
    snapshot: { current, median, q1 },
    current,
    median,
    q1,
  };
}

function isUsable(s: RelativeMetricSnapshot | undefined | null): boolean {
  return (
    !!s &&
    s.current !== null &&
    s.median !== null &&
    s.q1 !== null &&
    s.current > 0 &&
    s.median > 0 &&
    s.q1 > 0
  );
}
