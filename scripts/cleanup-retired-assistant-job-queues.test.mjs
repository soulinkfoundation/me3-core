import assert from "node:assert/strict";
import test from "node:test";
import { deleteRetiredAssistantJobQueues } from "./decommission-managed-install.mjs";

const workerName = "me3-mi-1234567890abcdef";
const queueNames = [`${workerName}-assistant-job-events`, `${workerName}-assistant-job-events-dlq`];
const input = { accountId: "a".repeat(32), apiToken: "cloudflare-token", workerName, releaseTag: "v0.1.214" };

test("deletes only the two detached retired queues and verifies absence on retry", async () => {
  const fake = fixture();
  const result = await deleteRetiredAssistantJobQueues(input, { request: fake.request });
  assert.equal(result.ok, true);
  assert.equal(fake.queues.size, 0);
  assert.deepEqual(fake.calls.filter(call => call.method === "DELETE").map(call => call.path.split("/").at(-1)), ["legacy-0", "legacy-1"]);
  const repeated = await deleteRetiredAssistantJobQueues(input, { request: fake.request });
  assert.equal(repeated.ok, true);
  assert.equal(repeated.deletedCount, 0);
});

test("removes the exact managed consumer left behind by Wrangler before deleting its retired queue", async () => {
  const fake = fixture();
  const queue = fake.queues.get(queueNames[0]);
  queue.consumers = [{ consumer_id: "old-consumer", type: "worker", script_name: workerName }];
  queue.consumers_total_count = 1;
  await deleteRetiredAssistantJobQueues(input, { request: fake.request, pause: async () => {}, queueDetachMaxAttempts: 1 });
  assert.equal(fake.queues.size, 0);
  const consumerDelete = fake.calls.findIndex(call => call.method === "DELETE" && call.path.endsWith("/consumers/old-consumer"));
  const queueDelete = fake.calls.findIndex(call => call.method === "DELETE" && call.path.endsWith("/queues/legacy-0"));
  assert.ok(consumerDelete >= 0 && consumerDelete < queueDelete);
});

test("checks both retired queues for foreign consumers before removing any consumer", async () => {
  const fake = fixture();
  const owned = fake.queues.get(queueNames[0]);
  owned.consumers = [{ consumer_id: "old-consumer", type: "worker", script_name: workerName }];
  owned.consumers_total_count = 1;
  const foreign = fake.queues.get(queueNames[1]);
  foreign.consumers = [{ consumer_id: "foreign-consumer", type: "worker", script_name: "another-worker" }];
  foreign.consumers_total_count = 1;
  await assert.rejects(deleteRetiredAssistantJobQueues(input, { request: fake.request, pause: async () => {}, queueDetachMaxAttempts: 1 }));
  assert.equal(fake.calls.some(call => call.method === "DELETE"), false);
});

test("preserves Jobs resources for releases before their retirement", async () => {
  let requests = 0;
  const result = await deleteRetiredAssistantJobQueues({ ...input, releaseTag: "v0.1.213" }, {
    request: async () => { requests += 1; throw new Error("must not access provider"); },
  });
  assert.equal(result.deletedCount, 0);
  assert.equal(requests, 0);
});

test("refuses live bindings, incomplete evidence, and foreign Worker names before deletion", async (t) => {
  for (const condition of ["worker-binding", "worker-binding-id", "consumer", "producer", "incomplete", "foreign-worker", "invalid-release"]) {
    await t.test(condition, async () => {
      const fake = fixture();
      const queue = fake.queues.get(queueNames[0]);
      if (condition === "worker-binding") fake.bindings.push({ type: "queue", name: "ASSISTANT_JOB_EVENTS", queue_name: queueNames[0] });
      if (condition === "worker-binding-id") fake.bindings.push({ type: "queue", name: "RENAMED_ACTIVE_QUEUE", queue_id: "legacy-0" });
      if (condition === "consumer") { queue.consumers = [{ consumer_id: "foreign-consumer", type: "worker", script_name: "another-worker" }]; queue.consumers_total_count = 1; }
      if (condition === "producer") { queue.producers = [{ script: "another-worker" }]; queue.producers_total_count = 1; }
      if (condition === "incomplete") delete queue.producers;
      const contract = { ...input,
        ...(condition === "foreign-worker" ? { workerName: "unrelated-worker" } : {}),
        ...(condition === "invalid-release" ? { releaseTag: "latest" } : {}),
      };
      await assert.rejects(deleteRetiredAssistantJobQueues(contract, {
        request: fake.request, pause: async () => {}, queueDetachMaxAttempts: 1,
      }));
      assert.equal(fake.calls.some(call => call.method === "DELETE"), false);
    });
  }
});

test("does not ignore provider delete failures or trust a successful delete without absence proof", async (t) => {
  for (const behavior of ["denied", "retained", "already-missing"]) await t.test(behavior, async () => {
    const fake = fixture(behavior);
    const action = deleteRetiredAssistantJobQueues(input, { request: fake.request });
    if (behavior === "already-missing") {
      assert.equal((await action).ok, true);
      assert.equal(fake.queues.size, 0);
    } else await assert.rejects(action, behavior === "denied" ? /status 403/ : /deletion was not verified/);
  });
});

function fixture(deleteBehavior = "delete") {
  const queues = new Map(queueNames.map((queue_name, index) => [queue_name, {
    queue_name, queue_id: `legacy-${index}`, consumers: [], producers: [],
    consumers_total_count: 0, producers_total_count: 0,
  }]));
  const bindings = [];
  const calls = [];
  const request = async (value, init = {}) => {
    const url = new URL(value);
    const method = init.method || "GET";
    calls.push({ method, path: url.pathname });
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer cloudflare-token");
    if (url.pathname.endsWith(`/workers/scripts/${workerName}/settings`)) return response({ bindings });
    if (url.pathname.endsWith("/queues") && method === "GET") {
      const queue = queues.get(url.searchParams.get("name"));
      return response(queue ? [queue] : []);
    }
    const consumerMatch = /\/queues\/([^/]+)\/consumers(?:\/([^/]+))?$/.exec(url.pathname);
    if (consumerMatch) {
      const queue = [...queues.values()].find(item => item.queue_id === consumerMatch[1]);
      if (method === "GET") return response(queue.consumers);
      if (method === "DELETE") {
        queue.consumers = queue.consumers.filter(item => item.consumer_id !== consumerMatch[2]);
        queue.consumers_total_count = queue.consumers.length;
        return response(null);
      }
    }
    const queue = [...queues.values()].find(item => url.pathname.endsWith(`/queues/${item.queue_id}`));
    if (queue && method === "DELETE") {
      if (deleteBehavior === "denied") return response(null, 403);
      if (deleteBehavior !== "retained") queues.delete(queue.queue_name);
      return response(null, deleteBehavior === "already-missing" ? 404 : 200);
    }
    throw new Error(`Unexpected test request: ${method} ${url.pathname}`);
  };
  return { queues, bindings, calls, request };
}

function response(result, status = 200) {
  return new Response(JSON.stringify({ success: status === 200, result }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
