import type {
  RedFlag,
  RedFlagCategory,
  RedFlagSeverity,
} from "@/lib/redFlags";

const CATEGORY_LABELS: Record<RedFlagCategory, string> = {
  auditor: "Auditor",
  leadership: "Liderazgo",
  litigation: "Litigios",
  restructuring: "Reestructuración",
  going_concern: "Going concern",
  other: "Otros",
};

const SEVERITY_STYLES: Record<
  RedFlagSeverity,
  { label: string; box: string; badge: string }
> = {
  info: {
    label: "Info",
    box: "border-navy-200 bg-white",
    badge: "bg-navy-100 text-navy-700",
  },
  watch: {
    label: "Vigilar",
    box: "border-amber-200 bg-amber-50/50",
    badge: "bg-amber-100 text-amber-800",
  },
  serious: {
    label: "Grave",
    box: "border-red-200 bg-red-50/50",
    badge: "bg-red-100 text-red-800",
  },
};

const SEVERITY_ORDER: RedFlagSeverity[] = ["serious", "watch", "info"];

// Pure presentational list of red flags grouped by severity (worst first).
// Empty state ("Sin señales de alerta conocidas") is rendered when the array
// is empty. No regenerate button, no header chrome — wrappers add those.
export default function RedFlagsList({ flags }: { flags: RedFlag[] }) {
  if (flags.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-4">
        <p className="text-sm font-medium text-emerald-900">
          Sin señales de alerta conocidas.
        </p>
        <p className="mt-1 text-sm text-emerald-800">
          La empresa aparece limpia de cambios de auditor, rotación directiva
          reciente, litigios materiales, reestructuraciones o dudas de
          continuidad en lo que el modelo tiene registrado.
        </p>
      </div>
    );
  }

  const bySeverity: Record<RedFlagSeverity, RedFlag[]> = {
    serious: [],
    watch: [],
    info: [],
  };
  for (const f of flags) {
    bySeverity[f.severity].push(f);
  }

  return (
    <div className="space-y-3">
      {SEVERITY_ORDER.flatMap((sev) =>
        bySeverity[sev].map((flag, i) => {
          const style = SEVERITY_STYLES[sev];
          return (
            <div
              key={`${sev}-${i}`}
              className={`rounded-lg border p-4 ${style.box}`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.badge}`}
                >
                  {style.label}
                </span>
                <span className="text-xs uppercase tracking-wider text-navy-500">
                  {CATEGORY_LABELS[flag.category]}
                </span>
              </div>
              <p className="mb-1 text-sm font-semibold text-navy-900">
                {flag.summary}
              </p>
              <p className="text-sm leading-relaxed text-navy-700">
                {flag.detail}
              </p>
              {flag.source_excerpt && (
                <blockquote className="mt-3 border-l-2 border-navy-300 bg-white/60 px-3 py-2 text-xs italic leading-relaxed text-navy-700">
                  “{flag.source_excerpt}”
                  {flag.source_item && (
                    <span className="mt-1 block not-italic text-navy-500">
                      — {flag.source_item}
                    </span>
                  )}
                </blockquote>
              )}
            </div>
          );
        }),
      )}
    </div>
  );
}

// Helper exported for wrappers that want to label the section/accordion with
// a count by severity.
export function summarizeFlagsBySeverity(flags: RedFlag[]): {
  serious: number;
  watch: number;
  info: number;
} {
  const counts = { serious: 0, watch: 0, info: 0 };
  for (const f of flags) counts[f.severity] += 1;
  return counts;
}
