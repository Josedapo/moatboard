"use client";

import { useActionState, useEffect, useRef } from "react";
import { addPositionAction, type ActionState } from "@/app/dashboard/actions";

const initialState: ActionState = {};

export default function AddPositionForm({ today }: { today: string }) {
  const [state, formAction, pending] = useActionState(
    addPositionAction,
    initialState,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.success) {
      formRef.current?.reset();
    }
  }, [state.success]);

  return (
    <form
      ref={formRef}
      action={formAction}
      className="mb-10 rounded-xl border border-navy-200 bg-white p-6"
    >
      <h2 className="mb-4 text-lg font-semibold text-navy-900">
        Add a position
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label
            htmlFor="ticker"
            className="mb-1 block text-sm font-medium text-navy-700"
          >
            Ticker
          </label>
          <input
            id="ticker"
            name="ticker"
            type="text"
            required
            placeholder="AAPL"
            maxLength={10}
            className="w-full rounded-lg border border-navy-300 px-3 py-2 uppercase focus:border-navy-900 focus:outline-none"
          />
        </div>
        <div>
          <label
            htmlFor="purchasePrice"
            className="mb-1 block text-sm font-medium text-navy-700"
          >
            Purchase price
          </label>
          <input
            id="purchasePrice"
            name="purchasePrice"
            type="number"
            step="0.0001"
            min="0"
            required
            placeholder="150.00"
            className="w-full rounded-lg border border-navy-300 px-3 py-2 focus:border-navy-900 focus:outline-none"
          />
        </div>
        <div>
          <label
            htmlFor="purchaseDate"
            className="mb-1 block text-sm font-medium text-navy-700"
          >
            Purchase date
          </label>
          <input
            id="purchaseDate"
            name="purchaseDate"
            type="date"
            required
            defaultValue={today}
            max={today}
            className="w-full rounded-lg border border-navy-300 px-3 py-2 focus:border-navy-900 focus:outline-none"
          />
        </div>
      </div>
      {state.error && (
        <p className="mt-3 text-sm text-red-600">{state.error}</p>
      )}
      <div className="mt-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-navy-900 px-5 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
        >
          {pending ? "Adding..." : "Add position"}
        </button>
      </div>
    </form>
  );
}
