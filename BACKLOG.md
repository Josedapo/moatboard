# Moatboard — Engineering backlog

**Status:** 2026-04-22 — Moatboard entra en uso real. Joseda empieza a analizar e invertir con el producto. Este archivo captura lo pendiente para que no se pierda; la prioridad la da el dogfooding, no la lista.

**Cómo se usa:**
- Cuando algo aparece durante el uso real, va arriba del todo en **Observed during use** con fecha.
- El resto son hilos documentados pero deferred — se pican cuando haya masa crítica o el uso lo demande.
- Mover items entre secciones es libre; cada entrada es una línea + una de contexto.

---

## Observed during use

_Aquí aterrizan las cosas que surjan al analizar / invertir de verdad. Fecha + una línea. Sin ordenar por prioridad — eso se resuelve cuando se decida retomar el backlog._

- **2026-04-23 · Local mode JSON-in-text fallback for Claude Agent SDK.** Los 2 typed callers (`businessUnderstandingAi`, `redFlagsAi`) ahora envían el schema inline en el prompt y parsean la salida de texto de Opus. Smoke-test en V dio JSON válido a la primera. Si en dogfooding Opus empieza a fallar parsos de forma recurrente (unescaped quotes, newlines sin escapar), la opción B es migrar a `@anthropic-ai/claude-agent-sdk` cuyo `query()` acepta tools custom con schemas typed manteniendo auth Max. ~2h de trabajo. Mantener como plan B documentado; no tocar mientras Opus cumpla.

- **2026-04-27 · Base case Implied Return — primary multiple + min(current, median) + UI shipped (LOCAL).** Cerrada la primera mitad de la entrada del 2026-04-25. Tres cambios juntos en una sesión: **(1)** El múltiplo que conduce el implied return ya no está hardcodeado a P/E. Ahora `selectPrimaryMultipleSnapshot` (lib/multipleSelection.ts) lee el `primary_tool` de la AI valuation guide; mapea `pe`/`pfcf`/`pb` al snapshot correspondiente; cae a dispatch determinístico por business type cuando la guide no recomienda multiple (`dcf`/`cash_yield`) o no está disponible (balance-sheet → P/B, REIT → P/FCF, product → P/FCF). El P/FCF se deriva invirtiendo el snapshot de yield (1/yield) — caveat documentado: median(1/x) ≠ 1/median(x), aceptado pragmáticamente para v1. **(2)** Base case dejó de ser "current held constant" (multipleChangeBase = 0). Nueva regla en `deriveMultipleChangeBase`: si current ≤ median del propio histórico, mantiene current (no asume re-rating al alza, evita doble-conteo de la barateza ya capturada en FCF Yield); si current > median, comprime a la mediana sobre 10y. Es la disciplina Smith/Akre/Sleep operativa. Stress sin cambios (sigue Q1). **(3)** UI del `ImpliedReturnCalculator` muestra el múltiplo terminal real en cada escenario (`27.5x` mediana 10y / `Nx` Q1 hist.) con el `±X%/año` como subordinate. Sección Detalles cita los números reales y explica de dónde sale el múltiplo (AI guide vs deterministic). Persistencia: `multiple_label`, `multiple_source`, `multiple_current/median/q1`, `multiple_base/stress_terminal` en `assumptions`. ensureValuationGuide se adelantó dentro de `computeAndSaveValuation` (caché golpea en cold path después). 17 valuations regeneradas: GOOGL/AAPL/MSFT comprimen como esperaba; V queda comprable manteniendo current; KNSL sigue pasando comprable porque la mediana propia 7.4x P/B refleja régimen anómalo — sigue pendiente la otra mitad de esta entrada (cross-sectional anchor + override editable abajo).

- **2026-04-25 · Cross-sectional anchor + override editable del stress en Implied Return — pendiente.** El primary multiple + min(current, median) shipped 2026-04-27 cierra la asimetría base/stress dentro del propio histórico. Lo que sigue abierto: cuando toda la historia 10y del ticker ha sido en régimen anómalo persistente (KNSL post-IPO 2016 vivió tipos cero + hard-market insurance + flow into quality compounders 2020-2024), la mediana propia es ella misma anómala. Buffett, Smith y Akre escapan esto con comparación cross-sectional (peer median del sector + tier de calidad), no con stress numérico extra. Lo que hay que construir: **(1) Anchor cross-sectional por business type** — peer median del múltiplo (P/B 1.8-2.2x para insurers Tier A; P/FCF 22-28x para SaaS compounders quality; etc.). Tres rutas posibles: hard-coded ranges desde Damodaran sector data, computar runtime desde Discovery roster (31 funds × ~860 tickers agrupando por business_type), o ingesta automática anual de las tablas de Damodaran. **(2) Disclaimer en el calculator** cuando el múltiplo actual cotice ≥1.5× el peer median del sector — texto explícito tipo "Este múltiplo está significativamente por encima del peer median del sector; el propio histórico puede no ser representativo del régimen normal". No penaliza el verdict — añade información contextual. **(3) Override editable del `multiple_change_stress`** y/o `multiple_change_base` en la UI del calculator. Cuando aparezca el disclaimer (o cuando Joseda lo crea oportuno), input numérico para introducir su propia compresión asumida y recalcular CAGRs. Persistir el override en `assumptions.multiple_change_*_override` para que sobreviva regeneraciones. Esto preserva la regla mecánica simple por defecto y deja el juicio cualitativo donde debe estar (manos del usuario, no en una constante mágica). Pendiente hasta que aparezca masa crítica de casos donde el frame relativo engañe — KNSL sigue siendo el caso testigo.

