"use client";

import { useState } from "react";

function splitIntoParagraphs(text: string): string[] {
  // Split the text by sentences and group every 3 sentences into a paragraph
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
  const [expanded, setExpanded] = useState(false);
  const paragraphs = splitIntoParagraphs(text);
  const canCollapse = paragraphs.length > 1 || text.length > 280;

  return (
    <div>
      <div
        className={
          expanded || !canCollapse
            ? "space-y-3 text-sm leading-relaxed text-navy-700"
            : "relative max-h-24 overflow-hidden space-y-3 text-sm leading-relaxed text-navy-700"
        }
      >
        {paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        {!expanded && canCollapse && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-white to-transparent" />
        )}
      </div>
      {canCollapse && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-sm font-medium text-navy-900 hover:text-navy-700"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
