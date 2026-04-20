"use client";

import { useState, useTransition } from "react";
import type { MoatStrength, MoatArchetype } from "@/lib/verdict";
import type { MoatValidationVerdict } from "@/lib/moatValidationAi";
import type { MoatValidation } from "@/lib/moatValidations";
import { revalidateMoatAction } from "@/app/dashboard/position/[id]/trajectory/actions";

const ARCHETYPE_LABEL: Record<MoatArchetype, string> = {
  brand: "Brand",
  network_effects: "Network effects",
  switching_costs: "Switching costs",
  scale: "Scale",
  ip: "Intellectual property",
  regulatory: "Regulatory",
  cost_advantage: "Cost advantage",
  none: "None",
};

const STRENGTH_LABEL: Record<MoatStrength, string> = {
  strong: "Strong",
  unclear: "Unclear",
  weak: "Weak",
};

// Visual specs for each verdict mirror the DirectionBadge convention in
// TrajectoryExplorer so the moat reads in the same grammar as the
// dimension cards. "Intact" gets the outlined emerald treatment shared
// with "mantiene"; "expanding" is the filled-emerald up arrow;
// "compressing" is the amber down arrow; "dissolved" is the red warning.
const VERDICT_SPEC: Record<
  MoatValidationVerdict,
  {
    label: string;
    icon: string;
    chipClass: string;
    frameClass: string;
    toneClass: string;
  }
> = {
  intact: {
    label: "sigue en vigor",
    icon: "✓",
    chipClass:
      "border border-emerald-300 bg-emerald-100 text-emerald-700",
    frameClass: "border-navy-100 bg-white",
    toneClass: "text-emerald-700",
  },
  expanding: {
    label: "se está ampliando",
    icon: "↑",
    chipClass: "bg-emerald-500 text-white",
    frameClass: "border-emerald-200 bg-emerald-50/40",
    toneClass: "text-emerald-700",
  },
  compressing: {
    label: "se está comprimiendo",
    icon: "↓",
    chipClass: "bg-amber-500 text-white",
    frameClass: "border-amber-200 bg-amber-50/40",
    toneClass: "text-amber-700",
  },
  dissolved: {
    label: "se ha deshecho",
    icon: "⚠",
    chipClass: "bg-red-500 text-white",
    frameClass: "border-red-200 bg-red-50/50",
    toneClass: "text-red-700",
  },
};

