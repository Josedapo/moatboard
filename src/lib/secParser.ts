// SEC XBRL parser — Session 2 of the SEC EDGAR integration.
//
// Input:  raw companyfacts JSON (see src/lib/sec.ts → SecCompanyFacts)
// Output: Array<AnnualFundamentalRow> + parse_notes (per-field tag trace)
//
// The shape is identical to what yfinance's fetchMultiYearFundamentals
// produces, so downstream scorecard.ts/valuation.ts/relativeValuation.ts
// consume SEC data as a drop-in replacement in Session 3. Sign conventions
// match yfinance: capex / buybacks / dividends are stored as negative
// outflows even though SEC reports them as positive cash outflows.
//
// The period-length heuristic (350-380 days) filters out quarterly
// comparatives that SEC includes in 10-K filings (see plan §1.6 gotcha #1).
// Dedup picks the record with the most recent `filed` date per period-end
// (gotcha #2). The revenue chain handles ASC 606 tag turnover (gotcha #3).
// The NetIncome chain handles WAT's ProfitLoss-era reporting (gotcha #4).

import type { AnnualFundamentalRow } from "@/lib/financial";
import type { SecCompanyFacts } from "@/lib/sec";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FieldTrace = {
  tagsAttempted: string[];
  tagsUsed: string[]; // tags that contributed ≥ 1 record
  yearsFound: number;
  fallbackTriggered: boolean; // true if a non-primary tag contributed
};

export type ParseNotes = {
  fields: Record<string, FieldTrace>;
  warnings: string[];
};

export type ParsedFundamentals = {
  years: AnnualFundamentalRow[];
  parseNotes: ParseNotes;
  yearsAvailable: number;
  earliestYear: number | null;
  latestYear: number | null;
  latestFiling: LatestFiling | null;
};

// Minimal metadata about the most recent 10-Q or 10-K filing observed in
// raw_facts. Persisted in sec_fundamentals_cache so we can detect "has a
// new quarterly filing dropped since the last snapshot?" without re-reading
// the full XBRL payload each time. The quarterly snapshot trigger compares
// `accession` across filings — accession numbers are globally unique, so
// equality is the authoritative "same filing" check.
export type LatestFiling = {
  accession: string;
  period_end: string; // YYYY-MM-DD — the fiscal period the filing covers
  form: string;       // '10-K' | '10-K/A' | '10-Q' | '10-Q/A' | '20-F' | '20-F/A'
  filed: string;      // YYYY-MM-DD — the date SEC received the filing
};

type FactRecord = {
  start?: string;
  end: string;
  val: number;
  accn?: string;
  fy?: number;
  fp?: string;
  form: string;
  filed: string;
  frame?: string;
};

type NormalizedRecord = { end: string; val: number; filed: string };

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

// 20-F (foreign filer) kept alongside 10-K so we don't silently drop ADRs
// that happen to file as foreign issuers. CLAUDE.md still says US-listed
// only, but a US-listed foreign filer (BABA-style) would file 20-F.
const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "20-F", "20-F/A"]);

// Any filing that can trigger a quarterly fundamentals snapshot. 10-K is
// included because the fourth-quarter numbers are only disclosed in the
// annual filing (no 10-Q is filed for Q4). 6-K is deliberately omitted —
// foreign filers' interim reports are too heterogeneous to treat as a
// reliable quarterly trigger.
const PERIODIC_FORMS = new Set([
  "10-K",
  "10-K/A",
  "10-Q",
  "10-Q/A",
  "20-F",
  "20-F/A",
]);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(start: string, end: string): number {
  return (new Date(end).getTime() - new Date(start).getTime()) / MS_PER_DAY;
}

