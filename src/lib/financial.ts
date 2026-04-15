import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

export type Quote = {
  symbol: string;
  shortName: string | null;
  longName: string | null;
  currency: string | null;
  regularMarketPrice: number | null;
  marketCap: number | null;
  sharesOutstanding: number | null;
  sector: string | null;
  industry: string | null;
  website: string | null;
  longBusinessSummary: string | null;
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
  // Dividend
  dividendYield: number | null;
  payoutRatio: number | null;
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
      ],
    });

    const price = result.price;
    const profile = result.assetProfile ?? result.summaryProfile;
    const fd = result.financialData;
    const ks = result.defaultKeyStatistics;
    const sd = result.summaryDetail;

    const sharesOutstanding =
      price?.marketCap && price?.regularMarketPrice
        ? price.marketCap / price.regularMarketPrice
        : null;

    const quote: Quote | null = price
      ? {
          symbol: price.symbol ?? ticker.toUpperCase(),
          shortName: price.shortName ?? null,
          longName: price.longName ?? null,
          currency: price.currency ?? null,
          regularMarketPrice: price.regularMarketPrice ?? null,
          marketCap: price.marketCap ?? null,
          sharesOutstanding,
          sector: profile?.sector ?? null,
          industry: profile?.industry ?? null,
          website: profile?.website ?? null,
          longBusinessSummary: profile?.longBusinessSummary ?? null,
        }
      : null;

    const fundamentals: Fundamentals = {
      symbol: ticker.toUpperCase(),
      returnOnEquity: fd?.returnOnEquity ?? null,
      returnOnAssets: fd?.returnOnAssets ?? null,
      profitMargins: fd?.profitMargins ?? null,
      operatingMargins: fd?.operatingMargins ?? null,
      grossMargins: fd?.grossMargins ?? null,
      freeCashflow: fd?.freeCashflow ?? null,
      operatingCashflow: fd?.operatingCashflow ?? null,
      totalDebt: fd?.totalDebt ?? null,
      totalCash: fd?.totalCash ?? null,
      debtToEquity: fd?.debtToEquity ?? null,
      currentRatio: fd?.currentRatio ?? null,
      earningsGrowth: fd?.earningsGrowth ?? null,
      revenueGrowth: fd?.revenueGrowth ?? null,
      trailingPE: sd?.trailingPE ?? null,
      forwardPE: sd?.forwardPE ?? null,
      priceToBook: ks?.priceToBook ?? null,
      dividendYield: sd?.dividendYield ?? null,
      payoutRatio: sd?.payoutRatio ?? null,
    };

    return { quote, fundamentals };
  } catch (err) {
    console.error(`fetchQuoteAndFundamentals failed for ${ticker}:`, err);
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
  ebit: number | null;
  taxRate: number | null;
  netIncome: number | null;
  depreciationAmortization: number | null;
  capitalExpenditure: number | null; // yfinance sign: typically negative
  operatingCashFlow: number | null;
  freeCashFlow: number | null;
  investedCapital: number | null;
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

export async function fetchMultiYearFundamentals(
  ticker: string,
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

    const mapped: AnnualFundamentalRow[] = rows.map((r) => ({
      fiscalYearEnd:
        r.date instanceof Date
          ? r.date.toISOString().slice(0, 10)
          : String(r.date ?? ""),
      revenue: nullable(r["totalRevenue"]),
      ebit: nullable(r["EBIT"] ?? r["operatingIncome"]),
      taxRate: nullable(r["taxRateForCalcs"]),
      netIncome: nullable(r["netIncome"]),
      depreciationAmortization: nullable(
        r["depreciationAndAmortization"] ?? r["reconciledDepreciation"],
      ),
      capitalExpenditure: nullable(r["capitalExpenditure"]),
      operatingCashFlow: nullable(r["operatingCashFlow"]),
      freeCashFlow: nullable(r["freeCashFlow"]),
      investedCapital: nullable(r["investedCapital"]),
      totalDebt: nullable(r["totalDebt"]),
      cash: nullable(r["cashAndCashEquivalents"]),
      stockholdersEquity: nullable(
        r["stockholdersEquity"] ?? r["commonStockEquity"],
      ),
      sharesDiluted: nullable(r["dilutedAverageShares"]),
      repurchaseOfCapitalStock: nullable(r["repurchaseOfCapitalStock"]),
      cashDividendsPaid: nullable(r["cashDividendsPaid"]),
    }));

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
    console.error(`fetchMultiYearFundamentals failed for ${ticker}:`, err);
    return null;
  }
}

function nullable(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
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
    console.error(`fetchManagementSignals failed for ${ticker}:`, err);
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
