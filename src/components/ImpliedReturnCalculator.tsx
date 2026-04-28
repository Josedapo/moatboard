// Implied Return Calculator — primary widget of the Valuation section.
//
// Frames valuation operationally as "what return can I expect at this
// price?" instead of "is this below intrinsic?". The frame Buffett
// post-1985, Smith and Akre use. See `lib/impliedReturn.ts` for the math.
//
// 2026-04-25 redesign — three visual zones, top to bottom:
//
//   ZONE 1 · CONCLUSION  (verdict card, prominent, color-toned)
//     The reader's headline: comprable or not, with the two-step checks.
//
//   ZONE 2 · CALCULATION (the math, dense and uniform)
//     A single 3-column table — Componente · Base · Estrés — that contains
//     every number that drives the verdict. Below it, threshold + floor in
//     two compact lines.
//
//   ZONE 3 · DETAILS     (collapsed by default)
//     Anchors, formulas, tier table, footnotes. Available when the reader
//     wants to audit a number, not in the way when they don't.

import type { ImpliedReturnStoredAssumptions } from "@/lib/valuations";
import { VERDICT_LABELS } from "@/lib/impliedReturn";
import MultipleRowEditable from "@/components/MultipleRowEditable";
import GrowthRowEditable from "@/components/GrowthRowEditable";

// Disclaimer trigger threshold — when current/peer ratio reaches this,
// the calculator surfaces a meta-commentary card. Anchored on Damodaran's
// general "1.5× sector median = stretched" rule of thumb.
const PEER_MEDIAN_DISCLAIMER_RATIO = 1.5;

const TIER_LABEL: Record<
  ImpliedReturnStoredAssumptions["quality_tier"],
  string
> = {
  exceptional: "Exceptional",
  good: "Good",
  mediocre: "Mediocre",
  poor: "Poor",
};

const TIER_RATIONALE: Record<
  ImpliedReturnStoredAssumptions["quality_tier"],
  string
> = {
  exceptional:
    "Moat ancho + ROIC alto + runway largo. Varianza baja alrededor del caso base, así que el escenario malo no es desastre — basta con 12% de retorno esperado.",
  good: "Moat menos duradero o runway más corto. Mayor probabilidad de erosión, exigimos algo más de prima.",
  mediocre:
    "Calidad media: el escenario malo puede ser realmente malo. Exigimos retorno alto que compense la asimetría.",
  poor: "Calidad insuficiente para invertir bajo el framework — debería estar bloqueado por la gate.",
};

