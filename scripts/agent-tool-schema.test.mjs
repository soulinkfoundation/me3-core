import assert from "node:assert/strict";
import { test } from "node:test";
import { runCoreAgentToolTurn } from "../packages/agent-chat/src/core-agent-runtime.ts";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";

test("SDK tool calls reject invalid optional schema fields before writes", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-01");
  try {
    const responses = [
      { tool_calls: [{ id: "bad-create", name: "core_calendar_event_create", arguments: {
        title: "Invalid review",
        startDate: "2026-10-02",
        startTime: "14:00",
        startTimezone: "Europe/Dublin",
        durationMinutes: "not a number",
      } }] },
      { response: "Done, I created the event." },
    ];
    const response = await runCoreAgentToolTurn({
      db: seed.db,
      userId: seed.ownerId,
      requestId: "invalid-tool-schema",
      turnId: "invalid-tool-schema",
      ownerTimezone: "Europe/Dublin",
      route: { providerId: "workers-ai", model: "scripted-fixture", backupModel: null, apiKey: null, ai: { run: async () => responses.shift() }, aiGateway: null, configured: true },
      messages: [{ role: "system", content: "You are ME3." }, { role: "user", content: "Create a review." }],
      runtime: "sdk",
      installedPluginIds: new Set(["me3.calendar"]),
    });
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM user_calendar_events WHERE title = 'Invalid review'").get().n, 0);
    assert.doesNotMatch(response.replyText, /done|created the event/i);
    assert.match(response.replyText, /could not complete/i);
  } finally {
    seed.close();
  }
});
