// AI conversational follow-up on a ticker's valuation. Always uses
// Sonnet 4.6 via the Anthropic SDK (bypasses the dual-mode caller in
// claudeClient.ts) — chat latency matters more here than the local
// CLI's free Opus, and the editorial frame is much more important
// than the raw IQ delta.
//
// The prompt is grounded in the FULL current valuation context (method,
// IV range, current price, MoS, all the assumptions, the relative
// distributions and percentiles, the AI Valuation Guide, the moat,
// the quality tier, the business name). The AI never has to ask
// "what's the current price" — that would break the magic.

import Anthropic from "@anthropic-ai/sdk";
import type { Valuation } from "@/lib/valuations";
import type { MoatAssessment } from "@/lib/moats";
import type { ValuationGuide } from "@/lib/valuationGuides";
import type { Tier } from "@/lib/verdict";
import type { ValuationChatTurn } from "@/lib/valuationChats";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 1500;
// How many previous turns we feed the model. Beyond ~10 the prompt
// bloats and the model starts losing focus on the latest question.
// Conversations longer than this still render in the UI; they just
// fall out of the prompt window.
const HISTORY_TURNS = 10;

let _anthropic: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

const SYSTEM_PROMPT = `Eres Moatboard, un compañero analista personal de Joseda. Tu trabajo es ayudarle a ENTENDER una valoración — no a decidir si compra, vende o mantiene. Trabajas dentro del marco quality investing (Buffett, Munger, Terry Smith, Akre).

Reglas inviolables:
- NUNCA recomiendes comprar, vender, mantener, esperar o ninguna acción de mercado. Ni implícitamente ("creo que está caro", "merece la pena") ni con preguntas retóricas.
- NUNCA digas "está barato" o "está caro" como veredicto. Sí puedes contextualizar: "el P/B 4x es bajo vs su propia historia de 10y donde mediana fue 7x".
- Cuando dos modelos discrepan (DCF vs P/B vs PE), explica POR QUÉ contestan a preguntas distintas. No elijas uno como el correcto.
- Cita números concretos del contexto que te paso. No te inventes ratios.
- Cuando una asunción del modelo es discutible (stable_roe, growth, fade period), ponla sobre la mesa explícitamente.
- Cuando faltan datos, di "no tengo este dato" — NUNCA rellenes con conocimiento general.
- Tu objetivo es DESAFIAR las asunciones de Joseda, no validarlas. Si Joseda formula una pregunta que asume algo, identifica la asunción.

Estilo:
- Español natural y directo. Tono profesional pero conversacional, como compañero de mesa de research.
- Jerga financiera (DCF, P/B, ROE, FCF, MoS, IV, ROIC, capex, SBC, terminal value, fade period) en inglés dentro del español.
- Respuestas concretas: 3-6 párrafos cortos típicamente. Si la pregunta requiere más, está bien — no fuerces brevedad artificial.
- Nada de bullet lists rellenos. Prosa que se lee como pensamiento.
- Si la pregunta es ambigua, pide clarificación en una frase, no inventes lo que querían decir.`;

