import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getActiveSession } from "@/lib/analysisSessions";
import { getDraftPositionByTicker } from "@/lib/positions";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import DashboardNav from "@/components/DashboardNav";
import WizardShell from "@/components/analysis/WizardShell";
import StepUnderstanding from "@/components/analysis/StepUnderstanding";
import StepRedFlags from "@/components/analysis/StepRedFlags";
import StepQuality from "@/components/analysis/StepQuality";
import StepValuation from "@/components/analysis/StepValuation";
import StepDecision from "@/components/analysis/StepDecision";

export const metadata = {
  title: "Analyze",
};

export default async function AnalyzePage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker: rawTicker } = await params;
  const ticker = rawTicker.toUpperCase();

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
  const { quote } = await fetchQuoteAndFundamentals(ticker);

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
    case "decision":
      body = <StepDecision ticker={ticker} />;
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
      >
        {body}
      </WizardShell>
    </>
  );
}
