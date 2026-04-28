import Link from "next/link";
import type { AnalysisStep } from "@/lib/analysisSessions";
import {
  exitAnalysisAction,
  restartAnalysisAction,
  navigateToStepAction,
} from "@/app/dashboard/analyze/[ticker]/actions";
import WatchlistStarToggle from "@/components/WatchlistStarToggle";

// Ordered step labels for the indicator. "completed" is terminal and not
// rendered — the page redirects elsewhere when the session is completed.
// Quality runs first so the scorecard can short-circuit further AI spend.
// Post-2026-04-28: 4 linear steps; the wizard is now pure analysis with
// no terminal Decision step. Buy lives in /dashboard/comprar/[ticker];
// watchlist is the star toggle in the header.
const STEP_ORDER: { key: AnalysisStep; label: string }[] = [
  { key: "quality", label: "Quality" },
  { key: "understanding", label: "Understand" },
  { key: "red_flags", label: "Red flags" },
  { key: "valuation", label: "Valuation" },
];

export default function WizardShell({
  ticker,
  currentStep,
  furthestStep,
  companyName,
  isOnWatchlist,
  children,
}: {
  ticker: string;
  currentStep: AnalysisStep;
  furthestStep: AnalysisStep;
  companyName?: string | null;
  isOnWatchlist: boolean;
  children: React.ReactNode;
}) {
  const currentIndex = STEP_ORDER.findIndex((s) => s.key === currentStep);
  const furthestIndex = STEP_ORDER.findIndex((s) => s.key === furthestStep);

  return (
    <div className="flex min-h-screen flex-col bg-navy-50/40">
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">
        <Link
          href="/dashboard"
          className="mb-6 inline-block text-sm text-navy-600 hover:text-navy-900"
        >
          &larr; Dashboard
        </Link>

        {/* Header: ticker + company + restart/exit actions */}
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-md bg-navy-900 px-2.5 py-1 text-sm font-bold text-white">
                {ticker}
              </span>
              {companyName && (
                <h1 className="text-xl font-bold text-navy-950">
                  {companyName}
                </h1>
              )}
              <WatchlistStarToggle
                ticker={ticker}
                isOnWatchlist={isOnWatchlist}
              />
            </div>
            <p className="mt-2 text-xs text-navy-500">
              Análisis guiado — quality, business, red flags y valoración.
              Al final podrás comprar o cerrar.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <form action={exitAnalysisAction.bind(null, ticker)}>
              <button
                type="submit"
                className="text-sm font-medium text-navy-600 hover:text-navy-900"
              >
                Save &amp; exit
              </button>
            </form>
            <span className="text-navy-300">·</span>
            <form action={restartAnalysisAction.bind(null, ticker)}>
              <button
                type="submit"
                className="text-sm font-medium text-navy-500 hover:text-red-600"
              >
                Restart
              </button>
            </form>
          </div>
        </header>

        {/* Step indicator — past steps are clickable so the user can revisit
            what's already been computed (quality, valuation, etc.) while in
            a later step. Future steps are non-interactive: no jumping ahead. */}
        <ol className="mb-6 flex flex-wrap items-center gap-2 text-xs">
          {STEP_ORDER.map((step, i) => {
            const isCurrent = i === currentIndex;
            // Accessible = user has already reached this step at some point
            // (either it's behind the current one, or it's ahead but within
            // the furthest-reached range — e.g. they walked to Valuation and
            // then clicked back to Quality, so Valuation is still accessible).
            const isAccessible = !isCurrent && i <= furthestIndex;
            const tone = isCurrent
              ? "bg-navy-900 text-white"
              : isAccessible
                ? "bg-navy-200 text-navy-700 hover:bg-navy-300"
                : "bg-white text-navy-400 border border-navy-200";
            const label = `${i + 1}. ${step.label}`;
            return (
              <li key={step.key} className="flex items-center gap-2">
                {isAccessible ? (
                  <form
                    action={navigateToStepAction.bind(null, ticker, step.key)}
                  >
                    <button
                      type="submit"
                      className={`rounded-full px-3 py-1 font-medium ${tone}`}
                    >
                      {label}
                    </button>
                  </form>
                ) : (
                  <span className={`rounded-full px-3 py-1 font-medium ${tone}`}>
                    {label}
                  </span>
                )}
                {i < STEP_ORDER.length - 1 && (
                  <span className="text-navy-300">→</span>
                )}
              </li>
            );
          })}
        </ol>

        {children}
      </main>
    </div>
  );
}
