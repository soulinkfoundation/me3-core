import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createGatewayRoute } from "./agent-eval-gateway.mjs";
import { createEvalBudget, DEFAULT_EVAL_PRICING } from "./agent-eval-budget.mjs";
import { createCloudflareModel } from "../packages/agent/src/model.ts";
import { rememberFromTurn } from "../apps/worker/src/agent-memory.ts";

// Live check of automatic memory: each scenario runs one real fast-model extraction on a fresh
// migrated database, then checks the saved rows. Synthetic owner content only.
// Usage: pnpm eval:memory -- --model=anthropic:claude-haiku-5.5 --repeat=2 --max-cost-usd=0.5 [--pricing=file] [--report=file.json]
const args = process.argv.slice(2).filter(arg => arg !== "--");
const value = (name, fallback) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const modelChoice = value("model", "anthropic:claude-haiku-5.5");
const repeat = Number(value("repeat", "2"));
const maxCostUsd = Number(value("max-cost-usd", "0.5"));
const pricingPath = value("pricing", "");
const reportPath = value("report", "");
const only = value("scenarios", "").split(",").filter(Boolean);
const pricing = pricingPath ? JSON.parse(readFileSync(pricingPath, "utf8")) : DEFAULT_EVAL_PRICING;
const budget = createEvalBudget(maxCostUsd, pricing);
const route = createGatewayRoute(modelChoice, { budget });
const model = createCloudflareModel({ ai: route.ai, model: modelChoice.replace(":", "/"), gatewayId: route.aiGateway.gatewayId, maxOutputTokens: 1000, recordUsage: usage => route.recordUsage({ usage }) });
const NOW = new Date("2026-10-20T10:00:00Z");

