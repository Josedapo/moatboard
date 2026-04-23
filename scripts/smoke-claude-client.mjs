// Smoke test for src/lib/claudeClient.ts paths. Spawns the Claude Code CLI
// with ANTHROPIC_API_KEY stripped (local mode) and asks it for (a) a short
// text completion and (b) a structured JSON completion. Verifies that
// Opus 4.7 honours the JSON format contract under our strict prompt.
//
// Run:  node scripts/smoke-claude-client.mjs
// Needs MOATBOARD_AI_MODE=local in .env.local to actually exercise the CLI.

import { config } from "dotenv";
import { spawn } from "node:child_process";

config({ path: ".env.local" });

const CLI = process.env.CLAUDE_CLI_PATH ?? "/Users/joseda/.local/bin/claude";
const MODEL = process.env.CLAUDE_CLI_MODEL ?? "opus";

function callCli(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      CLI,
      ["-p", "--output-format", "text", "--model", MODEL],
      {
        env: (() => {
          const env = { ...process.env };
          delete env.ANTHROPIC_API_KEY;
          return env;
        })(),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code !== 0 && !stdout) reject(new Error(`exit ${code}: ${stderr.slice(0,400)}`));
      else resolve(stdout.trim());
    });
    child.on("error", reject);
    child.stdin.write(prompt);
    child.stdin.end();
    setTimeout(() => { child.kill("SIGKILL"); reject(new Error("timeout 120s")); }, 120000);
  });
}

console.log("== smoke 1 · plain text ==");
const t0 = Date.now();
const text = await callCli("Respond with EXACTLY the word 'ready' and nothing else.");
console.log(`→ ${(Date.now() - t0) / 1000}s · raw: ${JSON.stringify(text.slice(0, 80))}`);

console.log();
console.log("== smoke 2 · strict JSON ==");
const schema = {
  type: "object",
  properties: {
    ticker: { type: "string" },
    summary: { type: "string", description: "One sentence in Spanish." },
    strengths: { type: "array", items: { type: "string" }, description: "2 items." },
  },
  required: ["ticker", "summary", "strengths"],
};
const prompt = `Describe Visa (V) as a business for a long-term investor.

CRITICAL OUTPUT FORMAT — STRICT JSON:
You MUST respond with a single valid JSON object matching this schema and NOTHING ELSE. No prose, no markdown, no code fences, no commentary. Escape internal double-quotes as \\" and newlines inside strings as \\n. Your entire response must pass JSON.parse() exactly as written.

Schema:
${JSON.stringify(schema, null, 2)}`;

const t1 = Date.now();
const raw = await callCli(prompt);
console.log(`→ ${(Date.now() - t1) / 1000}s · raw first 200: ${raw.slice(0, 200)}`);

let cleaned = raw.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
const f = cleaned.indexOf("{"), l = cleaned.lastIndexOf("}");
if (f >= 0 && l > f) cleaned = cleaned.slice(f, l + 1);
try {
  const parsed = JSON.parse(cleaned);
  console.log("→ parsed OK:");
  console.log(JSON.stringify(parsed, null, 2));
  if (
    typeof parsed.ticker === "string" &&
    typeof parsed.summary === "string" &&
    Array.isArray(parsed.strengths)
  ) {
    console.log("→ schema shape OK ✓");
  } else {
    console.error("→ schema shape FAILED ✗");
    process.exit(1);
  }
} catch (err) {
  console.error("→ JSON parse FAILED:", err.message);
  process.exit(1);
}
