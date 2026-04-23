import {
  advanceStepAction,
  regenerateRedFlagsAction,
} from "@/app/dashboard/analyze/[ticker]/actions";
import { getRedFlags, saveRedFlags } from "@/lib/redFlags";
import { generateRedFlags } from "@/lib/redFlagsAi";
import { fetchQuoteAndFundamentals } from "@/lib/financial";
import { prepareRedFlagsFiling } from "@/lib/filingForPrompt";
import { buildFilingIndexUrlFromAccession } from "@/lib/secFilings";
import RedFlagsList from "@/components/shared/RedFlagsList";
import { SubmitButton, PendingOverlay } from "@/components/analysis/WizardPending";

export default async function StepRedFlags({ ticker }: { ticker: string }) {
  let cached = await getRedFlags(ticker);
  let generationError: string | null = null;

  if (!cached) {
    try {
      const [{ quote, fundamentals }, filing] = await Promise.all([
        fetchQuoteAndFundamentals(ticker),
        prepareRedFlagsFiling(ticker),
      ]);
      const { flags, model } = await generateRedFlags(
        ticker,
        quote,
        fundamentals,
        filing,
      );
      cached = await saveRedFlags({
        ticker,
        flags,
        last10kAccession: filing?.accession ?? null,
        last10kPeriodEnd: filing?.reportDate ?? null,
        model,
      });
    } catch (err) {
      generationError =
        err instanceof Error ? err.message : "Failed to generate red flags";
    }
  }

  if (generationError || !cached) {
    return (
      <section className="mb-6 rounded-2xl border border-red-200 bg-white p-6 shadow-sm">
        <h2 className="mb-2 text-xl font-bold text-navy-950">
          No se han podido generar las red flags
        </h2>
        <p className="text-sm text-red-700">
          {generationError ?? "Error desconocido"}
        </p>
      </section>
    );
  }

  const generatedOn = formatDate(cached.generated_at);
  const filingUrl = cached.last_10k_accession
    ? buildFilingIndexUrlFromAccession(cached.last_10k_accession)
    : null;
  const filingPeriodLabel = cached.last_10k_period_end
    ? `FY ${cached.last_10k_period_end}`
    : cached.last_10k_accession
      ? `accession ${cached.last_10k_accession}`
      : null;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-navy-950">
              Red flags cualitativas
            </h2>
            <p className="mt-1 text-xs text-navy-500">
              Generadas el {generatedOn}
            </p>
            {filingPeriodLabel && (
              <p className="mt-1 text-xs text-navy-500">
                Basado en{" "}
                {filingUrl ? (
                  <a
                    href={filingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-navy-700"
                  >
                    10-K {filingPeriodLabel}
                  </a>
                ) : (
                  <>10-K {filingPeriodLabel}</>
                )}
              </p>
            )}
            {!cached.last_10k_accession && (
              <p className="mt-1 text-xs text-amber-700">
                Sin 10-K reciente disponible — fallback a conocimiento general.
              </p>
            )}
          </div>
          <form action={regenerateRedFlagsAction.bind(null, ticker)}>
            <PendingOverlay message="Claude está re-escaneando el 10-K…" />
            <SubmitButton
              pendingLabel="Regenerando…"
              className="text-sm font-medium text-navy-600 hover:text-navy-900 disabled:opacity-60"
            >
              Regenerar
            </SubmitButton>
          </form>
        </div>

        <RedFlagsList flags={cached.flags} />
      </section>

      <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
        <p className="mb-4 text-sm text-navy-700">
          Si las red flags no bloquean tu interés, continúa a la evaluación
          de calidad. Si alguna es grave, salta directamente a la decisión
          para descartar la empresa o moverla a la watchlist sin gastar más
          análisis.
        </p>
        <div className="flex flex-wrap gap-3">
          <form action={advanceStepAction.bind(null, ticker, "quality", null)}>
            <PendingOverlay message="Claude está evaluando la calidad del negocio…" />
            <SubmitButton
              pendingLabel="Procesando…"
              className="rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-60"
            >
              Continuar al análisis de calidad →
            </SubmitButton>
          </form>
          <form action={advanceStepAction.bind(null, ticker, "decision", null)}>
            <button
              type="submit"
              className="rounded-lg border border-navy-300 bg-white px-5 py-2.5 text-sm font-medium text-navy-700 hover:border-navy-900"
            >
              Saltar a la decisión
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
