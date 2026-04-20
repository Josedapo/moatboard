// Splits a long-form description into paragraphs (groups of 3 sentences) so
// the wall of text breaks up visually. No expand/collapse — callers are
// expected to control visibility via a parent `<details>` if needed.

function splitIntoParagraphs(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+(?=[A-Z])/g)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const paragraphs: string[] = [];
  for (let i = 0; i < sentences.length; i += 3) {
    paragraphs.push(sentences.slice(i, i + 3).join(" "));
  }
  return paragraphs;
}

export default function BusinessDescription({ text }: { text: string }) {
  const paragraphs = splitIntoParagraphs(text);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-navy-700">
      {paragraphs.map((p, i) => (
        <p key={i}>{p}</p>
      ))}
    </div>
  );
}
