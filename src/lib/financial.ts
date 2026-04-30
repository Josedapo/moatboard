import YahooFinance from "yahoo-finance2";
import { fetchMultiYearFundamentalsSec } from "@/lib/sec";
import { getFxToUsd, applyFx } from "@/lib/fx";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export type Quote = {
  symbol: string;
  shortName: string | null;
  longName: string | null;
  currency: string | null;
  regularMarketPrice: number | null;
  marketCap: number | null;
  sharesOutstanding: number | null;
  // 52-week range — displayed in the position header as temperature, not as
  // a valuation input. Kept on the quote because it's price context, not
  // business fundamentals.
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekHigh: number | null;
  sector: string | null;
  industry: string | null;
  // Short exchange label ("NYSE", "NASDAQ", "AMEX"...) normalised from the
  // cryptic yfinance codes (NYQ, NMS, ASE...). Null when yfinance doesn't
  // surface an exchange code we recognise.
  exchange: string | null;
  website: string | null;
  longBusinessSummary: string | null;
  // Next expected earnings date — extracted from yfinance calendarEvents.
  // Returned as ISO string so it survives RSC serialization predictably.
  // Null when yfinance doesn't publish it (some tickers / foreign
  // companies). Shown in the dashboard "Próximas presentaciones" block.
  nextEarningsDate: string | null;
};

export type Fundamentals = {
  symbol: string;
  // Profitability
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  profitMargins: number | null;
  operatingMargins: number | null;
  grossMargins: number | null;
  // Cash flow
  freeCashflow: number | null;
  operatingCashflow: number | null;
  // Balance sheet
  totalDebt: number | null;
  totalCash: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  // Growth
  earningsGrowth: number | null;
  revenueGrowth: number | null;
  // Valuation
  trailingPE: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  // Per-share denominators behind PE / P-FCF. TTM where yfinance exposes it
  // directly; FCF per share is derived from freeCashflow / sharesOutstanding.
  trailingEps: number | null;
  fcfPerShare: number | null;
  // Dividend
  dividendYield: number | null;
  payoutRatio: number | null;
  // Beta — used by the Excess Returns Model for banks/insurers (CAPM cost
  // of equity). yfinance exposes this in `defaultKeyStatistics.beta`.
  beta: number | null;
};

export type QuoteAndFundamentals = {
  quote: Quote | null;
  fundamentals: Fundamentals | null;
};