export default function ImpliedReturnCalculator({
  positionId,
  ticker,
  currentPrice,
  assumptions,
  ephemeral = false,
}: {
  positionId: number;
  ticker: string;
  currentPrice: number;
  assumptions: ImpliedReturnStoredAssumptions;
  // Render-only mode: no per-row override editors. Used by the unified
  // ficha at /dashboard/ticker/[symbol] when there's no per-position
  // valuation row (Discovery puro / closed positions). The Analizar CTA
  // lives at the ficha level, not inside the calculator.
  ephemeral?: boolean;
}) {
  const verdictTone =
    assumptions.verdict === "comprable" ? "positive" : "negative";

  return (
    <div className="overflow-hidden rounded-lg border border-navy-200 bg-white">
      {/* Header (slim, neutral) */}
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-navy-100 bg-white px-6 py-4">
        <div>
          <h3 className="text-base font-bold text-navy-900">
            {ticker ? `${ticker} · ` : ""}Análisis de retorno implícito
          </h3>
          <p className="mt-1 text-xs text-navy-500">
            ¿Qué retorno puedo esperar a 10 años a este precio?
          </p>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-navy-500">
            Precio actual
          </div>
          <div className="text-lg font-bold tabular-nums text-navy-900">
            ${currentPrice.toFixed(2)}
          </div>
        </div>
      </div>

      {/* ─── ZONE 1 · CONCLUSIÓN ──────────────────────────────────── */}
      <ConclusionZone
        assumptions={assumptions}
        verdictTone={verdictTone}
      />

      {/* ─── ZONE 2 · CÁLCULO ─────────────────────────────────────── */}
      <CalculationZone
        positionId={positionId}
        assumptions={assumptions}
        ephemeral={ephemeral}
      />

      {/* ─── ZONE 3 · DETALLES (collapsed) ───────────────────────── */}
      <DetailsZone assumptions={assumptions} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// ZONE 1 · Conclusion
// ────────────────────────────────────────────────────────────────────

function ConclusionZone({
  assumptions,
  verdictTone,
}: {
  assumptions: ImpliedReturnStoredAssumptions;
  verdictTone: "positive" | "negative";
}) {
  const bg =
    verdictTone === "positive"
      ? "bg-emerald-50 border-l-emerald-500"
      : "bg-amber-50 border-l-amber-500";
  const labelColor =
    verdictTone === "positive" ? "text-emerald-900" : "text-amber-900";
  const subColor =
    verdictTone === "positive" ? "text-emerald-800" : "text-amber-800";

  return (
    <div
      className={`border-y border-navy-100 border-l-4 px-6 py-5 ${bg}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className={`text-xs font-semibold uppercase tracking-wider ${subColor}`}>
          Veredicto
        </div>
        <div className={`text-[11px] tabular-nums ${subColor}`}>
          Calidad: {TIER_LABEL[assumptions.quality_tier]}
        </div>
      </div>
      <div className={`mt-1 font-display text-2xl italic ${labelColor}`}>
        {VERDICT_LABELS[assumptions.verdict]}
      </div>
      <div className="mt-3 grid gap-1.5 text-xs">
        <CheckRow
          ok={assumptions.passes_attractiveness}
          tone={verdictTone}
          text={
            <>
              <strong>Atractivo:</strong> caso base{" "}
              <span className="tabular-nums font-semibold">
                {pct(assumptions.base_cagr)}
              </span>{" "}
              {assumptions.passes_attractiveness ? "supera" : "no supera"} el
              umbral{" "}
              <span className="tabular-nums">
                ≥{pct(assumptions.threshold)}
              </span>{" "}
              para {TIER_LABEL[assumptions.quality_tier]}.
            </>
          }
        />
        <CheckRow
          ok={assumptions.passes_no_disaster}
          tone={verdictTone}
          text={
            <>
              <strong>No-desastre:</strong> escenario estresado{" "}
              <span className="tabular-nums font-semibold">
                {pct(assumptions.stress_cagr)}
              </span>{" "}
              {assumptions.passes_no_disaster ? "supera" : "cae por debajo de"}{" "}
              el floor{" "}
              <span className="tabular-nums">
                ≥{pct(assumptions.floor)}
              </span>{" "}
              (Treasury 10y + 2%).
            </>
          }
        />
      </div>

      <PeerMedianDisclaimer assumptions={assumptions} />
    </div>
  );
}

// Cross-sectional disclaimer: when the current multiple cotiza
// ≥ 1.5× the peer median for this business type, the own-history
// math may be unrepresentative. Informational only — does not change
// the verdict. Drives Joseda toward considering the override.
function PeerMedianDisclaimer({
  assumptions,
}: {
  assumptions: ImpliedReturnStoredAssumptions;
}) {
  const current = assumptions.multiple_current ?? null;
  const peer = assumptions.peer_median ?? null;
  const label = assumptions.multiple_label ?? null;
  if (current === null || peer === null || label === null || peer <= 0) {
    return null;
  }
  const ratio = current / peer;
  if (ratio < PEER_MEDIAN_DISCLAIMER_RATIO) return null;

  const sourceLabel =
    assumptions.peer_median_source === "industry"
      ? "industria"
      : "sector";
  const matchKey = assumptions.peer_median_match_key ?? null;

  return (
    <div className="mt-4 rounded-md border border-navy-200 border-l-4 border-l-amber-500 bg-white px-4 py-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-800">
        Aviso sobre el múltiplo asumido
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-navy-700">
        El múltiplo {label} actual ({current.toFixed(1)}x) cotiza{" "}
        <strong>{ratio.toFixed(1)}×</strong> el peer median del{" "}
        {sourceLabel} ({peer.toFixed(1)}x). El propio histórico 10y
        puede no ser representativo del régimen normal — considera
        introducir manualmente el múltiplo terminal en base/estrés
        (botón ✎ en la fila Múltiplo de la tabla).
      </p>
      <p className="mt-2 text-[10px] text-navy-500">
        Fuente:{" "}
        <a
          href="https://pages.stern.nyu.edu/~adamodar/New_Home_Page/data.html"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-navy-800"
        >
          Damodaran 2025
        </a>
        {matchKey ? ` · ${matchKey}` : ""}
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// ZONE 2 · Calculation
// ────────────────────────────────────────────────────────────────────

function CalculationZone({
  positionId,
  assumptions,
  ephemeral,
}: {
  positionId: number;
  assumptions: ImpliedReturnStoredAssumptions;
  ephemeral: boolean;
}) {
  return (
    <div className="px-6 py-5">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-navy-500">
          El cálculo
        </div>
        <div className="text-[11px] text-navy-400">
          CAGR ≈ FCF Yield + Growth + Δ Múltiplo
        </div>
      </div>

      {ephemeral && (
        <p className="mb-3 rounded-md border border-dashed border-navy-200 bg-navy-50/40 px-3 py-2 text-[11px] italic text-navy-600">
          Asunciones por defecto. Para personalizar el growth o el múltiplo
          terminal, analiza el ticker desde el wizard.
        </p>
      )}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-[10px] font-semibold uppercase tracking-wider text-navy-500">
            <th className="pb-2 text-left">Componente</th>
            <th className="pb-2 text-right">Caso base</th>
            <th className="pb-2 text-right">Estrés</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-navy-100">
          <CalcRow
            label="FCF Yield"
            base={pct(assumptions.fcf_yield)}
            stress={pct(assumptions.fcf_yield)}
          />
          <GrowthRowEditable
            positionId={positionId}
            assumptions={assumptions}
            ephemeral={ephemeral}
          />
          <MultipleRowEditable
            positionId={positionId}
            assumptions={assumptions}
            ephemeral={ephemeral}
          />
          <tr className="border-t-2 border-navy-300 text-base font-bold">
            <td className="py-3 text-navy-900">= CAGR esperado</td>
            <td className="py-3 text-right tabular-nums text-navy-900">
              {pct(assumptions.base_cagr)}
            </td>
            <td className="py-3 text-right tabular-nums text-navy-900">
              {pct(assumptions.stress_cagr)}
            </td>
          </tr>
          {/* Benchmark rows — threshold under Base, floor under Estrés
              (each compares against the column above it). */}
          <tr className="text-[11px] uppercase tracking-wider text-navy-500">
            <td className="pt-3 pb-1" colSpan={3}>
              Se compara con
            </td>
          </tr>
          <tr className="text-xs">
            <td className="py-1.5 text-navy-600">
              Umbral · {TIER_LABEL[assumptions.quality_tier]}
            </td>
            <td className="py-1.5 text-right tabular-nums text-navy-700">
              ≥ {pct(assumptions.threshold)}{" "}
              <CheckMark ok={assumptions.passes_attractiveness} />
            </td>
            <td className="py-1.5 text-right text-navy-300">—</td>
          </tr>
          <tr className="text-xs">
            <td className="py-1.5 text-navy-600">Floor · Treasury + 2%</td>
            <td className="py-1.5 text-right text-navy-300">—</td>
            <td className="py-1.5 text-right tabular-nums text-navy-700">
              ≥ {pct(assumptions.floor)}{" "}
              <CheckMark ok={assumptions.passes_no_disaster} />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function CheckMark({ ok }: { ok: boolean }) {
  return (
    <span
      className={`ml-1 ${ok ? "text-emerald-700" : "text-amber-700"}`}
      aria-label={ok ? "supera" : "no supera"}
    >
      {ok ? "✓" : "×"}
    </span>
  );
}

function CalcRow({
  label,
  base,
  stress,
}: {
  label: string;
  base: string;
  stress: string;
}) {
  return (
    <tr>
      <td className="py-2 text-navy-700">{label}</td>
      <td className="py-2 text-right tabular-nums text-navy-900">{base}</td>
      <td className="py-2 text-right tabular-nums text-navy-700">{stress}</td>
    </tr>
  );
}

// MultipleRowEditable owns the row rendering + the inline edit form.
// Lives in its own client component file because it needs useState/
// useTransition for the edit interaction.

function formatMultiple(x: number): string {
  return `${x.toFixed(1)}x`;
}

// Detailed prose for the Δ Múltiplo collapsed section. Explains the rule
// (min(current, median) for base, Q1 for stress) using the actual numbers
// computed for THIS valuation. Falls back to a generic explanation when
// the multiple metadata is missing (legacy rows).
function MultipleDetail({
  assumptions,
}: {
  assumptions: ImpliedReturnStoredAssumptions;
}) {
  const label = assumptions.multiple_label ?? null;
  const current = assumptions.multiple_current ?? null;
  const median = assumptions.multiple_median ?? null;
  const q1 = assumptions.multiple_q1 ?? null;
  const baseTerm = assumptions.multiple_base_terminal ?? null;
  const stressTerm = assumptions.multiple_stress_terminal ?? null;
  const source = assumptions.multiple_source ?? null;

  if (label === null || current === null || median === null || baseTerm === null) {
    return (
      <p className="text-[12px] leading-relaxed text-navy-600">
        <strong>Caso base:</strong> múltiplo estable (
        {signedPct(assumptions.multiple_change_base)}). No asumimos re-rating en
        ninguna dirección.{" "}
        <strong>Estrés:</strong>{" "}
        {signedPct(assumptions.multiple_change_stress)}/año.{" "}
        {assumptions.multiple_change_stress === 0
          ? "El múltiplo ya está en el Q1 histórico o por debajo."
          : "Asumimos vuelta hacia el Q1 histórico a lo largo de 10 años."}
      </p>
    );
  }

  const baseHoldsCurrent = current <= median;

  return (
    <div className="space-y-2 text-[12px] leading-relaxed text-navy-600">
      <p>
        <strong>Múltiplo de referencia:</strong> {label} ({formatMultiple(current)}{" "}
        actual · {formatMultiple(median)} mediana 10y
        {q1 !== null ? ` · ${formatMultiple(q1)} Q1 histórico` : ""}).{" "}
        {source === "ai_guide"
          ? "Determinado por la AI valuation guide como herramienta primaria para este negocio."
          : "Determinado por dispatch automático según business type (no hay AI guide disponible o recomendaba un método no-multiple)."}
      </p>
      <p>
        <strong>Caso base:</strong>{" "}
        {baseHoldsCurrent ? (
          <>
            como el múltiplo actual ({formatMultiple(current)}) está al nivel o
            por debajo de la mediana 10y ({formatMultiple(median)}), mantenemos
            el actual a 10 años — <em>no asumimos re-rating al alza</em>. La
            barateza, si la hay, ya se captura en FCF Yield; bake-in de
            re-expansión sería doble-conteo.
          </>
        ) : (
          <>
            como el múltiplo actual ({formatMultiple(current)}) cotiza por
            encima de la mediana 10y ({formatMultiple(median)}), el caso base
            asume reversión a la mediana sobre 10 años → terminal{" "}
            {formatMultiple(baseTerm)} ({signedPct(assumptions.multiple_change_base)}/año
            de drag).
          </>
        )}
      </p>
      <p>
        <strong>Estrés:</strong>{" "}
        {assumptions.multiple_change_stress === 0
          ? `el múltiplo actual ya está al nivel del Q1 histórico o por debajo (${q1 !== null ? formatMultiple(q1) : "—"}); no asumimos compresión adicional.`
          : `el escenario malo asume vuelta al Q1 histórico (${stressTerm !== null ? formatMultiple(stressTerm) : "—"}) a lo largo de 10 años, equivalente a ${signedPct(assumptions.multiple_change_stress)}/año de compresión. Q1 (no la mediana) porque el escenario malo debe simular un cuartil bajo creíble, no la tendencia central.`}
      </p>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// ZONE 3 · Details (collapsed)
// ────────────────────────────────────────────────────────────────────

function DetailsZone({
  assumptions,
}: {
  assumptions: ImpliedReturnStoredAssumptions;
}) {
  return (
    <details className="border-t border-navy-100 bg-navy-50/30">
      <summary className="cursor-pointer px-6 py-3 text-sm font-medium text-navy-700 hover:text-navy-900">
        Detalles del cálculo · supuestos y racional
      </summary>
      <div className="space-y-8 border-t border-navy-100 px-6 py-5">
        {/* FCF Yield breakdown */}
        <DetailSection title="FCF Yield">
          <p className="text-[12px] leading-relaxed text-navy-600">
            FCF TTM ({formatLargeUSD(assumptions.fcf_ttm)}) dividido entre la
            capitalización ({formatLargeUSD(assumptions.market_cap)}). Es el
            cash que el negocio genera el primer año a precio actual.
          </p>
        </DetailSection>

        {/* Growth anchors */}
        <DetailSection title="Crecimiento sostenible — anclas">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-navy-100">
              {assumptions.growth.anchors.map((a) => {
                const isDriver = a.key === assumptions.growth.driver;
                return (
                  <tr key={a.key}>
                    <td className="py-2 text-navy-700">
                      {a.label}
                      {isDriver && (
                        <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                          ← driver
                        </span>
                      )}
                      <div className="text-[10px] text-navy-400">
                        {a.formula}
                      </div>
                      {a.note && (
                        <div className="text-[10px] text-amber-700">
                          {a.note}
                        </div>
                      )}
                    </td>
                    <td className="py-2 text-right font-medium tabular-nums text-navy-900">
                      {a.value !== null ? pct(a.value) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {assumptions.growth.note && (
            <p className="mt-2 text-[11px] italic text-navy-500">
              {assumptions.growth.note}
            </p>
          )}
          <p className="mt-2 text-[12px] leading-relaxed text-navy-600">
            Tomamos la <strong>menor</strong> de las anclas como caso base —
            disciplina de Smith: nunca extrapolar growth más allá de lo que el
            negocio puede sostener fundamentalmente. El stress aplica un
            cushion adicional ({pct(assumptions.growth.base)} × 0.7 ={" "}
            {pct(assumptions.growth.stress)}).
          </p>
        </DetailSection>

        {/* Multiple change */}
        <DetailSection title="Múltiplo a 10 años">
          <MultipleDetail assumptions={assumptions} />
        </DetailSection>

        {/* Peer median origin — only when peer_median is available. */}
        {assumptions.peer_median !== null &&
          assumptions.peer_median !== undefined && (
            <DetailSection title="Peer median del sector — origen y limitación">
              <PeerMedianDetail assumptions={assumptions} />
            </DetailSection>
          )}

        {/* Tier thresholds */}
        <DetailSection title="Umbrales por calidad del negocio">
          <p className="mb-2 text-[12px] leading-relaxed text-navy-600">
            {TIER_RATIONALE[assumptions.quality_tier]}
          </p>
          <div className="space-y-1">
            {(
              [
                ["exceptional", 0.12],
                ["good", 0.14],
                ["mediocre", 0.17],
              ] as const
            ).map(([tier, threshold]) => {
              const isCurrent = tier === assumptions.quality_tier;
              return (
                <div
                  key={tier}
                  className={`flex items-baseline justify-between rounded px-3 py-1 text-sm ${
                    isCurrent
                      ? "bg-navy-100 font-semibold text-navy-900"
                      : "text-navy-500"
                  }`}
                >
                  <span>
                    {TIER_LABEL[tier]}{" "}
                    {isCurrent && (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                        ← este negocio
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums">≥ {pct(threshold)}</span>
                </div>
              );
            })}
            <div className="flex items-baseline justify-between rounded border-t border-navy-100 px-3 pt-2 text-sm text-navy-500">
              <span>Floor (Treasury 10y + 2%)</span>
              <span className="tabular-nums">
                ≥ {pct(assumptions.floor)}
              </span>
            </div>
          </div>
        </DetailSection>

        {/* Link to the full explainer */}
        <div className="border-t border-navy-100 pt-3 text-right">
          <a
            href="/dashboard/learn/valuation"
            className="text-[11px] font-medium text-navy-600 underline-offset-2 hover:text-navy-900 hover:underline"
          >
            Explicación completa del marco →
          </a>
        </div>
      </div>
    </details>
  );
}

// Peer median detail — methodology + source + limitations. Honest about
// the hardcoded-annual nature of Route A and signals that Route B
// (Discovery-cached) is the planned evolution.
function PeerMedianDetail({
  assumptions,
}: {
  assumptions: ImpliedReturnStoredAssumptions;
}) {
  const value = assumptions.peer_median ?? null;
  const label = assumptions.peer_median_label ?? null;
  const source = assumptions.peer_median_source ?? null;
  const matchKey = assumptions.peer_median_match_key ?? null;
  if (value === null || label === null) return null;

  const sourceLabel = source === "industry" ? "industria" : "sector";

  return (
    <div className="space-y-2 text-[12px] leading-relaxed text-navy-600">
      <p>
        El peer median ({formatMultiple(value)} {label}) proviene de la
        tabla anual de{" "}
        <a
          href="https://pages.stern.nyu.edu/~adamodar/New_Home_Page/data.html"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-navy-900"
        >
          Damodaran (NYU Stern, sector multiples 2025)
        </a>
        , benchmark estándar entre investment professionals.
        {matchKey
          ? ` Para esta valoración el lookup hizo match con ${sourceLabel} `
          : ` Match a nivel de ${sourceLabel}.`}
        {matchKey && (
          <span className="font-medium text-navy-800">{matchKey}</span>
        )}
        {matchKey ? "." : ""}
      </p>
      <p>
        <strong>Limitación:</strong> la tabla se mantiene manualmente en{" "}
        <code className="rounded bg-navy-100 px-1 text-[11px]">
          lib/peerMedians.ts
        </code>{" "}
        y se actualiza anualmente. Entre ediciones el valor puede quedar
        atrás de cambios de régimen estructural.
      </p>
    </div>
  );
}

function DetailSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h4 className="mb-3 border-b border-navy-200 pb-1.5 font-display text-[15px] font-semibold italic text-navy-900">
        {title}
      </h4>
      {children}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Shared helpers
// ────────────────────────────────────────────────────────────────────

function CheckRow({
  ok,
  text,
  tone,
}: {
  ok: boolean;
  text: React.ReactNode;
  tone: "positive" | "negative";
}) {
  const okColor = tone === "positive" ? "text-emerald-700" : "text-amber-700";
  return (
    <div className="flex items-baseline gap-2">
      <span className={`flex-none ${ok ? okColor : "text-amber-700"}`}>
        {ok ? "✓" : "×"}
      </span>
      <span className="text-navy-800">{text}</span>
    </div>
  );
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

// Signed percentage — for multiple change where the sign carries
// meaning (negative = compresión, positive = expansión).
function signedPct(x: number): string {
  const sign = x > 0 ? "+" : "";
  return `${sign}${(x * 100).toFixed(1)}%`;
}

function formatLargeUSD(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "—";
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(2)}K`;
  return `$${value.toFixed(0)}`;
}
