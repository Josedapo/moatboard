import { type Quality, qualityStyles } from "@/lib/scorecard";

export default function ScorecardCard({
  label,
  value,
  hint,
  quality,
}: {
  label: string;
  value: string;
  hint?: string;
  quality: Quality;
}) {
  const styles = qualityStyles(quality);

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
