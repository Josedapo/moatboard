import {
  advanceStepAction,
  markOutsideCircleAction,
  regenerateUnderstandingAction,
} from "@/app/dashboard/analyze/[ticker]/actions";
import {
  getCurrentUnderstanding,
  saveNewUnderstanding,
  isBusinessUnderstandingStale,
} from "@/lib/businessUnderstanding";
import { generateBusinessUnderstanding } from "@/lib/businessUnderstandingAi";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import { fetchLatestAnnualFiling } from "@/lib/secFilings";
import { prepareUnderstandingFiling } from "@/lib/filingForPrompt";
import FollowupChat from "@/components/analysis/FollowupChat";
import BusinessUnderstandingView from "@/components/shared/BusinessUnderstandingView";
import { SubmitButton, PendingOverlay } from "@/components/analysis/WizardPending";

export default async function StepUnderstanding({ ticker }: { ticker: string }) {
  // Generate on first visit — expensive but one-shot, and cached per ticker
  // across users. Subsequent visits hit the DB instantly.
  let understanding = await getCurrentUnderstanding(ticker);
  let generationError: string | null = null;
  if (!understanding) {
    try {
      const [{ quote, fundamentals }, filing] = await Promise.all([
        fetchQuoteAndFundamentals(ticker),
        prepareUnderstandingFiling(ticker),
      ]);
      const { generated, model } = await generateBusinessUnderstanding(
        ticker,
        quote,
        fundamentals,
        filing,
      );
      understanding = await saveNewUnderstanding({
        ticker,
        summaryMd: generated.summary_md,
        questionsAndAnswers: generated.questions_and_answers,
        sources: generated.sources,
        last10kAccession: filing?.accession ?? null,
        last10kPeriodEnd: filing?.reportDate ?? null,
        model,
      });
    } catch (err) {
      generationError =
        err instanceof Error
          ? err.message
          : "Failed to generate business understanding";
    }
  }

  if (generationError || !understanding) {
    return (
      <section className="mb-6 rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-xl font-bold text-navy-950">
          Couldn&apos;t generate the business explanation
        </h2>
        <p className="text-sm text-red-700">
          {generationError ?? "Unknown error"}
        </p>
      </section>
    );
  }

  const generatedOn = formatDate(understanding.generated_at);

  // Stale check: if SEC has a newer 10-K than the one this row was
  // grounded in, surface a banner. We intentionally do NOT auto-
  // regenerate — Joseda decides when to refresh.
  const latestFiling = await fetchLatestAnnualFiling(ticker).catch(() => null);
  const isStale =
    latestFiling != null &&
    isBusinessUnderstandingStale(understanding, latestFiling.accession);

  const sourceFiling = understanding.sources.find((s) => s.type === "10k");

  return (
    <div className="space-y-6">
      {isStale && latestFiling && (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Nuevo {latestFiling.form} disponible
              </p>
              <p className="mt-1 text-xs text-amber-800">
                Publicado el {formatDate(latestFiling.filingDate)}
                {latestFiling.reportDate
                  ? ` (FY ${latestFiling.reportDate})`
                  : ""}
                . Esta explicación se generó a partir del filing anterior.
              </p>
            </div>
            <form action={regenerateUnderstandingAction.bind(null, ticker)}>
              <PendingOverlay
                message="Moatboard está leyendo el nuevo 10-K…"
              />
              <SubmitButton
                pendingLabel="Regenerando…"
                className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
              >
                Regenerar con nuevo {latestFiling.form}
              </SubmitButton>
            </form>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-navy-950">
              Entender el negocio
            </h2>
            <p className="mt-1 text-xs text-navy-500">
              Versión {understanding.version} · generada el {generatedOn}
            </p>
            {sourceFiling && (
              <p className="mt-1 text-xs text-navy-500">
                Basado en{" "}
                <a
                  href={sourceFiling.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-navy-700"
                >
                  {sourceFiling.label}
                </a>
              </p>
            )}
          </div>
          <form action={regenerateUnderstandingAction.bind(null, ticker)}>
            <PendingOverlay message="Moatboard está regenerando el resumen…" />
            <SubmitButton
              pendingLabel="Regenerando…"
              className="text-sm font-medium text-navy-600 hover:text-navy-900 disabled:opacity-60"
            >
              Regenerar
            </SubmitButton>
          </form>
        </div>

        <BusinessUnderstandingView understanding={understanding} />
      </section>

      <FollowupChat ticker={ticker} />

      <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
        <p className="mb-4 text-sm text-navy-700">
          Sin comprensión clara, los números no importan. Si entiendes el
          negocio, continúa a las red flags. Si no, márcalo fuera del círculo
          de competencia para no volver a perder tiempo analizándolo.
        </p>
        <div className="flex flex-wrap gap-3">
          <form
            action={advanceStepAction.bind(
              null,
              ticker,
              "red_flags",
              "understood",
            )}
          >
            <PendingOverlay message="Moatboard está revisando los red flags del 10-K…" />
            <SubmitButton
              pendingLabel="Procesando…"
              className="rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-60"
            >
              Sí, lo entiendo →
            </SubmitButton>
          </form>
          <form
            action={advanceStepAction.bind(
              null,
              ticker,
              "red_flags",
              "doubts_resolved",
            )}
          >
            <PendingOverlay message="Moatboard está revisando los red flags del 10-K…" />
            <SubmitButton
              pendingLabel="Procesando…"
              className="rounded-lg border border-navy-300 bg-white px-5 py-2.5 text-sm font-medium text-navy-700 hover:border-navy-900 disabled:opacity-60"
            >
              Con dudas, pero continúo
            </SubmitButton>
          </form>
          <form action={markOutsideCircleAction.bind(null, ticker)}>
            <input
              type="hidden"
              name="reason"
              value={`${ticker} fuera del círculo de competencia`}
            />
            <button
              type="submit"
              className="rounded-lg border border-red-200 bg-white px-5 py-2.5 text-sm font-medium text-red-700 hover:border-red-500"
            >
              No lo entiendo
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("es-ES", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}
