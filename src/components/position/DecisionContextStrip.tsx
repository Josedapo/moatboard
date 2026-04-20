import type { DecisionContext } from "@/lib/positionContext";
import { getUnderstandingVersion } from "@/lib/businessUnderstanding";
import BusinessUnderstandingView from "@/components/shared/BusinessUnderstandingView";

// Renders one line per active condition. Server component — fetches the
// historical understanding version inline if drift is set, so the user can
// expand it without a navigation. No dismiss buttons — calmness through
// honesty, not through hiding.
export default async function DecisionContextStrip({
  ticker,
  context,
}: {
  ticker: string;
  context: DecisionContext;
}) {
  const lines: React.ReactNode[] = [];

  if (context.priorReasonOnInvestMd) {
    lines.push(
      <details key="prior" className="group">
        <summary className="cursor-pointer list-none text-sm leading-relaxed text-navy-800 hover:text-navy-950">
          <span className="mr-2 inline-block text-navy-400 transition-transform group-open:rotate-90">
            ▸
          </span>
          Habías parkeado este ticker antes de cambiar de opinión.
          <span className="ml-2 text-xs text-navy-500">Ver razón</span>
        </summary>
        <div className="mt-2 whitespace-pre-wrap rounded-md border border-navy-100 bg-white px-3 py-2 text-sm text-navy-700">
          {context.priorReasonOnInvestMd}
        </div>
      </details>,
    );
  }

  if (context.investedUnderstoodFlag === "doubts_resolved") {
    lines.push(
      <p key="doubts" className="text-sm leading-relaxed text-navy-800">
        Compraste con dudas{context.investedAt && ` el ${formatDate(context.investedAt)}`}.
        Revisa tus pre-commitments para ver si siguen abiertas.
      </p>,
    );
  }

  if (context.investedUnderstoodFlag === "not_understood") {
    lines.push(
      <p
        key="not_understood"
        className="text-sm leading-relaxed text-amber-900"
      >
        Compraste marcando &quot;no lo entiendo&quot;. Revisa si esto sigue
        siendo aceptable o conviene salir.
      </p>,
    );
  }

  if (context.understandingDrift) {
    const { currentVersion, versionAtInvest } = context.understandingDrift;
    const historical = await getUnderstandingVersion(ticker, versionAtInvest);
    lines.push(
      <details key="drift" className="group">
        <summary className="cursor-pointer list-none text-sm leading-relaxed text-navy-800 hover:text-navy-950">
          <span className="mr-2 inline-block text-navy-400 transition-transform group-open:rotate-90">
            ▸
          </span>
          El resumen del negocio se ha regenerado desde la compra (v
          {currentVersion} hoy vs v{versionAtInvest} cuando invertiste).
          <span className="ml-2 text-xs text-navy-500">
            Ver versión que viste al comprar
          </span>
        </summary>
        <div className="mt-2 rounded-md border border-navy-100 bg-white p-4">
          {historical ? (
            <BusinessUnderstandingView understanding={historical} />
          ) : (
            <p className="text-sm text-navy-500">
              No se encuentra la versión {versionAtInvest} en el archivo.
            </p>
          )}
        </div>
      </details>,
    );
  }

  if (lines.length === 0) return null;

  return (
    <section className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/40 px-5 py-4">
      <div className="space-y-3">{lines}</div>
    </section>
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
