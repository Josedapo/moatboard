// AI generator for qualitative red flags.
//
// Same caveat as businessUnderstandingAi: this draws on Claude's general
// knowledge of the company plus whatever yfinance exposes. It does NOT yet
// read the real 10-K Item 1A (Risk Factors) or recent 8-Ks — that's
// captured as a known limitation in moatboard-app/CLAUDE.md. For well-known
// large caps, the output is useful context; for obscure tickers, expect
// gaps. The UI surfaces this with a "based on general knowledge" note.

import Anthropic from "@anthropic-ai/sdk";
import type { Quote, Fundamentals } from "@/lib/financial";
import type {
  RedFlag,
  RedFlagCategory,
  RedFlagSeverity,
} from "@/lib/redFlags";

const MODEL = "claude-sonnet-4-6";

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

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
): string {
  const companyLine = quote
    ? `${quote.longName ?? ticker} (${ticker}) · ${quote.sector ?? "sector ?"} / ${quote.industry ?? "industry ?"}`
    : `Ticker ${ticker}`;

  const summaryLine = quote?.longBusinessSummary
    ? `Resumen del negocio: ${quote.longBusinessSummary.slice(0, 500)}`
    : "Sin resumen disponible.";

  const debtLine = fundamentals?.totalDebt
    ? `Deuda total aproximada: $${(fundamentals.totalDebt / 1e9).toFixed(1)}B`
    : "Deuda no disponible.";

  return `${TONE_PREAMBLE}

Empresa a revisar: ${companyLine}

${summaryLine}
${debtLine}

Enumera entre 0 y 8 señales cualitativas (red flags o asuntos a vigilar). Cada una debe tener:
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
- **detail**: 2-4 frases — por qué importa a un inversor de buy-and-hold

Si la empresa es conocida por estar limpia (blue chip sin eventos recientes), es válido devolver solo 1-2 flags de severidad "info" o una lista vacía. NO inventes problemas donde no los hay.

FORMATO DE SALIDA — JSON estricto, nada antes ni después:

{
  "flags": [
    {
      "category": "...",
      "severity": "...",
      "summary": "...",
      "detail": "..."
    }
  ]
}`;
}

export async function generateRedFlags(
  ticker: string,
  quote: Quote | null,
  fundamentals: Fundamentals | null,
): Promise<{ flags: RedFlag[]; model: string }> {
  const prompt = buildPrompt(ticker, quote, fundamentals);

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2000,
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
      `Could not find JSON in red-flags response: ${raw.slice(0, 200)}`,
    );
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    flags?: Array<{
      category?: string;
      severity?: string;
      summary?: string;
      detail?: string;
    }>;
  };

  if (!Array.isArray(parsed.flags)) {
    throw new Error("Red flags JSON missing `flags` array");
  }

  const flags: RedFlag[] = parsed.flags
    .filter(
      (f): f is { category: string; severity: string; summary: string; detail: string } =>
        typeof f.category === "string" &&
        typeof f.severity === "string" &&
        typeof f.summary === "string" &&
        typeof f.detail === "string" &&
        CATEGORIES.includes(f.category as RedFlagCategory) &&
        SEVERITIES.includes(f.severity as RedFlagSeverity),
    )
    .map((f) => ({
      category: f.category as RedFlagCategory,
      severity: f.severity as RedFlagSeverity,
      summary: f.summary.trim(),
      detail: f.detail.trim(),
    }));

  return { flags, model: MODEL };
}
