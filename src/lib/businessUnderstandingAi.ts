// AI generator for the business-understanding step of the analysis wizard.
//
// Output is Spanish, in a close conversational tone — as if a financially
// literate friend were explaining the company over coffee. Uses plain
// language, no jargon, translating metrics into ideas the reader can
// picture. Honesty over politeness: if something doesn't have clear value
// for an investor, say it.
//
// When a 10-K is available (new flow), the real Item 1 (Business) text is
// injected as the primary source. Yahoo Finance's short summary drops to
// a secondary context signal. When no 10-K is available (very recent IPO,
// SEC fetch failure), we fall back to the pre-10K behaviour and tag the
// `sources` array accordingly so the row is honest about its ancestry.

import { callJson } from "@/lib/claudeClient";
import type { Quote, Fundamentals } from "@/lib/financial";
import type {
  QnA,
  BusinessUnderstandingSource,
} from "@/lib/businessUnderstanding";

// Filing grounding passed in by the caller (regenerate action). When
// provided, the prompt uses the 10-K text as the primary source.
export type UnderstandingFilingInput = {
  text: string;
  truncated: boolean;
  accession: string;
  form: string;
  filingDate: string; // YYYY-MM-DD
  reportDate: string | null;
  url: string;
};

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
  filing: UnderstandingFilingInput | null,
): string {
  const companyLine = quote
    ? `${quote.longName ?? ticker} (${ticker}) · ${quote.sector ?? "sector ?"} / ${quote.industry ?? "industry ?"}`
    : `Ticker ${ticker}`;

  const marketCapLine =
    quote?.marketCap != null
      ? `Market cap: $${(quote.marketCap / 1e9).toFixed(1)}B`
      : "Market cap no disponible";

  const secondaryYahooLine = quote?.longBusinessSummary
    ? `Resumen breve de Yahoo Finance (contexto actual de mercado, no fuente primaria):\n${quote.longBusinessSummary}`
    : "Yahoo Finance no aporta resumen.";

  const fdLine = fundamentals
    ? `Algunos datos financieros recientes:
- Margen bruto: ${formatPct(fundamentals.grossMargins)}
- Margen operativo: ${formatPct(fundamentals.operatingMargins)}
- Crecimiento ingresos (últ. año): ${formatPct(fundamentals.revenueGrowth)}`
    : "Sin datos financieros detallados.";

  const filingBlock = filing
    ? `
FUENTE PRIMARIA — DOCUMENTO SEC EDGAR (${filing.form}${filing.reportDate ? `, periodo ${filing.reportDate}` : ""}, filed ${filing.filingDate}).
El texto está en inglés; tu respuesta va en español.${filing.truncated ? " El documento se truncó por longitud — úsalo como primary input, pero si falta información crítica puedes apoyarte en la fuente secundaria." : ""}

=== TEXTO ${filing.form} (plano) ===
${filing.text}
=== FIN DEL DOCUMENTO ===
`
    : `
(No hay un ${"10-K"} reciente disponible en EDGAR para este ticker. Apóyate en el contexto de Yahoo Finance y tu conocimiento general; indícalo implícitamente escribiendo con mayor cautela cuando una afirmación sea difícil de verificar.)
`;

  return `${TONE_PREAMBLE}

Explícame ${companyLine}.

${marketCapLine}
${filingBlock}
FUENTE SECUNDARIA:
${secondaryYahooLine}

${fdLine}

INSTRUCCIONES DE USO DE LAS FUENTES:
- La fuente primaria es el ${filing ? filing.form : "resumen de Yahoo Finance"}. Ahí está la descripción real del negocio, sus segmentos, productos, geografías, clientes.
- Cita mentalmente los segmentos / productos / tipos de cliente tal como aparecen en el documento (nombres propios, líneas de negocio), pero escríbelo en lenguaje llano en español.
- Nombres propios, tickers, productos, siglas financieras (ROIC, FCF, CAGR, moat, DCF, EPS) y referencias a secciones legales (Item 1, Item 1A) se quedan en inglés dentro del texto en español.
- No inventes. Si la fuente no aclara algo, dilo ("el 10-K no detalla…").

La explicación debe tener cinco secciones con estos títulos exactos (en este orden):
1. "Qué hace exactamente" — el mecanismo real, no una frase abstracta.
2. "Quién paga" — qué cliente final pone el dinero en la caja.
3. "Cómo gana dinero" — unidad económica (comisión, suscripción, unidad vendida…).
4. "En qué invierte" — dónde va el capital (capex, I+D, adquisiciones).
5. "Qué la hace diferente (o no)" — si hay algo estructural, o es commodity-like.

LONGITUD (crítico): cada sección debe tener 1-2 párrafos; cada párrafo 2-3 frases. Objetivo: 80-130 palabras por sección (400-650 palabras totales para las 5 secciones). Densidad alta, una cifra o dato concreto por sección cuando aporte, sin listados exhaustivos. Si tienes que elegir entre exhaustividad y claridad, elige claridad. No es un highlight superficial, pero tampoco una memoria anual parafraseada.

Después, anticipa 5-7 preguntas que un inversor con criterio se haría y respóndelas tú mismo. Las preguntas deben ser CONCRETAS y específicas de este negocio, no genéricas ("¿es rentable?" no vale; "¿qué pasa con los volúmenes si las tasas bajan 200bp?" sí). Las respuestas 1-3 frases, directas.

Llama a la tool submit_business_understanding con exactamente 5 secciones (en el orden indicado) y 5-7 Q&A. No escribas texto plano fuera de la tool.`;
}

