import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentEvalScenarios } from "./agent-eval-scenarios.mjs";
import { createDomainTools } from "../packages/agent/src/tools/index.ts";
import { buildFastPathRequest, parseFastPathResponse } from "../packages/agent/src/fast-path.ts";
import { CLEF_INPUT_PRICE, createClefDecider } from "../packages/agent/src/clef.ts";
import { canonicalJson } from "../packages/agent/src/schema.ts";

const tools = createDomainTools();
const eligible = new Set(tools.filter(tool => tool.fastPath).map(tool => tool.name));
const THRESHOLDS = [.9, .95, .98, .99, .995];
export function fastPathCases(baseDate) {
  return createAgentEvalScenarios(baseDate).filter(scenario => scenario.turns.length === 1).map(scenario => {
    const turn = scenario.turns[0], calls = turn.calls ?? [];
    return { id: scenario.id, messageText: turn.prompt, calls, images: turn.images ?? scenario.images ?? [],
      expected: calls.length === 1 && eligible.has(calls[0].name) ? calls[0] : null };
  });
}
function deciderInput(row, baseDate, signal) {
  return { messageText: row.messageText, recentMessages: row.images?.length ? [{ role: "user", content: row.messageText, images: [{ url: "synthetic-attachment-skip" }] }] : [], tools, ownerTimezone: "Europe/Dublin", now: new Date(`${baseDate}T12:00:00Z`), signal };
}
function percentile(values, fraction) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]; }
function metrics(rows) {
  const executed = rows.filter(row => row.decision.kind === "execute");
  const correct = row => row.expected && row.expected.name === row.decision.call.name && canonicalJson(row.expected.arguments) === canonicalJson(row.decision.call.arguments);
  const wrong = executed.filter(row => !correct(row));
  const toolOnly = rows.filter(row => row.decision.kind === "fallthrough" && row.decision.reason === "tool_only");
  const known = rows.filter(row => row.usage?.estimatedCostUsd !== null && row.usage?.estimatedCostUsd !== undefined);
  const costs = known.map(row => row.usage.estimatedCostUsd), latency = rows.map(row => row.durationMs);
  const reasons = {};
  for (const row of rows) if (row.decision.kind === "fallthrough") reasons[row.decision.reason] = (reasons[row.decision.reason] ?? 0) + 1;
  return { cases: rows.length, executed: executed.length, executeRate: rows.length ? executed.length / rows.length : null,
    precision: executed.length ? (executed.length - wrong.length) / executed.length : null, wrongExecutions: wrong.length,
    toolChoiceAccuracy: rows.length ? rows.filter(row => row.decision.toolChoice === (row.expected?.name ?? "none")).length / rows.length : null,
    toolOnlyPicks: toolOnly.length, toolOnlyCorrect: toolOnly.filter(row => row.decision.toolChoice === row.expected?.name).length,
    fallthroughReasons: reasons, latencyMs: { p50: percentile(latency, .5), p95: percentile(latency, .95) },
    costUsd: known.length === rows.length ? costs.reduce((sum, value) => sum + value, 0) : null,
    knownCostUsd: costs.reduce((sum, value) => sum + value, 0), costPerCaseUsd: { p50: percentile(costs, .5), p95: percentile(costs, .95) }, missingUsage: rows.length - known.length };
}
export function summarizeFastPath(rows, names = [...eligible]) {
  const wrongPicks = rows.filter(row => row.decision.kind === "execute" ? !row.expected || row.expected.name !== row.decision.call.name || canonicalJson(row.expected.arguments) !== canonicalJson(row.decision.call.arguments)
    : row.decision.reason === "tool_only" && row.expected?.name !== row.decision.toolChoice)
    .map(({ id, messageText, expected, decision }) => ({ id, messageText, expected, decision }));
  const perTool = Object.fromEntries([...names, "none"].map(name => {
    const relevant = rows.filter(row => (row.expected?.name ?? "none") === name || (row.decision.kind === "execute" && row.decision.call.name === name) || (row.decision.kind === "fallthrough" && row.decision.reason === "tool_only" && row.decision.toolChoice === name));
    return [name, { expectedCases: rows.filter(row => (row.expected?.name ?? "none") === name).length, ...metrics(relevant) }];
  }));
  return { overall: metrics(rows), perTool, wrongPicks };
}
export function createFastPathAi({ accountId, apiToken, gatewayId = "default", fetch: send = fetch }) {
  if (!accountId || !apiToken) throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required for the live benchmark.");
  return { async run(model, input, options) {
    const response = await send(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`, {
      method: "POST", signal: AbortSignal.timeout(120_000),
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json", "cf-aig-gateway-id": gatewayId,
        "cf-aig-metadata": JSON.stringify(options?.gateway?.metadata ?? {}) }, body: JSON.stringify(input),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) throw Object.assign(new Error(`Cloudflare Clef request failed (HTTP ${response.status})`), { status: response.status });
    const result = payload?.result ?? payload;
    return result?.gatewayMetadata && result.result ? result.result : result;
  } };
}
function reportBase(baseDate, outputDirectory, cases) {
  const sources = ["scripts/evaluate-fast-path.mjs", "scripts/agent-eval-scenarios.mjs", "scripts/agent-eval-historical.mjs", "scripts/agent-eval-ordered.mjs", "scripts/agent-eval-images.mjs", "packages/agent/src/fast-path.ts", "packages/agent/src/clef.ts", "packages/agent/src/schema.ts", "packages/agent/src/types.ts", "packages/agent/src/tools/reminders.ts", "packages/agent/src/tools/tasks.ts", "packages/agent/src/tools/calendar.ts", "packages/agent-chat/src/capabilities.ts"];
  return { schemaVersion: "me3-fast-path-phase1-v1", startedAt: new Date().toISOString(), baseDate, ownerTimezone: "Europe/Dublin", outputDirectory,
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()),
    sourceHashes: Object.fromEntries(sources.map(path => [path, createHash("sha256").update(readFileSync(new URL(`../${path}`, import.meta.url))).digest("hex")])),
    command: process.argv.slice(1), status: "running", cases: cases.length, eligibleCases: cases.filter(row => row.expected).length,
    pricingUsdPerMillionInput: CLEF_INPUT_PRICE, outputPriceUsd: 0, pricingSource: "https://developers.cloudflare.com/workers-ai/models/clef/", flashPricingSource: "https://developers.cloudflare.com/workers-ai/models/clef-flash/",
    notes: "Measurement only; no tools or write arguments execute. tool_only counts routing for creates separately from full read decisions. All thresholds reuse the same inference. Zero wrong picks with zero accepted decisions does not establish useful accuracy.", models: [] };
}
export async function runFastPathBenchmark({ ai, outputDirectory, baseDate, cases = fastPathCases(baseDate) }) {
  if (existsSync(resolve(outputDirectory, "report.json")) || existsSync(resolve(outputDirectory, "raw.jsonl"))) throw new Error("Output already contains a report. Choose a fresh --out directory.");
  mkdirSync(outputDirectory, { recursive: true });
  const report = reportBase(baseDate, outputDirectory, cases);
  writeReport(report);
  try {
    for (const model of ["clef", "clef-flash"]) {
      const rows = [];
      for (const row of cases) {
        let raw;
        const input = deciderInput(row, baseDate, AbortSignal.timeout(120_000));
        const request = buildFastPathRequest(input), started = performance.now();
        let result;
        try {
          result = await createClefDecider({ model, ai: { async run(...args) { raw = await ai.run(...args); return raw; } }, gatewayId: "default", metadata: { purpose: "fast_path", me3_eval: "phase1", scenario: row.id } }).decide(input);
        } catch (error) {
          result = { kind: "fallthrough", reason: "inference_error", durationMs: performance.now() - started };
          if ([401, 403, 404].includes(error.status)) {
            appendFileSync(resolve(outputDirectory, "raw.jsonl"), JSON.stringify({ model, id: row.id, request: { state: request.state, questions: request.questions }, response: raw ?? null, result }) + "\n");
            throw error;
          }
        }
        const { durationMs, usage, ...decision } = result;
        rows.push({ ...row, durationMs, usage, raw, request, decision });
        appendFileSync(resolve(outputDirectory, "raw.jsonl"), JSON.stringify({ model, id: row.id, request: { state: request.state, questions: request.questions }, response: raw ?? null, result }) + "\n");
      }
      report.models.push({ model, inferenceErrors: rows.filter(row => row.decision.reason === "inference_error").length, thresholds: THRESHOLDS.map(threshold => {
        const thresholds = { toolProbability: threshold, argumentProbability: threshold, singleCommand: threshold, unsafeProbability: 1 - threshold };
        const scored = rows.map(row => ({ ...row, decision: row.raw && row.raw.model === model ? parseFastPathResponse(row.raw, row.request, thresholds) : row.decision }));
        return { threshold, thresholds, ...summarizeFastPath(scored) };
      }) });
      writeReport(report);
    }
    report.status = report.models.some(model => model.inferenceErrors) ? "completed_with_errors" : "complete";
  } catch (error) { report.status = "failed"; report.error = error.message; }
  report.completedAt = new Date().toISOString(); writeReport(report); return report;
}
function writeReport(report) {
  writeFileSync(resolve(report.outputDirectory, "report.json"), JSON.stringify(report, null, 2) + "\n");
  const fmt = value => value === null || value === undefined ? "n/a" : typeof value === "number" ? value.toFixed(4) : String(value);
  const cost = value => value === null || value === undefined ? "n/a" : value.toFixed(8);
  const lines = ["# Decision fast path phase 1", "", `Status: ${report.status}. Revision: ${report.revision}${report.dirty ? " (working tree changes)" : ""}. Synthetic base date: ${report.baseDate}.`, "", report.notes, "",
    `${report.cases} single-turn phrasings; ${report.eligibleCases} have one eligible expected call. Create arguments are never predicted. Empty tool coverage is shown explicitly.`, ""];
  if (report.error) lines.push(report.error, "");
  for (const model of report.models) {
    lines.push(`## ${model.model}`, "", "| Threshold | Tool | Cases | Expected | Execute rate | Exact precision | Wrong executions | Tool choice accuracy | Create picks / correct | p50 / p95 ms | Known cost USD |", "|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    for (const score of model.thresholds) for (const [name, metrics] of [["overall", score.overall], ...Object.entries(score.perTool)]) lines.push(`| ${score.threshold} | ${name} | ${metrics.cases} | ${metrics.expectedCases ?? "—"} | ${fmt(metrics.executeRate)} | ${fmt(metrics.precision)} | ${metrics.wrongExecutions} | ${fmt(metrics.toolChoiceAccuracy)} | ${metrics.toolOnlyPicks} / ${metrics.toolOnlyCorrect} | ${fmt(metrics.latencyMs.p50)} / ${fmt(metrics.latencyMs.p95)} | ${cost(metrics.knownCostUsd)}${metrics.missingUsage ? " (incomplete)" : ""} |`);
    for (const score of model.thresholds) lines.push("", `Threshold ${score.threshold}: fallthrough reasons ${JSON.stringify(score.overall.fallthroughReasons)}; cost p50/p95 $${cost(score.overall.costPerCaseUsd.p50)}/$${cost(score.overall.costPerCaseUsd.p95)}; wrong picks ${JSON.stringify(score.wrongPicks)}.`);
    lines.push("");
  }
  writeFileSync(resolve(report.outputDirectory, "report.md"), lines.join("\n") + "\n");
}
async function main() {
  const args = process.argv.slice(2), baseDate = args.find(value => value.startsWith("--date="))?.slice(7) ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate) || !Number.isFinite(Date.parse(`${baseDate}T12:00:00Z`)) || new Date(`${baseDate}T12:00:00Z`).toISOString().slice(0, 10) !== baseDate) throw new Error("--date must be a valid YYYY-MM-DD date.");
  const outputDirectory = resolve(args.find(value => value.startsWith("--out="))?.slice(6) ?? `.me3-evals/fast-path/${new Date().toISOString().replace(/[:.]/g, "-")}`);
  execFileSync("git", ["check-ignore", "--quiet", resolve(outputDirectory, "report.json")]);
  mkdirSync(outputDirectory, { recursive: true }); const cases = fastPathCases(baseDate);
  const ready = reportBase(baseDate, outputDirectory, cases);
  if (args.includes("--dry-run")) {
    ready.status = "dry_run"; ready.error = "No model calls; accuracy, latency and cost are unmeasured."; writeReport(ready);
  } else {
    let ai;
    try { ai = createFastPathAi({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID?.trim(), apiToken: (process.env.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_AUTH_TOKEN)?.trim(), gatewayId: process.env.CLOUDFLARE_AI_GATEWAY_ID?.trim() || "default" }); }
    catch (error) { ready.status = "blocked"; ready.error = error.message; writeReport(ready); process.exitCode = 1; }
    if (ai) { const report = await runFastPathBenchmark({ ai, outputDirectory, baseDate, cases }); if (report.status !== "complete") process.exitCode = 1; }
  }
  console.log(`Fast-path report: ${resolve(outputDirectory, "report.md")}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