export default function MoatValidationPanel({
  positionId,
  ticker,
  fromSnapshotId,
  originalMoat,
  originalRecordedAt,
  existingValidation,
}: {
  positionId: number;
  ticker: string;
  // Snapshot id whose moat is being validated. Used by the server action
  // to key the `moat_validations` row (history is per-snapshot).
  fromSnapshotId: number;
  // The moat registered on the "Desde" snapshot — always the baseline for
  // the comparison. Null when the earlier snapshot has no moat recorded
  // (rare; happens for very old legacy positions).
  originalMoat: {
    archetype: MoatArchetype;
    strength: MoatStrength;
    reasoning: string;
  } | null;
  // Declared as string but the Neon driver returns `timestamp` columns
  // as Date objects at runtime, which survive RSC serialization intact.
  // Normalised to ISO at prop entry so `.slice()` in downstream code
  // never fails with "is not a function".
  originalRecordedAt: string | Date;
  // The most recent validation for this snapshot (preloaded server-side).
  // When present we hydrate the panel straight into the "post-validación"
  // state instead of forcing the user to re-run the AI on every visit.
  existingValidation: MoatValidation | null;
}) {
  const recordedAtIso = toIsoString(originalRecordedAt);

  const [result, setResult] = useState<MoatValidation | null>(
    existingValidation,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleValidate() {
    if (!originalMoat) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await revalidateMoatAction({
          positionId,
          ticker,
          fromSnapshotId,
          originalArchetype: originalMoat.archetype,
          originalStrength: originalMoat.strength,
          originalReasoning: originalMoat.reasoning,
          originalRecordedAt: recordedAtIso,
        });
        setResult(res);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "No se pudo validar el moat",
        );
      }
    });
  }

  if (!originalMoat) {
    return (
      <div className="rounded-xl border border-navy-100 bg-white p-4">
        <header className="mb-2 flex items-center justify-between gap-2">
          <h5 className="text-sm font-semibold text-navy-900">Moat</h5>
        </header>
        <p className="text-sm text-navy-500">
          Sin moat registrado en el snapshot Desde.
        </p>
      </div>
    );
  }

  if (result) {
    const spec = VERDICT_SPEC[result.verdict];
    return (
      <div className={`rounded-xl border p-4 ${spec.frameClass}`}>
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h5 className="text-sm font-semibold text-navy-900">Moat</h5>
          <span
            className="inline-flex items-center gap-1.5"
            title={spec.label}
          >
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold leading-none ${spec.chipClass}`}
              aria-hidden
            >
              {spec.icon}
            </span>
            <span className={`text-xs font-medium ${spec.toneClass}`}>
              {spec.label}
            </span>
          </span>
        </header>

        <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
          <MoatMiniCard
            label={formatShortDateEs(recordedAtIso)}
            archetype={originalMoat.archetype}
            strength={originalMoat.strength}
          />
          <span className="self-center text-navy-400">→</span>
          <MoatMiniCard
            label={`Hoy (${formatShortDateEs(toIsoString(result.validated_at))})`}
            archetype={result.new_archetype}
            strength={result.new_strength}
          />
        </div>

        <p className="mt-4 rounded-md bg-white/60 p-3 text-xs leading-relaxed text-navy-700">
          {result.reasoning}
        </p>

        <div className="mt-4 flex items-center justify-between gap-2">
          <span className="text-[11px] text-navy-500">
            Validado el {formatLongDateEs(toIsoString(result.validated_at))} con{" "}
            {result.validated_with_model}
          </span>
          <button
            type="button"
            onClick={handleValidate}
            disabled={isPending}
            className="text-xs font-medium text-navy-600 hover:text-navy-900 disabled:opacity-50"
          >
            {isPending ? "Revalidando…" : "Revalidar ↻"}
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-md bg-red-50 p-2 text-xs text-red-700">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-navy-100 bg-white p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h5 className="text-sm font-semibold text-navy-900">Moat</h5>
        <span className="text-[11px] uppercase tracking-wider text-navy-500">
          Registrado {formatShortDateEs(recordedAtIso)}
        </span>
      </header>

      <div className="flex flex-col gap-3 md:flex-row md:items-start">
        <div className="flex flex-col gap-2 md:w-56 md:flex-none">
          <MoatMiniCard
            label="Original"
            archetype={originalMoat.archetype}
            strength={originalMoat.strength}
          />
          <button
            type="button"
            onClick={handleValidate}
            disabled={isPending}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-navy-900 px-3 py-2 text-xs font-medium text-white hover:bg-navy-800 disabled:opacity-50"
          >
            {isPending ? (
              <>Validando…</>
            ) : (
              <>
                <span aria-hidden>↻</span>
                Validar con IA
              </>
            )}
          </button>
        </div>
        <p className="flex-1 text-xs leading-relaxed text-navy-600">
          {originalMoat.reasoning}
        </p>
      </div>

      {error && (
        <p className="mt-3 rounded-md bg-red-50 p-2 text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function MoatMiniCard({
  label,
  archetype,
  strength,
}: {
  label: string;
  archetype: MoatArchetype;
  strength: MoatStrength;
}) {
  return (
    <div className="rounded-md border border-navy-100 border-l-2 border-l-navy-300 bg-navy-50/40 px-3 py-2">
      <div className="truncate text-[10px] font-medium uppercase tracking-wide text-navy-500">
        {label}
      </div>
      <div className="mt-0.5 text-sm font-semibold text-navy-900">
        {ARCHETYPE_LABEL[archetype]}
      </div>
      <div className="text-[11px] text-navy-500">
        {STRENGTH_LABEL[strength]}
      </div>
    </div>
  );
}

// Coerce whatever the DB driver handed us (string | Date) into an ISO
// string so downstream code (.slice, .toLocaleDateString with string input,
// the server action payload) never has to re-check.
function toIsoString(value: string | Date): string {
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

function formatShortDateEs(value: string): string {
  try {
    const d = new Date(value);
    return d.toLocaleDateString("es-ES", {
      year: "2-digit",
      month: "short",
      day: "numeric",
    });
  } catch {
    return value.slice(0, 10);
  }
}

function formatLongDateEs(value: string): string {
  try {
    const d = new Date(value);
    return d.toLocaleDateString("es-ES", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return value.slice(0, 10);
  }
}
