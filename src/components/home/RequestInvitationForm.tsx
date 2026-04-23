"use client";

import { useActionState } from "react";
import {
  submitWaitlistEmailAction,
  type WaitlistState,
} from "@/app/actions";

const initial: WaitlistState = {};

// Editorial invitation form. Lives inside the sidebar card on the home
// page (see src/app/page.tsx). Keeps the visual weight Joseda validated
// in the mock — 1px ink border card, italic Fraunces lede, ink button —
// while handling the three states the visitor can land in: idle, pending,
// saved.
export default function RequestInvitationForm() {
  const [state, formAction, pending] = useActionState(
    submitWaitlistEmailAction,
    initial,
  );

  if (state.ok) {
    return (
      <p className="m-0 font-display text-[14.5px] italic leading-[1.55] text-ink">
        Thank you. I'll send an invitation when the next batch is ready.
      </p>
    );
  }

  return (
    <form action={formAction}>
      <div className="mb-3 border-t border-ink pt-2.5">
        <input
          name="email"
          type="email"
          required
          placeholder="your@email.com"
          aria-label="Email address"
          maxLength={320}
          autoComplete="email"
          className="w-full border-none bg-transparent p-0 font-display text-[16px] text-ink placeholder:italic placeholder:text-ink-30 focus:outline-none"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full bg-ink px-0 py-[11px] font-sans text-[11px] font-medium uppercase tracking-[0.16em] text-paper disabled:opacity-60"
      >
        {pending ? "Sending…" : "Request invitation"}
      </button>
      {state.error && (
        <p className="mt-2.5 text-[12.5px] text-red">{state.error}</p>
      )}
    </form>
  );
}
