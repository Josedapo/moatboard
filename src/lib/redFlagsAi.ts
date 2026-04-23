// AI generator for qualitative red flags.
//
// When a 10-K is available (new flow), we feed the model either the
// extracted Item 1A (Risk Factors) section or the end-truncated full
// filing (preserves Items 1A / 2 / 3), and the prompt requires the
// model to cite the text that justifies each flag. That lands on the
// flag as `source_excerpt` + `source_item`.
//
// When no 10-K is reachable (recent IPO, primary document not yet
// live on EDGAR, 20-F-only ADR), we fall back to the pre-10K behaviour
// — Claude uses yfinance's summary plus training-data knowledge. The
// UI caller decides whether to surface a notice in that case; this
// module just flags it via the return value.

import { callJson } from "@/lib/claudeClient";
import type { Quote, Fundamentals } from "@/lib/financial";
import type {
  RedFlag,
  RedFlagCategory,
  RedFlagSeverity,
} from "@/lib/redFlags";

// Filing input shared with businessUnderstandingAi — the fields are
// identical because both features use the same 10-K. Declared here
// for independence (caller passes whatever matches the shape).
export type RedFlagsFilingInput = {
  text: string;
  truncated: boolean;
  source: "item_1a" | "full_truncated_end" | "full_truncated_start";
  accession: string;
  form: string;
  filingDate: string; // YYYY-MM-DD
  reportDate: string | null;
  url: string;
};

const CATEGORIES: RedFlagCategory[] = [
  "auditor",
  "leadership",
  "litigation",
  "restructuring",
  "going_concern",
  "other",
];

const SEVERITIES: RedFlagSeverity[] = ["info", "watch", "serious"];

const TONE_PREAMBLE = `Eres un inversor experimentado que ayuda a un amigo a revisar una empresa antes de comprarla. Hablas en español, tono cercano y directo, sin jerga innecesaria. Términos asimilados como 10-K, CEO, CFO, going-concern pueden ir en inglés.

Tu trabajo es listar señales cualitativas que un inversor debería conocer ANTES de mirar los números: cambios de auditor, rotación del CEO/CFO, litigios materiales, reestructuraciones, dudas de going concern. No inventes — si no tienes información sobre alguna categoría, no la incluyas. Si la empresa está limpia en todas, devuelve una lista vacía o muy corta con severidad "info".`;

function buildPrompt(
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
  filing: RedFlagsFilingInput | null,
): string {
  const companyLine = quote
    ? `${quote.longName ?? ticker} (${ticker}) · ${quote.sector ?? "sector ?"} / ${quote.industry ?? "industry ?"}`
    : `Ticker ${ticker}`;

  const summaryLine = quote?.longBusinessSummary
    ? `Resumen del negocio (contexto, no fuente primaria): ${quote.longBusinessSummary.slice(0, 500)}`
    : "Sin resumen disponible.";

  const debtLine = fundamentals?.totalDebt
    ? `Deuda total aproximada: $${(fundamentals.totalDebt / 1e9).toFixed(1)}B`
    : "Deuda no disponible.";

  const filingBlock = filing
    ? `
FUENTE PRIMARIA — ${filing.form} SEC EDGAR (${filing.reportDate ? `periodo ${filing.reportDate}, ` : ""}filed ${filing.filingDate}).
${
  filing.source === "item_1a"
    ? "El texto contiene Item 1A (Risk Factors) extraído del 10-K."
    : filing.source === "full_truncated_end"
      ? "El texto es el final del 10-K (Items 1A / 2 / 3 conservados; Items 1 y anteriores cortados por longitud)."
      : "El texto es el inicio del 10-K (puede que Items 1A posteriores queden fuera)."
}${filing.truncated ? " Indicalo si consideras que información crítica podría estar fuera del corte." : ""}

=== TEXTO ${filing.form} (plano, inglés) ===
${filing.text}
=== FIN DEL DOCUMENTO ===
`
    : `
(No hay un 10-K reciente accesible para este ticker. Trabaja con el contexto disponible y sé conservador — sin fuente documental, devuelve pocos flags y marca severidad "info" salvo que la señal sea pública y conocida.)
`;

  return `${TONE_PREAMBLE}

Empresa a revisar: ${companyLine}
${filingBlock}
FUENTE SECUNDARIA (contexto de mercado, no evidencia):
${summaryLine}
${debtLine}

INSTRUCCIONES CRÍTICAS DE USO DE LA FUENTE:
- Cada flag que propongas DEBE estar respaldado por texto literal del ${filing ? filing.form : "documento"}.
- No inventes. Si no encuentras evidencia textual en el documento, no emitas el flag.
- Si la empresa está limpia según el documento (risk factors genéricos, sin procedimientos legales materiales, sin cambios de auditor o directivos), devuelve una lista vacía o 1-2 flags "info".
- Nombres propios, siglas financieras (ROIC, FCF, EBITDA, moat) e identificadores legales (Item 1A, Item 3, 10-K, 8-K, SEC, DOJ) se quedan en inglés dentro del texto en español.

Enumera entre 0 y 8 señales cualitativas. Cada una debe tener:
- **category**: una de ${CATEGORIES.join(", ")}
  - auditor: cambios de auditor, material weakness, restatements
  - leadership: cambios recientes CEO/CFO, huida de directivos clave
  - litigation: demandas materiales, investigaciones SEC/DOJ
  - restructuring: despidos masivos, escisiones, write-downs grandes
  - going_concern: duda sobre continuidad del negocio
  - other: lo que no encaje arriba (cumplimiento, reputación, etc.)
- **severity**: info / watch / serious
  - info: bueno saberlo, no bloquea
  - watch: investigar antes de invertir
  - serious: razón fuerte para parar (Moatboard debería recomendarte no continuar)
- **summary**: 1 frase corta — qué es
- **detail**: 2-4 frases — por qué importa a un inversor de buy-and-hold${filing ? `
- **source_excerpt**: el fragmento literal del documento que respalda este flag (inglés, máximo 300 caracteres, ideal 100-200). No parafrasees — copia.
- **source_item**: la sección donde aparece (ej: Item 1A, Item 3, Item 7A). Omítelo si no puedes identificar sección exacta.` : ""}

Llama a la tool submit_red_flags con tu resultado. No escribas texto plano.`;
}