export async function fetchQuoteAndFundamentals(
  ticker: string,
): Promise<QuoteAndFundamentals> {
  try {
    const result = await yf.quoteSummary(ticker, {
      modules: [
        "price",
        "assetProfile",
        "summaryProfile",
        "financialData",
        "defaultKeyStatistics",
        "summaryDetail",
        "calendarEvents",
      ],
    });

    const price = result.price;
    const profile = result.assetProfile ?? result.summaryProfile;
    const fd = result.financialData;
    const ks = result.defaultKeyStatistics;
    const sd = result.summaryDetail;
    // calendarEvents.earnings.earningsDate is an array of Dates (yfinance
    // sometimes gives a single date, sometimes a range). First element is
    // the next expected release. ISO string for predictable RSC
    // serialisation. Null when yfinance doesn't surface it.
    const ce = result.calendarEvents;
    const earningsDates = ce?.earnings?.earningsDate;
    const nextEarningsDate =
      Array.isArray(earningsDates) && earningsDates.length > 0
        ? new Date(earningsDates[0]).toISOString()
        : null;

    const sharesOutstanding =
      price?.marketCap && price?.regularMarketPrice
        ? price.marketCap / price.regularMarketPrice
        : null;

    // Foreign filers (TSM in TWD, ASML in EUR, TM in JPY...) expose `price`
    // values in the trading currency (USD for ADRs) but `financialData`
    // numbers in the company's reporting currency. Without FX conversion
    // a TSM FCF of NT$721B divided by a $2T market cap would yield a 35%
    // FCF-yield phantom. Detect the mismatch once and convert the absolute
    // monetary fields below; ratios (margins, growth, PE, P/B) are
    // dimensionless and already valid as-is.
    const finCcy =
      (fd as { financialCurrency?: string } | null | undefined)
        ?.financialCurrency ?? null;
    const priceCcy = price?.currency ?? null;
    const fxToUsd =
      finCcy && priceCcy && finCcy.toUpperCase() !== priceCcy.toUpperCase()
        ? await getFxToUsd(finCcy)
        : 1;
    const freeCashflowUsd = applyFx(fd?.freeCashflow ?? null, fxToUsd);
    const operatingCashflowUsd = applyFx(fd?.operatingCashflow ?? null, fxToUsd);
    const totalDebtUsd = applyFx(fd?.totalDebt ?? null, fxToUsd);
    const totalCashUsd = applyFx(fd?.totalCash ?? null, fxToUsd);

    const quote: Quote | null = price
      ? {
          symbol: price.symbol ?? ticker.toUpperCase(),
          shortName: price.shortName ?? null,
          longName: price.longName ?? null,
          currency: price.currency ?? null,
          regularMarketPrice: price.regularMarketPrice ?? null,
          marketCap: price.marketCap ?? null,
          sharesOutstanding,
          fiftyTwoWeekLow: sd?.fiftyTwoWeekLow ?? null,
          fiftyTwoWeekHigh: sd?.fiftyTwoWeekHigh ?? null,
          sector: profile?.sector ?? null,
          industry: profile?.industry ?? null,
          exchange: normaliseExchange(
            (price as { exchange?: string; fullExchangeName?: string })
              .exchange ?? null,
            (price as { fullExchangeName?: string }).fullExchangeName ?? null,
          ),
          website: profile?.website ?? null,
          longBusinessSummary: profile?.longBusinessSummary ?? null,
          nextEarningsDate,
        }
      : null;

    // Trailing EPS: prefer yfinance's own trailingEps from defaultKeyStatistics.
    // If absent but trailingPE and price are, derive it (EPS = price / PE).
    const trailingEpsRaw = ks?.trailingEps ?? null;
    const trailingEps =
      typeof trailingEpsRaw === "number" && Number.isFinite(trailingEpsRaw)
        ? trailingEpsRaw
        : sd?.trailingPE &&
            price?.regularMarketPrice &&
            sd.trailingPE > 0
          ? price.regularMarketPrice / sd.trailingPE
          : null;

    // FCF per share = trailing FCF / shares outstanding. Both in USD now
    // (FCF was converted above when the filer reports in a non-USD
    // currency; sharesOutstanding is derived from USD market cap / USD
    // price so it's USD-denominated by construction).
    const fcfPerShare =
      freeCashflowUsd != null && sharesOutstanding && sharesOutstanding > 0
        ? freeCashflowUsd / sharesOutstanding
        : null;

    const fundamentals: Fundamentals = {
      symbol: ticker.toUpperCase(),
      returnOnEquity: fd?.returnOnEquity ?? null,
      returnOnAssets: fd?.returnOnAssets ?? null,
      profitMargins: fd?.profitMargins ?? null,
      operatingMargins: fd?.operatingMargins ?? null,
      grossMargins: fd?.grossMargins ?? null,
      freeCashflow: freeCashflowUsd,
      operatingCashflow: operatingCashflowUsd,
      totalDebt: totalDebtUsd,
      totalCash: totalCashUsd,
      debtToEquity: fd?.debtToEquity ?? null,
      currentRatio: fd?.currentRatio ?? null,
      earningsGrowth: fd?.earningsGrowth ?? null,
      revenueGrowth: fd?.revenueGrowth ?? null,
      trailingPE: sd?.trailingPE ?? null,
      forwardPE: sd?.forwardPE ?? null,
      priceToBook: ks?.priceToBook ?? null,
      trailingEps,
      fcfPerShare,
      dividendYield: sd?.dividendYield ?? null,
      payoutRatio: sd?.payoutRatio ?? null,
      beta: ks?.beta ?? null,
    };

    return { quote, fundamentals };
  } catch (err) {
    console.warn(`fetchQuoteAndFundamentals failed for ${ticker}:`, err);
    return { quote: null, fundamentals: null };
  }
}