// Add `n` days to a YYYY-MM-DD string (negative subtracts). UTC-anchored
// to avoid timezone drift across DST boundaries.
function addDays(yyyymmdd: string, n: number): string {
  const d = new Date(`${yyyymmdd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Sum 4 chained quarterly entries to synthesize an annual record. Used
// as fallback in extractAnnualFlow for filers that only break out the
// metric quarterly inside the 10-K (e.g., INTU's CostOfGoodsAndServicesSold
// post-2018: 4 quarters per fiscal year, no annual aggregate).
//
// Chain rule: each next quarter starts the day after the previous ends.
// Validation: total span 350-380 days. Filter: ANNUAL_FORMS only (10-K /
// 10-K/A / 20-F / 20-F/A — not 10-Q, where quarterly is the natural shape
// and aggregating across filings risks double-counting).
//
// `validEnds`, when provided, restricts emitted records to ends that
// match a known fiscal-year-end set (typically derived from revenue's
// direct annual ends). Without it, the aggregator would synthesize
// phantom annuals at every chain endpoint — e.g., for a filer that
// reports continuous quarters, every quarter forms a 365-day chain
// back, producing one synthetic annual per quarter instead of one per
// fiscal year. Anchoring on revenue's spine fixes this.
//
// Returns synthetic annual records keyed at the q4.end. Per-end dedupe
// keeps the most recently filed chain.
function aggregateAnnualFromQuarterly(
  records: FactRecord[],
  validEnds?: Set<string>,
): NormalizedRecord[] {
  const quarterly = records.filter((r) => {
    if (!r.start || !ANNUAL_FORMS.has(r.form)) return false;
    const d = daysBetween(r.start, r.end);
    return d >= 80 && d <= 95;
  });

  // Dedupe by (start, end): same period reported across multiple filings
  // → keep the latest filed.
  const byPeriod = new Map<string, FactRecord>();
  for (const r of quarterly) {
    const key = `${r.start}_${r.end}`;
    const prev = byPeriod.get(key);
    if (!prev || r.filed > prev.filed) byPeriod.set(key, r);
  }

  // Index by end date for chain lookup. When two records share the same
  // end (different starts, e.g. 88d vs 91d), prefer the one with the
  // later start — typically the canonical fiscal quarter rather than a
  // partial slice.
  const byEnd = new Map<string, FactRecord>();
  for (const r of byPeriod.values()) {
    const prev = byEnd.get(r.end);
    if (!prev || (r.start && prev.start && r.start > prev.start)) {
      byEnd.set(r.end, r);
    }
  }

  const result: NormalizedRecord[] = [];
  const seenEnds = new Set<string>();

  for (const q4 of byPeriod.values()) {
    if (seenEnds.has(q4.end) || !q4.start) continue;

    const q3 = byEnd.get(addDays(q4.start, -1));
    if (!q3?.start) continue;
    const q2 = byEnd.get(addDays(q3.start, -1));
    if (!q2?.start) continue;
    const q1 = byEnd.get(addDays(q2.start, -1));
    if (!q1?.start) continue;

    const span = daysBetween(q1.start, q4.end);
    if (span < 350 || span > 380) continue;

    if (validEnds && !validEnds.has(q4.end)) continue;

    const total = q1.val + q2.val + q3.val + q4.val;
    const latestFiled = [q1, q2, q3, q4].reduce((a, b) =>
      a.filed > b.filed ? a : b,
    ).filed;

    result.push({ end: q4.end, val: total, filed: latestFiled });
    seenEnds.add(q4.end);
  }

  return result.sort((a, b) => a.end.localeCompare(b.end));
}

function getUnitRecords(
  facts: SecCompanyFacts,
  tag: string,
  namespace: string,
  unit: string,
): FactRecord[] | null {
  const ns = facts.facts?.[namespace] as
    | Record<string, { units?: Record<string, FactRecord[]> }>
    | undefined;
  const entry = ns?.[tag];
  if (!entry?.units) return null;
  return entry.units[unit] ?? null;
}

export function extractAnnualFlow(
  facts: SecCompanyFacts,
  tag: string,
  namespace = "us-gaap",
  unit = "USD",
  aggregateOptions?: {
    aggregateQuarterly: boolean;
    validEnds?: Set<string>;
  },
): NormalizedRecord[] {
  const records = getUnitRecords(facts, tag, namespace, unit);
  if (!records) return [];
  const annual = records.filter((r) => {
    if (!ANNUAL_FORMS.has(r.form)) return false;
    if (!r.start) return false;
    const d = daysBetween(r.start, r.end);
    return d >= 350 && d <= 380;
  });
  const byEnd = new Map<string, FactRecord>();
  for (const r of annual) {
    const prev = byEnd.get(r.end);
    if (!prev || r.filed > prev.filed) byEnd.set(r.end, r);
  }
  const direct = Array.from(byEnd.values())
    .sort((a, b) => a.end.localeCompare(b.end))
    .map((r) => ({ end: r.end, val: r.val, filed: r.filed }));

  // Aggregation is opt-in per tag (off by default to avoid synthesizing
  // phantom annuals for tags that report continuous quarterly data
  // without a clear fiscal-year boundary). Caller signals intent via
  // `aggregateOptions.aggregateQuarterly = true`. The `validEnds` set
  // (fiscal year ends derived from revenue) anchors aggregation to real
  // year boundaries — see comment on aggregateAnnualFromQuarterly.
  if (!aggregateOptions?.aggregateQuarterly) return direct;

  const aggregated = aggregateAnnualFromQuarterly(
    records,
    aggregateOptions.validEnds,
  );
  if (aggregated.length === 0) return direct;
  const directEnds = new Set(direct.map((r) => r.end));
  const additions = aggregated.filter((r) => !directEnds.has(r.end));
  if (additions.length === 0) return direct;
  return [...direct, ...additions].sort((a, b) =>
    a.end.localeCompare(b.end),
  );
}

export function extractInstant(
  facts: SecCompanyFacts,
  tag: string,
  namespace = "us-gaap",
  unit = "USD",
): NormalizedRecord[] {
  const records = getUnitRecords(facts, tag, namespace, unit);
  if (!records) return [];
  const instants = records.filter(
    (r) => ANNUAL_FORMS.has(r.form) && !r.start,
  );
  const byEnd = new Map<string, FactRecord>();
  for (const r of instants) {
    const prev = byEnd.get(r.end);
    if (!prev || r.filed > prev.filed) byEnd.set(r.end, r);
  }
  return Array.from(byEnd.values())
    .sort((a, b) => a.end.localeCompare(b.end))
    .map((r) => ({ end: r.end, val: r.val, filed: r.filed }));
}

// Merge multiple tag extractions, first-come-first-served by calendar year
// (plan §2.1). Priority: earlier tags in the list win for overlapping years.
function mergeYearsByTag(
  facts: SecCompanyFacts,
  tags: string[],
  extract: (tag: string) => NormalizedRecord[],
  trace: FieldTrace,
): NormalizedRecord[] {
  const byYear = new Map<string, NormalizedRecord & { tag: string }>();
  for (const tag of tags) {
    trace.tagsAttempted.push(tag);
    const rows = extract(tag);
    if (rows.length === 0) continue;
    let contributed = false;
    for (const r of rows) {
      const year = r.end.slice(0, 4);
      if (!byYear.has(year)) {
        byYear.set(year, { ...r, tag });
        contributed = true;
      }
    }
    if (contributed) trace.tagsUsed.push(tag);
  }
  const result = Array.from(byYear.values()).sort((a, b) =>
    a.end.localeCompare(b.end),
  );
  trace.yearsFound = result.length;
  trace.fallbackTriggered =
    trace.tagsUsed.length > 0 && trace.tagsUsed[0] !== tags[0];
  return result.map(({ end, val, filed }) => ({ end, val, filed }));
}

function extractMerged(
  facts: SecCompanyFacts,
  tags: string[],
  trace: FieldTrace,
  namespace = "us-gaap",
  unit = "USD",
  kind: "flow" | "instant" = "flow",
  aggregateOptions?: {
    aggregateQuarterly: boolean;
    validEnds?: Set<string>;
  },
): NormalizedRecord[] {
  const extract =
    kind === "flow"
      ? (tag: string) =>
          extractAnnualFlow(facts, tag, namespace, unit, aggregateOptions)
      : (tag: string) => extractInstant(facts, tag, namespace, unit);
  return mergeYearsByTag(facts, tags, extract, trace);
}

// Find the instant value whose end date aligns with `flowEnd` within ±45d.
function alignInstant(
  instants: NormalizedRecord[],
  flowEnd: string,
): number | null {
  let best: { val: number; diff: number } | null = null;
  for (const i of instants) {
    const diff = Math.abs(daysBetween(flowEnd, i.end));
    if (diff <= 45 && (!best || diff < best.diff)) {
      best = { val: i.val, diff };
    }
  }
  return best?.val ?? null;
}

function findFlowValue(
  flow: NormalizedRecord[],
  end: string,
): number | null {
  const match = flow.find((r) => r.end === end);
  return match?.val ?? null;
}

function newTrace(): FieldTrace {
  return {
    tagsAttempted: [],
    tagsUsed: [],
    yearsFound: 0,
    fallbackTriggered: false,
  };
}

// Walk the companyfacts payload to find the 10-Q / 10-K with the most recent
// `filed` date. Accession number is globally unique — the caller compares it
// against previously-snapshotted accessions to detect new filings.
//
// Searches multiple "anchor" tags because not every company populates every
// tag, and picking a single tag would miss filings for filers that report
// NetIncomeLoss but not Revenues (e.g. holding companies) or vice versa.
// The search stops as soon as any anchor tag returns records — the latest
// filing is almost always present in multiple tags simultaneously.
export function extractLatestFiling(
  facts: SecCompanyFacts,
): LatestFiling | null {
  const ANCHOR_TAGS: { ns: string; tag: string; unit: string }[] = [
    { ns: "us-gaap", tag: "Revenues", unit: "USD" },
    { ns: "us-gaap", tag: "NetIncomeLoss", unit: "USD" },
    {
      ns: "us-gaap",
      tag: "RevenueFromContractWithCustomerExcludingAssessedTax",
      unit: "USD",
    },
    { ns: "us-gaap", tag: "Assets", unit: "USD" },
    { ns: "us-gaap", tag: "StockholdersEquity", unit: "USD" },
  ];

  let best: FactRecord | null = null;
  for (const { ns, tag, unit } of ANCHOR_TAGS) {
    const records = getUnitRecords(facts, tag, ns, unit);
    if (!records) continue;
    for (const r of records) {
      if (!PERIODIC_FORMS.has(r.form)) continue;
      if (!r.accn || !r.filed) continue;
      if (!best || r.filed > best.filed) best = r;
    }
    // Walk every anchor, not just the first. Some filers stopped
    // populating `Revenues` after the ASC 606 migration (~2018) and
    // switched to `RevenueFromContractWithCustomerExcludingAssessedTax`;
    // bailing on the first anchor that matched would lock us onto
    // stale 2017-2018 records for those tickers.
  }

  if (!best) return null;
  return {
    accession: best.accn!,
    period_end: best.end,
    form: best.form,
    filed: best.filed,
  };
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export function parseFundamentals(
  facts: SecCompanyFacts,
): ParsedFundamentals {
  const notes: ParseNotes = { fields: {}, warnings: [] };
  const trace = (field: string): FieldTrace => {
    const t = newTrace();
    notes.fields[field] = t;
    return t;
  };

  // --- Flow fields (annual totals) ---

  const revenueRows = extractMerged(
    facts,
    [
      "Revenues",
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
      "SalesRevenueNet",
      "SalesRevenueGoodsNet",
      "RealEstateRevenueNet",
      "OperatingLeasesIncomeStatementLeaseRevenue",
      "InterestIncomeOperating",
      // Banks report top-line as net of interest expense (AXP, JPM-style).
      // Without this tag, AXP's Revenues series is fragmentary because the
      // bank reclassified after 2020 to RevenuesNetOfInterestExpense.
      "RevenuesNetOfInterestExpense",
    ],
    trace("revenue"),
  );

  const netIncomeRows = extractMerged(
    facts,
    [
      "NetIncomeLoss",
      "ProfitLoss",
      "NetIncomeLossAvailableToCommonStockholdersBasic",
    ],
    trace("netIncome"),
  );

  // Fiscal year ends derived from revenue's direct annual records — used
  // to anchor quarterly-aggregation fallback for tags like cogs / gross
  // profit so we don't synthesize phantom annuals at non-fiscal-year
  // boundaries (e.g., INTU reports continuous quarterly cogs; without
  // anchoring we'd emit an annual record at every quarter-end).
  const fiscalYearEnds = new Set(revenueRows.map((r) => r.end));

  const grossProfitRows = extractMerged(
    facts,
    ["GrossProfit"],
    trace("grossProfit"),
    "us-gaap",
    "USD",
    "flow",
    { aggregateQuarterly: true, validEnds: fiscalYearEnds },
  );

  const cogsRows = extractMerged(
    facts,
    ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"],
    trace("cogs"),
    "us-gaap",
    "USD",
    "flow",
    { aggregateQuarterly: true, validEnds: fiscalYearEnds },
  );

  const operatingIncomeRows = extractMerged(
    facts,
    ["OperatingIncomeLoss"],
    trace("operatingIncome"),
  );

  const daRows = extractMerged(
    facts,
    [
      "DepreciationAndAmortization",
      "DepreciationDepletionAndAmortization",
      "DepreciationAmortizationAndAccretionNet",
      "Depreciation",
    ],
    trace("depreciationAmortization"),
  );
  // If primary D&A tags all empty, attempt to compose from Depreciation +
  // AmortizationOfIntangibleAssets (MSFT-style split).
  let composedDA: NormalizedRecord[] | null = null;
  if (daRows.length === 0) {
    const depTrace = trace("depreciationAmortization__depreciationOnly");
    const dep = extractMerged(
      facts,
      ["Depreciation", "DepreciationNonproduction"],
      depTrace,
    );
    const amortTrace = trace("depreciationAmortization__amortization");
    const amort = extractMerged(
      facts,
      [
        "AmortizationOfIntangibleAssets",
        "AmortizationOfIntangibleAssetsExcludingGoodwill",
      ],
      amortTrace,
    );
    if (dep.length > 0 || amort.length > 0) {
      const byEnd = new Map<string, number>();
      for (const r of dep) byEnd.set(r.end, (byEnd.get(r.end) ?? 0) + r.val);
      for (const r of amort)
        byEnd.set(r.end, (byEnd.get(r.end) ?? 0) + r.val);
      composedDA = Array.from(byEnd.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([end, val]) => ({ end, val, filed: "" }));
      notes.warnings.push(
        "depreciationAmortization: composed from Depreciation + AmortizationOfIntangibleAssets",
      );
    }
  }
  const daFinal = daRows.length > 0 ? daRows : (composedDA ?? []);

  const capexRows = extractMerged(
    facts,
    [
      "PaymentsToAcquirePropertyPlantAndEquipment",
      "PaymentsToAcquireProductiveAssets",
      "PaymentsForProceedsFromProductiveAssets",
      "PaymentsForCapitalImprovements",
    ],
    trace("capitalExpenditure"),
  );

  // Derivation inputs for operatingIncome fallback (product businesses)
  const sgaRows = extractMerged(
    facts,
    [
      "SellingGeneralAndAdministrativeExpense",
      "GeneralAndAdministrativeExpense",
    ],
    trace("sga"),
  );
  const rndRows = extractMerged(
    facts,
    [
      "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost",
      "ResearchAndDevelopmentExpense",
    ],
    trace("rnd"),
  );

  const ocfRows = extractMerged(
    facts,
    [
      "NetCashProvidedByUsedInOperatingActivities",
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ],
    trace("operatingCashFlow"),
  );

  // Diluted shares is the headline. When a filer doesn't report Diluted
  // (Berkshire is the canonical example: no stock options issued, so basic
  // = diluted by definition), fall back to Basic. Mark with a parse-note
  // so callers can tell it was a fallback.
  let sharesDilutedRows = extractMerged(
    facts,
    ["WeightedAverageNumberOfDilutedSharesOutstanding"],
    trace("sharesDiluted"),
    "us-gaap",
    "shares",
  );
  if (sharesDilutedRows.length === 0) {
    const basicTrace = trace("sharesDiluted__basicFallback");
    const basicShares = extractMerged(
      facts,
      ["WeightedAverageNumberOfSharesOutstandingBasic"],
      basicTrace,
      "us-gaap",
      "shares",
    );
    if (basicShares.length > 0) {
      sharesDilutedRows = basicShares;
      notes.warnings.push(
        "sharesDiluted: filer reports only Basic (Diluted absent); using Basic as a proxy. Common for issuers with no equity-linked instruments (e.g. Berkshire Hathaway).",
      );
    }
  }

  const repurchaseRows = extractMerged(
    facts,
    ["PaymentsForRepurchaseOfCommonStock"],
    trace("repurchaseOfCapitalStock"),
  );

  const dividendsRows = extractMerged(
    facts,
    [
      "PaymentsOfDividends",
      "PaymentsOfDividendsCommonStock",
      "DividendsCommonStockCash",
    ],
    trace("cashDividendsPaid"),
  );

  const taxExpenseRows = extractMerged(
    facts,
    ["IncomeTaxExpenseBenefit"],
    trace("taxExpense"),
  );

  const pretaxIncomeRows = extractMerged(
    facts,
    [
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments",
      "IncomeLossFromContinuingOperationsBeforeIncomeTaxesNoncontrollingInterest",
    ],
    trace("pretaxIncome"),
  );

  // --- Balance-sheet instants ---

  const assetsRows = extractMerged(
    facts,
    ["Assets"],
    trace("totalAssets"),
    "us-gaap",
    "USD",
    "instant",
  );

  const equityRows = extractMerged(
    facts,
    [
      "StockholdersEquity",
      "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
    ],
    trace("stockholdersEquity"),
    "us-gaap",
    "USD",
    "instant",
  );

  const longTermDebtRows = extractMerged(
    facts,
    [
      "LongTermDebtNoncurrent",
      "LongTermDebt",
      "LongTermDebtAndCapitalLeaseObligations",
    ],
    trace("longTermDebt"),
    "us-gaap",
    "USD",
    "instant",
  );

  const shortTermDebtRows = extractMerged(
    facts,
    ["LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings"],
    trace("shortTermDebt"),
    "us-gaap",
    "USD",
    "instant",
  );

  const cashRows = extractMerged(
    facts,
    [
      "CashAndCashEquivalentsAtCarryingValue",
      "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
      "Cash",
    ],
    trace("cash"),
    "us-gaap",
    "USD",
    "instant",
  );

  // --- Build spine ---
  // Use the union of period-ends observed across revenue, netIncome, and
  // operatingCashFlow as the canonical fiscal-year list. Most filers have
  // all three aligned to the same end-date; unions cover the rare filer
  // where one field is missing a year.
  const spineEnds = new Set<string>();
  for (const r of revenueRows) spineEnds.add(r.end);
  for (const r of netIncomeRows) spineEnds.add(r.end);
  for (const r of ocfRows) spineEnds.add(r.end);
  const orderedEnds = Array.from(spineEnds).sort();

  // --- Assemble rows ---
  const rows: AnnualFundamentalRow[] = orderedEnds.map((end) => {
    const revenue = findFlowValue(revenueRows, end);
    const directGrossProfit = findFlowValue(grossProfitRows, end);
    const cogs = findFlowValue(cogsRows, end);
    const derivedGrossProfit =
      revenue !== null && cogs !== null ? revenue - cogs : null;
    const grossProfit = directGrossProfit ?? derivedGrossProfit;

    // operatingIncome: primary tag, then derive (Revenue − COGS − SG&A − R&D)
    // for product businesses that don't report OperatingIncomeLoss directly
    // (e.g., ZTS reports only the line items, not the subtotal). Matches
    // OQ1 step 2 for product businesses. For banks/REITs the inputs are
    // typically absent → derivation returns null and scorecard neutralizes.
    const primaryOpInc = findFlowValue(operatingIncomeRows, end);
    const sga = findFlowValue(sgaRows, end);
    const rnd = findFlowValue(rndRows, end);
    const cogsForOpInc = findFlowValue(cogsRows, end);
    const derivedOpInc =
      revenue !== null && cogsForOpInc !== null && sga !== null
        ? revenue - cogsForOpInc - sga - (rnd ?? 0)
        : null;
    const operatingIncome = primaryOpInc ?? derivedOpInc;
    const netIncome = findFlowValue(netIncomeRows, end);
    const da = findFlowValue(daFinal, end);

    // Sign conventions (match yfinance): capex, repurchase, dividends are
    // outflows stored as NEGATIVE. SEC reports them as positive cash outflows.
    const capexRaw = findFlowValue(capexRows, end);
    const capex = capexRaw !== null ? -Math.abs(capexRaw) : null;
    const repurchaseRaw = findFlowValue(repurchaseRows, end);
    const repurchase =
      repurchaseRaw !== null ? -Math.abs(repurchaseRaw) : null;
    const dividendsRaw = findFlowValue(dividendsRows, end);
    const dividends =
      dividendsRaw !== null ? -Math.abs(dividendsRaw) : null;

    const ocf = findFlowValue(ocfRows, end);
    // FCF = OCF + capex (capex negative), matching yfinance definition.
    const freeCashFlow =
      ocf !== null && capex !== null ? ocf + capex : null;

    // Tax rate: tax / pretax. Null if denominator ≤ 0 (loss-year) or absent;
    // scorecard.ts already falls back to 21% statutory in that case.
    const taxExpense = findFlowValue(taxExpenseRows, end);
    const pretax = findFlowValue(pretaxIncomeRows, end);
    const taxRate =
      taxExpense !== null && pretax !== null && pretax > 0
        ? taxExpense / pretax
        : null;

    const sharesDiluted = findFlowValue(sharesDilutedRows, end);

    // Instants aligned to flow period-end (±45 days).
    const totalAssets = alignInstant(assetsRows, end);
    const stockholdersEquity = alignInstant(equityRows, end);
    const longTermDebt = alignInstant(longTermDebtRows, end);
    const shortTermDebt = alignInstant(shortTermDebtRows, end);
    // If a balance sheet is present for this period (equity or assets
    // populated) but no debt tags matched, the company had no debt that
    // year — treat as 0 rather than null. FTNT pre-2021 is the canonical
    // case: high-FCF tech with no long-term notes until 2021 issuance.
    const hasBalanceSheet =
      stockholdersEquity !== null || totalAssets !== null;
    const totalDebt =
      longTermDebt !== null || shortTermDebt !== null
        ? (longTermDebt ?? 0) + (shortTermDebt ?? 0)
        : hasBalanceSheet
          ? 0
          : null;
    const cash = alignInstant(cashRows, end);

    // Invested capital = equity + totalDebt − cash. Requires all three.
    const investedCapital =
      stockholdersEquity !== null && totalDebt !== null && cash !== null
        ? stockholdersEquity + totalDebt - cash
        : null;

    return {
      fiscalYearEnd: end,
      revenue,
      grossProfit,
      operatingIncome,
      ebit: operatingIncome, // scorecard conflates EBIT with operatingIncome (see financial.ts line 236)
      taxRate,
      netIncome,
      depreciationAmortization: da,
      capitalExpenditure: capex,
      operatingCashFlow: ocf,
      freeCashFlow,
      investedCapital,
      totalAssets,
      totalDebt,
      cash,
      stockholdersEquity,
      sharesDiluted,
      repurchaseOfCapitalStock: repurchase,
      cashDividendsPaid: dividends,
    };
  });

  // Count years usable for the *relative valuation distribution* (the
  // weakest bar — PE per year requires only NetIncome + DilutedShares).
  // ROIC / FCF-margin scoring degrades gracefully when EBIT / IC / FCF
  // are null, so the looser filter doesn't break operating-business
  // scoring but lets banks (no OperatingIncomeLoss / no capex / no
  // InvestedCapital concept) pass without falling through to yfinance's
  // 4-5y fallback. AXP, BAC, BRK go from 0 usable years to 18-51.
  // Filter is intentionally minimal: revenue + netIncome are the universal
  // anchors for "this year is structurally usable". Earlier we also required
  // sharesDiluted, but Visa-class filers (V, MA — Credit Services) don't
  // populate any standard XBRL share-count tag (no
  // WeightedAverageNumberOfDilutedSharesOutstanding, no
  // EarningsPerShareDiluted, etc. — verified via SEC EDGAR companyfacts API).
  // Requiring shares meant V failed yearsAvailable < 3 → parse_error → full
  // yfinance fallback (4y of everything). With shares dropped from the
  // filter, V passes with 19 usable years; the per-field merge in
  // fetchMultiYearFundamentals fills sharesDiluted from yfinance separately.
  const yearsAvailable = rows.filter(
    (r) => r.revenue !== null && r.netIncome !== null,
  ).length;

  const earliestYear = rows.length > 0 ? Number(rows[0].fiscalYearEnd.slice(0, 4)) : null;
  const latestYear =
    rows.length > 0
      ? Number(rows[rows.length - 1].fiscalYearEnd.slice(0, 4))
      : null;

  const latestFiling = extractLatestFiling(facts);

  return {
    years: rows,
    parseNotes: notes,
    yearsAvailable,
    earliestYear,
    latestYear,
    latestFiling,
  };
}
