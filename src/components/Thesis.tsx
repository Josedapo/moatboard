"use client";

import { useState, useTransition } from "react";
import type { Thesis } from "@/lib/theses";
import type { Tier } from "@/lib/verdict";
import {
  THESIS_FIELD_LABELS,
  THESIS_FIELD_ORDER,
  type ThesisContent,
  type ThesisFieldKey,
} from "@/lib/thesis";
import {
  generateAiThesisAction,
  saveUserThesisAction,
  updateAiThesisAction,
  deleteThesisAction,
} from "@/app/dashboard/position/[id]/actions";
import AutoResizeTextarea from "@/components/AutoResizeTextarea";

export default function ThesisSection({
  positionId,
  verdict,
  thesis,
}: {
  positionId: number;
  verdict: Tier | null;
  thesis: Thesis | null;
}) {
  const [error, setError] = useState<string | null>(null);

  if (!thesis) {
    return (
      <EmptyState
        positionId={positionId}
        verdict={verdict}
        error={error}
        setError={setError}
      />
    );
  }

  if (thesis.source === "ai" && thesis.structured_content) {
    return <AiThesisView positionId={positionId} thesis={thesis} />;
  }

  return <UserThesisView positionId={positionId} thesis={thesis} />;
}

function EmptyState({
  positionId,
  verdict,
  error,
  setError,
}: {
  positionId: number;
  verdict: Tier | null;
  error: string | null;
  setError: (e: string | null) => void;
}) {
  const [isGenerating, startGenerating] = useTransition();
  const [writingMode, setWritingMode] = useState(false);
  const [draft, setDraft] = useState("");
  const [isSaving, startSaving] = useTransition();

  const aiBlocked = verdict === "poor";

  function handleGenerate() {
    setError(null);
    startGenerating(async () => {
      try {
        await generateAiThesisAction(positionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to generate");
      }
    });
  }

  function handleSave() {
    setError(null);
    startSaving(async () => {
      try {
        await saveUserThesisAction({ positionId, rawText: draft });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    });
  }

  return (
    <section className="rounded-2xl border border-navy-100 bg-white p-6 shadow-sm">
      <div className="mb-4">
        <h2 className="text-xl font-bold text-navy-950">Your Thesis</h2>
        <p className="mt-1 text-xs text-navy-500">
          Why you own this business — in your own words. Moatboard will track
          whether your reasoning still holds.
        </p>
      </div>

      {aiBlocked && !writingMode && (
        <div className="mb-5 rounded-lg border border-red-100 bg-red-50/60 p-4">
          <p className="text-sm leading-relaxed text-red-900">
            Moatboard rates this as a Poor business. If you&apos;re investing
            anyway, capture your reasoning here — Moatboard will continue to
            track whether it holds.
          </p>
        </div>
      )}

      {writingMode ? (
        <div className="space-y-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={10}
            placeholder="Write why you own this business — in your own words, with whatever structure you prefer."
            className="w-full rounded-lg border border-navy-300 p-4 text-sm leading-relaxed text-navy-900 focus:border-navy-900 focus:outline-none"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={isSaving || draft.trim().length === 0}
              className="rounded-lg bg-navy-900 px-5 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
            >
              {isSaving ? "Saving..." : "Save thesis"}
            </button>
            <button
              onClick={() => {
                setWritingMode(false);
                setDraft("");
              }}
              disabled={isSaving}
              className="text-sm text-navy-600 hover:text-navy-900"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {!aiBlocked && (
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className="rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-navy-800 disabled:opacity-50"
            >
              {isGenerating ? "Generating..." : "Generate with AI"}
            </button>
          )}
          {aiBlocked && (
            <button
              disabled
              title="Moatboard won't generate a thesis for a business it rates as Poor."
              className="cursor-not-allowed rounded-lg bg-navy-200 px-5 py-2.5 text-sm font-semibold text-navy-500"
            >
              Generate with AI
            </button>
          )}
          <button
            onClick={() => setWritingMode(true)}
            className={
              aiBlocked
                ? "rounded-lg bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-navy-800"
                : "rounded-lg border border-navy-300 px-5 py-2.5 text-sm font-medium text-navy-900 hover:bg-navy-50"
            }
          >
            Write your own
          </button>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}

function AiThesisView({
  positionId,
  thesis,
}: {
  positionId: number;
  thesis: Thesis;
}) {
  // Legacy AI theses saved before we added the `management` field may be
  // missing keys. Normalise against THESIS_FIELD_ORDER so the edit UI never
  // crashes on undefined; the user sees an empty management section and can
  // regenerate or fill it in.
  const raw = (thesis.structured_content ?? {}) as Partial<ThesisContent>;
  const initial = THESIS_FIELD_ORDER.reduce((acc, key) => {
    acc[key] = raw[key] ?? { highlight: "", body: "" };
    return acc;
  }, {} as ThesisContent);
  const [draft, setDraft] = useState<ThesisContent>(initial);
  const [saving, startSaving] = useTransition();
  const [resetting, startReset] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isDirty = THESIS_FIELD_ORDER.some(
    (key) =>
      draft[key].highlight !== initial[key].highlight ||
      draft[key].body !== initial[key].body,
  );

  const allFilled = THESIS_FIELD_ORDER.every(
    (key) =>
      draft[key].highlight.trim().length > 0 &&
      draft[key].body.trim().length > 0,
  );

  function updateField(key: ThesisFieldKey, part: "highlight" | "body", value: string) {
    setDraft((prev) => ({
      ...prev,
      [key]: { ...prev[key], [part]: value },
    }));
  }

  function handleSave() {
    setError(null);
    startSaving(async () => {
      try {
        await updateAiThesisAction({
          thesisId: thesis.id,
          positionId,
          content: draft,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    });
  }

  function handleReset() {
    setDraft(initial);
  }

  function handleStartFresh() {
    if (
      !confirm(
        "This will delete the current thesis and let you start over. Continue?",
      )
    )
      return;
    setError(null);
    startReset(async () => {
      try {
        await deleteThesisAction(positionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to reset");
      }
    });
  }

  return (
    <section className="rounded-2xl border border-navy-100 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-navy-100 px-6 py-5">
        <div>
          <h2 className="text-xl font-bold text-navy-950">Your Thesis</h2>
          <p className="mt-1 text-xs text-navy-500">
            {thesis.edited_at
              ? `AI-generated · edited ${formatDate(thesis.edited_at)}`
              : `AI-generated ${formatDate(thesis.created_at)}`}{" "}
            · click anywhere to edit
          </p>
        </div>
        <button
          onClick={handleStartFresh}
          disabled={resetting}
          className="text-sm font-medium text-navy-500 hover:text-navy-900 disabled:opacity-50"
        >
          {resetting ? "Resetting..." : "Start fresh"}
        </button>
      </div>

      {/* Continuous editable surface — visually one block, technically 5 textareas per section */}
      <div className="px-6 py-2">
        {THESIS_FIELD_ORDER.map((key, idx) => (
          <div
            key={key}
            className={
              idx === 0
                ? "py-5"
                : "border-t border-navy-100 py-5"
            }
          >
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-navy-500">
              {THESIS_FIELD_LABELS[key]}
            </h3>
            <AutoResizeTextarea
              ariaLabel={`${THESIS_FIELD_LABELS[key]} highlight`}
              value={draft[key].highlight}
              onChange={(v) => updateField(key, "highlight", v)}
              placeholder="One-line highlight..."
              className="text-base font-semibold leading-snug text-navy-950 placeholder:text-navy-300"
            />
            <AutoResizeTextarea
              ariaLabel={`${THESIS_FIELD_LABELS[key]} body`}
              value={draft[key].body}
              onChange={(v) => updateField(key, "body", v)}
              placeholder="Body — expand on the highlight with specifics."
              className="mt-2 text-sm leading-relaxed text-navy-700 placeholder:text-navy-300"
            />
          </div>
        ))}
      </div>

      {/* Footer with sticky-ish save bar when dirty */}
      <div className="flex items-center justify-between border-t border-navy-100 bg-navy-50/40 px-6 py-4">
        <div className="text-xs text-navy-500">
          {isDirty
            ? "You have unsaved changes."
            : "All changes saved."}
        </div>
        <div className="flex items-center gap-3">
          {isDirty && (
            <button
              onClick={handleReset}
              disabled={saving}
              className="text-sm text-navy-600 hover:text-navy-900"
            >
              Discard
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !isDirty || !allFilled}
            className="rounded-lg bg-navy-900 px-5 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>

      {error && (
        <p className="m-6 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}

function UserThesisView({
  positionId,
  thesis,
}: {
  positionId: number;
  thesis: Thesis;
}) {
  const [draft, setDraft] = useState(thesis.raw_text);
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const isDirty = draft !== thesis.raw_text;
  const canSave = draft.trim().length > 0 && isDirty;

  function save() {
    setError(null);
    startSaving(async () => {
      try {
        await saveUserThesisAction({ positionId, rawText: draft });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save");
      }
    });
  }

  return (
    <section className="rounded-2xl border border-navy-100 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-navy-100 px-6 py-5">
        <div>
          <h2 className="text-xl font-bold text-navy-950">Your Thesis</h2>
          <p className="mt-1 text-xs text-navy-500">
            {thesis.edited_at
              ? `Last edited ${formatDate(thesis.edited_at)}`
              : `Written ${formatDate(thesis.created_at)}`}{" "}
            · click to edit
          </p>
        </div>
      </div>

      <div className="px-6 py-4">
        <AutoResizeTextarea
          value={draft}
          onChange={setDraft}
          ariaLabel="Your thesis"
          className="text-sm leading-relaxed text-navy-800 placeholder:text-navy-300"
          placeholder="Write your thesis here..."
        />
      </div>

      <div className="flex items-center justify-between border-t border-navy-100 bg-navy-50/40 px-6 py-4">
        <div className="text-xs text-navy-500">
          {isDirty ? "You have unsaved changes." : "All changes saved."}
        </div>
        <div className="flex items-center gap-3">
          {isDirty && (
            <button
              onClick={() => setDraft(thesis.raw_text)}
              disabled={saving}
              className="text-sm text-navy-600 hover:text-navy-900"
            >
              Discard
            </button>
          )}
          <button
            onClick={save}
            disabled={saving || !canSave}
            className="rounded-lg bg-navy-900 px-5 py-2 text-sm font-medium text-white hover:bg-navy-800 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>

      {error && (
        <p className="m-6 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </section>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