export async function validateTicker(ticker: string): Promise<boolean> {
  try {
    const result = await yf.quote(ticker);
    return !!result?.symbol;
  } catch {
    return false;
  }
}

// --- Multi-year fundamentals (yfinance fundamentalsTimeSeries) ---
// Used for Buffett-aligned scoring on medians + worst year rather than a
// single trailing snapshot. yfinance caps this at 4–5 years of annual data.

export type AnnualFundamentalRow = {
  fiscalYearEnd: string; // ISO date of period end
  revenue: number | null;
  grossProfit: number | null; // Revenue − COGS; direct if yfinance exposes it, else derived
  operatingIncome: number | null; // kept separate from EBIT for multi-year op-margin scoring
  ebit: number | null;
  taxRate: number | null;
  netIncome: number | null;
  depreciationAmortization: number | null;
  capitalExpenditure: number | null; // yfinance sign: typically negative
  operatingCashFlow: number | null;
  freeCashFlow: number | null;
  investedCapital: number | null;
  totalAssets: number | null; // ROA denominator for banks/insurers
  totalDebt: number | null;
  cash: number | null;
  stockholdersEquity: number | null;
  sharesDiluted: number | null;
  repurchaseOfCapitalStock: number | null; // typically negative (outflow)
  cashDividendsPaid: number | null; // typically negative (outflow)
};

export type MultiYearFundamentals = {
  symbol: string;
  years: AnnualFundamentalRow[]; // oldest → newest, sorted ascending by fiscalYearEnd
  yearsAvailable: number; // years.filter(r => r has usable data).length
};

// SEC-first, yfinance fallback. SEC XBRL gives 10–18 years of annual
// history vs yfinance's 4–5; yfinance is retained only for tickers where
// SEC has no CIK, the fetch fails, or the parser finds < 3 usable years
// (see plan §3.3 fallback triggers).
//
// Per-field enrichment: some filers (Visa is the canonical case) simply
// don't XBRL-tag shares outstanding — neither us-gaap nor dei carries a
// `WeightedAverageNumber...Shares...` or `CommonStockSharesOutstanding`
// value. The SEC parse still succeeds (revenue, netIncome, FCF all there)
// but `sharesDiluted` is null across every year, which neutralizes the
// Share Count Trend scorecard dimension and any per-share metric. To
// recover that signal we fetch yfinance in parallel and merge its
// `sharesDiluted` into matching fiscal year-ends. Scope is deliberately
// narrow: only shares are enriched, and only when SEC has it null across
// the board — matching years win, older SEC-only years stay null but at
// least the recent ones are now scorable.
export async function fetchMultiYearFundamentals(
  ticker: string,
): Promise<MultiYearFundamentals | null> {
  const fromSec = await fetchMultiYearFundamentalsSec(ticker).catch((err) => {
    console.warn(`SEC multi-year fetch failed for ${ticker}:`, err);
    return null;
  });
  if (fromSec && fromSec.yearsAvailable >= 3) {
    const allSharesNull = fromSec.years.every((y) => y.sharesDiluted === null);
    if (allSharesNull) {
      const fromYf = await fetchMultiYearFundamentalsYfinance(ticker).catch(
        () => null,
      );
      if (fromYf) {
        const yfByMonth = new Map<string, number>();
        for (const y of fromYf.years) {
          if (y.sharesDiluted !== null && y.fiscalYearEnd) {
            yfByMonth.set(y.fiscalYearEnd.slice(0, 7), y.sharesDiluted);
          }
        }
        fromSec.years = fromSec.years.map((y) => {
          const match = yfByMonth.get(y.fiscalYearEnd.slice(0, 7));
          return match !== undefined ? { ...y, sharesDiluted: match } : y;
        });
      }
    }
    return fromSec;
  }
  // SEC failed or thin (<3 usable years) — yfinance fallback. For foreign
  // filers (TSM, ASML, TM, BABA, NVO, etc.) yfinance returns absolute
  // monetary fields in the company's reporting currency, not USD. Detect
  // the mismatch here and pass the FX multiplier down so revenue / FCF /
  // assets / debt land in USD before they reach the implied-return math.
  let fxToUsd: number | null = 1;
  try {
    const summary = await yf.quoteSummary(ticker, {
      modules: ["price", "financialData"],
    });
    const finCcy =
      (summary.financialData as { financialCurrency?: string } | undefined)
        ?.financialCurrency ?? null;
    const priceCcy = summary.price?.currency ?? null;
    if (finCcy && priceCcy && finCcy.toUpperCase() !== priceCcy.toUpperCase()) {
      fxToUsd = await getFxToUsd(finCcy);
    }
  } catch (err) {
    console.warn(`Currency detection failed for ${ticker}:`, err);
  }
  return fetchMultiYearFundamentalsYfinance(ticker, fxToUsd);
}

