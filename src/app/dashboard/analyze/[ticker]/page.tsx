import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getActiveSession } from "@/lib/analysisSessions";
import { getDraftPositionByTicker } from "@/lib/positions";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import { isOnWatchlist as queryIsOnWatchlist } from "@/lib/watchlistEntries";
import DashboardNav from "@/components/DashboardNav";
import WizardShell from "@/components/analysis/WizardShell";
import StepUnderstanding from "@/components/analysis/StepUnderstanding";
import StepRedFlags from "@/components/analysis/StepRedFlags";
import StepQuality from "@/components/analysis/StepQuality";
import StepValuation from "@/components/analysis/StepValuation";

export const metadata = {
  title: "Analyze",
};

export default async function AnalyzePage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<{ aliasNotice?: string }>;
}) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();
  const { aliasNotice: rawAliasNotice } = await searchParams;
  const aliasNotice =
    rawAliasNotice && /^[A-Z-]{1,10}$/.test(rawAliasNotice.toUpperCase())
      ? rawAliasNotice.toUpperCase()
      : null;

  const session = await auth();
  if (!session?.user?.id) return null; // proxy redirects

  // Both the draft position and the active analysis session are expected to
  // exist at this point — they are created together by startAnalysisAction on
  // the dashboard. If either is missing, the user likely navigated directly
  // to the URL without going through the entry form. Send them back.
  const [draft, active] = await Promise.all([
    getDraftPositionByTicker(session.user.id, ticker),
    getActiveSession({ userId: session.user.id, ticker }),
  ]);
  if (!draft || !active) {
    redirect("/dashboard");
  }

  // Completed sessions shouldn't route here (completeSession redirects), but
  // guard anyway so a stale URL doesn't render a broken step.
  if (active.current_step === "completed") {
    redirect("/dashboard");
  }

  // Fetch the quote once — the header and the downstream ensure* helpers all
  // read it. fetchQuoteAndFundamentals is a single yfinance call so there's no
  // benefit to deferring.
  const [{ quote }, isWatchlisted] = await Promise.all([
    fetchQuoteAndFundamentals(ticker),
    queryIsOnWatchlist({ userId: session.user.id, ticker }),
  ]);

  let body: React.ReactNode;
  switch (active.current_step) {
    case "understanding":
      body = <StepUnderstanding ticker={ticker} />;
      break;
    case "red_flags":
      body = <StepRedFlags ticker={ticker} />;
      break;
    case "quality":
      body = (
        <StepQuality
          ticker={ticker}
          quote={quote}
          draftPositionId={draft.id}
        />
      );
      break;
    case "valuation":
      body = <StepValuation ticker={ticker} draftPositionId={draft.id} />;
      break;
    default:
      body = null;
  }

  return (
    <>
      <DashboardNav />
      <WizardShell
        ticker={ticker}
        currentStep={active.current_step}
        furthestStep={active.furthest_step}
        companyName={quote?.longName ?? null}
        isOnWatchlist={isWatchlisted}
      >
        {aliasNotice && (
          <p className="mb-6 border-l-2 border-navy-300 bg-navy-50/40 px-4 py-3 text-sm italic text-navy-700">
            {aliasNotice} y {ticker} son el mismo negocio
            {quote?.longName ? ` (${quote.longName})` : ""}, distintas
            clases de acciones. Moatboard analiza el negocio bajo {ticker}{" "}
            para no duplicar trabajo. Si compras una clase u otra,
            regístrala con su ticker real para que el coste y el precio
            sean correctos.
          </p>
        )}
        {body}
      </WizardShell>
    </>
  );
}
