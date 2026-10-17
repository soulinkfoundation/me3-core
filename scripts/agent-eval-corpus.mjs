import { createAgentEvalScenarios } from "./agent-eval-scenarios.mjs";
import { createConversationEvalScenarios } from "./agent-eval-conversation.mjs";
import { createFindingsEvalScenarios } from "./agent-eval-findings.mjs";
import { createToolGroupEvalScenarios } from "./agent-eval-tool-groups.mjs";
import { createQuoteEvalScenarios, snapshotQuoteEvalState, checkQuoteEvalState } from "./agent-eval-quote-scenarios.mjs";

export function createAgentEvalCorpus(baseDate, supplement = "") {
  if (!["", "quotes", "conversation", "findings", "toolgroups"].includes(supplement)) throw Error("Unknown eval supplement; use --supplement=quotes, --supplement=conversation, --supplement=findings, --supplement=toolgroups or omit it.");
  const originals = createAgentEvalScenarios(baseDate), quotes = supplement === "quotes" ? createQuoteEvalScenarios() : [];
  if (supplement === "findings") {
    const findings = createFindingsEvalScenarios();
    return { scenarios: [...originals, ...findings], originalIds: originals.map(s => s.id), probeIds: [], supplement,
      version: "original85-plus-findings-v1", originalCount: originals.length, supplementCount: findings.length };
  }
  if (supplement === "toolgroups") {
    const toolGroups = createToolGroupEvalScenarios();
    return { scenarios: [...originals, ...toolGroups], originalIds: originals.map(s => s.id), probeIds: [], supplement,
      version: "original85-plus-toolgroups-v1", originalCount: originals.length, supplementCount: toolGroups.length };
  }
  if (supplement === "conversation") {
    const conversation = createConversationEvalScenarios();
    return { scenarios: [...originals, ...conversation], originalIds: originals.map(s => s.id), probeIds: [], supplement,
      version: "original85-plus-conversation10-v1", originalCount: originals.length, supplementCount: conversation.length };
  }
  const states = new WeakMap();
  const probes = quotes.map(quote => ({ id: `quotes/${quote.id}`, suite: quote.suite, evaluationKind: "owner-create-guard-probe", quoteExpectation: quote,
    setup(seed) { states.set(seed, snapshotQuoteEvalState(seed)); },
    turns: [{ prompt: quote.prompt, calls: quote.fixtureCalls, ownerCreateVerdicts: quote.ownerCreateVerdicts }],
    fixtureReply: quote.fixtureReply, rubric: quote.rubric, check: seed => checkQuoteEvalState(seed, states.get(seed), quote) }));
  return { scenarios: [...originals, ...probes], originalIds: originals.map(s => s.id), probeIds: probes.map(s => s.id), supplement,
    version: supplement ? "original85-plus-quote-probes-v1" : "original85-v1", originalCount: originals.length, supplementCount: probes.length };
}

export function assertQuoteCorpusOptions(supplement, repeat, args) {
  if (supplement !== "quotes") return;
  if (repeat !== 3 || args.some(arg => /^--(?:limit|scenarios|report-only)(?:=|$)/.test(arg))) throw Error("Quote supplement requires one whole91-scenario/273-trial run: repeat3, no filter, limit or report-only override.");
}

export function completeCorpusContract(config, observedIds) {
  if (!config.supplement && !config.scenarioContractVersion) return true; // Historical raw contract compatibility.
  try {
    const corpus = createAgentEvalCorpus(config.baseDate, config.supplement || "");
    return config.scenarioContractVersion === corpus.version && config.originalScenarioCount === corpus.originalCount && config.supplementScenarioCount === corpus.supplementCount
      && (!corpus.supplement || config.repeat === 3) && config.totalScenarioCount === corpus.scenarios.length && config.scenarioCount === corpus.scenarios.length
      && observedIds.length === corpus.scenarios.length && corpus.scenarios.every(s => observedIds.includes(s.id));
  } catch { return false; }
}