export async function fetchMultiYearFundamentalsYfinance(
  ticker: string,
  fxToUsd: number | null = 1,
): Promise<MultiYearFundamentals | null> {
  try {
    const today = new Date();
    // Ask for 15 years; yfinance will return what it has (~5y in practice)
    const period1 = new Date(today.getFullYear() - 15, 0, 1);

    const rawRows = await yf.fundamentalsTimeSeries(ticker, {
      period1: period1.toISOString().slice(0, 10),
      period2: today.toISOString().slice(0, 10),
      type: "annual",
      module: "all",
    });

    if (!Array.isArray(rawRows) || rawRows.length === 0) return null;
    // `module: "all"` widens the row to the union of financials/balance/cashflow
    // fields, but the declared return type narrows to the intersection. Cast to
    // a permissive record so we can read heterogeneous fields by name.
    const rows = rawRows as unknown as Array<
      Record<string, unknown> & { date?: Date | string }
    >;

    // Per-year FX is the same multiplier as the spot rate. CAGRs are
    // currency-invariant when the multiplier is constant across years
    // (CAGR(k·xs) = CAGR(xs)), so applying today's FX uniformly preserves
    // the growth signal while putting absolute USD-denominated comparisons
    // (FCF Yield, Net Debt / EBITDA, market-cap-relative metrics) on
    // honest footing.
    const fx = (v: number | null) => applyFx(v, fxToUsd);
    const mapped: AnnualFundamentalRow[] = rows.map((r) => {
      const revenue = fx(nullable(r["totalRevenue"]));
      const cogs = fx(nullable(r["costOfRevenue"]));
      const directGrossProfit = fx(nullable(r["grossProfit"]));
      const derivedGrossProfit =
        revenue !== null && cogs !== null ? revenue - cogs : null;
      return {
      fiscalYearEnd:
        r.date instanceof Date
          ? r.date.toISOString().slice(0, 10)
          : String(r.date ?? ""),
      revenue,
      grossProfit: directGrossProfit ?? derivedGrossProfit,
      operatingIncome: fx(nullable(r["operatingIncome"] ?? r["EBIT"])),
      ebit: fx(nullable(r["EBIT"] ?? r["operatingIncome"])),
      taxRate: nullable(r["taxRateForCalcs"]),
      netIncome: fx(nullable(r["netIncome"])),
      depreciationAmortization: fx(
        nullable(r["depreciationAndAmortization"] ?? r["reconciledDepreciation"]),
      ),
      capitalExpenditure: fx(nullable(r["capitalExpenditure"])),
      operatingCashFlow: fx(nullable(r["operatingCashFlow"])),
      freeCashFlow: fx(nullable(r["freeCashFlow"])),
      investedCapital: fx(nullable(r["investedCapital"])),
      totalAssets: fx(nullable(r["totalAssets"])),
      totalDebt: fx(nullable(r["totalDebt"])),
      cash: fx(nullable(r["cashAndCashEquivalents"])),
      stockholdersEquity: fx(
        nullable(r["stockholdersEquity"] ?? r["commonStockEquity"]),
      ),
      sharesDiluted: nullable(r["dilutedAverageShares"]),
      repurchaseOfCapitalStock: fx(nullable(r["repurchaseOfCapitalStock"])),
      cashDividendsPaid: fx(nullable(r["cashDividendsPaid"])),
    };
    });

    // Sort ascending by fiscalYearEnd
    mapped.sort((a, b) => a.fiscalYearEnd.localeCompare(b.fiscalYearEnd));

    // yfinance occasionally returns the oldest row with most fields null.
    // Count years with enough signal to score ROIC/FCF margin at minimum.
    const yearsAvailable = mapped.filter(
      (r) =>
        r.revenue !== null &&
        r.ebit !== null &&
        r.investedCapital !== null &&
        r.freeCashFlow !== null,
    ).length;

    return {
      symbol: ticker.toUpperCase(),
      years: mapped,
      yearsAvailable,
    };
  } catch (err) {
    console.warn(`fetchMultiYearFundamentals failed for ${ticker}:`, err);
    return null;
  }
}

