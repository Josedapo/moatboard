// Pure classification: given a SEC filing, decide whether it generates
// a review_signals row and with what severity + event_type. No DB, no
// network, no LLM — fully deterministic by form + Item codes. Lives
// apart from `secFilings.ts` so it can be unit-tested without touching
// SEC or Neon.

export type SignalSource =
  | "sec_8k"
  | "sec_10q"
  | "sec_10k"
  | "sec_10qa"
  | "sec_10ka";

export type SignalSeverity = "floor" | "material" | "informational";

// Event types emitted to the UI. Kept as a closed union so the frontend
// can map them to labels + icons exhaustively. Adding a new one here
// requires also adding it to the EVENT_TYPE_LABELS map in the UI.
export type SignalEventType =
  | "earnings_release" // 10-Q or 10-K
  | "earnings_restatement" // 10-Q/A or 10-K/A
  | "material_agreement" // 8-K 1.01 / 1.02
  | "bankruptcy" // 8-K 1.03
  | "cyber_incident" // 8-K 1.05
  | "ma_completion" // 8-K 2.01
  | "debt_event" // 8-K 2.03 / 2.04
  | "restructuring" // 8-K 2.05
  | "impairment" // 8-K 2.06
  | "delisting" // 8-K 3.01
  | "equity_dilution" // 8-K 3.02
  | "auditor_change" // 8-K 4.01
  | "financial_restatement" // 8-K 4.02
  | "management_change" // 8-K 5.02
  | "bylaws_amendment" // 8-K 5.03
  | "fd_disclosure" // 8-K 7.01
  | "other_material"; // 8-K 8.01

export type ClassifiedSignal = {
  source: SignalSource;
  eventType: SignalEventType;
  severity: SignalSeverity;
};

// 8-K Items that emit a signal. `silenced` = Items we recognise but
// deliberately drop (2.02 earnings attached to 10-Q, 5.07 routine vote,
// 9.01 exhibits). Anything not listed here returns null = ignore.
//
// Item codes follow SEC format "1.01", "5.02", etc. Some filings list
// them as "Item 1.01" or "1.01 Entry into a Material Agreement". The
// parser normalises to the numeric prefix before lookup.
const ITEM_MAP: Record<
  string,
  { eventType: SignalEventType; severity: SignalSeverity } | "silenced"
> = {
  "1.01": { eventType: "material_agreement", severity: "material" },
  "1.02": { eventType: "material_agreement", severity: "material" },
  "1.03": { eventType: "bankruptcy", severity: "material" },
  "1.05": { eventType: "cyber_incident", severity: "material" },
  "2.01": { eventType: "ma_completion", severity: "material" },
  "2.02": "silenced", // earnings — covered by 10-Q/10-K floor
  "2.03": { eventType: "debt_event", severity: "material" },
  "2.04": { eventType: "debt_event", severity: "material" },
  "2.05": { eventType: "restructuring", severity: "material" },
  "2.06": { eventType: "impairment", severity: "material" },
  "3.01": { eventType: "delisting", severity: "material" },
  "3.02": { eventType: "equity_dilution", severity: "material" },
  "4.01": { eventType: "auditor_change", severity: "material" },
  "4.02": { eventType: "financial_restatement", severity: "material" },
  "5.02": { eventType: "management_change", severity: "material" },
  "5.03": { eventType: "bylaws_amendment", severity: "informational" },
  "5.07": "silenced", // routine shareholder vote
  "7.01": { eventType: "fd_disclosure", severity: "informational" },
  "8.01": { eventType: "other_material", severity: "informational" },
  "9.01": "silenced", // exhibits
};

// Classify a single filing. `form` is the SEC form type as returned by
// `/submissions/CIK...json` (e.g. "10-Q", "10-K", "10-K/A", "8-K").
// `items` is the comma-separated string for 8-Ks or empty/undefined
// for other forms (same source field).
//
// Returns null when the filing doesn't warrant a signal. When the
// filing is an 8-K with multiple Items, returns the HIGHEST severity
// classification — one row per filing, not per Item.
export function classifyFiling({
  form,
  items,
}: {
  form: string;
  items?: string | null;
}): ClassifiedSignal | null {
  const f = form.trim().toUpperCase();

  if (f === "10-Q") {
    return {
      source: "sec_10q",
      eventType: "earnings_release",
      severity: "floor",
    };
  }
  if (f === "10-K") {
    return {
      source: "sec_10k",
      eventType: "earnings_release",
      severity: "floor",
    };
  }
  if (f === "10-Q/A") {
    return {
      source: "sec_10qa",
      eventType: "earnings_restatement",
      severity: "material",
    };
  }
  if (f === "10-K/A") {
    return {
      source: "sec_10ka",
      eventType: "earnings_restatement",
      severity: "material",
    };
  }
  if (f === "8-K" || f === "8-K/A") {
    if (!items || !items.trim()) return null;
    return classify8k(items);
  }
  return null;
}

// 8-K Items come as a comma-separated string like "5.02,7.01" or
// sometimes with stray prefixes ("Item 5.02, Item 7.01"). Tolerant
// parse: strip whitespace + "Item " prefix, split on commas/semicolons,
// match each to the map, return the strongest classification found.
function classify8k(itemsRaw: string): ClassifiedSignal | null {
  const parts = itemsRaw
    .split(/[,;]/)
    .map((p) =>
      p
        .replace(/item\s+/i, "")
        .trim()
        .replace(/[^0-9.]/g, ""),
    )
    .filter((p) => p.length > 0);

  let best: { eventType: SignalEventType; severity: SignalSeverity } | null =
    null;
  for (const code of parts) {
    const entry = ITEM_MAP[code];
    if (!entry || entry === "silenced") continue;
    if (!best || severityRank(entry.severity) > severityRank(best.severity)) {
      best = entry;
    }
  }

  if (!best) return null;
  return {
    source: "sec_8k",
    eventType: best.eventType,
    severity: best.severity,
  };
}

function severityRank(s: SignalSeverity): number {
  return s === "material" ? 3 : s === "floor" ? 2 : 1;
}
