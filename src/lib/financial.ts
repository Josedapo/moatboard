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
