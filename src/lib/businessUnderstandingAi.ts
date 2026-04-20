// AI generator for the business-understanding step of the analysis wizard.
//
// Output is Spanish, in a close conversational tone — as if a financially
// literate friend were explaining the company over coffee. Uses plain
// language, no jargon, translating metrics into ideas the reader can
// picture. Honesty over politeness: if something doesn't have clear value
// for an investor, say it.
//
// Two entry points:
//   1. `generateBusinessUnderstanding` — full first-pass generation (summary
//      + 5-7 pre-generated Q&A). Persisted via `saveNewUnderstanding`.
//   2. `answerFollowupQuestion` — single-turn Q&A against an existing summary,
//      appended to the record via `appendFollowupQA`.

import Anthropic from "@anthropic-ai/sdk";
import type { Quote, Fundamentals } from "@/lib/financial";
import type {
  BusinessUnderstanding,
  QnA,
  BusinessUnderstandingSource,
} from "@/lib/businessUnderstanding";

const MODEL = "claude-sonnet-4-6";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

// Structured summary: an ordered list of sections each with a title and
// 1-3 short paragraphs. Avoids pulling in a markdown renderer dependency —
// the wizard just maps over the array. Stored as JSON inside `summary_md`
// so the DB column name stays backward-compatible.
export type SummarySection = {
  title: string;
  paragraphs: string[];
};

export type SerializedSummary = {
  sections: SummarySection[];
};

export type GeneratedUnderstanding = {
  summary_md: string; // serialized SerializedSummary JSON
  questions_and_answers: QnA[];
  sources: BusinessUnderstandingSource[];
};

const TONE_PREAMBLE = `Eres un colega experto en inversión que le explica empresas a un amigo como si se tomaran un café. Hablas en español, en tono cercano, directo y honesto. Usas lenguaje llano, no técnico ni profesional; cuando necesitas un concepto financiero, lo traduces a una idea que se pueda visualizar. Si algo de la empresa no tiene valor claro para un inversor, lo dices. No dras relleno ni frases de marketing — "provider of integrated solutions" no sirve, explicas el mecanismo real.

Términos específicos del negocio o siglas muy asimiladas (ROIC, FCF, moat, DCF, EPS) pueden ir en inglés. Todo lo demás en español.`;

function buildGenerationPrompt(
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
): string {
  const companyLine = quote
    ? `${quote.longName ?? ticker} (${ticker}) · ${quote.sector ?? "sector ?"} / ${quote.industry ?? "industry ?"}`
    : `Ticker ${ticker}`;

  const marketCapLine =
    quote?.marketCap != null
      ? `Market cap: $${(quote.marketCap / 1e9).toFixed(1)}B`
      : "Market cap no disponible";

  const summaryLine = quote?.longBusinessSummary
    ? `Resumen de Yahoo Finance (referencia — puedes reescribirlo):\n${quote.longBusinessSummary}`
    : "Sin resumen de Yahoo Finance.";

  const fdLine = fundamentals
    ? `Algunos datos financieros recientes:
- Margen bruto: ${formatPct(fundamentals.grossMargins)}
- Margen operativo: ${formatPct(fundamentals.operatingMargins)}
- Crecimiento ingresos (últ. año): ${formatPct(fundamentals.revenueGrowth)}`
    : "Sin datos financieros detallados.";

  return `${TONE_PREAMBLE}

Explícame ${companyLine}.

${marketCapLine}

${summaryLine}

${fdLine}

La explicación debe tener cinco secciones con estos títulos exactos (en este orden):
1. "Qué hace exactamente" — el mecanismo real, no una frase abstracta.
2. "Quién paga" — qué cliente final pone el dinero en la caja.
3. "Cómo gana dinero" — unidad económica (comisión, suscripción, unidad vendida…).
4. "En qué invierte" — dónde va el capital (capex, I+D, adquisiciones).
5. "Qué la hace diferente (o no)" — si hay algo estructural, o es commodity-like.

Después, anticipa 5-7 preguntas que un inversor con criterio se haría y respóndelas tú mismo. Las preguntas deben ser CONCRETAS y específicas de este negocio, no genéricas ("¿es rentable?" no vale; "¿qué pasa con los volúmenes si las tasas bajan 200bp?" sí).

FORMATO DE SALIDA — JSON estricto, nada antes ni después:

{
  "sections": [
    {
      "title": "Qué hace exactamente",
      "paragraphs": ["Párrafo 1 (2-4 frases).", "Párrafo 2 opcional."]
    },
    ... (5 secciones en total)
  ],
  "questions_and_answers": [
    { "question": "...", "answer": "1-3 frases, directas, sin rodeos" }
  ]
}`;
}

