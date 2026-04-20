"use client";

import { useState, useTransition } from "react";
import { updatePositionPreCommitmentAction } from "@/app/dashboard/position/[id]/actions";

export default function PositionPreCommitment({
  positionId,
  text,
  // Date labels are formatted server-side and passed as strings — locale
  // formatting on the client would differ from the server (server runs in
  // UTC, client in Madrid) and trigger a hydration mismatch near midnight.
  editedLabel,
  createdLabel,
}: {
  positionId: number;
  text: string | null;
  editedLabel: string | null;
  createdLabel: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isEmpty = !text || text.trim().length === 0;
  const footer = editedLabel
    ? `Editado el ${editedLabel}`
    : createdLabel
      ? `Anclado el ${createdLabel}`
      : null;

  function startEditing() {
    setDraft(text ?? "");
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setDraft(text ?? "");
    setError(null);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      try {
        await updatePositionPreCommitmentAction({ positionId, text: draft });
        setEditing(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    });
  }

  if (editing) {
    return (
      <div className="rounded-lg border-l-4 border-l-navy-700 bg-navy-50/50 p-5">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-navy-700">
            Compromiso de salida
          </h3>
        </div>
        <p className="mb-3 text-xs text-navy-500">
          ¿Qué tendría que pasar para perder confianza en esta inversión?
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={6}
          autoFocus
          placeholder="Erosión del moat, capital allocation que destruya ROIC, CEO sustituido sin continuidad clara…"
          className="w-full rounded-lg border border-navy-300 bg-white px-3 py-2 text-sm focus:border-navy-900 focus:outline-none"
        />
        {error && (
          <p className="mt-2 text-xs text-red-600">{error}</p>
        )}
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="rounded-lg bg-navy-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
          >
            {pending ? "Guardando…" : "Guardar"}
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={pending}
            className="text-sm text-navy-600 hover:text-navy-900 disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className="rounded-lg border-l-4 border-l-amber-400 bg-amber-50/50 p-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-800">
          Compromiso de salida
        </h3>
        <p className="mb-3 text-sm leading-relaxed text-navy-700">
          Aún no has registrado un compromiso de salida para esta posición.
          Hazlo en cuanto puedas — anclará tu comportamiento cuando el precio
          se mueva.
        </p>
        <button
          type="button"
          onClick={startEditing}
          className="rounded-lg border border-amber-400 bg-white px-4 py-1.5 text-sm font-medium text-amber-800 hover:border-amber-600"
        >
          Añadir compromiso
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border-l-4 border-l-navy-700 bg-navy-50/50 p-5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-navy-700">
          Compromiso de salida
        </h3>
        <button
          type="button"
          onClick={startEditing}
          className="text-xs font-medium text-navy-600 hover:text-navy-900"
        >
          Editar
        </button>
      </div>
      <p className="mb-3 text-xs text-navy-500">
        Lo que tendría que pasar para perder confianza en esta inversión.
      </p>
      <blockquote className="whitespace-pre-wrap text-base font-medium leading-relaxed text-navy-900">
        {text}
      </blockquote>
      {footer && (
        <p className="mt-4 text-xs text-navy-400">{footer}</p>
      )}
    </div>
  );
}
