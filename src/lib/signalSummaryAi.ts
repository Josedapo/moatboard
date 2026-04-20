// Plain-language SEC filing summariser. Given a review_signals row
// (SEC filing reference), fetches the primary document from EDGAR,
// strips HTML boilerplate, and asks Claude to produce a short Spanish
// executive summary in language a non-financial reader can follow.
//
// Design pillars agreed with Joseda:
//   - Spanish prose; widely-known acronyms (ROIC, FCF, EBITDA, moat)
//     stay English, SEC-specific jargon gets translated inline.
//   - Focus on long-term investor angle (does this touch the thesis?),
//     not trading / price commentary.
//   - Never auto — the action is triggered by an explicit click so
//     cost is always user-controlled.
//   - Cached forever in review_signals.summary_md (filings are
//     immutable), regenerate only when the user asks.

import Anthropic from "@anthropic-ai/sdk";
import {
  EVENT_TYPE_LABEL,
  SOURCE_LABEL,
} from "@/lib/signalLabels";
import type {
  SignalEventType,
  SignalSource,
} from "@/lib/signalClassifier";

const SEC_USER_AGENT = process.env.SEC_USER_AGENT;
if (!SEC_USER_AGENT) {
  throw new Error(
    "SEC_USER_AGENT is not set. SEC EDGAR requires 'Name Email' format.",
  );
}

const MODEL = "claude-sonnet-4-6";

// Rough character cap before we truncate the filing. Sonnet 4.6 has a
// 200k-token context; budgeting ~15k tokens for prompt + response
// leaves ~185k for the document (~600k–750k chars of English). We cap
// at 550k chars as a conservative cushion — most 10-Qs fit; some 10-Ks
// get truncated, which is the known trade-off of Strategy A.
const MAX_DOCUMENT_CHARS = 550_000;

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) _client = new Anthropic();
  return _client;
}

export type SignalSummary = {
  summary_md: string;
  model: string;
  truncated: boolean;
};

// Fetch + clean + summarise. Errors bubble up with the SEC or Claude
// error message attached so the caller (server action) can show it in
// the UI instead of a cryptic "Failed to summarise".
export async function summariseFiling({
  ticker,
  source,
  eventType,
  sourceUrl,
}: {
  ticker: string;
  source: SignalSource;
  eventType: SignalEventType;
  sourceUrl: string;
}): Promise<SignalSummary> {
  const { text, truncated } = await fetchFilingText(sourceUrl);
  if (!text || text.length < 200) {
    throw new Error("SEC document was empty or unreadable");
  }

  const prompt = buildPrompt({
    ticker,
    sourceLabel: SOURCE_LABEL[source],
    eventLabel: EVENT_TYPE_LABEL[eventType],
    filingText: text,
    truncated,
  });

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1200,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  return {
    summary_md: textBlock.text.trim(),
    model: MODEL,
    truncated,
  };
}

