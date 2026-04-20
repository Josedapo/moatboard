"use client";

import { useState, useTransition } from "react";
import { addOperationAction } from "@/app/dashboard/position/[id]/actions";

type OperationType = "add" | "sell";

const TYPE_LABELS: Record<OperationType, string> = {
  add: "Add",
  sell: "Sell",
};

const TYPE_DESCRIPTIONS: Record<OperationType, string> = {
  add: "Comprar más acciones de esta posición.",
  sell: "Vender total o parcialmente. No puedes vender más de las que tienes; si vendes el total, la posición se cierra.",
};

export default function AddOperationForm({
  positionId,
  currentPrice,
}: {
  positionId: number;
  // Pre-fill the price field as a hint. The user can override.
  currentPrice: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<OperationType>("add");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await addOperationAction(positionId, formData);
        setOpen(false);
        setType("add");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to record");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-navy-300 bg-white px-3 py-1.5 text-sm font-medium text-navy-700 hover:border-navy-900 hover:text-navy-900"
      >
        + Registrar operación
      </button>
    );
  }

  return (
    <form
      action={handleSubmit}
      className="rounded-lg border border-navy-200 bg-white p-5"
    >
      <div className="mb-4">
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-navy-500">
          Tipo
        </label>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(TYPE_LABELS) as OperationType[]).map((t) => {
            const isActive = type === t;
            return (
              <label
                key={t}
                className={
                  isActive
                    ? "flex cursor-pointer items-center gap-2 rounded-lg border-2 border-navy-900 bg-navy-50 px-3 py-1.5 text-sm font-medium text-navy-900"
                    : "flex cursor-pointer items-center gap-2 rounded-lg border-2 border-navy-200 bg-white px-3 py-1.5 text-sm font-medium text-navy-600 hover:border-navy-400"
                }
              >
                <input
                  type="radio"
                  name="type"
                  value={t}
                  checked={isActive}
                  onChange={() => setType(t)}
                  className="sr-only"
                />
                {TYPE_LABELS[t]}
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-navy-500">{TYPE_DESCRIPTIONS[type]}</p>
      </div>

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="op_date"
            className="mb-1 block text-xs font-semibold uppercase tracking-wider text-navy-500"
          >
            Fecha
          </label>
          <input
            id="op_date"
            name="transaction_date"
            type="date"
            defaultValue={today}
            max={today}
            required
            className="w-full rounded-lg border border-navy-300 px-3 py-2 text-sm focus:border-navy-900 focus:outline-none"
          />
        </div>
        <div>
          <label
            htmlFor="op_price"
            className="mb-1 block text-xs font-semibold uppercase tracking-wider text-navy-500"
          >
            Precio ($)
          </label>
          <input
            id="op_price"
            name="price"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={currentPrice ?? undefined}
            required
            className="w-full rounded-lg border border-navy-300 px-3 py-2 text-sm focus:border-navy-900 focus:outline-none"
          />
        </div>
        <div>
          <label
            htmlFor="op_shares"
            className="mb-1 block text-xs font-semibold uppercase tracking-wider text-navy-500"
          >
            Acciones
          </label>
          <input
            id="op_shares"
            name="shares"
            type="number"
            step="0.0001"
            min="0"
            required
            className="w-full rounded-lg border border-navy-300 px-3 py-2 text-sm focus:border-navy-900 focus:outline-none"
          />
        </div>
      </div>

      <div className="mb-4">
        <label
          htmlFor="op_note"
          className="mb-1 block text-xs font-semibold uppercase tracking-wider text-navy-500"
        >
          Nota (opcional)
        </label>
        <textarea
          id="op_note"
          name="note"
          rows={3}
          placeholder="¿Por qué esta operación hoy?"
          className="w-full rounded-lg border border-navy-300 px-3 py-2 text-sm focus:border-navy-900 focus:outline-none"
        />
      </div>

      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
        >
          {pending ? "Registrando…" : "Registrar"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
            setType("add");
          }}
          disabled={pending}
          className="text-sm text-navy-600 hover:text-navy-900 disabled:opacity-50"
        >
          Cancelar
        </button>
      </div>
    </form>
  );
}