---

## Framework audit — Tier 2/3 deferred

Fuente: `Context/framework-alignment-audit.md` (2026-04-18). Tier 1 ya shipped (V1, V2a, V2c, V5). V2b obsoleto por SEC integration. Lo que queda:

- **V3 — Hide Valuation section for Mediocre/Poor tier businesses.** Hoy la Valoración sigue renderizándose aunque la empresa sea Poor y no tenga sentido valorarla. Pequeño cambio de UI condicionada al tier.
- **V4 / Q4 — Bank tier algorithm over-strict on 6-dimension path.** Una empresa financiera con 5 strong + 1 acceptable nunca llega a Exceptional (requiere ≥5 strong = applicable-1). Calibración: aflojar para 6-dim path o proporcional. Afecta bancos / aseguradoras / mortgage REITs.
- **V6 — "Bear / Base / Bull" label overclaims confidence.** La label sugiere más certidumbre de la que el rango realmente tiene. Rename o matizar copy.
- **Q1 — Add mortgage REITs to HARD_INDUSTRIES.** Spread-on-leveraged-MBS es apuesta de tipos de interés, no de negocio. Buffett explícitamente no invierte ahí. Hoy mREITs corren por balance-sheet-businesses; debería además disparar too-hard gate.

---

## Phase 6 signals pending

Event-driven review loop empezó con SEC cron (step 1-2 shipped 2026-04-20). Lo que queda:

- **Revisión anual deliberada.** Cron detecta posiciones cuya primera compra fue hace ~365d sin re-análisis en ese período → emite signal `annual_review_due`. Refuerza el ritual, reusa toda la infra de signals. Scope pequeño.
- **DEF 14A — proxy statements.** Compensación ejecutiva, related-party transactions, shareholder proposals. Anual por ticker, menos accionable que 13F/Form 4 pero complementario. Scope medio.
- **News APIs fase 2.** Marketwatch / Reuters / financial press. Deferred deliberadamente por recomendación del clean-mind agent: dogfood SEC-only durante 3-4 semanas primero para ver si sentimos el gap.

---

## Phase 7 Discovery extensions

Phase 7 Sessions 1-3 + cron semanal 13F + cross-signals shipped. Pendiente:

- **Form 4 coverage para los 860 tickers del roster Discovery.** Hoy Form 4 solo cubre los tickers del usuario. Extender a Discovery exige ingesta adicional (860 tickers × Form 4s diarios). Decisión: evaluar tras 3-4 semanas usando Form 4 sobre cartera propia.
- **Form 4 overlay en Discovery leaderboard.** Badge per-row tipo "3 insiders comprando últimos 90d" cuando extendamos la cobertura.
- **OpenFIGI API key.** Hoy free tier 25 req/min; con key 60 req/min. Relevante solo si hacemos backfill grande o extendemos Form 4 a Discovery. ~15 min de setup.

---

## Ideas sin plan

Items que se mencionaron en alguna sesión pero no llegaron a plan formal:

- **Customer/supplier map de posiciones.** Para cada posición propia, identificar customers/suppliers públicos cotizados. Conecta Discovery con portfolio. Requiere LLM extraction de 10-K Item 1 + UX decision (¿dónde vive el grafo?). Alto esfuerzo, valor especulativo hasta probar.
- **Form 4 SELLS (code S).** Hoy solo code P. Las ventas son señal ambigua (diversificación, fiscalidad, 10b5-1). Pattern interesante: cluster selling (3+ insiders venden en 30d) puede ser materialmente informativo. No urge.
- **Aggregación de insider activity.** "3 insiders comprando este mes en AAPL" como vista mensual — `summarizeRecentInsiderPurchases` ya lo permite si hace falta.

---

## Killed with reason

Items considerados y decididos no construir, para no re-debatir:

- **Punch card surface (2026-04-22).** Widget contando moves/año. Descartado tras discusión: Moatboard ya está diseñado para no llevar al trading (sin precios, crons silenciosos, signals como revisión no acción). Un contador — incluso como espejo sin cap — es ornamental, no funcional. El sistema ya crea la disciplina por su propia naturaleza.
- **Compound verdict en Valuation section (drift M, 2026-04-16).** Se consideró un tier de Valoración único compuesto; se descartó por la razón opuesta al punch card: compactar en un verdict único oculta el trabajo de weighing que el inversor debe hacer (latticework Munger). La solución es 4 herramientas independientes + AI Guide que pondera.

---

## Meta — cómo evolucionar este archivo

- Entries se pueden graduar entre secciones (Observed → Framework / Phase 6 / etc. cuando se clarifique el tamaño).
- Al matar un item, moverlo a **Killed with reason** con fecha + motivo para no re-proponerlo sin contexto.
- Si una sección se vacía, retirarla completamente (no dejar "(vacío)" permanente).
- Cuando un item se aborde en una sesión con Claude, linkar al commit o plan doc correspondiente al cerrarlo.
