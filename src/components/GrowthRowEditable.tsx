"use client";

// Growth row in the Implied Return calculator's calculation table.
// Shows the effective growth (override ?? auto) per scenario and supports
// inline override editing. Pattern mirrors MultipleRowEditable: pencil ✎
// per cell, expandable inline form with Save/Reset/Cancel, emerald accent
// when override is active, italic muted "auto: Y.Y%/yr" hint.
//
// User input semantic: percent per year (e.g. "12.0" = 12%/year). Server
// stores as decimal (0.12). Validation: −10% to +30% per year.

import { useState, useTransition } from "react";
import type { ImpliedReturnStoredAssumptions } from "@/lib/valuations";
import { updateImpliedReturnOverrideAction } from "@/app/dashboard/position/[id]/actions";

export default function GrowthRowEditable({
  positionId,
  assumptions,
}: {
  positionId: number;
  assumptions: ImpliedReturnStoredAssumptions;
}) {
  const autoBase = assumptions.growth.base;
  const autoStress = assumptions.growth.stress;
  const baseOverride = assumptions.growth_base_override ?? null;
  const stressOverride = assumptions.growth_stress_override ?? null;
  const effectiveBase = baseOverride ?? autoBase;
  const effectiveStress = stressOverride ?? autoStress;

  return (
    <tr>
      <td className="py-2 align-top text-navy-700">+ Crecimiento sostenible</td>
      <td className="py-2 align-top text-right tabular-nums">
        <ScenarioCell
          positionId={positionId}
          scenario="base"
          effective={effectiveBase}
          autoValue={autoBase}
          override={baseOverride}
        />
      </td>
      <td className="py-2 align-top text-right tabular-nums text-navy-700">
        <ScenarioCell
          positionId={positionId}
          scenario="stress"
          effective={effectiveStress}
          autoValue={autoStress}
          override={stressOverride}
        />
      </td>
    </tr>
  );
}

function ScenarioCell({
  positionId,
  scenario,
  effective,
  autoValue,
  override,
}: {
  positionId: number;
  scenario: "base" | "stress";
  effective: number;
  autoValue: number;
  override: number | null;
}) {
  const isOverride = override !== null;
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState((effective * 100).toFixed(1));
  const [error, setError] = useState<string | null>(null);

  function openEditor() {
    setDraft((effective * 100).toFixed(1));
    setError(null);
    setEditing(true);
  }

  function close() {
    setEditing(false);
    setError(null);
  }

  function save(decimalValue: number | null) {
    setError(null);
    startTransition(async () => {
      try {
        await updateImpliedReturnOverrideAction({
          positionId,
          baseGrowth: scenario === "base" ? decimalValue : undefined,
          stressGrowth: scenario === "stress" ? decimalValue : undefined,
        });
        setEditing(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Error al guardar.");
      }
    });
  }

  if (editing) {
    return (
      <div
        className={`flex flex-col items-end gap-1 ${pending ? "opacity-70" : ""}`}
      >
        <div className="flex items-center gap-1">
          <input
            type="number"
            step="0.1"
            min="-10"
            max="30"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={pending}
            className="w-20 rounded border border-navy-300 px-2 py-1 text-right text-sm tabular-nums text-navy-900 focus:border-navy-500 focus:outline-none"
            aria-label={`Override ${scenario} growth`}
          />
          <span className="text-xs text-navy-500">%/yr</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              const v = Number(draft);
              if (!Number.isFinite(v)) {
                setError("Introduce un número.");
                return;
              }
              save(v / 100);
            }}
            disabled={pending}
            className="rounded bg-navy-800 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-navy-900 disabled:opacity-50"
          >
            Guardar
          </button>
          {isOverride && (
            <button
              type="button"
              onClick={() => save(null)}
              disabled={pending}
              className="rounded border border-navy-300 px-2 py-0.5 text-[11px] font-medium text-navy-700 hover:bg-navy-50 disabled:opacity-50"
              title="Volver al cálculo automático"
            >
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={close}
            disabled={pending}
            className="rounded px-2 py-0.5 text-[11px] font-medium text-navy-500 hover:text-navy-700 disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
        {error && (
          <div className="text-[10px] text-red-700" role="alert">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end">
      <div className="flex items-center gap-1.5">
        <span
          className={`font-medium ${isOverride ? "text-emerald-800" : "text-navy-900"}`}
        >
          {formatPct(effective)}
        </span>
        <button
          type="button"
          onClick={openEditor}
          aria-label={`Editar growth ${scenario}`}
          title="Editar manualmente"
          className="text-navy-400 hover:text-navy-700"
        >
          <PencilIcon />
        </button>
      </div>
      {isOverride && (
        <div className="text-[11px] font-normal italic text-navy-400">
          auto: {formatPct(autoValue)}
        </div>
      )}
    </div>
  );
}

function formatPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function PencilIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12.146 0.146a0.5 0.5 0 0 1 0.708 0l3 3a0.5 0.5 0 0 1 0 0.708l-10 10a0.5 0.5 0 0 1-0.196 0.121l-4 1.5a0.5 0.5 0 0 1-0.638-0.638l1.5-4a0.5 0.5 0 0 1 0.121-0.196l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h0.5a0.5 0.5 0 0 1 0.5 0.5V11h0.5a0.5 0.5 0 0 1 0.5 0.5V12h0.293l6.5-6.5zM3.012 10.293 2.5 11.5 1.5 12 0.5 13l3-1 1-1z" />
    </svg>
  );
}