export async function generateBusinessUnderstanding(
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
  filing: UnderstandingFilingInput | null = null,
): Promise<{ generated: GeneratedUnderstanding; model: string }> {
  const prompt = buildGenerationPrompt(ticker, quote, fundamentals, filing);

  // In remote mode callJson uses Anthropic's tool_use to guarantee valid
  // JSON. In local mode it injects the schema into the prompt and parses
  // Opus's text output — Opus 4.7 is reliable enough at format adherence
  // for the two known callers (understanding + red flags) to ride this
  // path without regressing the quote-escaping bug tool_use originally
  // solved. 5 sections + 5-7 Q&A easily clear 4k tokens; 8000 is cushion.
  const { data: input, model } = await callJson<{
    sections?: Array<{ title?: string; paragraphs?: unknown }>;
    questions_and_answers?: Array<{ question?: string; answer?: string }>;
  }>(prompt, {
    schemaName: "submit_business_understanding",
    schemaDescription: "Submit the structured business understanding.",
    maxTokens: 8000,
    jsonSchema: {
      type: "object",
      properties: {
        sections: {
          type: "array",
          description: "Exactly 5 sections with the fixed titles in order.",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              paragraphs: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["title", "paragraphs"],
          },
        },
        questions_and_answers: {
          type: "array",
          description: "5-7 concrete investor questions with answers.",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              answer: { type: "string" },
            },
            required: ["question", "answer"],
          },
        },
      },
      required: ["sections", "questions_and_answers"],
    },
  });

  if (!Array.isArray(input.sections) || input.sections.length < 3) {
    console.error(
      `Understanding output missing sections. Raw: ${JSON.stringify(input).slice(0, 600)}`,
    );
    throw new Error("Generated summary sections missing or too few");
  }

  const sections: SummarySection[] = input.sections
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
    !Array.isArray(input.questions_and_answers) ||
    input.questions_and_answers.length < 3
  ) {
    console.error(
      `Understanding Q&A list too short. qa_length=${input.questions_and_answers?.length ?? "undefined"}. Raw input preview: ${JSON.stringify(input).slice(0, 800)}`,
    );
    throw new Error(
      `Generated Q&A list is missing or too short (length=${input.questions_and_answers?.length ?? 0})`,
    );
  }

  const qa: QnA[] = input.questions_and_answers
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

  const sources: BusinessUnderstandingSource[] = filing
    ? [
        {
          url: filing.url,
          label: filing.reportDate
            ? `${filing.form} (FY ${filing.reportDate})`
            : `${filing.form} filed ${filing.filingDate}`,
          type: "10k",
        },
      ]
    : [];

  return {
    generated: {
      summary_md: JSON.stringify(serialized),
      questions_and_answers: qa,
      sources,
    },
    model,
  };
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}
