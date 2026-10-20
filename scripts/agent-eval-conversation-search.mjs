// Conversation search: facts decided in an archived chat, or too far back in the
// main chat to be in the model's window, are recovered with core_conversations_search.
const turn = (prompt) => ({ prompt, calls: [{ name: "core_conversations_search", arguments: { query: "Acme Print flyers" } }] });
const noWrites = (_seed, results) => results.every((row) => row.status !== "succeeded" || !/create|update|cancel|save|send|draft/.test(row.tool_name || ""));
const searched = (results) => results.some((row) => row.tool_name === "core_conversations_search" && row.status === "succeeded");

function addMessages(seed, threadId, rows) {
  const insert = seed.raw.prepare("INSERT INTO assistant_messages (id, owner_id, thread_id, role, content, created_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?, '{}')");
  for (const [id, role, content, at] of rows) insert.run(id, seed.ownerId, threadId, role, content, at);
}

export function createConversationSearchEvalScenarios() {
  return [
    { id: "search/archived-decision",
      setup: (seed) => {
        seed.raw.prepare("INSERT INTO assistant_threads (id, owner_id, title, status, archived_at) VALUES ('eval-archived', ?, 'Launch prep', 'archived', '2026-09-30 09:00:00')").run(seed.ownerId);
        addMessages(seed, "eval-archived", [
          ["arch-1", "user", "For the launch flyers let's go with Acme Print, they quoted 400 euro for 500 copies.", "2026-09-12 10:00:00"],
          ["arch-2", "assistant", "Noted: Acme Print for the launch flyers, 400 euro for 500 copies.", "2026-09-12 10:00:05"],
        ]);
      },
      turns: [turn("What did we decide about the launch flyers last month?")],
      rubric: "The decision lives only in an archived chat. Pass only if the reply says Acme Print and 400 euro for 500 copies, grounded in a conversation search, and changes nothing.",
      check: (seed, results, replies) => noWrites(seed, results) && searched(results) && /acme/i.test(replies.at(-1) || "") },
    { id: "search/beyond-window",
      setup: (seed) => {
        addMessages(seed, "eval-thread", [["old-1", "user", "Note for later: the venue contact for the launch is Brid at Harbour Hall, and the deposit is 250 euro.", "2026-09-01 09:00:00"]]);
        addMessages(seed, "eval-thread", Array.from({ length: 90 }, (_, i) => [`filler-${i}`, i % 2 ? "assistant" : "user", i % 2 ? `Done, item ${i} is noted.` : `Add item ${i} to my weekly list.`, `2026-10-${String(1 + Math.floor(i / 6)).padStart(2, "0")} 09:${String(i % 60).padStart(2, "0")}:00`]));
      },
      turns: [{ prompt: "Who was the venue contact for the launch again, and what was the deposit?", calls: [{ name: "core_conversations_search", arguments: { query: "venue contact deposit" } }] }],
      rubric: "The fact was said more than 60 messages ago in this chat. Pass only if the reply names Brid at Harbour Hall and a 250 euro deposit, grounded in a conversation search, and changes nothing.",
      check: (seed, results, replies) => noWrites(seed, results) && searched(results) && /harbour hall/i.test(replies.at(-1) || "") },
  ].map((scenario) => ({ ...scenario, suite: "search", evaluationKind: "candidate-quality", allowedWrites: {},
    fixtureReply: scenario.id === "search/archived-decision" ? "You chose Acme Print: 400 euro for 500 copies." : "Brid at Harbour Hall; the deposit was 250 euro." }));
}
