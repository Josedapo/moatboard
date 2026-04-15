import type { Tier } from "@/lib/verdict";

const STYLES: Record<
  Tier,
  { label: string; bg: string; text: string; ring: string; symbol: string }
> = {
  exceptional: {
    label: "Exceptional business",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    ring: "ring-emerald-200",
    symbol: "★",
  },
  good: {
    label: "Good business",
    bg: "bg-teal-50",
    text: "text-teal-700",
    ring: "ring-teal-200",
    symbol: "✓",
  },
  mediocre: {
    label: "Mediocre business",
    bg: "bg-amber-50",
    text: "text-amber-700",
    ring: "ring-amber-200",
    symbol: "~",
  },
  poor: {
    label: "Poor business",
    bg: "bg-red-50",
    text: "text-red-700",
    ring: "ring-red-200",
    symbol: "✕",
  },
};

export default function QualityBadge({
  tier,
  size = "md",
}: {
  tier: Tier;
  size?: "sm" | "md" | "lg";
}) {
  const styles = STYLES[tier];
  const sizeClasses =
    size === "lg"
      ? "px-4 py-2 text-base"
      : size === "sm"
        ? "px-2.5 py-1 text-xs"
        : "px-3 py-1.5 text-sm";

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full font-semibold uppercase tracking-wide ring-1 ${styles.bg} ${styles.text} ${styles.ring} ${sizeClasses}`}
    >
      <span className="text-base leading-none">{styles.symbol}</span>
      {styles.label}
    </span>
  );
}
