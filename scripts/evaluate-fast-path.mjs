import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentEvalScenarios } from "./agent-eval-scenarios.mjs";
import { createDomainTools } from "../packages/agent/src/tools/index.ts";
import { buildFastPathRequest, FAST_PATH_THRESHOLDS } from "../packages/agent/src/fast-path.ts";
import { CLEF_INPUT_PRICE, createClefDecider } from "../packages/agent/src/clef.ts";
import { canonicalJson } from "../packages/agent/src/schema.ts";
import { calibrationExtras, heldOutFastPathCases } from "./fast-path-eval-cases.mjs";

const tools = createDomainTools();
const eligible = new Set(tools.filter(tool => tool.fastPath).map(tool => tool.name));
const THRESHOLDS = Array.from({ length: 49 }, (_, i) => (50 + i) / 100);
export function fastPathCases(baseDate) {
  return createAgentEvalScenarios(baseDate).filter(scenario => scenario.turns.length === 1).map(scenario => {
    const turn = scenario.turns[0], calls = turn.calls ?? [];
    const oneAction = calls.length === 1 || (scenario.expectedExecutions === 1 && calls.length > 1 && calls.every(call => canonicalJson(call) === canonicalJson(calls[0])));
    return { id: scenario.id, messageText: turn.prompt, calls, images: turn.images ?? scenario.images ?? [], recentMessages: [],
      argumentsScorable: !["soulink-calendar-read-1", "soulink-calendar-read-2"].includes(scenario.id),
      expected: oneAction && eligible.has(calls[0]?.name) ? calls[0] : null };
  });
}
function deciderInput(row, baseDate, signal) {
  return { messageText: row.messageText, recentMessages: row.images?.length ? [{ role: "user", content: row.messageText, images: [{ url: "synthetic-attachment-skip" }] }] : row.recentMessages ?? [], tools, ownerTimezone: "Europe/Dublin", now: new Date(`${baseDate}T12:00:00Z`), signal };
}
function percentile(values, fraction) { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]; }
function metrics(rows) {
  const executed = rows.filter(row => row.decision.kind === "execute" && row.argumentsScorable !== false);
  const correct = row => row.expected && row.expected.name === row.decision.call.name && canonicalJson(row.expected.arguments) === canonicalJson(row.decision.call.arguments);
  const wrong = executed.filter(row => !correct(row));
  const toolOnly = rows.filter(row => row.decision.kind === "fallthrough" && row.decision.reason === "tool_only");
  const known = rows.filter(row => row.usage?.estimatedCostUsd !== null && row.usage?.estimatedCostUsd !== undefined);
  const costs = known.map(row => row.usage.estimatedCostUsd), latency = rows.map(row => row.durationMs);
  const reasons = {};
  for (const row of rows) if (row.decision.kind === "fallthrough") reasons[row.decision.reason] = (reasons[row.decision.reason] ?? 0) + 1;
  return { cases: rows.length, executed: executed.length, executeRate: rows.length ? executed.length / rows.length : null,
    expectedReadCases: rows.filter(row => row.argumentsScorable !== false && row.expected?.arguments && tools.find(tool => tool.name === row.expected.name)?.fastPath?.mode === "arguments").length,
    unscoredReadPredictions: rows.filter(row => row.argumentsScorable === false && row.decision.kind === "execute").length,
    precision: executed.length ? (executed.length - wrong.length) / executed.length : null, wrongExecutions: wrong.length,
    toolChoiceAccuracy: rows.length ? rows.filter(row => row.decision.toolChoice === (row.expected?.name ?? "none")).length / rows.length : null,
    toolOnlyPicks: toolOnly.length, toolOnlyCorrect: toolOnly.filter(row => row.decision.toolChoice === row.expected?.name).length,
    fallthroughReasons: reasons, latencyMs: { p50: percentile(latency, .5), p95: percentile(latency, .95) },
    costUsd: known.length === rows.length ? costs.reduce((sum, value) => sum + value, 0) : null,
    knownCostUsd: costs.reduce((sum, value) => sum + value, 0), costPerCaseUsd: { p50: percentile(costs, .5), p95: percentile(costs, .95) }, missingUsage: rows.length - known.length };
}
export function summarizeFastPath(rows, names = [...eligible]) {
  const wrongPicks = rows.filter(row => row.decision.kind === "execute" ? row.argumentsScorable !== false && (!row.expected || row.expected.name !== row.decision.call.name || canonicalJson(row.expected.arguments) !== canonicalJson(row.decision.call.arguments))
    : row.decision.reason === "tool_only" && row.expected?.name !== row.decision.toolChoice)
    .map(({ id, messageText, expected, decision }) => ({ id, messageText, expected, decision }));
  const perTool = Object.fromEntries([...names, "none"].map(name => {
    const relevant = rows.filter(row => (row.expected?.name ?? "none") === name || (row.decision.kind === "execute" && row.decision.call.name === name) || (row.decision.kind === "fallthrough" && row.decision.reason === "tool_only" && row.decision.toolChoice === name));
    return [name, { expectedCases: rows.filter(row => (row.expected?.name ?? "none") === name).length, ...metrics(relevant) }];
  }));
  return { overall: metrics(rows), perTool, wrongPicks };
}
function applyThresholds(row, thresholds) {
  const decision = row.decision;
  if (decision.kind !== "execute" && decision.reason !== "tool_only") return row;
  const reason = decision.probabilities[decision.toolChoice] < thresholds.toolProbability ? "tool_threshold"
    : (decision.gates.refers_to_history ?? 0) > thresholds.historyProbability ? "refers_to_history"
    : decision.kind === "execute" && row.argumentProbability < thresholds.argumentProbability ? "argument_threshold" : null;
  return reason ? { ...row, decision: { kind: "fallthrough", reason, toolChoice: decision.toolChoice, probabilities: decision.probabilities, gates: decision.gates } } : row;
}
function score(rows, thresholds) {
  let correctReads = 0, wrongReads = 0, correctWrites = 0, wrongWrites = 0, expectedReads = 0;
  for (const row of rows) {
    if (row.argumentsScorable === false) continue;
    const decision = row.decision;
    if (row.expected?.arguments && tools.find(tool => tool.name === row.expected.name)?.fastPath?.mode === "arguments") expectedReads++;
    if (decision.kind !== "execute" && decision.reason !== "tool_only") continue;
    if (decision.probabilities[decision.toolChoice] < thresholds.toolProbability || (decision.gates.refers_to_history ?? 0) > thresholds.historyProbability) continue;
    if (decision.kind === "execute") {
      if (row.argumentProbability < thresholds.argumentProbability) continue;
      if (row.expected?.name === decision.call.name && canonicalJson(row.expected.arguments) === canonicalJson(decision.call.arguments)) correctReads++; else wrongReads++;
    } else if (row.expected?.name === decision.toolChoice) correctWrites++; else wrongWrites++;
  }
  return { correctReads, wrongReads, correctWrites, wrongWrites, expectedReads, readCoverage: expectedReads ? correctReads / expectedReads : null };
}
export function calibrateFastPath(rows) {
  const floor = { toolProbability: 0, argumentProbability: 0, historyProbability: 1 };
  const curves = Object.fromEntries(Object.keys(floor).map(axis => [axis, THRESHOLDS.map(value => {
    const threshold = axis === "historyProbability" ? Math.round((1 - value) * 100) / 100 : value;
    return { threshold, ...score(rows, { ...floor, [axis]: threshold }) };
  })]));
  let selection;
  for (const toolProbability of THRESHOLDS) for (const argumentProbability of THRESHOLDS) for (const value of THRESHOLDS) {
    const thresholds = { toolProbability, argumentProbability, historyProbability: Math.round((1 - value) * 100) / 100 };
    const result = score(rows, thresholds);
    if (result.wrongReads || result.wrongWrites) continue;
    if (!selection || result.correctReads > selection.correctReads || (result.correctReads === selection.correctReads && result.correctWrites > selection.correctWrites)
      || (result.correctReads === selection.correctReads && result.correctWrites === selection.correctWrites && (toolProbability > selection.thresholds.toolProbability
        || (toolProbability === selection.thresholds.toolProbability && (argumentProbability > selection.thresholds.argumentProbability
          || (argumentProbability === selection.thresholds.argumentProbability && thresholds.historyProbability < selection.thresholds.historyProbability)))))) selection = { thresholds, ...result };
  }
  return { curves, selection: selection ?? null, selectionRule: "Calibration only: zero wrong read predictions and zero wrong write routes, then most correct reads, then most correct write routes; ties favour stricter cutoffs. Holdout never selects thresholds." };
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
function reportBase(baseDate, outputDirectory, cases, holdoutCases = []) {
  const sources = ["scripts/evaluate-fast-path.mjs", "scripts/fast-path-eval-cases.mjs", "scripts/agent-eval-scenarios.mjs", "scripts/agent-eval-historical.mjs", "scripts/agent-eval-ordered.mjs", "scripts/agent-eval-images.mjs", "packages/agent/src/fast-path.ts", "packages/agent/src/clef.ts", "packages/agent/src/schema.ts", "packages/agent/src/types.ts", "packages/agent/src/tools/reminders.ts", "packages/agent/src/tools/tasks.ts", "packages/agent/src/tools/calendar.ts", "packages/agent-chat/src/capabilities.ts"];
  return { schemaVersion: "me3-fast-path-phase1-v2", startedAt: new Date().toISOString(), baseDate, ownerTimezone: "Europe/Dublin", outputDirectory,
    revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), dirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()),
    sourceHashes: Object.fromEntries(sources.map(path => [path, createHash("sha256").update(readFileSync(new URL(`../${path}`, import.meta.url))).digest("hex")])),
    command: process.argv.slice(1), status: "running", cases: cases.length, holdoutCases: holdoutCases.length, eligibleCases: cases.filter(row => row.expected).length,
    caseManifest: { calibration: cases, holdout: holdoutCases }, shadowThresholds: FAST_PATH_THRESHOLDS,
    pricingUsdPerMillionInput: CLEF_INPUT_PRICE, outputPriceUsd: 0, pricingSource: "https://developers.cloudflare.com/workers-ai/models/clef/", flashPricingSource: "https://developers.cloudflare.com/workers-ai/models/clef-flash/",
    notes: "Measurement only; no tools execute and no write arguments are predicted. tool_only counts routing for creates. Each case has one inference reused for every curve. Calibration reuses correlated original phrasings plus targeted history/range/task-create cases. Fresh synthetic holdout cases are evaluated once at thresholds frozen before their calls; they are not production traffic. Two original Soulink cases have hidden seed dates: their tool routes are scored, their arguments are unscorable and excluded from calibration. Invalid-date creates are routing-positive; validation remains separate. Bookings and availability remain distinct unsupported actions. Calendar reads require a bounded inclusive range of at most 31 days; open ranges are not supported. Zero errors with zero coverage is not evidence for execution. Shadow saves no LLM cost; economic break-even needs the cost of the model steps actually avoided and the live eligible-traffic fraction.", models: [] };
}
export async function runFastPathBenchmark({ ai, outputDirectory, baseDate, cases, holdoutCases = cases ? [] : heldOutFastPathCases(baseDate) }) {
  cases ??= [...fastPathCases(baseDate), ...calibrationExtras(baseDate)];
  if (existsSync(resolve(outputDirectory, "report.json")) || existsSync(resolve(outputDirectory, "raw.jsonl"))) throw new Error("Output already contains a report. Choose a fresh --out directory.");
  mkdirSync(outputDirectory, { recursive: true });
  const report = reportBase(baseDate, outputDirectory, cases, holdoutCases);
  writeReport(report);
  try {
    for (const model of ["clef", "clef-flash"]) {
      const measure = async (batch, split) => {
      const rows = [];
      for (const row of batch) {
        let raw;
        const input = deciderInput(row, baseDate, AbortSignal.timeout(120_000));
        const request = buildFastPathRequest(input), started = performance.now();
        let result;
        try {
          result = await createClefDecider({ model, thresholds: { toolProbability: 0, argumentProbability: 0, historyProbability: 1 }, ai: { async run(...args) { raw = await ai.run(...args); return raw; } }, gatewayId: "default", metadata: { purpose: "fast_path", me3_eval: "phase1-calibration", scenario: row.id } }).decide(input);
        } catch (error) {
          result = { kind: "fallthrough", reason: "inference_error", durationMs: performance.now() - started };
          if ([401, 403, 404].includes(error.status)) {
            appendFileSync(resolve(outputDirectory, "raw.jsonl"), JSON.stringify({ model, split, id: row.id, request: { state: request.state, questions: request.questions }, response: raw ?? null, result }) + "\n");
            throw error;
          }
        }
        const { durationMs, usage, ...decision } = result;
        const args = raw?.answers?.[`args_${decision.toolChoice}`];
        const argumentProbability = args?.probabilities?.[args.choice] ?? 0;
        rows.push({ ...row, durationMs, usage, decision, argumentProbability });
        appendFileSync(resolve(outputDirectory, "raw.jsonl"), JSON.stringify({ model, split, id: row.id, request: { state: request.state, questions: request.questions }, response: raw ?? null, result, argumentProbability }) + "\n");
      }
      return rows;
      };
      const rows = await measure(cases, "calibration");
      const calibration = calibrateFastPath(rows);
      const frozen = calibration.selection?.thresholds ?? FAST_PATH_THRESHOLDS;
      const entry = { model, inferenceErrors: rows.filter(row => row.decision.reason === "inference_error").length,
        calibration: { ...calibration, frozenAt: new Date().toISOString(), ...summarizeFastPath(rows.map(row => applyThresholds(row, frozen))) } };
      report.models.push(entry);
      writeReport(report); // Freeze before seeing any held-out responses.
      const holdout = await measure(holdoutCases, "holdout");
      entry.inferenceErrors += holdout.filter(row => row.decision.reason === "inference_error").length;
      entry.holdout = { thresholds: frozen, ...score(holdout, frozen), ...summarizeFastPath(holdout.map(row => applyThresholds(row, frozen))) };
      entry.holdout.validated = Boolean(calibration.selection && holdout.length && !entry.inferenceErrors && !entry.holdout.wrongPicks.length && entry.holdout.correctReads);
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
  const lines = ["# Decision fast path phase 1: revised calibration", "", `Status: ${report.status}. Revision: ${report.revision}${report.dirty ? " (working tree changes)" : ""}. Synthetic base date: ${report.baseDate}.`, "", report.notes, "",
    `${report.cases} calibration cases; ${report.holdoutCases} fresh holdout cases per model. Runtime shadow defaults: ${JSON.stringify(report.shadowThresholds)}. Frozen benchmark selections below are separate from those defaults.`, ""];
  const csv = ["model,axis,threshold,correctReads,wrongReads,correctWrites,wrongWrites,expectedReads,readCoverage"];
  if (report.error) lines.push(report.error, "");
  for (const model of report.models) {
    lines.push(`## ${model.model}`, "", `Frozen calibration selection: ${JSON.stringify(model.calibration.selection)}. Frozen at ${model.calibration.frozenAt}.`, "", model.calibration.selectionRule, "");
    for (const [axis, points] of Object.entries(model.calibration.curves)) for (const point of points) csv.push([model.model, axis, point.threshold, point.correctReads, point.wrongReads, point.correctWrites, point.wrongWrites, point.expectedReads, point.readCoverage ?? ""].join(","));
    for (const [split, result] of [["calibration", model.calibration], ["holdout", model.holdout]]) {
      if (!result) continue;
      lines.push(`### ${split}`, "", "| Tool | Cases | Expected | Accepted read rate | Exact precision | Wrong reads | Raw route accuracy | Create picks / correct | p50 / p95 ms | Known cost USD |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
      for (const [name, metrics] of [["overall", result.overall], ...Object.entries(result.perTool)]) lines.push(`| ${name} | ${metrics.cases} | ${metrics.expectedCases ?? "—"} | ${fmt(metrics.executeRate)} | ${fmt(metrics.precision)} | ${metrics.wrongExecutions} | ${fmt(metrics.toolChoiceAccuracy)} | ${metrics.toolOnlyPicks} / ${metrics.toolOnlyCorrect} | ${fmt(metrics.latencyMs.p50)} / ${fmt(metrics.latencyMs.p95)} | ${cost(metrics.knownCostUsd)}${metrics.missingUsage ? " (incomplete)" : ""} |`);
      lines.push("", `Fallthrough reasons: ${JSON.stringify(result.overall.fallthroughReasons)}. Unscored read predictions: ${result.overall.unscoredReadPredictions}. Cost per call p50/p95: $${cost(result.overall.costPerCaseUsd.p50)}/$${cost(result.overall.costPerCaseUsd.p95)}. Wrong picks: ${JSON.stringify(result.wrongPicks)}.`);
    }
    if (model.holdout) lines.push("", `Frozen selection passes held-out read/write checks with nonzero read coverage: ${model.holdout.validated}. No retuning on holdout.`);
    lines.push("");
  }
  writeFileSync(resolve(report.outputDirectory, "report.md"), lines.join("\n") + "\n");
  writeFileSync(resolve(report.outputDirectory, "curves.csv"), csv.join("\n") + "\n");
}
async function main() {
  const args = process.argv.slice(2), baseDate = args.find(value => value.startsWith("--date="))?.slice(7) ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate) || !Number.isFinite(Date.parse(`${baseDate}T12:00:00Z`)) || new Date(`${baseDate}T12:00:00Z`).toISOString().slice(0, 10) !== baseDate) throw new Error("--date must be a valid YYYY-MM-DD date.");
  const outputDirectory = resolve(args.find(value => value.startsWith("--out="))?.slice(6) ?? `.me3-evals/fast-path/${new Date().toISOString().replace(/[:.]/g, "-")}`);
  execFileSync("git", ["check-ignore", "--quiet", resolve(outputDirectory, "report.json")]);
  mkdirSync(outputDirectory, { recursive: true }); const cases = [...fastPathCases(baseDate), ...calibrationExtras(baseDate)];
  const ready = reportBase(baseDate, outputDirectory, cases, heldOutFastPathCases(baseDate));
  if (args.includes("--dry-run")) {
    ready.status = "dry_run"; ready.error = "No model calls; accuracy, latency and cost are unmeasured."; writeReport(ready);
  } else {
    let ai;
    try { ai = createFastPathAi({ accountId: process.env.CLOUDFLARE_ACCOUNT_ID?.trim(), apiToken: (process.env.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_AUTH_TOKEN)?.trim(), gatewayId: process.env.CLOUDFLARE_AI_GATEWAY_ID?.trim() || "default" }); }
    catch (error) { ready.status = "blocked"; ready.error = error.message; writeReport(ready); process.exitCode = 1; }
    if (ai) { const report = await runFastPathBenchmark({ ai, outputDirectory, baseDate, cases, holdoutCases: heldOutFastPathCases(baseDate) }); if (report.status !== "complete") process.exitCode = 1; }
  }
  console.log(`Fast-path report: ${resolve(outputDirectory, "report.md")}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
