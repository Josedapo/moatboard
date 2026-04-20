"use client";

import { useActionState } from "react";
import { startAnalysisAction, type ActionState } from "@/app/dashboard/actions";

const initialState: ActionState = {};

const STATUS_LABELS: Record<string, string> = {
  watchlist: "moved it to your watchlist",
  discarded: "discarded it",
  outside_circle: "marked it as outside your circle of competence",
};

function formatDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export default function AnalyzeEntryForm() {
  const [state, formAction, pending] = useActionState(
    startAnalysisAction,
    initialState,
  );

  const prior = state.priorState;

  return (
    <div className="mb-10 rounded-xl border border-navy-200 bg-white p-6">
      <h2 className="mb-2 text-lg font-semibold text-navy-900">
        Analyze a new business
      </h2>
      <p className="mb-4 text-sm text-navy-600">
        Enter a ticker to start a guided analysis: understand the business,
        check for red flags, review quality and valuation, and decide whether
        to invest, watch it, or move on.
      </p>

      {prior && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
          <p className="text-sm text-navy-800">
            You already analyzed{" "}
            <span className="font-semibold">{prior.ticker}</span> on{" "}
            {formatDate(prior.lastTouchedAt)} and{" "}
            {STATUS_LABELS[prior.status] ?? prior.status}.
          </p>
          {prior.reasonMd && (
            <p className="mt-2 text-sm text-navy-700">
              <span className="font-medium">Reason:</span> {prior.reasonMd}
            </p>
          )}
          {prior.reviewWhen && (
            <p className="mt-1 text-sm text-navy-700">
              <span className="font-medium">Review when:</span>{" "}
              {prior.reviewWhen}
            </p>
          )}
          <form action={formAction} className="mt-3">
            <input type="hidden" name="ticker" value={prior.ticker} />
            <input type="hidden" name="confirmReanalysis" value="true" />
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
            >
              {pending ? "Starting..." : `Re-analyze ${prior.ticker} anyway`}
            </button>
          </form>
        </div>
      )}

      <form
        action={formAction}
        className="flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <div className="flex-1">
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
            autoComplete="off"
            className="w-full rounded-lg border border-navy-300 px-3 py-2 uppercase focus:border-navy-900 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-navy-900 px-5 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
        >
          {pending ? "Starting..." : "Start analysis"}
        </button>
      </form>
      {state.error && (
        <p className="mt-3 text-sm text-red-600">{state.error}</p>
      )}
    </div>
  );
}
