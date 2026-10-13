import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildFastPathRequest } from "../packages/agent/src/fast-path.ts";
import { createDomainTools } from "../packages/agent/src/tools/index.ts";
import { canonicalJson } from "../packages/agent/src/schema.ts";

const allTools = createDomainTools();
const none = { toolChoice: "none", reason: "no_phrase_match" };
const variant = model => model.replace(/^@cf\//, "").replace(/^cloudflare\//, "");
const known = value => typeof value === "number" && Number.isFinite(value) && value >= 0;
const mean = values => values.length && values.every(known) ? values.reduce((a, b) => a + b, 0) / values.length : null;
const percentile = (values, p) => { const sorted = values.filter(known).sort((a, b) => a - b); return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null; };
const same = (a, b) => a && b && a.name === b.name && canonicalJson(a.arguments) === canonicalJson(b.arguments);

export function phraseFastPath(state) {
  const text = String(state?.latest_request ?? "").replace(/’/g, "'").replace(/\s+/g, " ").trim();
  const available = new Set(state?.available_tools ?? []);
  if (/\b(?:don't|do not|instead|that one|those|same|earlier|second one)\b/i.test(text) || /\band (?:then |also )?(?:show|list|add|create|move|cancel|send)\b/i.test(text)) return none;
  if (/^remind me\b.*\bto\s+\S/i.test(text) && available.has("core_reminders_create")) return { toolChoice: "core_reminders_create" };
  if (/^(?:list|show) (?:all )?(?:my )?reminders[.!?]?$/i.test(text) && available.has("core_reminders_list")) return { toolChoice: "core_reminders_list", call: { name: "core_reminders_list", arguments: {} } };
  const calendar = /^(?:what(?:'s| is) on my calendar|show my calendar|list (?:my )?calendar events) (today|tomorrow|(?:the )?day after tomorrow)[.!?]?$/i.exec(text);
  if (!calendar || !available.has("core_calendar_events_list") || !state.owner_timezone || !Number.isFinite(Date.parse(state.now_iso))) return none;
  const key = calendar[1].toLowerCase().replace(/^the /, "").replace(/ /g, "_");
  const request = buildFastPathRequest({ messageText: text, recentMessages: [], tools: allTools, ownerTimezone: state.owner_timezone, now: new Date(state.now_iso), signal: new AbortController().signal }, "core_calendar_events_list");
  return { toolChoice: "core_calendar_events_list", call: { name: "core_calendar_events_list", arguments: request.candidates.core_calendar_events_list[key].arguments } };
}
function firstStep(turn, events) {
  const steps = (turn.modelSteps ?? []).filter(step => step.step === 1);
  const successful = steps.findLast(step => step.status === "complete");
  const costs = steps.map(step => step.billingUsageId ? events.find(event => event.id === step.billingUsageId)?.costUsd : step.usage?.estimatedCostUsd);
  return { calls: successful?.toolCalls ?? [], costUsd: steps.length && costs.every(known) ? costs.reduce((a, b) => a + b, 0) : null,
    durationMs: steps.length ? steps.reduce((a, step) => a + step.durationMs, 0) : null };
}
export function summarizeShadow(capture) {
  const turns = capture.turns ?? [], events = capture.usageEvents ?? [], buckets = {};
  const phraseRules = { cases: 0, picks: 0, firstToolAgreements: 0, exactReadAgreements: 0 };
  const mix = {};
  for (const turn of turns) {
    const first = firstStep(turn, events);
    for (const call of first.calls) mix[call.name] = (mix[call.name] ?? 0) + 1;
    if (!turn.fastPath) continue;
    const state = turn.fastPath.state ?? {};
    const phrase = phraseFastPath(state);
    phraseRules.cases++; if (phrase.toolChoice !== "none") phraseRules.picks++;
    if (first.calls.length === 1 && phrase.toolChoice === first.calls[0].name) phraseRules.firstToolAgreements++;
    if (first.calls.length === 1 && same(phrase.call, first.calls[0])) phraseRules.exactReadAgreements++;
    for (const model of turn.fastPath.models ?? [turn.fastPath]) {
      const name = variant(model.decider);
      const paid = events.filter(event => event.turnId === turn.turnId && variant(event.model) === name && event.measurement);
      const mode = model.argumentMode ?? paid[0]?.measurement.argumentMode ?? "fanout";
      const bucket = buckets[`${name}:${mode}`] ??= { samples: 0, acceptedReads: 0, exactReadAgreements: 0, acceptedCreateRoutes: 0, firstToolAgreements: 0, eventualToolAgreements: 0, timeouts: 0, firstModelFinishedBeforeShadow: 0, lateObservedReadAgreements: 0, readsWithLaterActions: 0, costs: [], firstCosts: [], firstLatencies: [], requestLatencies: [], decisionLatencies: [], potentialSavedCosts: [], unknownCosts: 0 };
      bucket.samples++; bucket.firstCosts.push(first.costUsd); bucket.firstLatencies.push(first.durationMs);
      const costs = paid.map(event => event.costUsd);
      const cost = paid.length ? (costs.every(known) ? costs.reduce((a, b) => a + b, 0) : null) : model.usage?.estimatedCostUsd ?? (model.decision?.reason === "no_eligible_tools" ? 0 : null);
      bucket.costs.push(cost); if (cost === null) bucket.unknownCosts++;
      bucket.requestLatencies.push(...paid.map(event => event.measurement.durationMs));
      const completed = paid.filter(event => event.measurement.status === "complete");
      if (completed.length) bucket.decisionLatencies.push(Math.max(...completed.map(event => (event.measurement.offsetMs ?? 0) + event.measurement.durationMs)));
      const accepted = model.status === "complete" ? model.decision : null;
      const observed = completed.at(-1)?.measurement.decision ?? accepted;
      const choice = observed?.toolChoice ?? observed?.call?.name;
      if (first.calls.length === 1 && choice === first.calls[0].name) bucket.firstToolAgreements++;
      const allCalls = (turn.modelSteps ?? []).filter(step => step.status === "complete").flatMap(step => step.toolCalls ?? []);
      if (allCalls.some(call => call.name === choice)) bucket.eventualToolAgreements++;
      let saved = 0;
      if (accepted?.kind === "execute") {
        bucket.acceptedReads++;
        if (first.calls.length === 1 && same(accepted.call, first.calls[0])) {
          bucket.exactReadAgreements++;
          if (allCalls.some(call => !same(call, accepted.call))) bucket.readsWithLaterActions++;
          else saved = first.costUsd;
        }
      } else if (accepted?.reason === "tool_only") bucket.acceptedCreateRoutes++;
      if (model.status === "timeout") {
        bucket.timeouts++; if (model.decision?.reason === "first_model_finished") bucket.firstModelFinishedBeforeShadow++;
        if (observed?.kind === "execute" && first.calls.length === 1 && same(observed.call, first.calls[0])) bucket.lateObservedReadAgreements++;
      }
      bucket.potentialSavedCosts.push(saved);
    }
  }
  const models = Object.fromEntries(Object.entries(buckets).map(([key, bucket]) => {
    const { costs, firstCosts, firstLatencies, requestLatencies, decisionLatencies, potentialSavedCosts, ...counts } = bucket;
    const meanShadowCostUsd = mean(costs), meanFirstStepCostUsd = mean(firstCosts), meanPotentialSavedCostUsd = mean(potentialSavedCosts);
    return [key, { ...counts, exactReadAgreementCoverage: counts.exactReadAgreements / counts.samples, meanShadowCostUsd, meanFirstStepCostUsd,
      breakEvenCoverage: meanShadowCostUsd !== null && meanFirstStepCostUsd > 0 ? meanShadowCostUsd / meanFirstStepCostUsd : null,
      meanPotentialFirstStepNetSavingUsd: meanShadowCostUsd !== null && meanPotentialSavedCostUsd !== null ? meanPotentialSavedCostUsd - meanShadowCostUsd : null,
      firstStepLatencyMs: { p50: percentile(firstLatencies, .5), p95: percentile(firstLatencies, .95) }, requestLatencyMs: { p50: percentile(requestLatencies, .5), p95: percentile(requestLatencies, .95) }, decisionLatencyMs: { p50: percentile(decisionLatencies, .5), p95: percentile(decisionLatencies, .95) } }];
  }));
  return { schemaVersion: "me3-fast-path-shadow-report-v1", generatedAt: new Date().toISOString(), turns: turns.length, sampledTurns: turns.filter(turn => turn.fastPath).length,
    models, phraseRules, observedFirstToolMix: mix,
    notes: "LLM tool calls are proxy labels, not reviewed intent truth. Exact read agreement is not execution approval. Later planner actions exclude a read from the cost-saving estimate. Each model/mode reports its paired first-step cost including fallback attempts; receipts include hosted fees when referenced. Unknown costs remain unknown. Timeout observations retain paid-request latency; first_model_finished means the LLM finished before the shadow, not necessarily a 2s deadline. Phrase rules cover only reminder creation/listing and basic dated calendar listing. No model calls or tool execution occur in this analysis." };
}
async function main() {
  const path = process.argv.find(arg => arg.startsWith("--input="))?.slice(8);
  if (!path) throw new Error("--input=<private capture.json> is required.");
  const directory = resolve(process.argv.find(arg => arg.startsWith("--out="))?.slice(6) ?? dirname(path));
  execFileSync("git", ["check-ignore", "--quiet", resolve(directory, "shadow-report.json")]);
  const report = summarizeShadow(JSON.parse(readFileSync(path, "utf8")));
  mkdirSync(directory, { recursive: true }); writeFileSync(resolve(directory, "shadow-report.json"), JSON.stringify(report, null, 2) + "\n");
  const lines = ["# Managed shadow comparison", "", `${report.turns} turns; ${report.sampledTurns} sampled.`, "", report.notes, "", "| Model / arguments | Samples | Exact read agreements | Timeouts | Mean shadow USD | First-step break-even | Paid request p95 ms |", "|---|---:|---:|---:|---:|---:|---:|"];
  for (const [model, row] of Object.entries(report.models)) lines.push(`| ${model} | ${row.samples} | ${row.exactReadAgreements} | ${row.timeouts} | ${row.meanShadowCostUsd ?? "unknown"} | ${row.breakEvenCoverage === null ? "unknown" : (row.breakEvenCoverage * 100).toFixed(1) + "%"} | ${row.requestLatencyMs.p95 ?? "unknown"} |`);
  lines.push("", `Phrase baseline: ${JSON.stringify(report.phraseRules)}.`, "", `Observed first-tool mix: ${JSON.stringify(report.observedFirstToolMix)}.`);
  writeFileSync(resolve(directory, "shadow-report.md"), lines.join("\n") + "\n");
  console.log(`Shadow comparison: ${resolve(directory, "shadow-report.md")}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
