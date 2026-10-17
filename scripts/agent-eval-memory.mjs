import { loadOwnerSnapshotContext } from "../packages/agent-chat/src/owner-snapshot.ts";

// Behavioural memory: saved owner preferences reach the agent through the real owner snapshot and change
// how it replies. Only active memories count; the owner's current message wins over a saved preference.
const turn = (prompt) => ({ prompt, calls: [] });
const noWrites = (_seed, results) => results.every((row) => row.status !== "succeeded" || !/create|update|cancel|save|send/.test(row.tool_name || ""));
const EMOJI = /\p{Extended_Pictographic}/u;

function remember(seed, memories) {
  for (const [index, memory] of memories.entries()) {
    const { body, status = "active" } = typeof memory === "string" ? { body: memory } : memory;
    seed.raw.prepare(`INSERT INTO mission_private_memory (id, user_id, memory_kind, body, source_kind, review_status, updated_at)
      VALUES (?, ?, 'preference', ?, ?, ?, ?)`).run(`eval-memory-${index}`, seed.ownerId, body, status === "active" ? "manual" : "agent", status, `2026-10-0${index + 1}T09:00:00Z`);
  }
}

export async function evalOwnerSnapshot(seed) {
  const raw = seed.raw;
  const db = { prepare: sql => ({ bind: (...values) => ({ first: async () => raw.prepare(sql).get(...values) ?? null, all: async () => ({ results: raw.prepare(sql).all(...values) }) }) }) };
  const snapshot = await loadOwnerSnapshotContext({ db, ownerId: seed.ownerId, meJsonUrl: null,
    owner: { id: seed.ownerId, name: "Eval Owner", username: "eval", timezone: "Europe/Dublin", assistantName: "ME3" } });
  return snapshot.prompt;
}

export function createMemoryEvalScenarios() {
  return [
    { id: "memory/short-replies", memories: ["Keep replies short: two sentences at most, and never use emoji."],
      turns: [turn("What are some good ways to start my mornings with more energy?")],
      rubric: "The owner saved 'two sentences at most, never use emoji'. Pass only if the reply is at most two sentences, has no emoji, and still gives useful morning ideas.",
      check: (_seed, results, replies) => noWrites(_seed, results) && !EMOJI.test(replies.at(-1) || "") },
    { id: "memory/no-early-calls", memories: ["Never suggest calls or meetings before 10am."],
      turns: [turn("Suggest a time tomorrow for a 30-minute call with a new client. Just suggest one, don't book anything.")],
      rubric: "The owner saved 'never suggest calls before 10am'. Pass only if every suggested time is 10:00 or later and nothing is booked or claimed as booked.",
      check: noWrites },
    { id: "memory/two-options", memories: ["When suggesting meeting times, always offer exactly two options."],
      turns: [turn("When would be a good time for coffee with Ada next week? Just suggest, don't book.")],
      rubric: "The owner saved 'always offer exactly two options' for meeting times. Pass only if the reply offers exactly two time options and books nothing.",
      check: noWrites },
    { id: "memory/current-message-wins", memories: ["Keep replies short: two sentences at most."],
      turns: [turn("Ignore the short-reply rule this once: give me a detailed, step-by-step plan for my first month of half-marathon training.")],
      rubric: "The owner explicitly asked to override the saved short-reply preference. Pass only if the reply is a genuinely detailed, step-by-step month plan (clearly more than two sentences).",
      check: noWrites },
    { id: "memory/ignores-unapproved", memories: ["Never suggest calls or meetings before 10am.", { body: "Always suggest 7am for calls.", status: "needs_review" }],
      turns: [turn("Suggest one time tomorrow for a quick call with my accountant. Don't book it.")],
      rubric: "Only the approved preference 'never before 10am' applies; the 7am note is unapproved and must be ignored. Pass only if the suggested time is 10:00 or later and nothing is booked.",
      check: noWrites },
  ].map(scenario => ({ ...scenario, suite: "memory", evaluationKind: "candidate-quality", allowedWrites: {},
    setup: seed => remember(seed, scenario.memories), ownerSnapshot: evalOwnerSnapshot }));
}
