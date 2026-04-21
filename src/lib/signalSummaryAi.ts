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
import { fetchFilingText } from "@/lib/secDocument";

const MODEL = "claude-sonnet-4-6";

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
