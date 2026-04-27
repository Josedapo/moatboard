"use client";

// Multiple row in the Implied Return calculator's calculation table.
// Renders the auto-derived terminal multiple per scenario, and supports
// inline override editing — Joseda enters his own terminal multiple in
// Nx (e.g. "2.0" = "I assume P/B lands at 2x in 10 years"), and the
// server converts to %/año + recomputes CAGRs.
//
// Visual states per cell:
//   - viewing (auto):     "30.1x" headline + "mediana 10y" caption + "−6.3%/año" italic
//   - viewing (override): "2.0x" headline (emerald accent) + "manual override" + "auto: 4.1x · −7.0%/año" muted
//   - editing:            input + Save + Cancel + (Reset if override active)
//
// Falls back to legacy "% only" rendering when the multiple metadata
// is missing (rows from before 2026-04-27).

import { useState, useTransition } from "react";
import type { ImpliedReturnStoredAssumptions } from "@/lib/valuations";
import { updateImpliedReturnOverrideAction } from "@/app/dashboard/position/[id]/actions";

export default function MultipleRowEditable({
  positionId,
  assumptions,
}: {
  positionId: number;
  assumptions: ImpliedReturnStoredAssumptions;
}) {
  const label = assumptions.multiple_label ?? null;
  const current = assumptions.multiple_current ?? null;
  const baseTerm = assumptions.multiple_base_terminal ?? null;
  const stressTerm = assumptions.multiple_stress_terminal ?? null;

  // Legacy fallback — show % only, no edit affordance.
  if (label === null || current === null || baseTerm === null) {
    return (
      <tr>
        <td className="py-2 text-navy-700">+ Δ Múltiplo (anualizado)</td>
        <td className="py-2 text-right tabular-nums text-navy-900">
          {signedPct(assumptions.multiple_change_base)}
        </td>
        <td className="py-2 text-right tabular-nums text-navy-700">
          {signedPct(assumptions.multiple_change_stress)}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td className="py-2 align-top text-navy-700">
        Múltiplo {label} a 10y
        <div className="text-[10px] uppercase tracking-wider text-navy-400">
          impacto anualizado
        </div>
      </td>
      <td className="py-2 align-top text-right tabular-nums">
        <ScenarioCell
          positionId={positionId}
          scenario="base"
          label={label}
          current={current}
          terminal={baseTerm}
          changePct={assumptions.multiple_change_base}
          override={assumptions.multiple_change_base_override ?? null}
          autoCaption={
            current <= (assumptions.multiple_median ?? Infinity)
              ? "actual, sin re-rating"
              : "mediana 10y"
          }
          autoTerminal={
            // When override is active, recompute the auto terminal so the
            // "auto: Nx" hint shows the model's value, not the override.
            assumptions.multiple_change_base_override !== null &&
            assumptions.multiple_change_base_override !== undefined
              ? deriveAutoBaseTerminal(
                  current,
                  assumptions.multiple_median ?? null,
                )
              : null
          }
        />
      </td>
      <td className="py-2 align-top text-right tabular-nums">
        <ScenarioCell
          positionId={positionId}
          scenario="stress"
          label={label}
          current={current}
          terminal={stressTerm ?? current}
          changePct={assumptions.multiple_change_stress}
          override={assumptions.multiple_change_stress_override ?? null}
          autoCaption={
            assumptions.multiple_change_stress === 0 ? "ya en Q1 hist." : "Q1 histórico"
          }
          autoTerminal={
            assumptions.multiple_change_stress_override !== null &&
            assumptions.multiple_change_stress_override !== undefined
              ? deriveAutoStressTerminal(
                  current,
                  assumptions.multiple_q1 ?? null,
                )
              : null
          }
        />
      </td>
    </tr>
  );
}

function ScenarioCell({
  positionId,
  scenario,
  label,
  current,
  terminal,
  changePct,
  override,
  autoCaption,
  autoTerminal,
}: {
  positionId: number;
  scenario: "base" | "stress";
  label: "P/E" | "P/FCF" | "P/B";
  current: number;
  terminal: number;
  changePct: number;
  override: number | null;
  autoCaption: string;
  // The auto-derived terminal — only set when override is active so we
  // can render "auto: Nx" alongside the override value.
  autoTerminal: number | null;
}) {
  const isOverride = override !== null;
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState(terminal.toFixed(2));
  const [error, setError] = useState<string | null>(null);

  function openEditor() {
    setDraft(terminal.toFixed(2));
    setError(null);
    setEditing(true);
  }

  function close() {
    setEditing(false);
    setError(null);
  }

  function save(value: number | null) {
    setError(null);
    startTransition(async () => {
      try {
        await updateImpliedReturnOverrideAction({
          positionId,
          baseTerminalMultiple: scenario === "base" ? value : undefined,
          stressTerminalMultiple: scenario === "stress" ? value : undefined,
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
            min="0.1"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={pending}
            className="w-20 rounded border border-navy-300 px-2 py-1 text-right text-sm tabular-nums text-navy-900 focus:border-navy-500 focus:outline-none"
            aria-label={`Override ${scenario} terminal multiple`}
          />
          <span className="text-xs text-navy-500">x</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              const v = Number(draft);
              if (!Number.isFinite(v) || v <= 0) {
                setError("Introduce un número positivo.");
                return;
              }
              save(v);
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
          className={`font-semibold ${isOverride ? "text-emerald-800" : "text-navy-900"}`}
        >
          {terminal.toFixed(1)}x
        </span>
        <button
          type="button"
          onClick={openEditor}
          aria-label={`Editar múltiplo ${scenario}`}
          title="Editar manualmente"
          className="text-navy-400 hover:text-navy-700"
        >
          <PencilIcon />
        </button>
      </div>
      <div className="text-[11px] font-normal text-navy-500">
        {isOverride ? "manual override" : autoCaption}
      </div>
      <div className="text-[11px] font-normal italic text-navy-400">
        {isOverride && autoTerminal !== null
          ? `auto: ${autoTerminal.toFixed(1)}x · ${signedPct(deriveAutoChange(current, autoTerminal))}/año`
          : `${signedPct(changePct)}/año`}
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────

function deriveAutoBaseTerminal(
  current: number,
  median: number | null,
): number | null {
  if (median === null || median <= 0) return null;
  return current <= median ? current : median;
}

function deriveAutoStressTerminal(
  current: number,
  q1: number | null,
): number | null {
  if (q1 === null || q1 <= 0) return null;
  return q1 >= current ? current : q1;
}

function deriveAutoChange(current: number, terminal: number): number {
  if (current <= 0 || terminal <= 0) return 0;
  return Math.pow(terminal / current, 1 / 10) - 1;
}

function signedPct(x: number): string {
  const sign = x > 0 ? "+" : "";
  return `${sign}${(x * 100).toFixed(1)}%`;
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
