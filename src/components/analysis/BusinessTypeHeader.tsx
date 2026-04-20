import {
  isBalanceSheetBusiness,
  isRealEstate,
} from "@/lib/scorecard";
import type { Quote } from "@/lib/financial";
import type { ScorecardSummary } from "@/lib/verdict";

type BusinessType = "product" | "balance_sheet" | "reit";

const TYPE_META: Record<
  BusinessType,
  { label: string; description: string }
> = {
  product: {
    label: "Product business",
    description:
      "Makes money by selling goods or services. Quality is judged on return on capital, margins, cash conversion, and balance sheet discipline.",
  },
  balance_sheet: {
    label: "Balance-sheet business",
    description:
      "Banks, insurers, asset managers, mortgage finance, health insurers. Profit comes from the balance sheet — ROE, ROA, and book value growth matter more than classic cash-flow metrics.",
  },
  reit: {
    label: "REIT (real estate)",
    description:
      "Equity REITs report AFFO (adjusted funds from operations) rather than classic earnings. Quality is judged on payout discipline, leverage, and AFFO per share growth.",
  },
};

type DimensionMeta = {
  key: keyof ScorecardSummary["dimensions"];
  label: string;
};

const DIMENSIONS_BY_TYPE: Record<BusinessType, DimensionMeta[]> = {
  product: [
    { key: "returnOnInvestedCapital", label: "ROIC" },
    { key: "grossMargin", label: "Gross margin" },
    { key: "fcfMargin", label: "FCF margin" },
    { key: "operatingMargins", label: "Operating margin" },
    { key: "shareCountTrend", label: "Share count trend" },
    { key: "debtToEquity", label: "Debt to equity" },
    { key: "revenueGrowth", label: "Revenue growth" },
  ],
  balance_sheet: [
    { key: "operatingMargins", label: "Operating margin" },
    { key: "shareCountTrend", label: "Share count trend" },
    { key: "revenueGrowth", label: "Revenue growth" },
    { key: "returnOnEquity", label: "ROE multi-year" },
    { key: "returnOnAssets", label: "ROA multi-year" },
    { key: "bookValuePerShareCagr", label: "BV/share 5y CAGR" },
  ],
  reit: [
    { key: "fcfMargin", label: "FCF margin" },
    { key: "operatingMargins", label: "Operating margin" },
    { key: "shareCountTrend", label: "Share count trend" },
    { key: "revenueGrowth", label: "Revenue growth" },
    { key: "affoPayoutRatio", label: "AFFO payout ratio" },
    { key: "netDebtToEbitda", label: "Net Debt / EBITDA" },
    { key: "affoPerShareCagr", label: "AFFO/share 5y CAGR" },
  ],
};

function classifyBusinessType(quote: Quote | null): BusinessType {
  const sector = quote?.sector ?? null;
  const industry = quote?.industry ?? null;
  if (isBalanceSheetBusiness(sector, industry)) return "balance_sheet";
  if (isRealEstate(sector)) return "reit";
  return "product";
}

export default function BusinessTypeHeader({
  ticker,
  quote,
  scorecardSummary,
}: {
  ticker: string;
  quote: Quote | null;
  scorecardSummary: ScorecardSummary;
}) {
  const type = classifyBusinessType(quote);
  const meta = TYPE_META[type];
  const typeDimensions = DIMENSIONS_BY_TYPE[type];
  const dims = scorecardSummary.dimensions;
  const scored = typeDimensions.filter((d) => dims[d.key] !== "neutral");
  const notApplicable = typeDimensions.filter((d) => dims[d.key] === "neutral");

  return (
    <section className="mb-6 rounded-2xl border border-navy-100 bg-white p-5 shadow-sm">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="rounded-full bg-navy-100 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider text-navy-700">
            {meta.label}
          </span>
          {(quote?.sector || quote?.industry) && (
            <span className="text-xs text-navy-500">
              {quote?.sector}
              {quote?.industry && ` · ${quote.industry}`}
            </span>
          )}
        </div>
        <span className="text-xs text-navy-500">
          Scoring {scored.length} of {typeDimensions.length} dimensions for{" "}
          {ticker}
        </span>
      </div>

      <p className="mb-3 text-sm leading-relaxed text-navy-600">
        {meta.description}
      </p>

      <div className="flex flex-wrap gap-1.5">
        {scored.map((d) => (
          <span
            key={d.key}
            className="rounded-md border border-navy-200 bg-navy-50 px-2 py-0.5 text-xs text-navy-700"
          >
            {d.label}
          </span>
        ))}
      </div>

      {notApplicable.length > 0 && (
        <details className="mt-3 text-xs text-navy-500">
          <summary className="cursor-pointer hover:text-navy-700">
            {notApplicable.length}{" "}
            {notApplicable.length === 1 ? "dimension" : "dimensions"} not
            applicable to this business
          </summary>
          <ul className="mt-2 space-y-1 pl-4">
            {notApplicable.map((d) => (
              <li key={d.key}>
                {d.label}{" "}
                <span className="text-navy-400">
                  — data not reported in a form the framework can score
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
