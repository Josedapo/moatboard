import Anthropic from "@anthropic-ai/sdk";
import { spawn } from "node:child_process";

// Dual-mode Claude caller. Modelled on the ElCaptain pattern but adapted
// to Moatboard's per-call typed shapes:
//   - `remote` (production on Vercel): direct Anthropic API via
//     @anthropic-ai/sdk using ANTHROPIC_API_KEY. Sonnet 4.6.
//   - `local` (Joseda's laptop): subprocess `claude -p` CLI with
//     ANTHROPIC_API_KEY stripped so it routes through his Max subscription
//     (Opus 4.7 by default). Zero API spend during dogfooding.
//
// Callers use two helpers:
//   - `callText(prompt, { maxTokens })` → returns a text string. Used by
//     the 7 prose-generating surfaces (moat, verdict, valuation guide,
//     thesis, signal summary, etc.).
//   - `callJson(prompt, { schema, name, description, maxTokens })` →
//     returns structured data. In remote mode this uses Anthropic's
//     `tool_use` for guaranteed valid JSON. In local mode the schema is
//     injected into the prompt and the CLI's text output is parsed as
//     JSON — less rigid, but Opus 4.7 is reliable enough at format
//     adherence that the two known callers (businessUnderstanding +
//     redFlags) can live with the JSON-in-text path locally.
//
// Switch via env var `MOATBOARD_AI_MODE`. Defaults to `remote` so the
// production behaviour is unchanged without an explicit opt-in.

type Mode = "local" | "remote";

const MODE: Mode =
  (process.env.MOATBOARD_AI_MODE as Mode | undefined) === "local"
    ? "local"
    : "remote";

// In `remote` mode, the Anthropic API model id. Kept here so every
// caller uses the same one; override per-call via `modelOverride` only
// when a surface genuinely needs a different model.
const REMOTE_MODEL = "claude-sonnet-4-6";

// In `local` mode the CLI accepts aliases: "opus" resolves to whatever
// Opus version is current in the user's Max subscription (Opus 4.7 at
// the time of writing). If Joseda needs a specific version he sets
// `CLAUDE_CLI_MODEL` in `.env.local`.
const LOCAL_MODEL = process.env.CLAUDE_CLI_MODEL ?? "opus";

// Path to the Claude Code CLI. Matches ElCaptain's default location.
// Overridable via env var.
const CLI_PATH = process.env.CLAUDE_CLI_PATH ?? "/Users/joseda/.local/bin/claude";

// Five minutes is more than enough for the longest Moatboard prompt
// (understanding pass on a full 10-K). Keeps hung subprocesses from
// lingering forever.
const CLI_TIMEOUT_MS = 300_000;

// ─── Anthropic SDK (remote mode) ───

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

// ─── CLI subprocess (local mode) ───

function callClaudeCli(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      CLI_PATH,
      [
        "-p",
        "--output-format",
        "text",
        "--model",
        LOCAL_MODEL,
      ],
      {
        // Crucial: strip ANTHROPIC_API_KEY so the CLI uses the Max
        // subscription instead of falling back to API billing.
        env: (() => {
          const env = { ...process.env };
          delete env.ANTHROPIC_API_KEY;
          return env;
        })(),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      if (code !== 0 && !stdout) {
        reject(
          new Error(
            `claude CLI exited ${code}: ${stderr.slice(0, 400) || "no stderr"}`,
          ),
        );
      } else {
        resolve(stdout.trim());
      }
    });
    child.on("error", reject);

    child.stdin.write(prompt);
    child.stdin.end();

    const killer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`claude CLI timed out after ${CLI_TIMEOUT_MS / 1000}s`));
    }, CLI_TIMEOUT_MS);
    child.on("close", () => clearTimeout(killer));
  });
}

// ─── Public API ───

export type CallTextOptions = {
  maxTokens?: number;
  modelOverride?: string;
};

