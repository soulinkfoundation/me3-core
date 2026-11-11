import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntimeAdapter } from "./agent-eval-adapters.mjs";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";
import { createSeededEvalServices } from "./agent-eval-services.mjs";

const plugins = new Set(["me3.social-publishing", "me3.journal", "me3.mission-control"]);
const tables = ["social_packages", "social_variants", "social_publications"];
const snapshot = seed => tables.map(table => seed.raw.prepare(`SELECT * FROM ${table} ORDER BY id`).all());
async function turn(seed, id, prompt, calls, options = {}) {
  return createRuntimeAdapter("new").runTurn({ seed, ownerId: seed.ownerId, turnId: id, requestId: id,
    messages: [{ role: "user", content: prompt }], canonicalOwnerInputs: [{ turnId: id, requestId: id, messageText: prompt }],
    ownerTimezone: "Europe/Dublin", enabledPluginIds: plugins, services: createSeededEvalServices(seed), modelRoute: { model: "scripted-fixture" },
    fixtureCalls: calls, fixtureReply: "The saved results are ready for review; nothing was published.", ...options });
}

// ME3 never writes the owner's social posts (me3-9t6b.4): the generating tools are gone.
test("retired social writing tools cannot run and write nothing", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-14");
  try {
    const before = snapshot(seed);
    for (const name of ["core_social_draft_create", "core_social_suggestions_create", "core_social_source_read", "core_social_posting_plan_create"]) {
      const response = await turn(seed, `retired-${name}`, "Write me a post from my journal.", [{ name, arguments: { sourceType: "journal", sourceId: "eval-journal" } }]);
      assert.ok(response.toolCalls.every(call => call.status !== "ok"), name);
    }
    seed.reopen(); assert.deepEqual(snapshot(seed), before);
  } finally { seed.close(); }
});

test("a draft from the owner's message keeps their words and fits each platform", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-14");
  const message = "Turn this into a post: We're opening the studio on Saturday 8 Nov, 10 till 4. Coffee, the autumn work on the walls, and free design reviews. Come and say hello, bring a friend, and stay as long as you like because there will be plenty of coffee and the kettle is always on, plus a few surprises we have been saving all year for the people who make this studio what it is.";
  const text = message.replace("Turn this into a post: ", "");
  try {
    const ok = await turn(seed, "from-message", message, [{ name: "core_social_draft_from_message", arguments: { text, platforms: ["x", "linkedin"] } }]);
    assert.ok(ok.toolCalls.every(call => call.status === "ok"));
    seed.reopen();
    const versions = seed.raw.prepare("SELECT platform, body_text, approval_status FROM social_variants ORDER BY platform").all();
    assert.deepEqual(versions.map(row => row.platform), ["linkedin", "x"]);
    assert.equal(versions[0].body_text, text);
    assert.ok(versions[1].body_text.length <= 280 && text.startsWith(versions[1].body_text.replace(/…$/, "").trim()));
    assert.ok(versions.every(row => row.approval_status === "draft"));
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM social_publications").get().n, 0);

    const before = snapshot(seed);
    const invented = await turn(seed, "from-nothing", "Post something about productivity.", [{ name: "core_social_draft_from_message", arguments: { text: "Productivity is a habit, not a hack.", platforms: ["x"] } }]);
    assert.ok(invented.toolCalls.some(call => call.status === "error"));
    seed.reopen(); assert.deepEqual(snapshot(seed), before);
  } finally { seed.close(); }
});

test("the social nudge is due at most weekly, only when little is scheduled, and can be switched off", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-14");
  try {
    const first = await turn(seed, "nudge-1", "How's my social looking?", [{ name: "core_social_queue_read", arguments: { recordNudge: true } }]);
    const nudge = (response) => JSON.parse(response.toolResults[0].result_json).result.nudge;
    assert.equal(nudge(first).due, true);
    const second = await turn(seed, "nudge-2", "And now?", [{ name: "core_social_queue_read", arguments: { recordNudge: true } }]);
    assert.equal(nudge(second).due, false);
    const off = await turn(seed, "nudge-off", "Stop nudging me about social.", [{ name: "core_social_nudges_set", arguments: { on: false } }]);
    assert.equal(off.toolCalls[0].status, "ok");
  } finally { seed.close(); }
});
