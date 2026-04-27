// Editorial loading surface for the guided analysis wizard. Mirrors the
// PendingOverlay pattern used between intermediate steps so the whole flow
// feels visually continuous instead of switching between a skeleton and a
// full-screen italic message.

export default function AnalyzeLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-[60vh] w-full items-center justify-center px-8 py-16"
    >
      <div className="max-w-md text-center">
        <p className="font-display text-[26px] font-light italic leading-[1.15] text-ink">
          Moatboard está preparando el análisis.
        </p>
        <p className="mt-4 font-display text-[14px] italic leading-[1.55] text-ink-70">
          Suele tardar 15–40 segundos. La página no está colgada — está
          leyendo.
        </p>
      </div>
    </div>
  );
}
