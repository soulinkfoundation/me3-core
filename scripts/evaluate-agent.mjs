import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runCoreAgentToolTurn } from "../packages/agent-chat/src/core-agent-runtime.ts";
import { getUtcMsForLocalTime } from "../packages/calendar/src/index.ts";
import { createAgentSchedulingToolServices } from "../apps/worker/src/agent-scheduling.ts";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";

const runtime = process.argv.find((arg) => arg.startsWith("--runtime="))?.slice(10) || "legacy";
if (runtime !== "legacy" && runtime !== "sdk") throw new Error("Use --runtime=legacy or --runtime=sdk");
const reportPath = process.argv.find((arg) => arg.startsWith("--report="))?.slice(9) || "/tmp/me3-agent-eval.json";
const limit = Number(process.argv.find((arg) => arg.startsWith("--limit="))?.slice(8) || "48");
if (!Number.isInteger(limit) || limit < 1 || limit > 48) throw new Error("--limit must be an integer from 1 to 48.");
const modelChoice = process.argv.find((arg) => arg.startsWith("--model="))?.slice(8) || "scripted-fixture";
const liveProvider = modelChoice.startsWith("openai:") ? "openai" : modelChoice.startsWith("anthropic:") ? "anthropic" : null;
if (modelChoice !== "scripted-fixture" && !liveProvider) throw new Error("Use --model=scripted-fixture, openai:MODEL, or anthropic:MODEL");
const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const cloudflareApiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
const cloudflareGatewayId = process.env.CLOUDFLARE_AI_GATEWAY_ID?.trim() || "default";
if (liveProvider && (!cloudflareAccountId || !cloudflareApiToken)) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required for a live model eval.");
}
const localToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const baseDate = localToday;
const day = (offset) => {
  const date = new Date(`${baseDate}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
const eventDay = day(1);
const soulinkDay = day(2);
const bookingDay = day(3);
const journalDay = day(-1);
const [year, month, date] = eventDay.split("-").map(Number);
const movedEventUtc = new Date(getUtcMsForLocalTime({ year, month, day: date, hour: 13, minute: 30 }, "Europe/Dublin")).toISOString();
const reminderUtc = new Date(getUtcMsForLocalTime({ year, month, day: date, hour: 9, minute: 0 }, "Europe/Dublin")).toISOString();
const scenarioFamilies = [
  {
    id: "calendar-find",
    prompt: "What's on my calendar tomorrow?",
    calls: [{ name: "core_calendar_events_list", arguments: { dateFrom: eventDay, dateTo: eventDay } }],
    check: (seed, results) => JSON.stringify(results).includes("Planning session") &&
      !JSON.stringify(results).includes("Private other-owner event") &&
      seed.raw.prepare("SELECT COUNT(*) AS n FROM user_calendar_events WHERE user_id = ?").get(seed.ownerId).n === 1,
  },
  {
    id: "calendar-move",
    prompt: "Move my planning session tomorrow to 1:30pm.",
    calls: [
      { name: "core_calendar_events_list", arguments: { dateFrom: eventDay, dateTo: eventDay } },
      { name: "core_calendar_event_reschedule", arguments: { eventId: "eval-planning", startDate: eventDay, startTime: "13:30", startTimezone: "Europe/Dublin" } },
    ],
    check: (seed) => seed.raw.prepare("SELECT starts_at FROM user_calendar_events WHERE id = 'eval-planning'").get().starts_at === movedEventUtc,
  },
  {
    id: "calendar-create",
    prompt: "Add a planning review for tomorrow at 2pm.",
    calls: [{ name: "core_calendar_event_create", arguments: { title: "Planning review", startDate: eventDay, startTime: "14:00", startTimezone: "Europe/Dublin", durationMinutes: 45 } }],
    check: (seed) => seed.raw.prepare("SELECT COUNT(*) AS n FROM user_calendar_events WHERE user_id = ? AND title = 'Planning review'").get(seed.ownerId).n === 1,
  },
  {
    id: "calendar-create-retried",
    prompt: "Add the same planning review and recover a repeated model call.",
    calls: [
      { name: "core_calendar_event_create", arguments: { title: "Planning review", startDate: eventDay, startTime: "14:00", startTimezone: "Europe/Dublin", durationMinutes: 45 } },
      { name: "core_calendar_event_create", arguments: { title: "Planning review", startDate: eventDay, startTime: "14:00", startTimezone: "Europe/Dublin", durationMinutes: 45 } },
    ],
    expectedExecutions: 1,
    check: (seed) => seed.raw.prepare("SELECT COUNT(*) AS n FROM user_calendar_events WHERE user_id = ? AND title = 'Planning review'").get(seed.ownerId).n === 1,
  },
  {
    id: "calendar-cancel-approved",
    prompt: "Cancel my planning session tomorrow.",
    calls: [{ name: "core_calendar_event_cancel", arguments: { eventId: "eval-planning" } }],
    confirmPrompt: "Confirm cancel Planning session",
    expectedExecutions: 2,
    check: (seed) => seed.raw.prepare("SELECT COUNT(*) AS n FROM user_calendar_events WHERE id = 'eval-planning'").get().n === 0 &&
      seed.raw.prepare("SELECT COUNT(*) AS n FROM calendar_agent_cancellation_approvals WHERE status = 'complete'").get().n === 1,
  },
  {
    id: "soulink-calendar-read",
    prompt: "When is my Soulink circle?",
    calls: [{ name: "core_calendar_events_list", arguments: { dateFrom: soulinkDay, dateTo: soulinkDay } }],
    check: (seed, results) => JSON.stringify(results).includes("Soulink circle") && seed.raw.prepare("SELECT COUNT(*) AS n FROM calendar_source_events").get().n === 1,
  },
  {
    id: "booking-read",
    prompt: "What upcoming bookings do I have?",
    calls: [{ name: "core_bookings_lookup", arguments: {} }],
    check: (seed, results) => JSON.stringify(results).includes("Ada Example") && seed.raw.prepare("SELECT COUNT(*) AS n FROM bookings").get().n === 1,
  },
  {
    id: "calendar-availability",
    prompt: "Find a free 30-minute call slot three days from now.",
    calls: [{ name: "core_calendar_availability", arguments: { dateFrom: bookingDay, dateTo: bookingDay, durationMinutes: 30, limit: 50 } }],
    check: (_seed, results) => {
      const slots = JSON.parse(results[0]?.result_json || "{}").result?.slots || [];
      const blockedStart = Date.parse(`${bookingDay}T12:45:00.000Z`);
      const blockedEnd = Date.parse(`${bookingDay}T14:15:00.000Z`);
      return slots.length > 0 && slots.every((slot) => Date.parse(slot.endsAt) <= blockedStart || Date.parse(slot.startsAt) >= blockedEnd);
    },
  },
  {
    id: "reminder-create",
    prompt: "Remind me tomorrow at 9am to call Alex.",
    calls: [{ name: "core_reminders_create", arguments: { title: "Call Alex", remindAt: reminderUtc, timezone: "Europe/Dublin" } }],
    check: (seed) => seed.raw.prepare("SELECT COUNT(*) AS n FROM user_reminders WHERE user_id = ? AND title = 'Call Alex'").get(seed.ownerId).n === 1,
  },
  {
    id: "reminder-list",
    prompt: "What reminders are coming up?",
    calls: [{ name: "core_reminders_list", arguments: {} }],
    check: (seed, results) => JSON.stringify(results).includes("Call Sam") && seed.raw.prepare("SELECT COUNT(*) AS n FROM user_reminders").get().n === 1,
  },
  {
    id: "journal-read",
    prompt: "What did I write in my journal yesterday?",
    calls: [{ name: "core_journal_read", arguments: { mode: "date", date: journalDay } }],
    check: (seed, results) => JSON.stringify(results).includes("calmer launch week") && seed.raw.prepare("SELECT COUNT(*) AS n FROM journal_entries").get().n === 1,
  },
  {
    id: "mission-task-read",
    prompt: "Show my ME3 Launch tasks.",
    calls: [{ name: "core_mission_task_list", arguments: { projectName: "ME3 Launch" } }],
    check: (seed, results) => JSON.stringify(results).includes("Review launch plan") && seed.raw.prepare("SELECT COUNT(*) AS n FROM mission_tasks").get().n === 1,
  },
];

const phrasings = {
  "calendar-find": ["What's on my calendar tomorrow?", "Show tomorrow's events.", "Anything planned tomorrow?", "Tomorrow's agenda, please."],
  "calendar-move": ["Move my planning session tomorrow to 1:30pm.", "Shift the planning session to 13:30 tomorrow.", "Push that planning session to half one tomorrow.", "Planning session: move it to 1:30pm tomorrow."],
  "calendar-create": ["Add a planning review for tomorrow at 2pm.", "Put a planning review on tomorrow at 14:00.", "Block 45 minutes for planning review tomorrow at two.", "Planning review, tomorrow 2pm, 45 minutes."],
  "calendar-create-retried": ["Add the same planning review and recover a repeated model call.", "Create a planning review, handling a retry.", "Block the review once even if retried.", "Planning review, but no duplicate."],
  "calendar-cancel-approved": ["Cancel my planning session tomorrow.", "Remove tomorrow's planning session.", "Delete that planning session tomorrow.", "I need to cancel the planning session."],
  "soulink-calendar-read": ["When is my Soulink circle?", "Show the imported Soulink event.", "Is the circle the day after tomorrow?", "What's in the connected calendar the day after tomorrow?"],
  "booking-read": ["What upcoming bookings do I have?", "Any client sessions booked?", "Show my confirmed appointments.", "What's booked over the next few days?"],
  "calendar-availability": ["Find a free 30-minute call slot three days from now.", "When am I available for a half-hour call in three days?", "Give me openings around my booking three days out.", "Any free half-hour slots in three days?"],
  "reminder-create": ["Remind me tomorrow at 9am to call Alex.", "Set a reminder to call Alex tomorrow morning at nine.", "Call Alex: alert me at 9 tomorrow.", "Please ping me tomorrow 09:00 to call Alex."],
  "reminder-list": ["What reminders are coming up?", "Show my pending alerts.", "Anything I need to remember?", "List my reminders."],
  "journal-read": ["What did I write in my journal yesterday?", "Find yesterday's reflection.", "What was on my mind yesterday?", "Read yesterday's journal entry."],
  "mission-task-read": ["Show my ME3 Launch tasks.", "What's left to do for the ME3 Launch project?", "Find the launch work items.", "List tasks in ME3 Launch."],
};
const allScenarios = scenarioFamilies.flatMap((family) => phrasings[family.id].map((prompt, index) => ({
  ...family,
  id: `${family.id}-${index + 1}`,
  prompt,
})));
const selectedIds = process.argv.find((arg) => arg.startsWith("--scenarios="))?.slice(12).split(",");
const scenarios = selectedIds
  ? selectedIds.map((id) => {
      const scenario = allScenarios.find((item) => item.id === id);
      if (!scenario) throw new Error(`Unknown scenario: ${id}`);
      return scenario;
    })
  : allScenarios.slice(0, limit);

const results = [];
for (const scenario of scenarios) {
  const seed = createSeededAgentEvalInstallation(baseDate);
  const installedPluginIds = new Set(seed.raw.prepare("SELECT plugin_id FROM plugin_installations WHERE enabled = 1 AND status = 'installed'").all().map((row) => row.plugin_id));
  const outputs = scenario.calls.map((call, index) => ({
    tool_calls: [{ id: `${scenario.id}-${index}`, ...call }],
  }));
  outputs.push({ response: "The requested action is complete." });
  const modelInputs = [];
  const usageSamples = [];
  const liveRoute = liveProvider ? {
    providerId: "workers-ai",
    model: `${liveProvider}/${modelChoice.slice(liveProvider.length + 1)}`,
    backupModel: null,
    apiKey: null,
    ai: { run: async (model, input) => {
      const { stream: _stream, ...request } = input;
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cloudflareAccountId)}/ai/run`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cloudflareApiToken}`,
          "Content-Type": "application/json",
          "cf-aig-gateway-id": cloudflareGatewayId,
        },
        body: JSON.stringify({ model, input: request }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false || payload?.error) {
        throw new Error(payload?.errors?.[0]?.message || payload?.error?.message || `Cloudflare AI request failed (${response.status})`);
      }
      const run = payload?.result ?? payload;
      return (run?.gatewayMetadata || run?.state) && run?.result ? run.result : run;
    } },
    aiGateway: { accountId: cloudflareAccountId, gatewayId: cloudflareGatewayId, apiToken: null, routeWorkersAi: true, routeExternalProviders: false },
    configured: true,
    recordUsage: ({ usage }) => usageSamples.push(usage),
  } : null;
  const model = async (_name, input) => {
    modelInputs.push(input);
    return outputs.shift();
  };
  const started = performance.now();
  let firstDeltaMs = null;
  try {
    const response = await runCoreAgentToolTurn({
      db: seed.db,
      userId: seed.ownerId,
      requestId: `eval-${scenario.id}`,
      turnId: `eval-${scenario.id}`,
      ownerTimezone: "Europe/Dublin",
      route: liveRoute || { providerId: "workers-ai", model: "scripted-fixture", backupModel: null, apiKey: null, ai: { run: model }, aiGateway: null, configured: true },
      messages: [{ role: "system", content: `You are ME3. Today is ${baseDate} in Europe/Dublin.` }, { role: "user", content: scenario.prompt }],
      schedulingServices: { availability: createAgentSchedulingToolServices({ DB: seed.db }, seed.ownerId).availability },
      runtime,
      installedPluginIds,
      ...(liveProvider ? { streamOptions: { onEvent: (event) => { if (event.event === "delta") firstDeltaMs ??= performance.now() - started; } } } : {}),
    });
    const toolResults = seed.raw.prepare("SELECT tool_name, status, result_json FROM agent_tool_executions WHERE request_id = ? ORDER BY rowid").all(`eval-${scenario.id}`);
    let modelSteps = response.streamMetrics?.modelRequestCount || modelInputs.length;
    let approvalRequested = true;
    if (scenario.confirmPrompt) {
      approvalRequested = response.replyText.includes(scenario.confirmPrompt) &&
        seed.raw.prepare("SELECT COUNT(*) AS n FROM user_calendar_events WHERE id = 'eval-planning'").get().n === 1;
      const followUpOutputs = [
        { tool_calls: [{ id: `${scenario.id}-confirm`, ...scenario.calls[0] }] },
        { response: "The event was cancelled." },
      ];
      const followUp = await runCoreAgentToolTurn({
        db: seed.db,
        userId: seed.ownerId,
        requestId: `eval-${scenario.id}-confirm`,
        turnId: `eval-${scenario.id}-confirm`,
        ownerTimezone: "Europe/Dublin",
        route: liveRoute || { providerId: "workers-ai", model: "scripted-fixture", backupModel: null, apiKey: null, ai: { run: async () => followUpOutputs.shift() }, aiGateway: null, configured: true },
        messages: [
          { role: "system", content: `You are ME3. Today is ${baseDate} in Europe/Dublin.` },
          { role: "user", content: scenario.prompt },
          { role: "assistant", content: response.replyText },
          { role: "user", content: scenario.confirmPrompt },
        ],
        runtime,
        installedPluginIds,
      });
      modelSteps += followUp.streamMetrics?.modelRequestCount || (liveProvider ? 0 : 2);
      toolResults.push(...seed.raw.prepare("SELECT tool_name, status, result_json FROM agent_tool_executions WHERE request_id = ? ORDER BY rowid").all(`eval-${scenario.id}-confirm`));
      approvalRequested &&= followUp.replyText.includes("Cancelled Planning session");
    }
    const passed = approvalRequested && scenario.check(seed, toolResults) && toolResults.length === (scenario.expectedExecutions || scenario.calls.length) && toolResults.every((row) => row.status === "succeeded") && response.source !== "fallback";
    results.push({ id: scenario.id, passed, providerFailure: response.source === "fallback" && toolResults.length === 0, modelSteps, toolCalls: toolResults.map((row) => row.tool_name), usage: sumUsage(usageSamples), elapsedMs: Math.round(performance.now() - started), ttftMs: firstDeltaMs === null ? null : Math.round(firstDeltaMs), error: passed ? null : response.debugError || "State or tool execution mismatch" });
  } catch (error) {
    results.push({ id: scenario.id, passed: false, providerFailure: false, modelSteps: modelInputs.length, toolCalls: [], usage: sumUsage(usageSamples), elapsedMs: Math.round(performance.now() - started), ttftMs: firstDeltaMs, error: String(error) });
  } finally {
    seed.close();
  }
}
const report = {
  schemaVersion: 1,
  kind: liveProvider ? "live-model-seeded-integration" : "scripted-seeded-integration",
  evidenceLimit: liveProvider
    ? "Live model actions are checked against seeded state. Open-ended answer quality and cost are not graded here."
    : "The model is scripted. This checks tool visibility and persisted state, not live model choices, answer quality, cost, or streaming latency.",
  runtime,
  model: modelChoice,
  commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  baseDate,
  seed: "Fresh in-memory SQLite database from all Worker migrations for each scenario; discarded after each run.",
  command: `pnpm eval:agent -- --runtime=${runtime} --model=${modelChoice} ${selectedIds ? `--scenarios=${selectedIds.join(",")}` : `--limit=${limit}`}`,
  generatedAt: new Date().toISOString(),
  totals: {
    scenarios: results.length,
    passed: results.filter((item) => item.passed).length,
    failed: results.filter((item) => !item.passed).length,
    providerFailures: results.filter((item) => item.providerFailure).length,
    usage: sumUsage(results.flatMap((item) => item.usage ? [item.usage] : [])),
    modelStepsP50: percentile(results.map((item) => item.modelSteps), 0.5),
    modelStepsP95: percentile(results.map((item) => item.modelSteps), 0.95),
    elapsedP50Ms: percentile(results.map((item) => item.elapsedMs), 0.5),
    elapsedP95Ms: percentile(results.map((item) => item.elapsedMs), 0.95),
    costUsd: null,
    liveTtftP95Ms: liveProvider ? percentile(results.flatMap((item) => item.ttftMs === null ? [] : [item.ttftMs]), 0.95) : null,
  },
  results,
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`${report.totals.passed}/${report.totals.scenarios} passed; report: ${reportPath}`);
if (report.totals.passed !== report.totals.scenarios && !process.argv.includes("--report-only")) process.exitCode = 1;

function percentile(values, quantile) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil((sorted.length - 1) * quantile)] ?? null;
}

function sumUsage(samples) {
  if (!samples.length) return null;
  return samples.reduce((total, sample) => ({
    inputTokens: total.inputTokens + sample.inputTokens,
    outputTokens: total.outputTokens + sample.outputTokens,
    cachedInputTokens: total.cachedInputTokens + sample.cachedInputTokens,
  }), { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });
}
