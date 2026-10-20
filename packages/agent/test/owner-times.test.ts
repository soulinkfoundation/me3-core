import assert from "node:assert/strict";
import { test } from "node:test";
import { withOwnerLocalTimes, withOwnerLocalToolTimes } from "../src/owner-times.ts";

test("adds owner-local siblings for UTC instants at any depth", () => {
  const output = withOwnerLocalTimes({ status: "ok", data: { reminders: [{ id: "r1", remindAt: "2026-10-16T08:00:00.000Z" }], event: { startsAt: "2026-12-01T09:00Z" } } }, "Europe/Dublin");
  assert.equal(output.data.reminders[0].remindAtLocal, "Fri, 16 Oct 2026, 09:00 GMT+1");
  assert.equal((output.data.event as Record<string, unknown>).startsAtLocal, "Tue, 1 Dec 2026, 09:00 GMT");
  assert.equal(output.data.reminders[0].remindAt, "2026-10-16T08:00:00.000Z");
});

test("leaves dates, plain text, existing local fields and bad zones alone", () => {
  const input = { date: "2026-10-16", title: "2026-10-16T08:00Z is in the title", startsAt: "2026-10-16T08:00Z", startsAtLocal: "kept" };
  const output = withOwnerLocalTimes(input, "Europe/Dublin");
  assert.deepEqual(Object.keys(output).sort(), ["date", "startsAt", "startsAtLocal", "title"]);
  assert.equal(output.startsAtLocal, "kept");
  assert.equal(withOwnerLocalTimes(input, "Not/AZone"), input);
});

test("localizes only the model's copy of tool messages", () => {
  const saved = [{ role: "user" as const, content: "2026-10-16T08:00Z" }, { role: "tool" as const, toolCallId: "a", content: '{"status":"ok","data":{"remindAt":"2026-10-16T08:00Z"}}' }, { role: "tool" as const, toolCallId: "b", content: "not json" }];
  const copy = withOwnerLocalToolTimes(saved, "Europe/Dublin");
  assert.equal(JSON.parse(copy[1].content).data.remindAtLocal, "Fri, 16 Oct 2026, 09:00 GMT+1");
  assert.equal(copy[0], saved[0]);
  assert.equal(copy[2], saved[2]);
  assert.equal(saved[1].content, '{"status":"ok","data":{"remindAt":"2026-10-16T08:00Z"}}');
});
