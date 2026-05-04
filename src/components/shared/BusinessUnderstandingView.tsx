import type { BusinessUnderstanding } from "@/lib/businessUnderstanding";
import type { SerializedSummary } from "@/lib/businessUnderstandingAi";

// Pure presentational view of a business_understanding row. Renders the
// 5-section Spanish summary and the pregenerated Q&A list (collapsed).
// No regenerate button — wrappers (wizard step or position page card)
// add that around it.
export default function BusinessUnderstandingView({
  understanding,
}: {
  understanding: BusinessUnderstanding;
}) {
  const sections = parseSections(understanding.summary_md);
  const preQA = understanding.questions_and_answers;

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
                {renderInlineMarkdown(p)}
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
                  {renderInlineMarkdown(qa.answer)}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function renderInlineMarkdown(text: string) {
  const parts = text.split(/(\*\*[^*]+?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={i} className="font-semibold text-navy-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
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