export async function generateRedFlags(
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
  filing: RedFlagsFilingInput | null = null,
): Promise<{ flags: RedFlag[]; model: string }> {
  const prompt = buildPrompt(ticker, quote, fundamentals, filing);

  // Use Anthropic's tool_use for structured output. The schema guarantees
  // In remote mode callJson uses Anthropic's tool_use for guaranteed
  // valid JSON (the unescaped-quotes-in-free-text failure mode plain JSON
  // suffered from). In local mode the schema is injected in the prompt
  // and Opus parses the output.
  // max_tokens is generous because each flag carries a source_excerpt
  // (~100-300 chars) on top of detail, and 8 flags × 4 fields adds up.
  const { data: input, model } = await callJson<{
    flags?: Array<{
      category?: string;
      severity?: string;
      summary?: string;
      detail?: string;
      source_excerpt?: string;
      source_item?: string;
    }>;
  }>(prompt, {
    schemaName: "submit_red_flags",
    schemaDescription: "Submit the list of qualitative red flags identified for the company.",
    maxTokens: 4000,
    jsonSchema: {
      type: "object",
      properties: {
        flags: {
          type: "array",
          description: "Between 0 and 8 red flags. Empty array is valid for a clean company.",
          items: {
            type: "object",
            properties: {
              category: { type: "string", enum: CATEGORIES },
              severity: { type: "string", enum: SEVERITIES },
              summary: { type: "string", description: "One short Spanish sentence — what the flag is." },
              detail: { type: "string", description: "2-4 Spanish sentences — why it matters." },
              source_excerpt: {
                type: "string",
                description: "Literal English text from the filing that supports this flag (100-300 chars). Optional but preferred when filing is available.",
              },
              source_item: {
                type: "string",
                description: "The 10-K section where the excerpt lives (e.g. Item 1A, Item 3). Optional.",
              },
            },
            required: ["category", "severity", "summary", "detail"],
          },
        },
      },
      required: ["flags"],
    },
  });

  if (!Array.isArray(input.flags)) {
    console.error(
      `Red flags payload lacked flags array. Raw input: ${JSON.stringify(input).slice(0, 600)}`,
    );
    throw new Error("Red flags output missing `flags` array");
  }

  const flags: RedFlag[] = input.flags
    .filter(
      (f): f is {
        category: string;
        severity: string;
        summary: string;
        detail: string;
        source_excerpt?: string;
        source_item?: string;
      } =>
        typeof f.category === "string" &&
        typeof f.severity === "string" &&
        typeof f.summary === "string" &&
        typeof f.detail === "string" &&
        CATEGORIES.includes(f.category as RedFlagCategory) &&
        SEVERITIES.includes(f.severity as RedFlagSeverity),
    )
    .map((f) => {
      const flag: RedFlag = {
        category: f.category as RedFlagCategory,
        severity: f.severity as RedFlagSeverity,
        summary: f.summary.trim(),
        detail: f.detail.trim(),
      };
      if (typeof f.source_excerpt === "string") {
        const trimmed = f.source_excerpt.trim();
        if (trimmed.length > 0) {
          flag.source_excerpt = trimmed.slice(0, 300);
        }
      }
      if (typeof f.source_item === "string") {
        const trimmed = f.source_item.trim();
        if (trimmed.length > 0) flag.source_item = trimmed;
      }
      return flag;
    });

  return { flags, model };
}
