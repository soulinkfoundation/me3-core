import assert from "node:assert/strict";
import { test } from "node:test";
import { coalesceAgentStreamEvents } from "../src/stream.ts";

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("the first token goes out at once and the rest of the burst as one delta", async () => {
  const sent: Array<[string, Record<string, unknown>]> = [];
  const stream = coalesceAgentStreamEvents(async (event, data) => { sent.push([event, data]); }, 30);
  await stream.push({ event: "delta", data: { text: "Hel", source: "model" } });
  await stream.push({ event: "delta", data: { text: "lo", source: "model" } });
  await stream.push({ event: "delta", data: { text: " there", source: "model" } });
  assert.deepEqual(sent, [["delta", { text: "Hel", source: "model" }]]);
  await wait(45);
  assert.deepEqual(sent, [["delta", { text: "Hel", source: "model" }], ["delta", { text: "lo there", source: "model" }]]);
  await stream.flush();
  assert.equal(sent.length, 2);
});

test("other events flush the buffered text first so the persisted order holds", async () => {
  const sent: string[] = [];
  const stream = coalesceAgentStreamEvents(async (event, data) => { sent.push(event === "delta" ? `delta:${data.text}` : event); }, 1000);
  await stream.push({ event: "delta", data: { text: "a", source: "model" } });
  await stream.push({ event: "delta", data: { text: "b", source: "model" } });
  await stream.push({ event: "tool", data: { state: "running" } });
  await stream.push({ event: "delta", data: { text: "Done.", source: "runtime" } });
  await stream.flush();
  assert.deepEqual(sent, ["delta:a", "delta:b", "tool", "delta:Done."]);
});

test("flush delivers text buffered when the turn ends", async () => {
  const sent: string[] = [];
  const stream = coalesceAgentStreamEvents(async (_event, data) => { sent.push(String(data.text)); }, 1000);
  await stream.push({ event: "delta", data: { text: "x", source: "model" } });
  await stream.push({ event: "delta", data: { text: "y", source: "model" } });
  await stream.flush();
  assert.deepEqual(sent, ["x", "y"]);
});

test("a failed write surfaces instead of being lost in the timer", async () => {
  let calls = 0;
  const stream = coalesceAgentStreamEvents(async () => { if (++calls === 2) throw new Error("D1 unavailable"); }, 10);
  await stream.push({ event: "delta", data: { text: "a", source: "model" } });
  await stream.push({ event: "delta", data: { text: "b", source: "model" } });
  await wait(25);
  await assert.rejects(() => stream.push({ event: "delta", data: { text: "c", source: "model" } }), /D1 unavailable/);
  await assert.rejects(() => stream.flush(), /D1 unavailable/);
});
