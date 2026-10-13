import assert from "node:assert/strict";
import { test } from "node:test";
import { captureShadow } from "./capture-fast-path-shadow.mjs";
// Failure modes: leaking credentials, losing pending/late receipts or private
// predictions, and confusing JSON-encoded D1 fields with structured values.
test("capture is read-only and keeps uncertain costs and local predictions", async () => {
  const requests = [];
  const result = await captureShadow({ accountId: "synthetic", databaseId: "synthetic", apiToken: "synthetic-secret", since: "2026-10-13T00:00:00Z", until: "2026-10-14T00:00:00Z", fetch: async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    assert.match(body.sql, /^SELECT/);
    if (body.sql.includes("FROM me3_agent_turns")) return Response.json({ success: true, result: [{ results: [{ turnId: "one", messageText: "List my reminders", fastPath: '{"models":[]}', modelSteps: "[]" }] }] });
    return Response.json({ success: true, result: [{ results: [{ turnId: "one", model: "@cf/cloudflare/clef", estimated_cost_usd: 0, metadata_json: '{"costKnown":false,"shadowRequest":{"durationMs":4000}}' }] }] });
  } });
  assert.equal(requests.length, 2); assert.deepEqual(result.turns[0].modelSteps, []);
  assert.equal(result.usageEvents[0].costUsd, null); assert.equal(result.usageEvents[0].measurement.durationMs, 4000);
  assert.equal(JSON.stringify(result).includes("synthetic-secret"), false);
});
