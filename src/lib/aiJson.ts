// Robust JSON-object extraction from free-form LLM text output.
//
// The previous pattern was `text.match(/\{[\s\S]*\}/)` (greedy from
// first `{` to last `}`). It fails when the model emits a valid JSON
// object followed by an explanation that itself contains a `}` —
// common with Opus 4.7 in local-CLI mode, which sometimes appends a
// post-JSON paragraph despite the prompt asking for "strict JSON, no
// preamble". The greedy match captures JSON + trailing text + stray `}`,
// then `JSON.parse` chokes with "Unexpected non-whitespace character
// after JSON at position N".
//
// This helper uses a brace counter that respects string literals
// (so `}` inside a JSON string doesn't unbalance the count) and
// returns the first balanced object span.

export function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const start = trimmed.indexOf("{");
  if (start === -1) {
    throw new Error(
      `Could not find JSON in response: ${trimmed.slice(0, 200)}`,
    );
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(start, i + 1);
      }
    }
  }

  throw new Error(
    `Unbalanced JSON in response (no matching '}'): ${trimmed.slice(0, 200)}`,
  );
}

// Convenience: extract + parse in one call. Caller types the result.
export function parseJsonObject<T>(raw: string): T {
  const span = extractJsonObject(raw);
  return JSON.parse(span) as T;
}
