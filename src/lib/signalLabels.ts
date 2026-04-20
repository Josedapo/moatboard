// Display labels for review_signals. Kept as its own module so both
// the dashboard inbox and the per-position floor banner share the same
// vocabulary. Spanish prose for the UI; acronyms stay English.

import type {
  SignalEventType,
  SignalSeverity,
  SignalSource,
} from "@/lib/signalClassifier";

// One-line label per event_type. Surfaced as the card headline in the
// inbox. Deliberately descriptive — "cambio de CEO/CFO" vs the abstract
// "management_change" — so Joseda can skim the inbox without thinking.
export const EVENT_TYPE_LABEL: Record<SignalEventType, string> = {
  earnings_release: "Resultados presentados",
  earnings_restatement: "Estados financieros reexpresados",
  material_agreement: "Acuerdo material firmado o finalizado",
  bankruptcy: "Quiebra o suspensión de pagos",
  cyber_incident: "Incidente de ciberseguridad material",
  ma_completion: "Adquisición o venta completada",
  debt_event: "Evento material de deuda",
  restructuring: "Reestructuración o cierre de operaciones",
  impairment: "Deterioro de activos material",
  delisting: "Aviso de exclusión de cotización",
  equity_dilution: "Emisión de acciones material",
  auditor_change: "Cambio de auditor",
  financial_restatement: "Estados financieros previos dejan de ser fiables",
  management_change: "Cambio de directivos o consejeros",
  bylaws_amendment: "Modificación de estatutos",
  fd_disclosure: "Divulgación Reg FD",
  other_material: "Otros eventos materiales",
};

// Source → short badge label (SEC form type).
export const SOURCE_LABEL: Record<SignalSource, string> = {
  sec_8k: "8-K",
  sec_10q: "10-Q",
  sec_10k: "10-K",
  sec_10qa: "10-Q/A",
  sec_10ka: "10-K/A",
};

// Severity visual spec — consistent with DirectionCircle tones used
// elsewhere in the app (calidad section). Floor = emerald outlined
// (attention but not alarming), material = amber (review required),
// informational = navy (context, no action obligated).
export const SEVERITY_SPEC: Record<
  SignalSeverity,
  { label: string; chipClass: string; frameClass: string }
> = {
  floor: {
    label: "Revisión obligatoria",
    chipClass:
      "border border-emerald-300 bg-emerald-100 text-emerald-700",
    frameClass: "border-emerald-200 bg-emerald-50/30",
  },
  material: {
    label: "Evento material",
    chipClass: "bg-amber-500 text-white",
    frameClass: "border-amber-200 bg-amber-50/40",
  },
  informational: {
    label: "Informativo",
    chipClass: "border border-navy-200 bg-white text-navy-700",
    frameClass: "border-navy-100 bg-white",
  },
};
