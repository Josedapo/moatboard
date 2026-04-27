"use client";

import { useFormStatus } from "react-dom";

// Client-side pending feedback for the wizard's server-action forms. Two
// co-located primitives, both driven by the same `useFormStatus()` hook
// — when any form that contains them submits, the `pending` state covers
// (a) the action itself and (b) the subsequent RSC re-render triggered
// by revalidatePath, which is where the real 15-40s Claude work lives.
//
// `SubmitButton` swaps its label to "Procesando…" and disables while
// pending. `PendingOverlay` renders a full-screen paper overlay with an
// editorial italic message, so the user never sees a frozen page during
// a long Claude call.
//
// Usage pattern (inside any <form action={serverAction}>):
//
//   <form action={advanceStepAction.bind(null, ticker, "red_flags", "understood")}>
//     <PendingOverlay message="Moatboard está leyendo el 10-K…" />
//     <SubmitButton className="…">Sí, lo entiendo</SubmitButton>
//   </form>

export function SubmitButton({
  children,
  pendingLabel,
  className,
  disabled,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={className}
    >
      {pending ? (pendingLabel ?? "Procesando…") : children}
    </button>
  );
}

export function PendingOverlay({
  message,
  hint,
}: {
  /** Primary italic line. Editorial; what Claude is doing right now. */
  message?: string;
  /** Optional smaller line under it. Defaults to the "not hung — thinking"
   *  note matching the loading.tsx fallbacks elsewhere in the app. */
  hint?: string;
}) {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/90 backdrop-blur-[1px]"
    >
      <div className="max-w-md px-8 text-center">
        <p className="font-display text-[26px] font-light italic leading-[1.15] text-ink">
          {message ?? "Moatboard está pensando."}
        </p>
        <p className="mt-4 font-display text-[14px] italic leading-[1.55] text-ink-70">
          {hint ??
            "Suele tardar 15–40 segundos. La página no está colgada — está leyendo."}
        </p>
      </div>
    </div>
  );
}
