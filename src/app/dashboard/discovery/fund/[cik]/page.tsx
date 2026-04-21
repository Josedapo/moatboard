import { auth } from "@/auth";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getFundDetail, computeFundMovements } from "@/lib/discoveryFund";
import DashboardNav from "@/components/DashboardNav";
import FundHoldingsTable from "@/components/FundHoldingsTable";
import FundMovementsSummary from "@/components/FundMovementsSummary";

const TIER_LABEL: Record<string, string> = {
  A: "Quality Compounders",
  B: "Value",
  C: "Growth / GARP",
  D: "Concentrated",
  E: "Hedge funds (long book)",
};

const TIER_CHIP: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-800",
  B: "bg-teal-100 text-teal-800",
  C: "bg-navy-100 text-navy-700",
  D: "bg-navy-100 text-navy-700",
  E: "bg-navy-50 text-navy-500",
};

export const metadata = {
  title: "Fund detail · Discovery · Moatboard",
};

export default async function DiscoveryFundPage(props: {
  params: Promise<{ cik: string }>;
}) {
  const { cik } = await props.params;
  const session = await auth();
  if (!session?.user?.id) redirect("/auth/signin");

  const detail = await getFundDetail({ userId: session.user.id, cik });
  if (!detail) notFound();

  const { fund, filing, holdings, priorFiling } = detail;
  const quarterLabel = filing ? formatQuarter(filing.period_of_report) : "—";
  const priorLabel = priorFiling
    ? formatQuarter(priorFiling.period_of_report)
    : null;

  // Only compute movements when we have two filings to compare.
  const movements =
    filing && priorFiling
      ? await computeFundMovements({
          userId: session.user.id,
          latestFilingId: filing.id,
          priorFilingId: priorFiling.id,
          latestPeriod: filing.period_of_report,
          priorPeriod: priorFiling.period_of_report,
        })
      : null;

  return (
    <div className="flex min-h-screen flex-col">
      <DashboardNav />
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
        <div className="mb-4">
          <Link
            href="/dashboard/discovery"
            className="text-sm text-navy-600 hover:text-navy-900"
          >
            ← Discovery
          </Link>
        </div>

        <header className="mb-8 rounded-2xl border border-navy-100 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold ${TIER_CHIP[fund.tier]}`}
                >
                  Tier {fund.tier}
                </span>
                <span className="text-[11px] uppercase tracking-wider text-navy-500">
                  {TIER_LABEL[fund.tier]}
                </span>
                <span className="text-[11px] text-navy-400">
                  · peso {fund.tier_weight.toFixed(1)}
                </span>
              </div>
              <h1 className="text-2xl font-bold text-navy-950">
                {fund.display_name}
              </h1>
              <p className="mt-0.5 text-xs text-navy-500">
                {fund.manager_name} · CIK {fund.cik}
              </p>
              {fund.philosophy && (
                <p className="mt-3 max-w-3xl text-sm text-navy-700">
                  {fund.philosophy}
                </p>
              )}
            </div>
            {filing && (
              <div className="min-w-56 rounded-lg bg-navy-50 p-4 text-sm">
                <p className="text-xs uppercase tracking-wider text-navy-500">
                  Último 13F-HR
                </p>
                <p className="mt-1 text-lg font-semibold text-navy-950">
                  {quarterLabel}
                </p>
                <p className="mt-1 font-mono text-xs text-navy-600">
                  {filing.holdings_count} posiciones ·{" "}
                  ${(filing.total_value_usd / 1e9).toFixed(2)}B
                </p>
                {priorLabel && (
                  <p className="mt-1 text-[11px] text-navy-400">
                    Anterior: {priorLabel}
                  </p>
                )}
                {filing.source_url && (
                  <a
                    href={filing.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-block text-xs text-navy-600 underline hover:text-navy-900"
                  >
                    Ver en EDGAR ↗
                  </a>
                )}
              </div>
            )}
          </div>
        </header>

        {movements && (
          <section className="mb-6">
            <FundMovementsSummary movements={movements} />
          </section>
        )}

        {holdings.length === 0 ? (
          <p className="text-sm text-navy-600">
            Aún no hay holdings ingeridos para este fondo.
          </p>
        ) : (
          <FundHoldingsTable holdings={holdings} />
        )}
      </main>
    </div>
  );
}

function formatQuarter(ymd: string): string {
  const [yStr, mStr] = ymd.split("-");
  const month = Number(mStr);
  const q =
    month <= 3 ? "Q1" : month <= 6 ? "Q2" : month <= 9 ? "Q3" : "Q4";
  return `${q} ${yStr}`;
}
