import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntimeAdapter } from "./agent-eval-adapters.mjs";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";
import { createSeededEvalServices } from "./agent-eval-services.mjs";

for (const invalid of ["not a number", null, -1]) {
  test(`new loop rejects invalid optional calendar duration before native mutation: ${JSON.stringify(invalid)}`, async () => {
    const seed = createSeededAgentEvalInstallation("2026-10-14");
    try {
      const before = seed.raw.prepare("SELECT * FROM user_calendar_events ORDER BY id").all();
      const prompt = "Create Invalid review on 15 October 2026 at 14:00 Europe/Dublin for 45 minutes.";
      const response = await createRuntimeAdapter("new").runTurn({ seed, ownerId: seed.ownerId, requestId: "invalid-tool-schema", turnId: "invalid-tool-schema",
        canonicalOwnerInputs: [{ turnId: "invalid-tool-schema", requestId: "invalid-tool-schema", messageText: prompt }], messages: [{ role: "user", content: prompt }],
        ownerTimezone: "Europe/Dublin", modelRoute: { model: "scripted-fixture" }, services: createSeededEvalServices(seed), enabledPluginIds: new Set(["me3.calendar"]),
        fixtureCalls: [{ name: "core_calendar_event_create", arguments: { title: "Invalid review", startDate: "2026-10-15", startTime: "14:00", startTimezone: "Europe/Dublin", durationMinutes: invalid } }],
        fixtureReply: "The invalid duration prevented creating the event." });
      seed.reopen();
      assert.deepEqual(seed.raw.prepare("SELECT * FROM user_calendar_events ORDER BY id").all(), before);
      assert.deepEqual(response.toolCalls.map(call => [call.name, call.status]), [["core_calendar_event_create", "error"]]);
      const receipts = seed.raw.prepare("SELECT * FROM me3_agent_tool_receipts WHERE tool_name='core_calendar_event_create'").all();
      if (typeof invalid !== "number") assert.equal(receipts.length, 0, "schema rejection precedes effect receipt admission");
      else {
        // Integer bounds belong to the native calendar service; its failed
        // receipt records an attempted call, while the actual event stays absent.
        assert.equal(receipts.length, 1);
        assert.equal(receipts[0].status, "finished");
        assert.equal(JSON.parse(receipts[0].result_json).status, "error");
      }
    } finally { seed.close(); }
  });
}
