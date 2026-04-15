import { type Quality, qualityStyles } from "@/lib/scorecard";

export default function ScorecardCard({
  label,
  value,
  hint,
  quality,
  compact = false,
}: {
  label: string;
  value: string;
  hint?: string;
  quality: Quality;
  compact?: boolean;
}) {
  const styles = qualityStyles(quality);

  if (compact) {
    return (
      <div
        className={`rounded-md border border-navy-100 border-l-2 bg-navy-50/40 px-3 py-2 ${styles.border}`}
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[10px] font-medium uppercase tracking-wide text-navy-500">
            {label}
          </span>
          <span className="text-sm font-semibold tabular-nums text-navy-900">
            {value}
          </span>
        </div>
        {hint && (
          <div className="mt-0.5 text-[10px] leading-tight text-navy-400">
            {hint}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg border border-navy-100 border-l-4 bg-white p-4 ${styles.border}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-navy-500">
          {label}
        </span>
        {styles.label && (
          <span className="flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${styles.dot}`} />
            <span className={`text-[10px] font-medium uppercase tracking-wide ${styles.labelColor}`}>
              {styles.label}
            </span>
          </span>
        )}
      </div>
      <div className="mt-2 text-2xl font-semibold text-navy-950">{value}</div>
      {hint && <div className="mt-1 text-xs text-navy-500">{hint}</div>}
    </div>
  );
}