/**
 * Free-text generation. Returns concatenated text content regardless of
 * mode. Callers that expect JSON inside the prose should continue using
 * their own regex/bracket parsers — this helper stays format-agnostic.
 */
export async function callText(
  prompt: string,
  opts: CallTextOptions = {},
): Promise<{ text: string; model: string }> {
  if (MODE === "local") {
    const text = await callClaudeCli(prompt);
    return { text, model: `claude-max-${LOCAL_MODEL}` };
  }
  const client = getAnthropic();
  const model = opts.modelOverride ?? REMOTE_MODEL;
  const response = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4000,
    messages: [{ role: "user", content: prompt }],
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text, model };
}

export type CallJsonOptions<T> = {
  /** Tool name for remote mode (e.g. "submit_business_understanding"). */
  schemaName: string;
  /** Tool description for remote mode. */
  schemaDescription: string;
  /** JSON schema the response must match. Passed to Anthropic's tool_use
   *  in remote mode; injected into the prompt in local mode. */
  jsonSchema: object;
  /** Optional runtime validator the caller can use to verify the parse
   *  has the expected shape before trusting it. Returns the typed value
   *  or throws. Runs in both modes. */
  validate?: (value: unknown) => T;
  maxTokens?: number;
};

/**
 * Structured JSON generation. In remote mode uses Anthropic's
 * `tool_use` for guaranteed well-formed JSON. In local mode appends
 * the schema to the prompt and parses the CLI's text response. Opus
 * 4.7 is strong at format adherence, but if the parse fails the error
 * message includes the first 400 chars of the raw response so the
 * caller can debug.
 */
export async function callJson<T>(
  prompt: string,
  opts: CallJsonOptions<T>,
): Promise<{ data: T; model: string }> {
  if (MODE === "local") {
    const fencedSchema = JSON.stringify(opts.jsonSchema, null, 2);
    const augmented = `${prompt}

CRITICAL OUTPUT FORMAT — STRICT JSON:

You MUST respond with a single valid JSON object matching this schema and NOTHING ELSE. No prose, no markdown, no code fences, no commentary before or after the object. Every internal double-quote inside a string value must be escaped as \\". Every newline inside a string value must be \\n. Your entire response must pass JSON.parse() exactly as written.

Schema:
${fencedSchema}`;

    const raw = await callClaudeCli(augmented);
    const parsed = parseJsonLoose(raw);
    const data = opts.validate ? opts.validate(parsed) : (parsed as T);
    return { data, model: `claude-max-${LOCAL_MODEL}` };
  }

  const client = getAnthropic();
  const response = await client.messages.create({
    model: REMOTE_MODEL,
    max_tokens: opts.maxTokens ?? 4000,
    tools: [
      {
        name: opts.schemaName,
        description: opts.schemaDescription,
        input_schema: opts.jsonSchema as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: opts.schemaName },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(
      `Claude did not return a tool_use block (stop_reason=${response.stop_reason}, blocks=${response.content.map((b) => b.type).join(",")})`,
    );
  }
  const data = opts.validate
    ? opts.validate(toolUse.input)
    : (toolUse.input as T);
  return { data, model: REMOTE_MODEL };
}

// Tolerant JSON parser. Trims whitespace, strips optional markdown code
// fences, and isolates the outer object by bracket bounds so stray
// preamble/suffix from the model doesn't break the parse. If JSON.parse
// still fails, throws with a preview of the raw response.
function parseJsonLoose(raw: string): unknown {
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first > 0 || last < cleaned.length - 1) {
    if (first >= 0 && last > first) {
      cleaned = cleaned.slice(first, last + 1);
    }
  }
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Could not parse JSON from model output (${
        err instanceof Error ? err.message : String(err)
      }). First 400 chars of response: ${raw.slice(0, 400)}`,
    );
  }
}

// ─── Introspection helpers (used by boot logs / debug) ───

export function getMode(): Mode {
  return MODE;
}

export function getModelLabel(): string {
  return MODE === "local" ? `max/${LOCAL_MODEL}` : REMOTE_MODEL;
}
