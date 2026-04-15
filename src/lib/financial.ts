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
