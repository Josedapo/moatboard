import {
  advanceStepAction,
  markOutsideCircleAction,
  regenerateUnderstandingAction,
} from "@/app/dashboard/analyze/[ticker]/actions";
import {
  getCurrentUnderstanding,
  saveNewUnderstanding,
} from "@/lib/businessUnderstanding";
import { generateBusinessUnderstanding } from "@/lib/businessUnderstandingAi";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import FollowupChat from "@/components/analysis/FollowupChat";
import BusinessUnderstandingView from "@/components/shared/BusinessUnderstandingView";

export default async function StepUnderstanding({ ticker }: { ticker: string }) {
  // Generate on first visit — expensive but one-shot, and cached per ticker
  // across users. Subsequent visits hit the DB instantly.
  let understanding = await getCurrentUnderstanding(ticker);
  let generationError: string | null = null;
  if (!understanding) {
    try {
      const { quote, fundamentals } = await fetchQuoteAndFundamentals(ticker);
      const { generated, model } = await generateBusinessUnderstanding(
        ticker,
        quote,
        fundamentals,
      );
      understanding = await saveNewUnderstanding({
        ticker,
        summaryMd: generated.summary_md,
        questionsAndAnswers: generated.questions_and_answers,
        sources: generated.sources,
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

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-navy-950">
              Entender el negocio
            </h2>
            <p className="mt-1 text-xs text-navy-500">
              Versión {understanding.version} · generada el {generatedOn}
            </p>
          </div>
          <form action={regenerateUnderstandingAction.bind(null, ticker)}>
            <button
              type="submit"
              className="text-sm font-medium text-navy-600 hover:text-navy-900"
            >
              Regenerar
            </button>
          </form>
        </div>

        <BusinessUnderstandingView understanding={understanding} />
      </section>

      <FollowupChat ticker={ticker} />

      <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
        <h3 className="mb-2 text-base font-semibold text-navy-900">
          ¿Entiendes el negocio?
        </h3>
        <p className="mb-4 text-sm text-navy-600">
          Sin comprensión clara, los números no importan. Buffett: nunca
          inviertas en un negocio que no entiendas.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <form
            action={advanceStepAction.bind(
              null,
              ticker,
              "red_flags",
              "understood",
            )}
          >
            <button
              type="submit"
              className="w-full rounded-lg bg-navy-900 px-4 py-3 text-sm font-medium text-white hover:bg-navy-800"
            >
              Sí, lo entiendo
            </button>
          </form>
          <form
            action={advanceStepAction.bind(
              null,
              ticker,
              "red_flags",
              "doubts_resolved",
            )}
          >
            <button
              type="submit"
              className="w-full rounded-lg border border-navy-300 bg-white px-4 py-3 text-sm font-medium text-navy-700 hover:border-navy-900"
            >
              Con dudas, pero continúo
            </button>
          </form>
          <form action={markOutsideCircleAction.bind(null, ticker)}>
            <input
              type="hidden"
              name="reason"
              value={`${ticker} fuera del círculo de competencia`}
            />
            <button
              type="submit"
              className="w-full rounded-lg border border-red-200 bg-white px-4 py-3 text-sm font-medium text-red-700 hover:border-red-500"
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
