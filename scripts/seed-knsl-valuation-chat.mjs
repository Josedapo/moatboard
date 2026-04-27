// Seed the KNSL valuation chat with the conversation Joseda and
// Moatboard had on 2026-04-25 about the divergence between the
// Excess Returns DCF (IV $137) and the relative valuation
// (PE/PB at 3rd percentile of 9.81y history).
//
// Snapshot pulled from the live valuations row at the moment of
// seeding, so the version-divider in the UI reads "Sobre la
// valoración del 25 abr 2026 (IV $137 · Excess Returns)".
//
// Run once: node scripts/seed-knsl-valuation-chat.mjs

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const USER_ID = 1;
const TICKER = "KNSL";

const QUESTION = `En el caso de KNSL tengo una divergencia enorme entre el valuation relativo que me sugiere como primario y el DCF que me ofrece como secundario. ¿A qué puede deberse que el P/B esté tan bajo respecto a los comparables de los últimos 10 años?`;

const ANSWER = `Hay 3 explicaciones que hay que separar:

**1. La distribución histórica está sesgada por el boom 2020-2024**

KNSL IPO 2016. Los siguientes 9 años hubo:
- Ciclo de mercado duro de E&S 2020-2024 (premium growth 30%+ anual)
- ROE 25-30%, claramente atípico para una P&C insurer
- Mercado pagaba múltiplos de unicornio: PE 50-72x, PB 10-13x

Esa mediana de PE 42.8 y PB 7.4 **NO es una "fair value normal"** — es la mediana de un período de exuberancia. Cuando dice "PB 4.1 vs mediana 7.4 → barato", lo que está diciendo en realidad es "el mercado ya no paga el premium que pagaba en pico de ciclo". Que KNSL caiga de 13x BV a 4x BV es **re-rating, no descuento**.

**2. El DCF dice $137 porque asume reversión a competitive equilibrium**

Excess Returns Model (Damodaran):
\`\`\`
IV = BookValue + Σ (ROE − CostOfEquity) × BV  durante 10 años, fade a 0
\`\`\`

Para KNSL:
- Stable ROE alto (25-30%)
- Cost of Equity ~9-12% (CAPM con beta KNSL alto + Treasury 4.5% + ERP 5%)
- Excess return = 15-20pp anual los primeros años, fade a 0% por año 10

El modelo asume que **el moat se erosiona** (asunción Buffett-Munger estándar para insurance). KNSL puede tener nicho excelente en E&S, pero el sector ya ve entrantes agresivos (Skyward, Palomar, Bowhead). Si crees que ROE 25%+ persiste 10+ años → DCF es conservador. Si crees que el sector se normaliza → DCF está bien.

**3. Los dos modelos contestan preguntas distintas**

- DCF (Excess Returns) responde: ¿cuánto vale KNSL si los excess returns futuros se descuentan al cost of capital? → $137.
- PE / PB own-history responde: ¿está el mercado pagando más o menos que **históricamente**? → mucho menos.
- ¿Cuál es la "fair value" entre los dos? Ninguno te lo dice — eso es tu juicio.

**Lo que yo sospecharía mirando esto**

KNSL es un compounder cíclico que se sobre-valoró brutalmente en 2020-2024 (efecto hard market + flow into quality compounders). El re-rating actual es **honesto, no exagerado**. PB 4x para una insurer con ROE 20%+ sigue siendo carísimo en términos absolutos — la mayoría de bancos buenos cotizan 1.5-2x BV. El "look cheap vs own history" es una ilusión del marco de referencia.

La AI Guide pone P/B como primario probablemente porque KNSL es balance-sheet business y P/B es la herramienta canónica para ese caso. Pero **la propia historia de KNSL no es un buen ancla** — incluye un período anómalo. Aquí el DCF excess returns es mucho más informativo, aunque parezca contraintuitivo.`;

// Pull the live valuation row to snapshot exactly what was on screen.
const valRows = await sql`
  SELECT v.method, v.intrinsic_value, v.intrinsic_value_low,
         v.intrinsic_value_high, v.current_price, v.margin_of_safety_pct
  FROM valuations v
  JOIN positions p ON p.id = v.position_id
  WHERE p.user_id = ${USER_ID} AND p.ticker = ${TICKER}
`;
if (valRows.length === 0) {
  console.error(`No valuation found for ${TICKER}.`);
  process.exit(1);
}
const v = valRows[0];
const snapshot = {
  iv_base: Number(v.intrinsic_value),
  iv_low: Number(v.intrinsic_value_low),
  iv_high: Number(v.intrinsic_value_high),
  method: v.method,
  current_price: Number(v.current_price),
  mos_pct: Number(v.margin_of_safety_pct),
};

// Idempotency: if a turn with this exact question already exists for
// this user/ticker, skip — avoids accidental dupes on re-runs.
const existing = await sql`
  SELECT id FROM valuation_chats
  WHERE user_id = ${USER_ID} AND ticker = ${TICKER}
    AND question = ${QUESTION}
  LIMIT 1
`;
if (existing.length > 0) {
  console.log(`Already seeded (chat id=${existing[0].id}). Nothing to do.`);
  process.exit(0);
}

const inserted = await sql`
  INSERT INTO valuation_chats
    (user_id, ticker, question, answer, asked_at,
     answered_with_model, snapshot)
  VALUES
    (${USER_ID}, ${TICKER}, ${QUESTION}, ${ANSWER},
     '2026-04-25T11:00:00Z'::timestamptz,
     'claude-opus-4-7-1m (manual transcript)',
     ${JSON.stringify(snapshot)}::jsonb)
  RETURNING id, asked_at
`;

console.log(
  `Seeded KNSL turn: id=${inserted[0].id} asked_at=${inserted[0].asked_at}`,
);
console.log(`Snapshot: IV=$${snapshot.iv_base} · ${snapshot.method} · Px=$${snapshot.current_price}`);