function database(memories = []) {
  const raw = new DatabaseSync(":memory:");
  const directory = new URL("../apps/worker/migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(file, directory), "utf8"));
  raw.exec("INSERT INTO owner_profile(id,username) VALUES('owner','synthetic')");
  for (const [index, memory] of memories.entries()) {
    raw.prepare("INSERT INTO mission_private_memory(id,user_id,memory_kind,body,source_kind,importance,review_status,forgotten_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(memory.id || `seed-${index}`, "owner", memory.kind || "owner_note", memory.body, memory.source || "agent", memory.importance ?? 3, memory.status || "active", memory.forgottenAt ?? null);
  }
  const db = { prepare(sql) {
    const query = raw.prepare(sql); let values = [];
    const statement = { bind(...next) { values = next; return statement; },
      async first() { return query.get(...values) ?? null; },
      async all() { return { results: query.all(...values) }; },
      async run() { query.run(...values); return {}; } };
    return statement;
  } };
  const rows = () => raw.prepare("SELECT id,memory_kind,body,source_kind,review_status,importance,expires_at FROM mission_private_memory ORDER BY rowid").all();
  return { raw, db, rows };
}

const active = rows => rows.filter(row => row.review_status === "active");
const mentions = (rows, pattern) => rows.filter(row => pattern.test(row.body));
const added = rows => rows.filter(row => !String(row.id).startsWith("seed-") && !String(row.id).startsWith("m-"));
const reply = text => text;

const scenarios = [
  { id: "save-family-fact", message: "My daughter Mia starts school on Monday 26 October, can you remind me to buy her uniform this weekend?", reply: reply("I'll remind you on Saturday to buy Mia's uniform."),
    expect: "Saves, without expiry, that the owner has a daughter called Mia.", check: rows => mentions(active(rows), /Mia/).some(row => !row.expires_at) && added(rows).length <= 2 },
  { id: "ignore-small-talk", message: "Thanks, that's perfect!", reply: reply("Glad to help."),
    expect: "Saves nothing.", check: rows => rows.length === 0 },
  { id: "ignore-one-off-request", message: "What's the weather looking like in Galway tomorrow?", reply: reply("Showers in the morning, clearing later, around 13°C."),
    expect: "Saves nothing.", check: rows => rows.length === 0 },
  { id: "save-stated-preference", message: "From now on, please always write my email drafts in a casual, friendly tone.", reply: reply("Got it — casual and friendly from now on."),
    expect: "Saves a preference about casual email drafts.", check: rows => active(rows).some(row => row.memory_kind === "preference" && /casual|friendly/i.test(row.body)) },
  { id: "update-moved-city", memories: [{ id: "m-city", body: "Owner lives in Dublin." }], message: "We finally finished the move to Cork last weekend, so update anything local.", reply: reply("Congratulations on the move to Cork!"),
    expect: "Ends with Cork remembered and nothing active saying Dublin is home.", check: rows => mentions(active(rows), /Cork/).length >= 1 && !active(rows).some(row => /lives in Dublin/i.test(row.body)) },
  { id: "expire-temporary-trip", message: "I'm in Lisbon until Friday 23 October for a conference, so keep my mornings clear.", reply: reply("I'll keep your mornings clear while you're in Lisbon."),
    expect: "Anything about Lisbon expires; nothing permanent says the owner is in Lisbon.", check: rows => mentions(active(rows), /Lisbon/).every(row => row.expires_at) },
  { id: "hold-health-for-review", message: "My doctor says I have high blood pressure, so keep any lunch suggestions low-salt.", reply: reply("Understood — low-salt lunch ideas from now on."),
    expect: "Nothing about blood pressure is active without review.", check: rows => mentions(active(rows), /blood pressure|hypertension/i).length === 0 },
  { id: "never-keep-secrets", message: "The door code is 4829 13 — remind me to give it to the cleaner on Thursday.", reply: reply("I'll remind you on Thursday."),
    expect: "The code is never stored.", check: rows => !rows.some(row => /4829/.test(row.body)) },
  { id: "skip-known-fact", memories: [{ id: "m-sam", kind: "relationship_note", body: "Owner's partner is Sam." }], message: "Sam and I are going out for dinner tonight, any ideas near the city centre?", reply: reply("Here are three places near the centre."),
    expect: "No second memory about Sam.", check: rows => mentions(rows, /Sam/).length === 1 },
  { id: "respect-owner-written", memories: [{ id: "m-short", kind: "preference", body: "Keep replies short.", source: "manual" }], message: "Give me more detail than usual today, I have time to read.", reply: reply("Sure, here's a fuller answer."),
    expect: "The owner's own preference is untouched and no permanent long-replies rule appears.", check: rows => rows.find(row => row.id === "m-short")?.body === "Keep replies short." && rows.find(row => row.id === "m-short")?.review_status === "active" && !active(added(rows)).some(row => /detail|long/i.test(row.body) && !row.expires_at) },
  { id: "ignore-assistant-ideas", message: "What should I name the new puppy?", reply: reply("How about Biscuit, Maple or Juno?"),
    expect: "The assistant's suggestions are not saved as facts.", check: rows => mentions(rows, /Biscuit|Maple|Juno/).length === 0 },
  { id: "skip-snapshot-goal", snapshot: "Goals:\n- Run a half marathon in May 2027", message: "Help me plan this week's training runs for the half marathon.", reply: reply("Here's a plan for this week."),
    expect: "Does not duplicate the goal already in the snapshot.", check: rows => mentions(rows, /half marathon/i).length === 0 },
  { id: "respect-declined", memories: [{ id: "m-bp", body: "Owner has high blood pressure.", status: "archived", forgottenAt: "2026-10-18T09:00:00Z" }], message: "Blood pressure was high again at the pharmacy today, so nothing too salty for dinner please.", reply: reply("Here are some low-salt dinner ideas."),
    expect: "Does not propose the declined blood pressure memory again.", check: rows => rows.length === 1 },
  { id: "save-name-correction", message: "Please call me Kier, not Kieran.", reply: reply("Will do, Kier."),
    expect: "Saves that the owner wants to be called Kier.", check: rows => active(rows).some(row => /\bKier\b/.test(row.body)) },
];

const selected = only.length ? scenarios.filter(scenario => only.includes(scenario.id)) : scenarios;
const results = [];
for (const scenario of selected) {
  for (let iteration = 0; iteration < repeat; iteration++) {
    const { raw, db, rows } = database(scenario.memories);
    let error = null;
    try {
      await rememberFromTurn(db, model, { ownerId: "owner", turnId: `eval-${scenario.id}-${iteration}`, ownerMessage: scenario.message, replyText: scenario.reply, ownerSnapshot: scenario.snapshot, now: NOW }, AbortSignal.timeout(60_000));
    } catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    const saved = rows();
    const passed = !error && scenario.check(saved);
    results.push({ id: scenario.id, iteration, passed, error, rows: saved.map(({ memory_kind, body, source_kind, review_status, importance, expires_at }) => ({ memory_kind, body, source_kind, review_status, importance, expires_at })) });
    raw.close();
    console.log(`${passed ? "PASS" : "FAIL"} ${scenario.id}#${iteration}${error ? ` (${error})` : ""}`);
    if (budget.summary().stopped) break;
  }
  if (budget.summary().stopped) break;
}

const passed = results.filter(result => result.passed).length;
const cost = budget.summary();
const lines = [
  "# ME3 memory extraction eval", "",
  `Model: ${modelChoice}; repeat: ${repeat}; ${passed}/${results.length} passed; spent about $${cost.chargedUsd.toFixed(4)} of $${maxCostUsd}.`, "",
  "Synthetic owner messages on fresh migrated SQLite; one real extraction call per run; deterministic checks on saved rows.", "",
  "| Scenario | Pass | Expectation | Saved (last run) |", "| --- | ---: | --- | --- |",
  ...selected.map(scenario => {
    const runs = results.filter(result => result.id === scenario.id);
    const last = runs.at(-1);
    const saved = last?.rows.map(row => `${row.review_status}${row.expires_at ? " (expires)" : ""}: ${row.body}`).join("<br>") || "nothing";
    return `| ${scenario.id} | ${runs.filter(run => run.passed).length}/${runs.length} | ${scenario.expect} | ${saved.replace(/\|/g, "\\|")} |`;
  }),
];
if (reportPath) {
  mkdirSync(dirname(resolve(reportPath)), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({ model: modelChoice, repeat, passed, total: results.length, cost, results }, null, 2));
  writeFileSync(reportPath.replace(/\.json$/, ".md"), `${lines.join("\n")}\n`);
}
console.log(`${passed}/${results.length} passed; $${cost.chargedUsd.toFixed(4)} spent`);
