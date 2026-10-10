import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildAgentSystemPrompt } from "../packages/agent/src/prompt.ts";
import { createAgentEvalScenarios } from "./agent-eval-scenarios.mjs";
import { createGatewayRoute, gradeAgentReply, resolveGraderModel } from "./agent-eval-gateway.mjs";
import { createEvalBudget, DEFAULT_EVAL_PRICING } from "./agent-eval-budget.mjs";
import { estimateCost, GRADER_MODEL } from "./agent-eval-report.mjs";
import { sourceFingerprint } from "./agent-eval-source.mjs";

export async function runGraderReplay({ sourceReport, selections, graderModel = GRADER_MODEL, routeFactory, budget, pricing = DEFAULT_EVAL_PRICING, onCheckpoint } = {}) {
  resolveGraderModel(graderModel);
  if (!sourceReport?.live || !/synthetic/i.test(sourceReport.seed ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(sourceReport.baseDate ?? "")) throw new Error("Replay requires a live synthetic eval source report.");
  if (!Array.isArray(selections) || selections.length < 1 || selections.length > 2 || new Set(selections.map(row => `${row.id}:${row.repeat}`)).size !== selections.length) throw new Error("Select one or two distinct failed rows.");
  const scenarios = createAgentEvalScenarios(sourceReport.baseDate);
  // Validate the entire selection before making any model request.
  const rows = selections.map(selection => {
    const row = sourceReport.results?.find(row => row.id === selection.id && row.repeat === selection.repeat);
    const scenario = scenarios.find(scenario => scenario.id === selection.id);
    if (!row || !scenario || !Number.isInteger(selection.repeat)) throw new Error(`Unknown replay row ${selection.id}:${selection.repeat}.`);
    if (row.grader?.passed !== false || typeof row.grader.error !== "string") throw new Error("Replay only accepts existing failed grader-error rows.");
    if (!Array.isArray(row.turns) || !row.turns.length || row.turns.some(turn => typeof turn.prompt !== "string" || typeof turn.reply !== "string") || !Array.isArray(row.toolResults) || !Array.isArray(row.toolContracts)) throw new Error("Replay row is missing recorded grader evidence.");
    return { row, scenario };
  });
  const fingerprint = sourceFingerprint();
  const results = [];
  const report = () => ({ purpose: "grader-replay", promotionEligible: false, graderModel, pricing: pricing[graderModel],
    sourceReportFingerprint: sourceReport.sourceFingerprint, sourceFingerprint: fingerprint, sourceStable: fingerprint === sourceFingerprint(),
    candidateModel: sourceReport.model, selected: selections, completed: results.length, results,
    costUsd: results.length && results.every(row => Number.isFinite(row.costUsd)) ? results.reduce((sum, row) => sum + row.costUsd, 0) : null,
    budget: budget?.summary(), evidenceLimit: "Diagnostic grader-only replay. Existing candidate replies, recorded receipts and contracts are unchanged; the synthetic system prompt and scenario rubric are reconstructed from current source. No original report or promotion score is changed." });
  for (const { row, scenario } of rows) {
    const messages = [{ role: "system", content: buildAgentSystemPrompt({ ownerName: "Eval Owner", timezone: "Europe/Dublin", now: new Date(`${sourceReport.baseDate}T12:00:00Z`), ownerSnapshot: "Synthetic owner. Main project: ME3 Launch. Goals: a calmer launch week. Contact and mailbox data require tools." }) },
      ...row.turns.flatMap(turn => [{ role: "user", content: turn.prompt }, { role: "assistant", content: turn.reply }])];
    const result = { id: row.id, repeat: row.repeat, originalGrader: row.grader, grade: null, rawText: null, usage: null, costUsd: null };
    try {
      const graded = await gradeAgentReply({ scenario, messages, toolResults: row.toolResults, toolContracts: row.toolContracts, stateCheckPassed: row.stateCheckPassed,
        graderModel, route: routeFactory ? routeFactory(row) : createGatewayRoute(graderModel, { budget }) });
      result.grade = graded.grade; result.rawText = graded.rawText; result.usage = graded.usage;
    } catch (error) {
      result.error = String(error); result.rawText = error.graderEvidence?.rawText ?? null; result.usage = error.graderEvidence?.usage ?? null;
    }
    result.costUsd = estimateCost(result.usage, pricing[graderModel]);
    results.push(result);
    await onCheckpoint?.(report());
    if (budget?.summary().stopped) break;
  }
  return report();
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2).filter(arg => arg !== "--");
  for (const arg of args) if (!/^--(?:source|rows|grader-model|max-cost-usd|report)=.+$/.test(arg)) throw new Error(`Unknown replay option: ${arg}`);
  const value = (name, fallback) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  const maxCostUsd = Number(value("max-cost-usd", "0.10"));
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 0.10) throw new Error("Replay --max-cost-usd must be above zero and at most 0.10.");
  const sourcePath = value("source", null);
  if (!sourcePath) throw new Error("--source is required.");
  const selections = value("rows", "").split(",").filter(Boolean).map(token => {
    const match = /^([^:]+):(\d+)$/.exec(token);
    if (!match) throw new Error("--rows requires scenario-id:repeat selections.");
    return { id: match[1], repeat: Number(match[2]) };
  });
  const path = resolve(value("report", `.me3-evals/agent/grader-replay-${Date.now()}.json`));
  if (existsSync(path) || path === resolve(sourcePath)) throw new Error("Replay output must be a new file; existing reports are preserved.");
  const graderModel = resolveGraderModel(value("grader-model", GRADER_MODEL));
  mkdirSync(dirname(path), { recursive: true });
  const report = await runGraderReplay({ sourceReport: JSON.parse(readFileSync(sourcePath, "utf8")), selections, graderModel,
    budget: createEvalBudget(maxCostUsd, DEFAULT_EVAL_PRICING), onCheckpoint: report => writeFileSync(path, JSON.stringify({ ...report, sourcePath, command: ["pnpm exec node --import tsx scripts/agent-eval-grader-replay.mjs", ...args].join(" ") }, null, 2) + "\n") });
  console.log(`${report.completed}/${selections.length} grader-only rows replayed; cost ${report.costUsd === null ? "unknown" : `$${report.costUsd.toFixed(6)}`}; ${path}`);
  if (!report.sourceStable || report.completed !== selections.length || report.results.some(row => row.error)) process.exitCode = 1;
}
