import assert from "node:assert/strict";
import test from "node:test";
import { verifyManagedUpgradeResources } from "./verify-managed-upgrade-resources.mjs";

const installationId = "mi-1234567890abcdef";
const workerName = `me3-${installationId}`;
const queueNames = [
  `${workerName}-social-publish`,
  `${workerName}-social-publish-dlq`,
];
const input = {
  accountId: "a".repeat(32),
  apiToken: "cloudflare-token",
  attemptId: "11111111-1111-4111-8111-111111111111",
  installationId,
  workerName,
  d1Name: `${workerName}-d1`,
  d1Id: "22222222-2222-4222-8222-222222222222",
  r2Name: `${workerName}-r2`,
  queueNames,
  durableObjectNamespaceId: "b".repeat(32),
  publicOrigin: "https://owner.me3.app",
  canonicalHostname: "owner.me3.app",
  zoneId: "c".repeat(32),
};

test("proves every frozen Cloudflare identity without mutation", async () => {
  const methods = [];
  const result = await verifyManagedUpgradeResources(
    input,
    async (url, init = {}) => {
      methods.push(init.method || "GET");
      assert.equal(
        new Headers(init.headers).get("Authorization"),
        "Bearer cloudflare-token",
      );
      return cloudflareResponse(url);
    },
  );

  assert.equal(result.customDomainId, "domain-id");
  assert.equal(result.durableObjectNamespaceId, input.durableObjectNamespaceId);
  assert.deepEqual(result.queueNames, [...queueNames].sort());
  assert.deepEqual(new Set(methods), new Set(["GET"]));
});

test("only allows the two retired Jobs queues to be absent from release v0.1.214 onwards", async () => {
  const historical = { ...input, queueNames: [...queueNames,
    `${workerName}-assistant-job-events`, `${workerName}-assistant-job-events-dlq`] };
  const missingJobs = async (value) => {
    const url = new URL(value);
    if (url.pathname.endsWith("/queues") && url.searchParams.get("name").includes("assistant-job-events")) return apiResponse([]);
    return cloudflareResponse(value);
  };
  const result = await verifyManagedUpgradeResources({ ...historical, releaseTag: "v0.1.214" }, missingJobs);
  assert.equal(result.ok, true);
  assert.deepEqual(result.queueNames, [...historical.queueNames].sort());
  await assert.rejects(verifyManagedUpgradeResources({ ...historical, releaseTag: "v0.1.213" }, missingJobs), /queue identity does not match/);
  await assert.rejects(verifyManagedUpgradeResources({ ...historical, releaseTag: "v0.1.214" }, async (value) => {
    const url = new URL(value);
    if (url.pathname.endsWith("/queues") && url.searchParams.get("name").endsWith("social-publish")) return apiResponse([]);
    return missingJobs(value);
  }), /queue identity does not match/);
});

test("rejects a canonical hostname assigned to another Worker", async () => {
  await assert.rejects(
    verifyManagedUpgradeResources(input, async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/workers/domains")) {
        return apiResponse([
          {
            id: "domain-id",
            hostname: "owner.me3.app",
            service: "another-worker",
            zone_id: input.zoneId,
          },
        ]);
      }
      return cloudflareResponse(url);
    }),
    /custom domain identity does not match/,
  );
});

function cloudflareResponse(value) {
  const url = new URL(value);
  if (url.pathname.endsWith(`/workers/scripts/${workerName}`)) {
    return new Response("worker", { status: 200 });
  }
  if (url.pathname.includes("/d1/database/")) {
    return apiResponse({ uuid: input.d1Id, name: input.d1Name });
  }
  if (url.pathname.includes("/r2/buckets/")) {
    return apiResponse({ name: input.r2Name });
  }
  if (url.pathname.endsWith("/queues")) {
    return apiResponse([{ queue_name: url.searchParams.get("name") }]);
  }
  if (url.pathname.endsWith("/durable_objects/namespaces")) {
    return apiResponse([
      {
        id: input.durableObjectNamespaceId,
        script: workerName,
        class: "Me3UserAgent",
      },
    ]);
  }
  if (url.pathname.endsWith("/workers/domains")) {
    return apiResponse([
      {
        id: "domain-id",
        hostname: input.canonicalHostname,
        service: workerName,
        zone_id: input.zoneId,
      },
    ]);
  }
  return new Response(null, { status: 404 });
}

function apiResponse(result) {
  return new Response(JSON.stringify({ success: true, result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