function buildFollowupPrompt(
  ticker: string,
  understanding: BusinessUnderstanding,
  question: string,
): string {
  const priorQnA = understanding.questions_and_answers
    .map((qa) => `Q: ${qa.question}\nA: ${qa.answer}`)
    .join("\n\n");

  // Summary is stored as a JSON-serialized SerializedSummary. Flatten it
  // back to readable text so Claude has the full prior context.
  let summaryText = understanding.summary_md;
  try {
    const parsed = JSON.parse(understanding.summary_md) as SerializedSummary;
    summaryText = parsed.sections
      .map((s) => `## ${s.title}\n\n${s.paragraphs.join("\n\n")}`)
      .join("\n\n");
  } catch {
    // fall through — use the raw string if not parseable
  }

  return `${TONE_PREAMBLE}

Conoces esta empresa: ${understanding.ticker}.

Resumen ya escrito:
${summaryText}

Preguntas ya respondidas en esta sesión:
${priorQnA}

NUEVA PREGUNTA del inversor:
"${question}"

Respóndele en 2-5 frases, mismo tono, sin repetir lo que ya está en el resumen. Si la pregunta se sale del alcance (noticias recientísimas, predicciones de precio), dilo honestamente.

FORMATO: Texto plano, sin JSON, sin preámbulo. Sólo la respuesta.`;
}

export async function generateBusinessUnderstanding(
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
): Promise<{ generated: GeneratedUnderstanding; model: string }> {
  const prompt = buildGenerationPrompt(ticker, quote, fundamentals);

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const raw = textBlock.text.trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      `Could not find JSON in business-understanding response: ${raw.slice(0, 200)}`,
    );
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    sections?: Array<{ title?: string; paragraphs?: unknown }>;
    questions_and_answers?: Array<{ question?: string; answer?: string }>;
  };

  if (!Array.isArray(parsed.sections) || parsed.sections.length < 3) {
    throw new Error("Generated summary sections missing or too few");
  }

  const sections: SummarySection[] = parsed.sections
    .filter(
      (s): s is { title: string; paragraphs: string[] } =>
        typeof s.title === "string" &&
        Array.isArray(s.paragraphs) &&
        s.paragraphs.every((p) => typeof p === "string"),
    )
    .map((s) => ({ title: s.title, paragraphs: s.paragraphs }));

  if (sections.length < 3) {
    throw new Error("Too few valid sections after validation");
  }

  if (
    !Array.isArray(parsed.questions_and_answers) ||
    parsed.questions_and_answers.length < 3
  ) {
    throw new Error("Generated Q&A list is missing or too short");
  }

  const qa: QnA[] = parsed.questions_and_answers
    .filter((q) => typeof q.question === "string" && typeof q.answer === "string")
    .map((q) => ({
      question: q.question!,
      answer: q.answer!,
      type: "pregenerated" as const,
    }));

  if (qa.length < 3) {
    throw new Error("Too few valid Q&A entries after validation");
  }

  const serialized: SerializedSummary = { sections };

  return {
    generated: {
      summary_md: JSON.stringify(serialized),
      questions_and_answers: qa,
      sources: [],
    },
    model: MODEL,
  };
}

export async function answerFollowupQuestion(
  ticker: string,
  understanding: BusinessUnderstanding,
  question: string,
): Promise<{ answer: string; model: string }> {
  const prompt = buildFollowupPrompt(ticker, understanding, question);

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }
  const answer = textBlock.text.trim();
  if (answer.length < 10) {
    throw new Error("Follow-up answer was empty or too short");
  }
  return { answer, model: MODEL };
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}