// Build a compact, structured context block describing the current
// valuation state. Goes in every turn so the model never has to
// remember from previous turns. Plain text, not JSON — the model
// reads English/Spanish prose more reliably than nested objects.
function buildValuationContext({
  ticker,
  businessName,
  valuation,
  guide,
  moat,
  qualityTier,
}: {
  ticker: string;
  businessName: string | null;
  valuation: Valuation;
  guide: ValuationGuide | null;
  moat: MoatAssessment | null;
  qualityTier: Tier | null;
}): string {
  const lines: string[] = [];
  lines.push(`# Valoración actual de ${ticker}${businessName ? ` (${businessName})` : ""}`);
  lines.push("");

  const ivBase = Number(valuation.intrinsic_value).toFixed(2);
  const ivLow = Number(valuation.intrinsic_value_low).toFixed(2);
  const ivHigh = Number(valuation.intrinsic_value_high).toFixed(2);
  const price = Number(valuation.current_price).toFixed(2);
  const mos = (Number(valuation.margin_of_safety_pct) * 100).toFixed(1);

  lines.push(`Método: ${valuation.method}`);
  lines.push(`IV (low / base / high): $${ivLow} / $${ivBase} / $${ivHigh}`);
  lines.push(`Precio actual: $${price}`);
  lines.push(`MoS (vs IV base): ${mos}%`);
  if (valuation.reasoning) {
    lines.push("");
    lines.push(`Razonamiento del modelo:`);
    lines.push(valuation.reasoning);
  }

  // Surface the most decision-relevant assumptions in flat text so the
  // model can quote them. The full assumptions JSONB has more, but
  // bloating the prompt with every field hurts more than it helps.
  const a = valuation.assumptions as Record<string, unknown>;
  if (a) {
    const interesting: Array<[string, string]> = [];
    const num = (v: unknown): string | null =>
      typeof v === "number" && Number.isFinite(v) ? String(v) : null;

    if (num(a.stable_roe)) interesting.push(["stable_roe", `${(Number(a.stable_roe) * 100).toFixed(1)}%`]);
    if (num(a.cost_of_equity)) interesting.push(["cost_of_equity", `${(Number(a.cost_of_equity) * 100).toFixed(1)}%`]);
    if (num(a.retention_ratio)) interesting.push(["retention_ratio", `${(Number(a.retention_ratio) * 100).toFixed(1)}%`]);
    if (num(a.book_value)) interesting.push(["book_value", `$${Number(a.book_value).toFixed(2)} per share`]);
    if (num(a.beta)) interesting.push(["beta", String(a.beta)]);
    if (num(a.risk_free_rate)) interesting.push(["risk_free_rate", `${(Number(a.risk_free_rate) * 100).toFixed(2)}%`]);
    if (num(a.equity_risk_premium)) interesting.push(["equity_risk_premium", `${(Number(a.equity_risk_premium) * 100).toFixed(1)}%`]);
    if (num(a.terminal_roe)) interesting.push(["terminal_roe (fade target)", `${(Number(a.terminal_roe) * 100).toFixed(1)}%`]);
    if (num(a.owner_earnings_base)) interesting.push(["owner_earnings_base", `$${(Number(a.owner_earnings_base) / 1_000_000).toFixed(0)}M`]);
    if (num(a.stage_one_growth)) interesting.push(["stage_one_growth", `${(Number(a.stage_one_growth) * 100).toFixed(1)}%`]);
    if (num(a.terminal_growth)) interesting.push(["terminal_growth", `${(Number(a.terminal_growth) * 100).toFixed(1)}%`]);
    if (num(a.years_of_history)) interesting.push(["years_of_history", String(a.years_of_history)]);

    if (interesting.length > 0) {
      lines.push("");
      lines.push("Asunciones clave del modelo absoluto:");
      for (const [k, v] of interesting) lines.push(`  - ${k}: ${v}`);
    }

    const rel = (a as { relative_valuation?: Record<string, unknown> })
      .relative_valuation;
    if (rel && typeof rel === "object") {
      lines.push("");
      lines.push("Valoración relativa (vs propia historia):");
      const yrs = num((rel as { years_of_data?: unknown }).years_of_data);
      const ps = (rel as { period_start?: unknown }).period_start;
      const pe = (rel as { period_end?: unknown }).period_end;
      if (yrs) lines.push(`  Ventana: ${yrs}y (${ps} → ${pe})`);
      const renderDist = (
        label: string,
        d: Record<string, unknown> | undefined,
        pctIsCheaper: "low" | "high",
      ) => {
        if (!d) return;
        const cur = num(d.current);
        const med = num(d.median);
        const q1 = num(d.q1);
        const q3 = num(d.q3);
        const min = num(d.min);
        const max = num(d.max);
        const pct = num(d.current_percentile);
        if (cur === null) return;
        lines.push(
          `  ${label}: current=${cur}, min=${min}, Q1=${q1}, median=${med}, Q3=${q3}, max=${max}` +
            (pct
              ? ` · percentil=${Number(pct).toFixed(1)}/100${pctIsCheaper === "low" ? " (bajo = barato)" : " (alto = barato)"}`
              : ""),
        );
      };
      renderDist("PE", (rel as { pe?: Record<string, unknown> }).pe, "low");
      renderDist(
        "P/FCF (FCF yield invertido)",
        (rel as { fcf_yield?: Record<string, unknown> }).fcf_yield,
        "high",
      );
      renderDist("P/B", (rel as { pb?: Record<string, unknown> }).pb, "low");
    }
  }

  if (guide) {
    lines.push("");
    lines.push(
      `AI Valuation Guide — primary: ${guide.primary_tool}, secondary: ${guide.secondary_tool ?? "—"}, cautious: ${guide.cautious_tool ?? "—"}`,
    );
    lines.push(`Reasoning: ${guide.reasoning}`);
  }

  if (moat) {
    lines.push("");
    lines.push(
      `Moat: ${moat.strength} / archetype ${moat.archetype}`,
    );
    lines.push(`Reasoning: ${moat.reasoning}`);
  }

  if (qualityTier) {
    lines.push("");
    lines.push(`Tier de calidad: ${qualityTier}`);
  }

  return lines.join("\n");
}

export async function answerValuationFollowup({
  ticker,
  businessName,
  valuation,
  guide,
  moat,
  qualityTier,
  history,
  question,
}: {
  ticker: string;
  businessName: string | null;
  valuation: Valuation;
  guide: ValuationGuide | null;
  moat: MoatAssessment | null;
  qualityTier: Tier | null;
  history: ValuationChatTurn[];
  question: string;
}): Promise<{ answer: string; model: string }> {
  const client = getClient();
  const context = buildValuationContext({
    ticker,
    businessName,
    valuation,
    guide,
    moat,
    qualityTier,
  });

  const trimmedHistory = history.slice(-HISTORY_TURNS);
  const messages: Anthropic.MessageParam[] = [];
  for (const turn of trimmedHistory) {
    messages.push({ role: "user", content: turn.question });
    messages.push({ role: "assistant", content: turn.answer });
  }
  // Latest question gets the current context block prepended so the
  // model always grounds the new answer on what's on screen now.
  messages.push({
    role: "user",
    content: `${context}\n\n---\n\nPregunta de Joseda:\n${question}`,
  });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages,
  });

  const block = response.content.find((b) => b.type === "text");
  const answer = block && block.type === "text" ? block.text.trim() : "";
  if (!answer) {
    throw new Error("Sonnet returned an empty answer");
  }
  return { answer, model: response.model ?? MODEL };
}
