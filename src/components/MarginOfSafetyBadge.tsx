import type { MosTier } from "@/lib/valuation";

const STYLES: Record<
  MosTier,
  { label: string; bg: string; text: string; ring: string; symbol: string }
> = {
  margin: {
    label: "Margin of safety",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    ring: "ring-emerald-200",
    symbol: "↓↓",
  },
  acceptable: {
    label: "Acceptable",
    bg: "bg-teal-50",
    text: "text-teal-700",
    ring: "ring-teal-200",
    symbol: "↓",
  },
  fair: {
    label: "Fair price",
    bg: "bg-blue-50",
    text: "text-blue-700",
    ring: "ring-blue-200",
    symbol: "=",
  },
  premium: {
    label: "Premium",
    bg: "bg-red-50",
    text: "text-red-700",
    ring: "ring-red-200",
    symbol: "↑",
  },
};

export default function MarginOfSafetyBadge({
  tier,
  size = "md",
}: {
  tier: MosTier;
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
