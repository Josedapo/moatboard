import type { BusinessUnderstanding } from "@/lib/businessUnderstanding";
import type { SerializedSummary } from "@/lib/businessUnderstandingAi";

// Pure presentational view of a business_understanding row. Renders the
// 5-section Spanish summary, the pregenerated Q&A list (collapsed), and the
// user follow-up history. No regenerate button, no chat input — wrappers
// (wizard step or position page card) add those around it.
export default function BusinessUnderstandingView({
  understanding,
}: {
  understanding: BusinessUnderstanding;
}) {
  const sections = parseSections(understanding.summary_md);
  const preQA = understanding.questions_and_answers.filter(
    (q) => q.type === "pregenerated",
  );
  const followups = understanding.questions_and_answers.filter(
    (q) => q.type === "user_followup",
  );

  return (
    <div className="space-y-6">
      <div>
        {sections.map((s) => (
          <div key={s.title} className="mb-5 last:mb-0">
            <h3 className="mb-2 text-base font-semibold text-navy-900">
              {s.title}
            </h3>
            {s.paragraphs.map((p, i) => (
              <p
                key={i}
                className="mb-2 text-sm leading-relaxed text-navy-700 last:mb-0"
              >
                {p}
              </p>
            ))}
          </div>
        ))}
      </div>

      {preQA.length > 0 && (
        <div>
          <h3 className="mb-3 text-base font-semibold text-navy-900">
            Preguntas que probablemente te estás haciendo
          </h3>
          <div className="space-y-2">
            {preQA.map((qa, i) => (
              <details
                key={i}
                className="group rounded-lg border border-navy-200 bg-white open:bg-navy-50/60"
              >
                <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-navy-800 hover:text-navy-950 group-open:text-navy-950">
                  <span className="mr-2 inline-block text-navy-400 transition-transform group-open:rotate-90">
                    ▸
                  </span>
                  {qa.question}
                </summary>
                <div className="border-t border-navy-200 px-4 py-3 text-sm leading-relaxed text-navy-700">
                  {qa.answer}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {followups.length > 0 && (
        <div>
          <h3 className="mb-3 text-base font-semibold text-navy-900">
            Tus preguntas
          </h3>
          <div className="space-y-3">
            {followups.map((qa, i) => (
              <div key={i} className="border-l-2 border-navy-300 pl-3">
                <p className="mb-1 text-sm font-medium text-navy-900">
                  {qa.question}
                </p>
                <p className="text-sm leading-relaxed text-navy-700">
                  {qa.answer}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function parseSections(summary_md: string): SerializedSummary["sections"] {
  try {
    const parsed = JSON.parse(summary_md) as SerializedSummary;
    if (Array.isArray(parsed.sections)) return parsed.sections;
  } catch {
    // not parseable as JSON — fall back to single-block
  }
  return [{ title: "Resumen", paragraphs: [summary_md] }];
}
