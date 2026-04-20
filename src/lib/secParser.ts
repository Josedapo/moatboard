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
  return Array.from(byEnd.values())
    .sort((a, b) => a.end.localeCompare(b.end))
    .map((r) => ({ end: r.end, val: r.val, filed: r.filed }));
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
): NormalizedRecord[] {
  const extract =
    kind === "flow"
      ? (tag: string) => extractAnnualFlow(facts, tag, namespace, unit)
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
    if (best) break; // first anchor that produced a match is sufficient
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

  const grossProfitRows = extractMerged(
    facts,
    ["GrossProfit"],
    trace("grossProfit"),
  );

  const cogsRows = extractMerged(
    facts,
    ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold"],
    trace("cogs"),
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

  const sharesDilutedRows = extractMerged(
    facts,
    ["WeightedAverageNumberOfDilutedSharesOutstanding"],
    trace("sharesDiluted"),
    "us-gaap",
    "shares",
  );

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

  // yearsAvailable matches the yfinance convention: count rows with enough
  // signal to score ROIC + FCF margin at minimum.
  const yearsAvailable = rows.filter(
    (r) =>
      r.revenue !== null &&
      r.ebit !== null &&
      r.investedCapital !== null &&
      r.freeCashFlow !== null,
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