function nullable(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

// Normalise yfinance's cryptic exchange codes into a short label suitable
// for the UI. First tries the `exchange` code (NYQ / NMS / ASE / ...);
// falls back to parsing `fullExchangeName` ("NasdaqGS", "NYSE", ...) when
// the code is unknown. Returns null when neither resolves cleanly so the
// UI can skip rendering rather than showing noise.
function normaliseExchange(
  code: string | null,
  fullName: string | null,
): string | null {
  const CODE_MAP: Record<string, string> = {
    NYQ: "NYSE",
    NMS: "NASDAQ",
    NGM: "NASDAQ",
    NCM: "NASDAQ",
    NAS: "NASDAQ",
    ASE: "AMEX",
    PCX: "NYSE Arca",
    BATS: "BATS",
  };
  if (code && CODE_MAP[code]) return CODE_MAP[code];
  if (fullName) {
    const lower = fullName.toLowerCase();
    if (lower.startsWith("nasdaq")) return "NASDAQ";
    if (lower.startsWith("nyse arca")) return "NYSE Arca";
    if (lower.startsWith("nyse")) return "NYSE";
    if (lower.startsWith("amex") || lower.includes("american stock"))
      return "AMEX";
  }
  return code ?? null;
}

// --- Management signals ---
// Buffett says management is half the thesis. None of this is scored
// formulaically — we surface the data and let the thesis writer (AI or
// user) reason about it. Data comes from yfinance quoteSummary and is
// best-effort: for many tickers some fields will be null.

export type ManagementSignals = {
  ceoName: string | null;
  ceoTitle: string | null;
  ceoAge: number | null; // approximate (current year − yearBorn)
  ceoTotalPay: number | null; // USD
  insiderOwnershipPct: number | null; // decimal 0–1
  insiderNet6mPct: number | null; // net insider transactions as % of shares (signed)
  insiderBuyCount6m: number | null;
  insiderSellCount6m: number | null;
  employees: number | null;
};

export async function fetchManagementSignals(
  ticker: string,
): Promise<ManagementSignals | null> {
  try {
    const res = await yf.quoteSummary(ticker, {
      modules: [
        "assetProfile",
        "defaultKeyStatistics",
        "majorHoldersBreakdown",
        "netSharePurchaseActivity",
      ],
    });

    // yahoo-finance2 types narrow heterogeneously across modules; cast to a
    // permissive record so we can read fields by name without fighting the
    // library's per-call union types.
    const profile = (res.assetProfile ?? {}) as Record<string, unknown>;
    const ks = (res.defaultKeyStatistics ?? {}) as Record<string, unknown>;
    const mhb = (res.majorHoldersBreakdown ?? {}) as Record<string, unknown>;
    const net = (res.netSharePurchaseActivity ?? {}) as Record<string, unknown>;

    // Find the CEO: the title usually contains "CEO" or "Chief Executive Officer".
    // Some companies split Chairman vs CEO — we prefer the explicit "CEO" title
    // so the person running the business day-to-day is surfaced, not the
    // ceremonial chair.
    type Officer = {
      name?: string;
      title?: string;
      yearBorn?: number;
      totalPay?: number;
    };
    const officersRaw = profile["companyOfficers"];
    const officers: Officer[] = Array.isArray(officersRaw)
      ? (officersRaw as Officer[])
      : [];
    const ceo =
      officers.find((o) =>
        /chief\s+executive\s+officer/i.test(o.title ?? ""),
      ) ||
      officers.find((o) => /\bCEO\b/i.test(o.title ?? "")) ||
      null;

    const currentYear = new Date().getFullYear();
    const ceoAge =
      ceo && typeof ceo.yearBorn === "number" ? currentYear - ceo.yearBorn : null;

    return {
      ceoName: ceo?.name ?? null,
      ceoTitle: ceo?.title ?? null,
      ceoAge,
      ceoTotalPay: nullable(ceo?.totalPay),
      insiderOwnershipPct:
        nullable(ks["heldPercentInsiders"]) ??
        nullable(mhb["insidersPercentHeld"]),
      insiderNet6mPct: nullable(net["netPercentInsiderShares"]),
      insiderBuyCount6m: nullable(net["buyInfoCount"]),
      insiderSellCount6m: nullable(net["sellInfoCount"]),
      employees: nullable(profile["fullTimeEmployees"]),
    };
  } catch (err) {
    console.warn(`fetchManagementSignals failed for ${ticker}:`, err);
    return null;
  }
}

// --- Relative valuation history ---
// Drift M (improvement #6): compute the business's *own* historical valuation
// distribution and compare today's multiple against it. This complements the
// DCF's absolute-floor view with the relative-to-self view Buffett/Munger use
// implicitly when judging compounders.
//
// Data pipeline:
//   1. Monthly close prices for up to 10 years (yfinance historical, interval=1mo).
//      → ~120 monthly price points. Aligned with the 10-year scoring window
//      cap (scorecard.ts SCORING_WINDOW_YEARS) — Buffett 1987 letter, Pat
//      Dorsey, Damodaran ch. 11 all anchor "long enough to span a cycle, short
//      enough to stay current".
//   2. Annual fundamentals (from the already-fetched multi-year series).
//      SEC EDGAR XBRL gives 10-18y for US filers; yfinance fallback gives
//      4-5y for foreign filers (TSM, BABA, etc. — they don't file XBRL with
//      SEC even when ADR-listed). When fundamentals are shorter than the
//      price window, the alignment loop below skips price points before the
//      first available fiscal year, so foreign-filer histories are capped by
//      their fundamentals span, not by the 10-year price window.
//   3. For each monthly price, use the most recently reported fiscal-year
//      values as the denominator → PE = price / EPS_FY, FCF yield = FCF_FY / price.
//
// The denominator is therefore stepped (changes at each fiscal year-end), but
// the price numerator moves every month — so the monthly PE series captures
// real month-to-month variation in how the market values this specific
// business.

export type RelativeValuationPoint = {
  date: string; // YYYY-MM-DD
  price: number;
  epsFy: number | null; // EPS of the most recent fiscal year ≤ date
  fcfPerShareFy: number | null;
  bookValuePerShareFy: number | null;
  peRatio: number | null;
  fcfYield: number | null; // FCF per share / price
  pbRatio: number | null; // price / book value per share (FY)
};

export type RelativeValuationHistory = {
  symbol: string;
  points: RelativeValuationPoint[];
  yearsOfData: number; // actual span in years from oldest usable point to newest
  reason?: string; // populated when we cannot build a useful history
};

export async function fetchRelativeValuationHistory(
  ticker: string,
): Promise<RelativeValuationHistory | null> {
  try {
    const today = new Date();
    const tenYearsAgo = new Date(
      today.getFullYear() - 10,
      today.getMonth(),
      1,
    );

    // Annual fundamentals: SEC first (10-18y), yfinance fallback (4-5y).
    // Monthly price history always via yfinance — SEC has no price feed.
    const [priceHistory, multiYear] = await Promise.all([
      yf.historical(ticker, {
        period1: tenYearsAgo.toISOString().slice(0, 10),
        period2: today.toISOString().slice(0, 10),
        interval: "1mo",
      }),
      fetchMultiYearFundamentals(ticker),
    ]);

    if (!Array.isArray(priceHistory) || priceHistory.length === 0) {
      return {
        symbol: ticker.toUpperCase(),
        points: [],
        yearsOfData: 0,
        reason: "No price history available",
      };
    }
    if (!multiYear || multiYear.years.length === 0) {
      return {
        symbol: ticker.toUpperCase(),
        points: [],
        yearsOfData: 0,
        reason: "No annual fundamentals available",
      };
    }

    // Normalize annual rows into the shape the price-alignment loop needs.
    const annual = multiYear.years
      .map((r) => ({
        date: r.fiscalYearEnd ? new Date(r.fiscalYearEnd) : null,
        netIncome: r.netIncome,
        freeCashFlow: r.freeCashFlow,
        dilutedShares: r.sharesDiluted,
        stockholdersEquity: r.stockholdersEquity,
      }))
      .filter(
        (r): r is {
          date: Date;
          netIncome: number | null;
          freeCashFlow: number | null;
          dilutedShares: number | null;
          stockholdersEquity: number | null;
        } => r.date !== null && !isNaN(r.date.getTime()),
      )
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    // Precompute EPS, FCF-per-share and book-value-per-share for each fiscal
    // year that has data.
    type FyPoint = {
      date: Date;
      eps: number | null;
      fcfPerShare: number | null;
      bookValuePerShare: number | null;
    };
    const fyPoints: FyPoint[] = annual.map((r) => ({
      date: r.date,
      eps:
        r.netIncome !== null && r.dilutedShares !== null && r.dilutedShares > 0
          ? r.netIncome / r.dilutedShares
          : null,
      fcfPerShare:
        r.freeCashFlow !== null && r.dilutedShares !== null && r.dilutedShares > 0
          ? r.freeCashFlow / r.dilutedShares
          : null,
      // Book value per share. Nullable when equity is ≤ 0 (aggressive buybacks
      // can push equity negative — AAPL, MCD at times), because a P/B with
      // negative denominator is meaningless. Those months will simply not
      // contribute to the distribution.
      bookValuePerShare:
        r.stockholdersEquity !== null &&
        r.stockholdersEquity > 0 &&
        r.dilutedShares !== null &&
        r.dilutedShares > 0
          ? r.stockholdersEquity / r.dilutedShares
          : null,
    }));

    // For each monthly price, walk to the latest fiscal year whose end is
    // ≤ price date. That year's fundamentals are the "most recently reported"
    // values the market had when the price was observed.
    const points: RelativeValuationPoint[] = [];
    for (const p of priceHistory) {
      if (
        !(p.date instanceof Date) ||
        typeof p.close !== "number" ||
        !Number.isFinite(p.close) ||
        p.close <= 0
      ) {
        continue;
      }
      const priceDate = p.date;
      let fy: FyPoint | null = null;
      for (const fp of fyPoints) {
        if (fp.date.getTime() <= priceDate.getTime()) fy = fp;
        else break;
      }
      if (!fy) continue;

      const peRatio =
        fy.eps !== null && fy.eps > 0 ? p.close / fy.eps : null;
      const fcfYield =
        fy.fcfPerShare !== null && fy.fcfPerShare > 0
          ? fy.fcfPerShare / p.close
          : null;
      const pbRatio =
        fy.bookValuePerShare !== null && fy.bookValuePerShare > 0
          ? p.close / fy.bookValuePerShare
          : null;

      points.push({
        date: priceDate.toISOString().slice(0, 10),
        price: p.close,
        epsFy: fy.eps,
        fcfPerShareFy: fy.fcfPerShare,
        bookValuePerShareFy: fy.bookValuePerShare,
        peRatio,
        fcfYield,
        pbRatio,
      });
    }

    if (points.length === 0) {
      return {
        symbol: ticker.toUpperCase(),
        points: [],
        yearsOfData: 0,
        reason: "Could not align price history with annual reports",
      };
    }

    const first = new Date(points[0].date).getTime();
    const last = new Date(points[points.length - 1].date).getTime();
    const yearsOfData = (last - first) / (365.25 * 24 * 3600 * 1000);

    return {
      symbol: ticker.toUpperCase(),
      points,
      yearsOfData,
    };
  } catch (err) {
    console.error(
      `fetchRelativeValuationHistory failed for ${ticker}:`,
      err,
    );
    return null;
  }
}

// --- US 10-year Treasury yield (^TNX) ---
// Used as the terminal growth rate in DCF. Philosophy: terminal growth can't
// exceed the risk-free long-term anchor indefinitely, and the treasury yield
// reflects current macro reality rather than a hardcoded guess.

export type TreasuryYield = {
  fiveYearAveragePct: number; // e.g. 0.034 for 3.4%
  currentPct: number;
  source: "yfinance_tnx" | "fallback";
};

const TREASURY_FALLBACK_PCT = 0.025;

export async function fetchTenYearTreasuryYieldAverage(): Promise<TreasuryYield> {
  try {
    const today = new Date();
    const fiveYearsAgo = new Date(today.getFullYear() - 5, today.getMonth(), today.getDate());
    // ^TNX is quoted in basis points × 10 (e.g. 42.35 = 4.235%).
    const history = await yf.historical("^TNX", {
      period1: fiveYearsAgo.toISOString().slice(0, 10),
      period2: today.toISOString().slice(0, 10),
      interval: "1mo",
    });

    if (!Array.isArray(history) || history.length === 0) {
      return {
        fiveYearAveragePct: TREASURY_FALLBACK_PCT,
        currentPct: TREASURY_FALLBACK_PCT,
        source: "fallback",
      };
    }

    const closes = history
      .map((h) => (typeof h.close === "number" ? h.close : null))
      .filter((v): v is number => v !== null && Number.isFinite(v));

    if (closes.length === 0) {
      return {
        fiveYearAveragePct: TREASURY_FALLBACK_PCT,
        currentPct: TREASURY_FALLBACK_PCT,
        source: "fallback",
      };
    }

    const avg = closes.reduce((s, v) => s + v, 0) / closes.length;
    const current = closes[closes.length - 1];
    // ^TNX is in percent units (e.g. 4.2 = 4.2%). Convert to decimal.
    return {
      fiveYearAveragePct: avg / 100,
      currentPct: current / 100,
      source: "yfinance_tnx",
    };
  } catch (err) {
    console.error("fetchTenYearTreasuryYieldAverage failed:", err);
    return {
      fiveYearAveragePct: TREASURY_FALLBACK_PCT,
      currentPct: TREASURY_FALLBACK_PCT,
      source: "fallback",
    };
  }
}

// Fetch the monthly closing price nearest a target date. Used to anchor the
// Buffett one-dollar retention test to a market cap 5 years ago.
export async function fetchHistoricalPriceNear(
  ticker: string,
  targetDate: Date,
): Promise<number | null> {
  try {
    const windowStart = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth() - 2,
      1,
    );
    const windowEnd = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth() + 2,
      28,
    );
    const history = await yf.historical(ticker, {
      period1: windowStart.toISOString().slice(0, 10),
      period2: windowEnd.toISOString().slice(0, 10),
      interval: "1mo",
    });
    if (!Array.isArray(history) || history.length === 0) return null;
    // Find the entry with the smallest |date − targetDate|.
    const targetMs = targetDate.getTime();
    let best: { close: number; diff: number } | null = null;
    for (const h of history) {
      const d = h.date instanceof Date ? h.date : new Date(h.date);
      const close = typeof h.close === "number" ? h.close : null;
      if (close === null || !Number.isFinite(close)) continue;
      const diff = Math.abs(d.getTime() - targetMs);
      if (!best || diff < best.diff) best = { close, diff };
    }
    return best?.close ?? null;
  } catch (err) {
    // Graceful degradation: the caller (retention multiple, among others)
    // treats null as "market cap history unavailable" and produces a
    // neutral signal rather than breaking the page. Warn rather than
    // error so Next.js's dev overlay doesn't treat a handled fallback
    // as a red-flag crash.
    console.warn(`fetchHistoricalPriceNear failed for ${ticker}:`, err);
    return null;
  }
}
