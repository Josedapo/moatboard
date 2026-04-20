import type { PositionTransaction } from "@/lib/positionTransactions";

const TYPE_LABELS: Record<PositionTransaction["type"], string> = {
  buy: "Buy",
  add: "Add",
  trim: "Trim",
  sell: "Sell",
};

function formatShares(value: string | number): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(4).replace(/\.?0+$/, "");
}

function formatPrice(value: string | number): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

// Renders the per-operation log. Each row shows type/date/shares/price plus
// the optional `pre_commitment_md` text — kept on the column for backwards
// compat, but the semantics are now "operation note" (per-operation reason),
// not the position-level pre-commitment which lives on positions.
export default function TransactionOperationNotesList({
  transactions,
}: {
  transactions: PositionTransaction[];
}) {
  if (transactions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-navy-200 bg-navy-50/30 p-4">
        <p className="text-sm text-navy-500">
          No operations recorded yet for this position.
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {transactions.map((txn) => (
        <li
          key={txn.id}
          className="rounded-lg border border-navy-100 bg-white p-4"
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <span className="rounded-md bg-navy-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-navy-700">
              {TYPE_LABELS[txn.type]}
            </span>
            <span className="font-medium text-navy-900">
              {txn.transaction_date}
            </span>
            <span className="text-navy-600">
              {formatShares(txn.shares)} shares @ {formatPrice(txn.price)}
            </span>
          </div>
          <div className="mt-2 text-sm leading-relaxed text-navy-700">
            {txn.pre_commitment_md ? (
              <p className="whitespace-pre-wrap">{txn.pre_commitment_md}</p>
            ) : (
              <span className="text-navy-400">—</span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
