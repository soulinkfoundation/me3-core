import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";
import { createAgentEvalScenarios, snapshotEvalState, auditEvalWrites } from "./agent-eval-scenarios.mjs";
import { createRuntimeAdapter } from "./agent-eval-adapters.mjs";
import { createSeededEvalServices } from "./agent-eval-services.mjs";
import { createGatewayRoute, gradeAgentReply, resolveGraderModel } from "./agent-eval-gateway.mjs";
import { GRADER_MODEL, buildAgentEvalReport, agentEvalMarkdown, sumUsage, estimateCost } from "./agent-eval-report.mjs";
import { DEFAULT_EVAL_PRICING, createEvalBudget } from "./agent-eval-budget.mjs";
import { buildAgentSystemPrompt } from "../packages/agent/src/prompt.ts";
import { sourceFingerprint } from "./agent-eval-source.mjs";

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const allowedFlags = new Set(["runtime", "model", "repeat", "date", "limit", "scenarios", "pricing", "report", "report-only", "max-cost-usd", "grader-model"]);
for (const arg of args) if (!arg.startsWith("--") || !allowedFlags.has(arg.slice(2).split("=")[0])) throw new Error(`Unknown eval option: ${arg}`);
const value = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const graderModel = resolveGraderModel(value("grader-model", GRADER_MODEL));
const runtime = value("runtime", "new");
const adapter = createRuntimeAdapter(runtime);
const modelChoice = value("model", "scripted-fixture");
const live = modelChoice !== "scripted-fixture";
if (live && !/^(openai|anthropic|workers-ai):[^\s]+$/.test(modelChoice)) throw new Error("Use --model=scripted-fixture or provider:MODEL (openai, anthropic, workers-ai).");
const repeat = Number(value("repeat", "3"));
if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) throw new Error("--repeat must be an integer from 1 to 20.");
const baseDate = value("date", new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
const allScenarios = createAgentEvalScenarios(baseDate);
const limit = Number(value("limit", String(allScenarios.length)));
if (!Number.isInteger(limit) || limit < 1 || limit > allScenarios.length) throw new Error(`--limit must be an integer from 1 to ${allScenarios.length}.`);
const selectedIds = value("scenarios", "").split(",").filter(Boolean);
if (new Set(selectedIds).size !== selectedIds.length) throw new Error("--scenarios must not contain duplicates.");
const scenarios = selectedIds.length ? selectedIds.map((id) => {
  const scenario = allScenarios.find((item) => item.id === id);
  if (!scenario) throw new Error(`Unknown scenario: ${id}`);
  return scenario;
}) : allScenarios.slice(0, limit);
const pricingPath = value("pricing", null);
const pricing = { ...DEFAULT_EVAL_PRICING, ...(pricingPath ? JSON.parse(readFileSync(pricingPath, "utf8")) : {}) };
for (const [name, rates] of Object.entries(pricing)) {
  if (![rates.input, rates.output, rates.cached, rates.cacheWrite ?? rates.input].every((rate) => Number.isFinite(rate) && rate >= 0) || typeof rates.source !== "string" || !rates.source.startsWith("https://")) throw new Error(`Pricing for ${name} needs nonnegative input/output/cached USD per million tokens plus a source URL.`);
}
const maxCostUsd = Number(value("max-cost-usd", "40"));
if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0 || maxCostUsd > 50) throw new Error("--max-cost-usd must be above 0 and at most 50 under this task's spending limit.");
const budget = createEvalBudget(maxCostUsd, pricing);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportPath = resolve(value("report", `.me3-evals/agent/${stamp}-${runtime}-${modelChoice.replace(/[^a-z0-9.-]/gi, "-")}.json`));
const markdownPath = reportPath.replace(/\.json$/, "") + ".md";
mkdirSync(dirname(reportPath), { recursive: true });
const config = {
  runtime, model: modelChoice, graderModel, live, repeat, scenarioCount: scenarios.length, totalScenarioCount: allScenarios.length, baseDate,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  workingTreeDirty: Boolean(execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim()),
  command: ["pnpm eval:agent --", ...args].join(" "),
  seed: "Fresh migrated disposable file-backed SQLite per scenario/repeat; only synthetic example.invalid records. Close/reopen the database before each follow-up and final persisted-state verification.",
  providerFixtures: ["Seeded mailbox provider (real D1 writes, simulated mail transport)", "Synthetic public-web evidence", "No network people/Soulink results"],
  transport: live ? "Provider SSE body passed through Cloudflare native compatibility endpoints to the runtime; TTFT from first nonempty runtime delta on every owner turn." : "Scripted fixture; TTFT is not provider evidence.",
  pricing: Object.fromEntries(Object.entries(pricing).map(([name, rates]) => [name, { ...rates }])),
  sourceFingerprint: sourceFingerprint(),
};
const results = [];
const saveReport = () => {
  config.budget = budget.summary();
  config.sourceChangedDuringRun = config.sourceFingerprint !== sourceFingerprint();
  const report = buildAgentEvalReport(config, results);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, agentEvalMarkdown(report));
  return report;
};
saveReport();
evaluation: for (let iteration = 1; iteration <= repeat; iteration++) {
  for (const scenario of scenarios) {
    const seed = createSeededAgentEvalInstallation(baseDate);
    const started = performance.now();
    const row = { id: scenario.id, repeat: iteration, simpleAction: Boolean(scenario.simpleAction), passed: false, stateCheckPassed: false,
      providerFailure: false, safety: { duplicateWrites: 0, unauthorizedWrites: 0, wrongRecordWrites: 0 }, turns: [], turnTtftMs: [], toolCalls: [], usage: null, grader: null, graderUsage: null, costUsd: null, graderCostUsd: null };
    const toolResults = new Map();
    const toolContracts = new Map();
    const messages = [{ role: "system", content: buildAgentSystemPrompt({ ownerName: "Eval Owner", timezone: "Europe/Dublin", now: new Date(`${baseDate}T12:00:00Z`), ownerSnapshot: "Synthetic owner. Main project: ME3 Launch. Goals: a calmer launch week. Contact and mailbox data require tools." }) }];
    const route = live ? createGatewayRoute(modelChoice, { budget }) : { model: "scripted-fixture", providerId: "workers-ai", configured: true, usageSamples: [], recordUsage() {}, ai: { async run() { throw new Error("Fixture provider not initialized"); } }, aiGateway: null };
    try {
      scenario.setup?.(seed);
      const initialState = snapshotEvalState(seed);
      const services = createSeededEvalServices(seed);
      const enabledPluginIds = new Set(seed.raw.prepare("SELECT plugin_id FROM plugin_installations WHERE enabled = 1 AND status = 'installed'").all().map((row) => row.plugin_id));
      let intermediatePassed = true;
      for (const [turnIndex, turn] of scenario.turns.entries()) {
        if (turnIndex > 0) seed.reopen();
        const turnStarted = performance.now();
        let firstDeltaMs = null;
        messages.push({ role: "user", content: turn.prompt });
        const fixtureOutputs = turn.calls.map((call, index) => ({ tool_calls: [{ id: `fixture-${iteration}-${turnIndex}-${index}`, name: call.name, arguments: { ...call.arguments } }] }));
        const fixtureReply = scenario.id === "web-research-cited" ? "Cloudflare AI Gateway provides observability and rate limiting. [Cloudflare documentation](https://developers.cloudflare.com/ai-gateway/)." : "The requested action is complete.";
        fixtureOutputs.push({ response: fixtureReply });
        if (!live) route.ai.run = async () => {
          const next = fixtureOutputs.shift();
          const call = next?.tool_calls?.[0];
          if (call?.arguments.messageId === "$draftId") call.arguments.messageId = seed.raw.prepare("SELECT id FROM mailbox_messages WHERE mailbox_id = 'eval-mailbox' AND message_kind = 'draft' ORDER BY rowid DESC LIMIT 1").get()?.id;
          if (call?.arguments.reminderId === "$createdReminderId") call.arguments.reminderId = seed.raw.prepare("SELECT id FROM user_reminders WHERE user_id = ? AND title = 'Call Ada' ORDER BY rowid DESC LIMIT 1").get(seed.ownerId)?.id;
          return next;
        };
        const response = await adapter.runTurn({ seed, ownerId: seed.ownerId, messages: [...messages], requestId: `eval-${scenario.id}-${iteration}-${turnIndex}`, turnId: `eval-${scenario.id}-${iteration}-${turnIndex}`,
          ownerTimezone: "Europe/Dublin", modelRoute: route, services, enabledPluginIds, fixtureCalls: turn.calls, fixtureReply, approve: turn.approve,
          onEvent(event) { if (event.event === "delta" && typeof event.data?.text === "string" && event.data.text) firstDeltaMs ??= performance.now() - turnStarted; } });
        messages.push({ role: "assistant", content: response.replyText });
        for (const result of response.toolResults || []) toolResults.set(result.execution_id, result);
        for (const contract of response.toolContracts || []) toolContracts.set(contract.name, contract);
        row.providerFailure ||= response.source === "fallback" || response.status === "failed";
        const turnSafety = auditEvalWrites(initialState, snapshotEvalState(seed), { ...scenario, allowedWrites: turn.allowedWrites ?? scenario.allowedWrites });
        // Maximum observed counts retain failures even when a later turn restores state.
        for (const name of Object.keys(row.safety)) row.safety[name] = Math.max(row.safety[name], turnSafety[name]);
        intermediatePassed &&= !turn.check || Boolean(turn.check(seed, [...toolResults.values()], messages.filter((message) => message.role === "assistant").map((message) => message.content)));
        row.turnTtftMs.push(live && firstDeltaMs !== null ? Math.round(firstDeltaMs) : null);
        row.turns.push({ prompt: turn.prompt, reply: response.replyText, status: response.status || response.source, elapsedMs: Math.round(performance.now() - turnStarted), ttftMs: row.turnTtftMs.at(-1), modelRequests: response.modelRequestCount });
      }
      seed.reopen();
      row.persistedVerification = { freshConnection: true, reopenCount: seed.reopenCount };
      row.historySource = scenario.historySource;
      row.stateCheckPassed = intermediatePassed && Boolean(scenario.check(seed, [...toolResults.values()], row.turns.map((turn) => turn.reply)));
      row.toolCalls = [...toolResults.values()].map((result) => result.tool_name);
      row.toolResults = [...toolResults.values()];
      row.toolContracts = [...toolContracts.values()].filter(contract => row.toolCalls.includes(contract.name));
      row.elapsedMs = Math.round(performance.now() - started);
      row.ttftMs = row.turnTtftMs[0] ?? null;
      row.usage = sumUsage(route.usageSamples);
      row.usageComplete = live && route.usageComplete;
      row.costUsd = row.usageComplete ? estimateCost(row.usage, pricing[modelChoice]) : null;
      if (live) {
        try {
          const graded = await gradeAgentReply({ scenario, messages, toolResults: row.toolResults, toolContracts: row.toolContracts, stateCheckPassed: row.stateCheckPassed, graderModel, route: createGatewayRoute(graderModel, { budget }) });
          row.grader = graded.grade; row.graderUsage = graded.usage; row.graderCostUsd = estimateCost(graded.usage, pricing[graderModel]);
        } catch (error) { row.grader = { passed: false, error: String(error) }; }
      }
      row.passed = row.stateCheckPassed && Object.values(row.safety).every((count) => count === 0) && !row.providerFailure && (!live || row.grader?.passed === true);
    } catch (error) { row.error = String(error); row.elapsedMs = Math.round(performance.now() - started); }
    finally { seed.close(); }
    results.push(row);
    saveReport();
    console.log(`${scenario.id} repeat ${iteration}/${repeat}: ${row.passed ? "pass" : "FAIL"}${row.error ? ` (${row.error})` : ""}`);
    if (budget.summary().stopped) { console.log("Stopping before another billed request because the eval cost guard was reached."); break evaluation; }
  }
}
const report = saveReport();
console.log(`${report.totals.passed}/${report.totals.runs} passed; gate ${report.gate.passed ? "PASS" : "FAIL"}; ${reportPath}; ${markdownPath}`);
if (!args.includes("--report-only") && (live && runtime === "new" ? !report.gate.passed : results.some((row) => !row.passed))) process.exitCode = 1;