// Download the primary filing document from EDGAR and strip the HTML
// shell down to something Claude can read. Minimal cleaning on purpose
// — we remove scripts/styles and collapse whitespace but keep the
// semantic text (headings, paragraphs, tables as plain text). No DOM
// parser dependency; SEC filings are well-formed enough for regex.
async function fetchFilingText(
  url: string,
): Promise<{ text: string; truncated: boolean }> {
  const res = await fetch(url, {
    headers: { "User-Agent": SEC_USER_AGENT! },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      `SEC document fetch failed: ${res.status} ${res.statusText}`,
    );
  }
  const raw = await res.text();

  // Strip <script> and <style> blocks including their content.
  let cleaned = raw
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<head[\s\S]*?<\/head>/gi, "");

  // Replace closing block tags with newlines so structure survives.
  cleaned = cleaned.replace(
    /<\/(p|div|tr|li|h[1-6]|section|article|header|footer)>/gi,
    "\n",
  );

  // Strip every remaining tag.
  cleaned = cleaned.replace(/<[^>]+>/g, " ");

  // Decode a handful of common HTML entities. Not exhaustive but covers
  // what SEC filings use in 99% of cases.
  cleaned = cleaned
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8217;/g, "’")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&#8211;/g, "–")
    .replace(/&#8212;/g, "—")
    .replace(/&#160;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Collapse whitespace (including newlines between tags) into single
  // spaces, then restore paragraph breaks for the double-newlines we
  // introduced on block-close tags.
  cleaned = cleaned.replace(/[ \t]+/g, " ");
  cleaned = cleaned.replace(/\n +/g, "\n").replace(/\n{3,}/g, "\n\n");
  cleaned = cleaned.trim();

  const truncated = cleaned.length > MAX_DOCUMENT_CHARS;
  if (truncated) cleaned = cleaned.slice(0, MAX_DOCUMENT_CHARS);

  return { text: cleaned, truncated };
}

function buildPrompt({
  ticker,
  sourceLabel,
  eventLabel,
  filingText,
  truncated,
}: {
  ticker: string;
  sourceLabel: string;
  eventLabel: string;
  filingText: string;
  truncated: boolean;
}): string {
  const truncationNote = truncated
    ? "\n\n**NOTA AL ANALISTA:** El documento excedió el límite y se ha truncado por el final. Indícalo al lector al final del resumen si consideras que la parte final podría contener información material."
    : "";

  return `Eres un analista financiero que traduce documentos de la SEC en lenguaje claro para un inversor de largo plazo SIN formación financiera avanzada. Tu trabajo es convertir jerga legal/contable en algo que pueda entender cualquier persona inteligente.

EMPRESA: ${ticker}
TIPO DE DOCUMENTO: ${sourceLabel}
EVENTO CLASIFICADO: ${eventLabel}${truncationNote}

=== DOCUMENTO SEC EDGAR (texto plano) ===
${filingText}
=== FIN DEL DOCUMENTO ===

INSTRUCCIONES DE LENGUAJE (críticas):

1. **Traduce la jerga legal y contable a lenguaje llano.** Cualquier término que no usaría una persona en una conversación normal debe explicarse. Ejemplos:
   - "U.S. litigation escrow account" → "una cuenta bloqueada donde aparta dinero para pagar posibles litigios en EE.UU."
   - "retrospective responsibility plan" → "un acuerdo por el que la empresa se comprometió a compensar a sus socios por disputas pasadas"
   - "going concern" → "capacidad de seguir operando como empresa viable"
   - "material weakness in internal controls" → "un fallo significativo en los controles internos que podría afectar a la fiabilidad de sus cuentas"
   - "impairment charge" → "un ajuste contable que reduce el valor de un activo porque ya no vale lo que pensaban"

2. **Acrónimos que SÍ puedes dejar en inglés sin traducir** (son universales entre inversores): ROIC, FCF, EBITDA, moat, EPS, PE, CEO, CFO, SEC. Cualquier OTRO acrónimo o término técnico debe traducirse o explicarse la primera vez.

3. **Escribe como si se lo explicaras a un amigo inteligente** que no trabaja en finanzas. Frases cortas, directas, sin rodeos.

4. **Enfoque: inversor de largo plazo.** No hables de precio de la acción, ni especules sobre reacciones del mercado. Solo: ¿esto toca el negocio real, la tesis de inversión, la calidad de la empresa o sus fundamentales?

ESTRUCTURA DEL RESUMEN (en Markdown, secciones cortas):

**Qué ha pasado**
2-4 líneas explicando el hecho en lenguaje llano. Cifras exactas solo si son materiales.

**Qué implica para tu inversión**
1-3 líneas. Sé honesto: si es rutinario o administrativo, escribe algo como "Es una operación rutinaria y no afecta a la tesis de inversión." Si toca algo fundamental (margen, crecimiento, moat, management, balance), sé concreto sobre qué y por qué.

**Qué revisar** (solo incluir esta sección si hay algo concreto a revisar)
1-3 viñetas con ítems muy concretos.

**Señales de alerta** (solo si hay flags reales, no especulación)
1-3 viñetas.

LONGITUD: máximo 250 palabras totales. Sé denso y preciso. Nada de relleno. Nada de "en conclusión" ni frases de cierre.`;
}
