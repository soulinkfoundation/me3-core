import assert from "node:assert/strict";
import { test } from "node:test";
import { createRuntimeAdapter } from "./agent-eval-adapters.mjs";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";
import { createSeededEvalServices } from "./agent-eval-services.mjs";

test("normalized tool receipts retain the actual requested limit for grader verification", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-10");
  try {
    const args = { dateFrom: "2026-10-13", dateTo: "2026-10-13", durationMinutes: 30, limit: 3 };
    const response = await createRuntimeAdapter("new").runTurn({ seed, ownerId: seed.ownerId, messages: [{ role: "user", content: "Show three free half-hour slots on October 13." }], requestId: "receipt-limit", turnId: "receipt-limit", ownerTimezone: "Europe/Dublin", modelRoute: { model: "scripted-fixture" }, services: createSeededEvalServices(seed), enabledPluginIds: new Set(["me3.calendar"]), fixtureCalls: [{ name: "core_calendar_availability", arguments: args }], onEvent: async () => {} });
    assert.deepEqual(response.toolResults[0].arguments, args);
    assert.equal(JSON.parse(response.toolResults[0].result_json).result.slots.length, 3);
  } finally { seed.close(); }
});
