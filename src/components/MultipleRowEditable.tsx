"use client";

// Multiple row in the Implied Return calculator's calculation table.
// Renders the auto-derived terminal multiple per scenario, and supports
// inline override editing — Joseda enters his own terminal multiple in
// Nx ("the multiple I believe this business should converge to long-term").
// The override is the absolute Nx anchor; the implied %/año re-derives
// against the live current at every render, so when price moves the
// terminal stays put and the rate adjusts.
//
// Visual states per cell:
//   - viewing (auto):     "30.1x" headline + "mediana 10y" caption + "−6.3%/año" italic
//   - viewing (override): "25.0x" headline (emerald accent) + "manual override" + "compresión implícita −1.8%/año" muted
//   - editing:            input + Save + Cancel + (Reset if override active)
//
// Falls back to legacy "% only" rendering when the multiple metadata
// is missing (rows from before 2026-04-27).

import { useState, useTransition } from "react";
import type { ImpliedReturnStoredAssumptions } from "@/lib/valuations";
import { updateImpliedReturnOverrideAction } from "@/app/dashboard/position/[id]/actions";

export default function MultipleRowEditable({
  positionId,
  ticker,
  assumptions,
  ephemeral = false,
}: {
  positionId: number;
  // Required when positionId <= 0 (Discovery puro). The first save will
  // bootstrap a draft position + valuation row server-side; from then on,
  // the page renders the non-ephemeral path with the real positionId.
  ticker?: string;
  assumptions: ImpliedReturnStoredAssumptions;
  // Reserved for future read-only contexts. Not used today — the ephemeral
  // (Discovery puro) path is now editable via the bootstrap action.
  ephemeral?: boolean;
}) {
  const label = assumptions.multiple_label ?? null;
  const current = assumptions.multiple_current ?? null;
  const baseTerm = assumptions.multiple_base_terminal ?? null;
  const stressTerm = assumptions.multiple_stress_terminal ?? null;
  const isPeerFallback = assumptions.multiple_source === "peer_median_fallback";
  const median = assumptions.multiple_median ?? null;
  const q1 = assumptions.multiple_q1 ?? null;

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
          ticker={ticker}
          ephemeral={ephemeral}
          scenario="base"
          label={label}
          current={current}
          terminal={baseTerm}
          changePct={assumptions.multiple_change_base}
          isOverride={isBaseOverrideActive(assumptions)}
          autoCaption={baseAutoCaption({
            current,
            median,
            isPeerFallback,
          })}
          autoTerminal={
            // When override is active, recompute the auto terminal so the
            // "auto: Nx" hint shows the model's value, not the override.
            isBaseOverrideActive(assumptions)
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
          ticker={ticker}
          ephemeral={ephemeral}
          scenario="stress"
          label={label}
          current={current}
          terminal={stressTerm ?? current}
          changePct={assumptions.multiple_change_stress}
          isOverride={isStressOverrideActive(assumptions)}
          autoCaption={stressAutoCaption({
            current,
            q1,
            isPeerFallback,
            stressChange: assumptions.multiple_change_stress,
          })}
          autoTerminal={
            isStressOverrideActive(assumptions)
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
  ticker,
  ephemeral,
  scenario,
  label,
  current,
  terminal,
  changePct,
  isOverride,
  autoCaption,
  autoTerminal,
}: {
  positionId: number;
  ticker: string | undefined;
  ephemeral: boolean;
  scenario: "base" | "stress";
  label: "P/E" | "P/FCF" | "P/B";
  current: number;
  terminal: number;
  changePct: number;
  isOverride: boolean;
  autoCaption: string;
  // The auto-derived terminal — only set when override is active so we
  // can render "auto: Nx" alongside the override value.
  autoTerminal: number | null;
}) {
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
          ticker,
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
        {!ephemeral && (
          <button
            type="button"
            onClick={openEditor}
            aria-label={`Editar múltiplo ${scenario}`}
            title="Editar manualmente"
            className="text-navy-400 hover:text-navy-700"
          >
            <PencilIcon />
          </button>
        )}
      </div>
      <div className="text-[11px] font-normal text-navy-500">
        {isOverride ? "manual override" : autoCaption}
      </div>
      <div className="text-[11px] font-normal italic text-navy-400">
        {isOverride
          ? autoTerminal !== null
            ? `auto sería ${autoTerminal.toFixed(1)}x`
            : ""
          : `${signedPct(changePct)}/año`}
      </div>
    </div>
  );
}

// Override active when the absolute-terminal field is set OR (for legacy
// rows that haven't been migrated yet) the rate-based field is set. Either
// signals user intent for that scenario.
function isBaseOverrideActive(a: ImpliedReturnStoredAssumptions): boolean {
  return (
    (a.multiple_base_terminal_override !== null &&
      a.multiple_base_terminal_override !== undefined) ||
    (a.multiple_change_base_override !== null &&
      a.multiple_change_base_override !== undefined)
  );
}

function isStressOverrideActive(a: ImpliedReturnStoredAssumptions): boolean {
  return (
    (a.multiple_stress_terminal_override !== null &&
      a.multiple_stress_terminal_override !== undefined) ||
    (a.multiple_change_stress_override !== null &&
      a.multiple_change_stress_override !== undefined)
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

// Caption under the base-case multiple. Three regimes:
//   - own-history, current ≤ median  → "actual, sin re-rating"
//   - own-history, current > median  → "mediana 10y"
//   - peer fallback                  → "mediana sector" (Damodaran is the
//     anchor; q1 = median by design so base/stress dynamics differ).
function baseAutoCaption({
  current,
  median,
  isPeerFallback,
}: {
  current: number;
  median: number | null;
  isPeerFallback: boolean;
}): string {
  if (isPeerFallback) {
    return current <= (median ?? Infinity)
      ? "actual ≤ peer"
      : "mediana sector";
  }
  return current <= (median ?? Infinity)
    ? "actual, sin re-rating"
    : "mediana 10y";
}

// Caption under the stress-case multiple. Peer fallback has no sector Q1
// in our hardcoded table, so q1 = median; stress collapses to base unless
// the user overrides. We surface this explicitly so it's not confusing.
function stressAutoCaption({
  current,
  q1,
  isPeerFallback,
  stressChange,
}: {
  current: number;
  q1: number | null;
  isPeerFallback: boolean;
  stressChange: number;
}): string {
  if (isPeerFallback) {
    return current <= (q1 ?? Infinity)
      ? "sin Q1 sector — usa override"
      : "mediana sector (sin Q1)";
  }
  return stressChange === 0 ? "ya en Q1 hist." : "Q1 histórico";
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
