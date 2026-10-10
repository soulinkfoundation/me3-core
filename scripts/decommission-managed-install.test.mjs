import assert from "node:assert/strict";
import test from "node:test";
import {
  decommissionManagedInstall,
  MANAGED_DECOMMISSION_TOMBSTONE_SOURCE,
  managedDecommissionTombstoneDeployArgs,
  managedDecommissionTombstoneMessage,
  managedDecommissionTombstoneTag,
  orderedDedicatedQueueNames,
} from "./decommission-managed-install.mjs";

const ACCOUNT_ID = "a".repeat(32);
const INSTALLATION_ID = "mi-1234567890abcdef";
const WORKER_NAME = `me3-${INSTALLATION_ID}`;
const EXPORT_OPERATION_ID = "11111111-1111-4111-8111-111111111111";
const OPERATION_ID = "22222222-2222-4222-8222-222222222222";
const D1_ID = "33333333-3333-4333-8333-333333333333";
const DO_ID = "d".repeat(32);
const MD5 = "b".repeat(32);
const SHA256 = "c".repeat(64);
const DEDICATED_QUEUE = `${WORKER_NAME}-assistant-job-events`;
const SHARED_QUEUE = "me3-booking-reminders";
const DEPLOYMENT_ID = "44444444-4444-4444-8444-444444444444";
const VERSION_ID = "55555555-5555-4555-8555-555555555555";

test("the transitional tombstone retries rather than acknowledges late Queue batches", () => {
  assert.match(MANAGED_DECOMMISSION_TOMBSTONE_SOURCE, /queue\(batch\)/);
  assert.match(MANAGED_DECOMMISSION_TOMBSTONE_SOURCE, /batch\.retryAll\(\)/);
  assert.doesNotMatch(MANAGED_DECOMMISSION_TOMBSTONE_SOURCE, /\back(?:All)?\s*\(/);
  assert.ok(managedDecommissionTombstoneTag(OPERATION_ID).length <= 64);
  assert.ok(managedDecommissionTombstoneMessage(OPERATION_ID).length <= 120);
  assert.deepEqual(
    managedDecommissionTombstoneDeployArgs("/tmp/wrangler.toml", OPERATION_ID),
    [
      "exec",
      "wrangler",
      "deploy",
      "--config",
      "/tmp/wrangler.toml",
      "--strict",
      "--no-bundle",
      "--tag",
      managedDecommissionTombstoneTag(OPERATION_ID),
      "--message",
      managedDecommissionTombstoneMessage(OPERATION_ID),
    ],
  );
  assert.equal(
    managedDecommissionTombstoneDeployArgs(
      "/tmp/wrangler.toml",
      OPERATION_ID,
      { strict: false },
    ).includes("--strict"),
    false,
  );
});

test("removes Worker producer bindings before queue deletion and retries safely after Cloudflare 400", async () => {
  const fake = createCloudflareFixture();
  const stages = [];
  let tombstones = 0;
  let tombstoneCallIndex = -1;
  const blockedQueueDelete = await fake.request(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/queues/dedicated-id`,
    { method: "DELETE" },
  );
  assert.equal(blockedQueueDelete.status, 400);
  assert.equal(fake.state.queues.has(DEDICATED_QUEUE), true);
  const runStart = fake.calls.length;
  const options = {
    request: fake.request,
    reportStage: async (stage) => stages.push(stage),
    deployTombstone: async ({ workerName, operationId, deleteDurableObject }) => {
      tombstones += 1;
      assert.equal(workerName, WORKER_NAME);
      assert.equal(operationId, OPERATION_ID);
      assert.equal(deleteDurableObject, true);
      tombstoneCallIndex = fake.calls.length;
      fake.state.producerBindings.clear();
      fake.state.namespaces = [];
    },
  };

  const first = await decommissionManagedInstall(contract(), options);
  assert.equal(first.ok, true);
  assert.equal(first.exportWaived, false);
  assert.deepEqual(stages, [
    "deleting_r2",
    "removing_consumers",
    "deleting_queues",
    "deleting_worker",
    "deleting_d1",
    "verifying_absence",
  ]);
  assert.equal(tombstones, 1);
  assert.equal(fake.state.worker, false);
  assert.equal(fake.state.d1, null);
  assert.equal(fake.state.r2, null);
  assert.equal(fake.state.queues.has(DEDICATED_QUEUE), false);
  const r2DeleteIndex = fake.calls.findIndex(
    ({ method, path }, index) =>
      index >= runStart && method === "DELETE" && path.includes("/r2/buckets/"),
  );
  const queueDeleteIndex = fake.calls.findIndex(
    ({ method, path }, index) =>
      index >= runStart && method === "DELETE" && path.endsWith("/queues/dedicated-id"),
  );
  const workerDeleteIndex = fake.calls.findIndex(
    ({ method, path }, index) =>
      index >= runStart &&
      method === "DELETE" &&
      path.endsWith(`/workers/services/${WORKER_NAME}?force=false`),
  );
  assert.ok(r2DeleteIndex < tombstoneCallIndex);
  assert.ok(tombstoneCallIndex < workerDeleteIndex);
  assert.ok(workerDeleteIndex < queueDeleteIndex);
  assert.deepEqual(
    fake.state.queues.get(SHARED_QUEUE).consumers.map(fixtureConsumerName),
    ["unrelated-worker"],
  );
  assert.equal(
    fake.calls.some(
      ({ method, path }) =>
        method === "DELETE" && path.endsWith("/consumers/shared-managed-consumer"),
    ),
    true,
  );
  assert.equal(
    fake.calls.some(
      ({ method, path }) =>
        method === "DELETE" && path.endsWith("/consumers/shared-unrelated-consumer"),
    ),
    false,
  );

  stages.length = 0;
  const retried = await decommissionManagedInstall(contract(), options);
  assert.equal(retried.ok, true);
  assert.equal(tombstones, 1);
  assert.equal(stages.at(-1), "verifying_absence");
});

test("decommission deletes the SDK Durable Object namespace too", async () => {
  const fake = createCloudflareFixture();
  fake.state.namespaces.push({ id: "e".repeat(32), script: WORKER_NAME, class: "Me3SdkUserAgent" });
  let deletedSdk = false;
  await decommissionManagedInstall(contract(), {
    request: fake.request,
    reportStage: async () => {},
    deployTombstone: async ({ deleteDurableObject, deleteSdkDurableObject }) => {
      assert.equal(deleteDurableObject, true);
      deletedSdk = deleteSdkDurableObject;
      fake.state.producerBindings.clear();
      fake.state.namespaces = [];
    },
  });
  assert.equal(deletedSdk, true);
});

test("decommission deletes the new agent namespace and verifies it before deleting D1", async () => {
  for (const keepAgent of [false, true]) {
    const fake = createCloudflareFixture();
    const agentNamespace = { id: "f".repeat(32), script: WORKER_NAME, class: "Me3Agent" };
    fake.state.namespaces.push(agentNamespace);
    let deletedAgent = false;
    const run = decommissionManagedInstall(contract(), {
      request: fake.request,
      reportStage: async () => {},
      deployTombstone: async ({ deleteAgentDurableObject }) => {
        deletedAgent = deleteAgentDurableObject;
        fake.state.producerBindings.clear();
        fake.state.namespaces = keepAgent ? [agentNamespace] : [];
      },
    });
    if (keepAgent) {
      await assert.rejects(run, /Durable Object namespace deletion was not verified/);
      assert.notEqual(fake.state.d1, null);
    } else {
      assert.equal((await run).ok, true);
    }
    assert.equal(deletedAgent, true);
  }
});

test("detaches and verifies the permanent custom domain before Worker deletion", async () => {
  const fake = createCloudflareFixture();
  let domain = {
    id: "managed-domain-id",
    hostname: "owner.me3.app",
    service: WORKER_NAME,
  };
  const domainCalls = [];
  const request = async (url, init = {}) => {
    const parsed = new URL(url);
    const resource = parsed.pathname.replace(
      `/client/v4/accounts/${ACCOUNT_ID}`,
      "",
    );
    const method = init.method || "GET";
    if (resource === "/workers/domains" && method === "GET") {
      domainCalls.push({ method, resource });
      return success(domain ? [domain] : []);
    }
    if (resource === "/workers/domains/managed-domain-id" && method === "DELETE") {
      domainCalls.push({ method, resource });
      domain = null;
      return success(null);
    }
    return fake.request(url, init);
  };
  const input = waivedContract();
  input.publicOrigin = "https://owner.me3.app";

  await decommissionManagedInstall(input, {
    request,
    deployTombstone: async () => {
      fake.state.producerBindings.clear();
      fake.state.namespaces = [];
    },
  });

  assert.equal(domain, null);
  assert.equal(
    domainCalls.some(
      (call) =>
        call.method === "DELETE" &&
        call.resource === "/workers/domains/managed-domain-id",
    ),
    true,
  );
});

test("decommissions without S3 evidence only after persisted purge proof and verified REST absence", async () => {
  const fake = createCloudflareFixture();
  const stages = [];
  const result = await decommissionManagedInstall(waivedContract(), {
    request: fake.request,
    reportStage: async (stage) => stages.push(stage),
    deployTombstone: async ({ workerName, operationId, deleteDurableObject }) => {
      assert.equal(workerName, WORKER_NAME);
      assert.equal(operationId, OPERATION_ID);
      assert.equal(deleteDurableObject, true);
      fake.state.producerBindings.clear();
      fake.state.namespaces = [];
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.exportWaived, true);
  assert.deepEqual(stages, [
    "deleting_r2",
    "removing_consumers",
    "deleting_queues",
    "deleting_worker",
    "deleting_d1",
    "verifying_absence",
  ]);
  assert.equal(fake.state.worker, false);
  assert.equal(fake.state.d1, null);
  assert.equal(fake.state.r2, null);
  assert.equal(fake.state.queues.has(DEDICATED_QUEUE), false);
  assert.deepEqual(
    fake.state.queues.get(SHARED_QUEUE).consumers.map(fixtureConsumerName),
    ["unrelated-worker"],
  );
  const runtimeProofIndex = fake.calls.findIndex(({ path }) =>
    path.includes(`/d1/database/${D1_ID}/query`),
  );
  const r2DeleteIndex = fake.calls.findIndex(
    ({ method, path }) => method === "DELETE" && path.includes("/r2/buckets/"),
  );
  const r2AbsenceIndex = fake.calls.findIndex(
    ({ method, path }, index) =>
      index > r2DeleteIndex && method === "GET" && path.includes("/r2/buckets/"),
  );
  const firstLaterDeleteIndex = fake.calls.findIndex(
    ({ method, path }, index) =>
      index > r2DeleteIndex && method === "DELETE" && !path.includes("/r2/buckets/"),
  );
  assert.notEqual(runtimeProofIndex, -1);
  assert.ok(runtimeProofIndex < r2DeleteIndex);
  assert.ok(r2DeleteIndex < r2AbsenceIndex);
  assert.ok(r2AbsenceIndex < firstLaterDeleteIndex);
});

test("uses guarded force only for a stale Queue-consumer delete conflict", async () => {
  const fake = createCloudflareFixture();
  fake.state.rejectNonForceWorkerDelete = true;
  fake.state.retainProducerBindingOnPatch = true;
  fake.state.namespaces = [];
  fake.state.workerBindings = [{ name: "JWT_SECRET", type: "secret_text" }];

  const result = await decommissionManagedInstall(waivedContract(), {
    request: fake.request,
    deployTombstone: async ({ allowApiUpdatedWorker }) => {
      assert.equal(allowApiUpdatedWorker, true);
      fake.state.namespaces = [];
    },
  });

  assert.equal(result.ok, true);
  assert.equal(fake.state.worker, false);
  const workerDeletes = fake.calls.filter(
    ({ method, path }) => method === "DELETE" && path.includes("/workers/services/"),
  );
  assert.deepEqual(
    workerDeletes.map(({ path }) => new URL(`https://example.test${path}`).searchParams.get("force")),
    ["false", "true"],
  );
});

test("refuses guarded force when the Worker has an external dependency", async () => {
  const fake = createCloudflareFixture();
  fake.state.rejectNonForceWorkerDelete = true;
  fake.state.references.services.incoming.push({ script: "dependent-worker" });

  await assert.rejects(
    decommissionManagedInstall(waivedContract(), {
      request: fake.request,
      deployTombstone: async () => {
        fake.state.producerBindings.clear();
        fake.state.namespaces = [];
      },
    }),
    /guarded Worker force-delete found an external dependency/,
  );
  assert.equal(fake.state.worker, true);
  assert.notEqual(fake.state.d1, null);
  assert.equal(
    fake.calls.some(
      ({ method, path }) =>
        method === "DELETE" &&
        path.includes("/workers/services/") &&
        new URL(`https://example.test${path}`).searchParams.get("force") === "true",
    ),
    false,
  );
});

test("refuses guarded force when Cloudflare returns any error besides the exact stale-consumer code", async () => {
  const fake = createCloudflareFixture();
  fake.state.rejectNonForceWorkerDelete = true;
  fake.state.nonForceWorkerDeleteErrorCodes = [10064, 99999];
  let tombstones = 0;

  await assert.rejects(
    decommissionManagedInstall(waivedContract(), {
      request: fake.request,
      deployTombstone: async () => {
        tombstones += 1;
        fake.state.producerBindings.clear();
        fake.state.namespaces = [];
      },
    }),
    /Cloudflare resource operation failed with status 403/,
  );
  assert.equal(fake.state.worker, true);
  assert.equal(tombstones, 1);
  assert.equal(workerForceDeletes(fake).length, 0);
});

test("refuses guarded force when the pinned tombstone identity changes during preflight", async () => {
  const fake = createCloudflareFixture();
  fake.state.rejectNonForceWorkerDelete = true;
  fake.state.driftDeploymentOnSecondRead = true;

  await assert.rejects(
    decommissionManagedInstall(waivedContract(), {
      request: fake.request,
      deployTombstone: async () => {
        fake.state.producerBindings.clear();
        fake.state.namespaces = [];
      },
    }),
    /tombstone identity changed during preflight/,
  );
  assert.equal(fake.state.worker, true);
  assert.equal(workerForceDeletes(fake).length, 0);
});

test("accepts omitted optional dependency categories as empty", async () => {
  const fake = createCloudflareFixture();
  fake.state.rejectNonForceWorkerDelete = true;
  fake.state.references = {};

  const result = await decommissionManagedInstall(waivedContract(), {
    request: fake.request,
    deployTombstone: async () => {
      fake.state.producerBindings.clear();
      fake.state.namespaces = [];
    },
  });
  assert.equal(result.ok, true);
  assert.equal(fake.state.worker, false);
  assert.equal(workerForceDeletes(fake).length, 1);
});

test("refuses malformed present dependency categories", async () => {
  const fake = createCloudflareFixture();
  fake.state.rejectNonForceWorkerDelete = true;
  fake.state.references.services.incoming = null;

  await assert.rejects(
    decommissionManagedInstall(waivedContract(), {
      request: fake.request,
      deployTombstone: async () => {
        fake.state.producerBindings.clear();
        fake.state.namespaces = [];
      },
    }),
    /dependency evidence is incomplete/,
  );
  assert.equal(fake.state.worker, true);
  assert.equal(workerForceDeletes(fake).length, 0);
});

test("refuses guarded force when an owned Queue has an event subscription", async () => {
  const fake = createCloudflareFixture();
  fake.state.rejectNonForceWorkerDelete = true;
  fake.state.eventSubscriptions = [
    {
      id: "event-subscription-id",
      destination: { type: "queues.queue", queue_id: "dedicated-id" },
    },
  ];

  await assert.rejects(
    decommissionManagedInstall(waivedContract(), {
      request: fake.request,
      deployTombstone: async () => {
        fake.state.producerBindings.clear();
        fake.state.namespaces = [];
      },
    }),
    /found an event subscription/,
  );
  assert.equal(fake.state.worker, true);
  assert.equal(workerForceDeletes(fake).length, 0);
});

test("ignores a validated event subscription for an unrelated Queue", async () => {
  const fake = createCloudflareFixture();
  fake.state.rejectNonForceWorkerDelete = true;
  fake.state.eventSubscriptions = [
    {
      id: "unrelated-event-subscription-id",
      destination: { type: "queues.queue", queue_id: "shared-id" },
    },
  ];

  const result = await decommissionManagedInstall(waivedContract(), {
    request: fake.request,
    deployTombstone: async () => {
      fake.state.producerBindings.clear();
      fake.state.namespaces = [];
    },
  });
  assert.equal(result.ok, true);
  assert.equal(fake.state.worker, false);
  assert.equal(workerForceDeletes(fake).length, 1);
});

test("redeploys a binding-free tombstone when the Worker remains after its DO namespace is absent", async () => {
  const fake = createCloudflareFixture();
  fake.state.namespaces = [];
  let tombstones = 0;
  const result = await decommissionManagedInstall(waivedContract(), {
    request: fake.request,
    deployTombstone: async ({ workerName, operationId, deleteDurableObject }) => {
      tombstones += 1;
      assert.equal(workerName, WORKER_NAME);
      assert.equal(operationId, OPERATION_ID);
      assert.equal(deleteDurableObject, false);
      fake.state.producerBindings.clear();
    },
  });

  assert.equal(result.ok, true);
  assert.equal(tombstones, 1);
  assert.equal(fake.state.queues.has(DEDICATED_QUEUE), false);
});

test("resumes after a tombstone settings update without redeploying over API edits", async () => {
  const fake = createCloudflareFixture();
  fake.state.namespaces = [];
  fake.state.workerBindings = [{ name: "JWT_SECRET", type: "secret_text" }];
  fake.state.producerBindings.clear();
  let tombstones = 0;

  const result = await decommissionManagedInstall(waivedContract(), {
    request: fake.request,
    deployTombstone: async () => {
      tombstones += 1;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(tombstones, 0);
  assert.equal(fake.state.queues.has(DEDICATED_QUEUE), false);
  assert.equal(fake.state.worker, false);
  assert.equal(fake.state.d1, null);
});

test("polls complete Queue binding evidence and fails closed when detachment never converges", async () => {
  const delayed = createCloudflareFixture();
  delayed.state.producerDetachPollsRemaining = 2;
  let pauses = 0;
  const delayedResult = await decommissionManagedInstall(waivedContract(), {
    request: delayed.request,
    pause: async (milliseconds) => {
      assert.equal(milliseconds, 1_000);
      pauses += 1;
    },
    deployTombstone: async () => {
      delayed.state.producerBindings.clear();
      delayed.state.namespaces = [];
    },
  });
  assert.equal(delayedResult.ok, true);
  assert.equal(pauses, 2);

  const stuck = createCloudflareFixture();
  stuck.state.retainProducerBindingOnPatch = true;
  stuck.state.retainProducerBindingOnWorkerDelete = true;
  await assert.rejects(
    decommissionManagedInstall(waivedContract(), {
      request: stuck.request,
      pause: async () => {},
      queueDetachMaxAttempts: 2,
      deployTombstone: async () => {
        stuck.state.namespaces = [];
      },
    }),
    /queue bindings did not detach/,
  );
  assert.equal(stuck.state.queues.has(DEDICATED_QUEUE), true);
  assert.equal(stuck.state.worker, false);
  assert.notEqual(stuck.state.d1, null);
  assert.equal(
    stuck.calls.some(
      ({ method, path }) => method === "DELETE" && path.endsWith("/queues/dedicated-id"),
    ),
    false,
  );

  const incomplete = createCloudflareFixture();
  incomplete.state.omitProducerArray = true;
  await assert.rejects(
    decommissionManagedInstall(waivedContract(), {
      request: incomplete.request,
      deployTombstone: async () => {
        incomplete.state.producerBindings.clear();
        incomplete.state.namespaces = [];
      },
    }),
    /queue binding counts are invalid/,
  );
  assert.equal(incomplete.state.queues.has(DEDICATED_QUEUE), true);
});

test("waits for the exact Queue consumer to disappear before tombstone deployment", async () => {
  const fake = createCloudflareFixture();
  fake.state.retainConsumerOnDelete = true;
  let tombstones = 0;

  await assert.rejects(
    decommissionManagedInstall(waivedContract(), {
      request: fake.request,
      pause: async () => {},
      queueDetachMaxAttempts: 2,
      deployTombstone: async () => {
        tombstones += 1;
      },
    }),
    /queue consumer did not detach/,
  );

  assert.equal(tombstones, 0);
  assert.equal(fake.state.worker, true);
  assert.notEqual(fake.state.d1, null);
  assert.equal(fake.state.queues.has(DEDICATED_QUEUE), true);
});

test("rejects conflicting or malformed Queue consumer identity aliases", async () => {
  const fake = createCloudflareFixture();
  const managed = fake.state.queues.get(SHARED_QUEUE).consumers[0];
  managed.service = 123;

  await assert.rejects(
    decommissionManagedInstall(waivedContract(), { request: fake.request }),
    /queue consumer identity evidence is incomplete/,
  );
  assert.equal(fake.state.worker, true);
  assert.notEqual(fake.state.r2, null);
});

test("orders source queues before dead-letter queues independently of manifest order", () => {
  assert.deepEqual(
    orderedDedicatedQueueNames(
      [
        `${WORKER_NAME}-events-dlq`,
        SHARED_QUEUE,
        `${WORKER_NAME}-social-dlq`,
        `${WORKER_NAME}-events`,
        `${WORKER_NAME}-social`,
      ],
      WORKER_NAME,
    ),
    [
      `${WORKER_NAME}-events`,
      `${WORKER_NAME}-social`,
      `${WORKER_NAME}-events-dlq`,
      `${WORKER_NAME}-social-dlq`,
    ],
  );
});

test("requires an explicit strict export waiver value before any provider request", async (t) => {
  for (const value of [undefined, null, 0, "TRUE", "yes"]) {
    await t.test(String(value), async () => {
      let requests = 0;
      await assert.rejects(
        decommissionManagedInstall(
          { ...contract(), exportWaived: value },
          {
            request: async () => {
              requests += 1;
              throw new Error("must not request");
            },
          },
        ),
        /export waiver must be explicitly true or false/,
      );
      assert.equal(requests, 0);
    });
  }
});

test("requires every retained-export input to be absent when export is waived", async (t) => {
  const evidence = contract();
  for (const field of [
    "exportOperationId",
    "exportKeyVersion",
    "exportObjectKey",
    "exportSha256",
    "exportMd5",
    "exportEtag",
    "exportSizeBytes",
    "exportHead",
  ]) {
    await t.test(field, async () => {
      let requests = 0;
      await assert.rejects(
        decommissionManagedInstall(
          { ...waivedContract(), [field]: evidence[field] },
          {
            request: async () => {
              requests += 1;
              throw new Error("must not request");
            },
          },
        ),
        /resource contract is invalid|retained export inputs must be empty/,
      );
      assert.equal(requests, 0);
    });
  }
});

test("ordinary decommission still requires every retained-export proof", async (t) => {
  for (const field of [
    "exportOperationId",
    "exportKeyVersion",
    "exportObjectKey",
    "exportSha256",
    "exportMd5",
    "exportEtag",
    "exportSizeBytes",
    "exportHead",
  ]) {
    await t.test(field, async () => {
      let requests = 0;
      await assert.rejects(
        decommissionManagedInstall(
          { ...contract(), [field]: undefined },
          {
            request: async () => {
              requests += 1;
              throw new Error("must not request");
            },
          },
        ),
        /resource contract is invalid|verified retained export evidence is required/,
      );
      assert.equal(requests, 0);
    });
  }

  let requests = 0;
  await assert.rejects(
    decommissionManagedInstall(
      { ...contract(), r2EmptyListing: undefined },
      {
        request: async () => {
          requests += 1;
          throw new Error("must not request");
        },
      },
    ),
    /verifiably empty/,
  );
  assert.equal(requests, 0);
});

test("refuses waived decommission when source R2 is not proven empty", async () => {
  let requests = 0;
  await assert.rejects(
    decommissionManagedInstall(
      {
        ...waivedContract(),
        r2EmptyListing: {
          IsTruncated: false,
          Contents: [{ Key: "still-present", Size: 1, ETag: '"etag"' }],
        },
      },
      {
        request: async () => {
          requests += 1;
          throw new Error("must not request");
        },
      },
    ),
    /verifiably empty/,
  );
  assert.equal(requests, 0);
});

test("refuses waived decommission until runtime purge is persisted", async () => {
  const fake = createCloudflareFixture();
  fake.state.lifecycle.credentials_revoked_at = null;
  await assert.rejects(
    decommissionManagedInstall(waivedContract(), { request: fake.request }),
    /persisted runtime termination is required/,
  );
  assert.equal(fake.calls.some(({ method }) => method === "DELETE"), false);
  assert.notEqual(fake.state.worker, false);
  assert.notEqual(fake.state.d1, null);
  assert.notEqual(fake.state.r2, null);
});

test("refuses waived Worker deletion when its runtime proof database is missing", async () => {
  const fake = createCloudflareFixture();
  fake.state.d1 = null;
  await assert.rejects(
    decommissionManagedInstall(waivedContract(), { request: fake.request }),
    /runtime termination proof is unavailable/,
  );
  assert.equal(fake.calls.some(({ method }) => method === "DELETE"), false);
  assert.equal(fake.state.worker, true);
  assert.notEqual(fake.state.r2, null);
});

test("refuses waived R2 deletion when both persisted proof resources are missing", async () => {
  const fake = createCloudflareFixture();
  fake.state.worker = false;
  fake.state.d1 = null;
  await assert.rejects(
    decommissionManagedInstall(waivedContract(), { request: fake.request }),
    /runtime termination proof is unavailable before R2 deletion/,
  );
  assert.equal(fake.calls.some(({ method }) => method === "DELETE"), false);
  assert.notEqual(fake.state.r2, null);
});

test("stops before every later resource when REST does not prove R2 absence", async () => {
  const fake = createCloudflareFixture();
  const request = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if ((init.method || "GET") === "DELETE" && path.includes("/r2/buckets/")) {
      return success(null);
    }
    return fake.request(url, init);
  };

  await assert.rejects(
    decommissionManagedInstall(waivedContract(), { request }),
    /R2 bucket absence was not verified/,
  );
  assert.equal(fake.state.worker, true);
  assert.notEqual(fake.state.d1, null);
  assert.notEqual(fake.state.r2, null);
  assert.equal(fake.state.queues.has(DEDICATED_QUEUE), true);
});

test("stops before every later resource when REST rejects deletion of a non-empty R2 bucket", async () => {
  const fake = createCloudflareFixture();
  const request = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if ((init.method || "GET") === "DELETE" && path.includes("/r2/buckets/")) {
      return new Response(
        JSON.stringify({ success: false, errors: [{ code: 10008, message: "Bucket is not empty" }] }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      );
    }
    return fake.request(url, init);
  };

  await assert.rejects(
    decommissionManagedInstall(waivedContract(), { request }),
    /Cloudflare resource operation failed with status 409 \(10008: Bucket is not empty\)/,
  );
  assert.equal(fake.state.worker, true);
  assert.notEqual(fake.state.d1, null);
  assert.notEqual(fake.state.r2, null);
  assert.equal(fake.state.queues.has(DEDICATED_QUEUE), true);
});

test("retains D1 proof when an acknowledged Worker deletion is not observed as absent", async () => {
  const fake = createCloudflareFixture();
  const request = async (url, init = {}) => {
    const parsed = new URL(url);
    if (
      (init.method || "GET") === "DELETE" &&
      parsed.pathname.endsWith(`/workers/services/${WORKER_NAME}`)
    ) {
      return success(null);
    }
    return fake.request(url, init);
  };

  await assert.rejects(
    decommissionManagedInstall(waivedContract(), {
      request,
      deployTombstone: async () => {
        fake.state.producerBindings.clear();
        fake.state.namespaces = [];
      },
    }),
    /Worker absence was not verified/,
  );
  assert.notEqual(fake.state.d1, null);
  assert.equal(
    fake.calls.some(
      ({ method, path }) =>
        method === "DELETE" && path.includes(`/d1/database/${D1_ID}`),
    ),
    false,
  );
});

test("refuses a mismatched exact manifest before waived decommission deletes anything", async () => {
  const fake = createCloudflareFixture();
  fake.state.namespaces[0].script = "unrelated-worker";
  await assert.rejects(
    decommissionManagedInstall(waivedContract(), { request: fake.request }),
    /Durable Object namespace identity does not match/,
  );
  assert.equal(fake.calls.some(({ method }) => method === "DELETE"), false);
  assert.equal(fake.state.worker, true);
  assert.notEqual(fake.state.d1, null);
  assert.notEqual(fake.state.r2, null);
});

test("performs no provider deletion when final control-plane authorization is rejected", async () => {
  const fake = createCloudflareFixture();
  await assert.rejects(
    decommissionManagedInstall(contract(), {
      request: fake.request,
      reportStage: async (stage) => {
        assert.equal(stage, "deleting_r2");
        throw new Error("terminal authorization rejected");
      },
    }),
    /terminal authorization rejected/,
  );
  assert.equal(fake.calls.some(({ method }) => method === "DELETE"), false);
  assert.notEqual(fake.state.r2, null);
  assert.notEqual(fake.state.d1, null);
});

test("fails closed when a shared queue consumer listing is incomplete", async () => {
  const fake = createCloudflareFixture();
  const incompleteRequest = async (url, init = {}) => {
    const parsed = new URL(url);
    const response = await fake.request(url, init);
    if (
      (init.method || "GET") === "GET" &&
      parsed.pathname.endsWith("/queues/shared-id/consumers")
    ) {
      const body = await response.json();
      return success(body.result.slice(0, 1));
    }
    return response;
  };

  await assert.rejects(
    decommissionManagedInstall(contract(), { request: incompleteRequest }),
    /shared queue consumer listing is incomplete/,
  );
  assert.equal(fake.calls.some(({ method }) => method === "DELETE"), false);
  assert.notEqual(fake.state.r2, null);
});

test("fails closed when a dedicated queue consumer listing is incomplete", async () => {
  const fake = createCloudflareFixture();
  const incompleteRequest = async (url, init = {}) => {
    const parsed = new URL(url);
    const response = await fake.request(url, init);
    if (
      (init.method || "GET") === "GET" &&
      parsed.pathname.endsWith("/queues/dedicated-id/consumers")
    ) {
      return success([]);
    }
    return response;
  };

  await assert.rejects(
    decommissionManagedInstall(contract(), { request: incompleteRequest }),
    /dedicated queue consumer listing is incomplete/,
  );
  assert.equal(fake.calls.some(({ method }) => method === "DELETE"), false);
  assert.notEqual(fake.state.r2, null);
});

test("retries safely after every destructive stage has already taken effect", async (t) => {
  const stages = ["r2", "consumer", "queue", "tombstone", "worker", "d1"];
  for (const interruptedAfter of stages) {
    await t.test(interruptedAfter, async () => {
      const fake = createCloudflareFixture();
      let injected = false;
      const deployTombstone = async () => {
        fake.state.producerBindings.clear();
        fake.state.namespaces = [];
        if (interruptedAfter === "tombstone" && !injected) {
          injected = true;
          throw new Error("simulated interruption after tombstone deployment");
        }
      };
      const flakyRequest = async (url, init = {}) => {
        const response = await fake.request(url, init);
        const path = new URL(url).pathname;
        const method = init.method || "GET";
        const matched =
          (interruptedAfter === "r2" && method === "DELETE" && path.includes("/r2/buckets/")) ||
          (interruptedAfter === "consumer" && method === "DELETE" && path.includes("/consumers/")) ||
          (interruptedAfter === "queue" && method === "DELETE" && /\/queues\/[^/]+$/.test(path)) ||
          (interruptedAfter === "worker" && method === "DELETE" && path.includes("/workers/services/")) ||
          (interruptedAfter === "d1" && method === "DELETE" && path.includes("/d1/database/"));
        if (matched && !injected) {
          injected = true;
          throw new Error(`simulated interruption after ${interruptedAfter}`);
        }
        return response;
      };

      await assert.rejects(
        decommissionManagedInstall(contract(), {
          request: flakyRequest,
          deployTombstone,
        }),
        /simulated interruption/,
      );
      assert.equal(injected, true);
      const retried = await decommissionManagedInstall(contract(), {
        request: fake.request,
        deployTombstone: async () => {
          fake.state.producerBindings.clear();
          fake.state.namespaces = [];
        },
      });
      assert.equal(retried.ok, true);
      assert.equal(fake.state.worker, false);
      assert.equal(fake.state.d1, null);
      assert.equal(fake.state.r2, null);
    });
  }
});

test("does not continue after Worker loss without persisted runtime termination proof", async () => {
  const fake = createCloudflareFixture();
  fake.state.worker = false;
  fake.state.lifecycle.storage_purged_at = null;
  await assert.rejects(
    decommissionManagedInstall(contract(), { request: fake.request }),
    /persisted runtime termination is required/,
  );
  assert.notEqual(fake.state.d1, null);
  assert.notEqual(fake.state.r2, null);
});

function contract() {
  return {
    accountId: ACCOUNT_ID,
    apiToken: "cloudflare-api-token",
    installationId: INSTALLATION_ID,
    operationId: OPERATION_ID,
    exportWaived: false,
    exportOperationId: EXPORT_OPERATION_ID,
    exportKeyVersion: "v1",
    workerName: WORKER_NAME,
    d1Name: `${WORKER_NAME}-d1`,
    d1Id: D1_ID,
    r2Name: `${WORKER_NAME}-r2`,
    queueNames: [DEDICATED_QUEUE, SHARED_QUEUE],
    durableObjectNamespaceId: DO_ID,
    exportObjectKey:
      `managed-exports/${INSTALLATION_ID}/${EXPORT_OPERATION_ID}.me3-managed-export-v1.enc`,
    exportSha256: SHA256,
    exportMd5: MD5,
    exportEtag: MD5,
    exportSizeBytes: 42,
    exportHead: {
      ContentLength: 42,
      ETag: `"${MD5}"`,
      Metadata: {
        sha256: SHA256,
        md5: MD5,
        format: "me3-managed-export-v1",
        installation: INSTALLATION_ID,
        operation: EXPORT_OPERATION_ID,
        keyversion: "v1",
      },
    },
    r2EmptyListing: { IsTruncated: false, Contents: [] },
  };
}

function waivedContract() {
  const input = contract();
  input.exportWaived = true;
  delete input.exportOperationId;
  delete input.exportKeyVersion;
  delete input.exportObjectKey;
  delete input.exportSha256;
  delete input.exportMd5;
  delete input.exportEtag;
  delete input.exportSizeBytes;
  delete input.exportHead;
  delete input.r2EmptyListing;
  return input;
}

function createCloudflareFixture() {
  const state = {
    worker: true,
    d1: { uuid: D1_ID, name: `${WORKER_NAME}-d1` },
    r2: { name: `${WORKER_NAME}-r2` },
    namespaces: [{ id: DO_ID, script: WORKER_NAME, class: "Me3UserAgent" }],
    producerBindings: new Set([DEDICATED_QUEUE]),
    workerBindings: [
      {
        name: "SOCIAL_PUBLISH_QUEUE",
        type: "queue",
        queue_name: DEDICATED_QUEUE,
      },
      { name: "JWT_SECRET", type: "secret_text" },
    ],
    producerDetachPollsRemaining: 0,
    omitProducerArray: false,
    retainConsumerOnDelete: false,
    retainProducerBindingOnPatch: false,
    retainProducerBindingOnWorkerDelete: false,
    rejectNonForceWorkerDelete: false,
    nonForceWorkerDeleteErrorCodes: [10064],
    references: {
      services: { incoming: [], outgoing: [], pages_function: false },
      durable_objects: [],
      dispatch_outbounds: [],
    },
    tailProducers: [],
    eventSubscriptions: [],
    deploymentId: DEPLOYMENT_ID,
    versionId: VERSION_ID,
    deploymentReads: 0,
    driftDeploymentOnSecondRead: false,
    lifecycle: {
      state: "suspended",
      credentials_revoked_at: "2026-07-18T12:00:00Z",
      storage_purged_at: "2026-07-18T12:01:00Z",
    },
    queues: new Map([
      [
        DEDICATED_QUEUE,
        {
          queue_id: "dedicated-id",
          queue_name: DEDICATED_QUEUE,
          consumers: [
            {
              consumer_id: "dedicated-managed-consumer",
              type: "worker",
              script_name: WORKER_NAME,
            },
          ],
        },
      ],
      [
        SHARED_QUEUE,
        {
          queue_id: "shared-id",
          queue_name: SHARED_QUEUE,
          consumers: [
            {
              consumer_id: "shared-managed-consumer",
              type: "worker",
              script: WORKER_NAME,
            },
            {
              consumer_id: "shared-unrelated-consumer",
              type: "worker",
              service: "unrelated-worker",
            },
          ],
        },
      ],
    ]),
  };
  const calls = [];
  const request = async (url, init = {}) => {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    const method = init.method || "GET";
    calls.push({ method, path });
    const prefix = `/client/v4/accounts/${ACCOUNT_ID}`;
    assert.equal(parsed.pathname.startsWith(prefix), true, parsed.pathname);
    const resource = parsed.pathname.slice(prefix.length);

    if (resource === `/d1/database/${D1_ID}/query` && method === "POST") {
      return success([
        {
          results: [state.lifecycle],
        },
      ]);
    }
    if (resource === `/d1/database/${D1_ID}`) {
      if (method === "DELETE") state.d1 = null;
      return state.d1 ? success(state.d1) : missing();
    }
    if (resource === `/r2/buckets/${WORKER_NAME}-r2`) {
      if (method === "DELETE") state.r2 = null;
      return state.r2 ? success(state.r2) : missing();
    }
    if (resource === "/queues" && method === "GET") {
      const queueName = parsed.searchParams.get("name");
      if (queueName) {
        const queue = state.queues.get(queueName);
        return success(queue ? [publicQueue(queue, state)] : []);
      }
      return success(
        Number(parsed.searchParams.get("page") || "1") === 1
          ? [...state.queues.values()].map((queue) => publicQueue(queue, state))
          : [],
      );
    }
    const consumerList = /^\/queues\/([^/]+)\/consumers$/.exec(resource);
    if (consumerList && method === "GET") {
      const queue = queueById(state, consumerList[1]);
      return queue ? success(queue.consumers) : missing();
    }
    const consumerDelete = /^\/queues\/([^/]+)\/consumers\/([^/]+)$/.exec(resource);
    if (consumerDelete && method === "DELETE") {
      const queue = queueById(state, consumerDelete[1]);
      if (!queue) return missing();
      if (!state.retainConsumerOnDelete) {
        queue.consumers = queue.consumers.filter(
          (consumer) => consumer.consumer_id !== consumerDelete[2],
        );
      }
      return success(null);
    }
    const queueDelete = /^\/queues\/([^/]+)$/.exec(resource);
    if (queueDelete && method === "DELETE") {
      const queue = queueById(state, queueDelete[1]);
      if (!queue) return missing();
      if (state.producerBindings.has(queue.queue_name)) {
        return new Response(
          JSON.stringify({
            success: false,
            errors: [{ code: 11007, message: "Queue is referenced by a producer binding" }],
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }
      state.queues.delete(queue.queue_name);
      return success(null);
    }
    if (resource === "/workers/durable_objects/namespaces" && method === "GET") {
      return success(state.namespaces);
    }
    if (resource === `/workers/scripts/${WORKER_NAME}/settings`) {
      if (method === "PATCH") {
        const settings = JSON.parse(init.body.get("settings"));
        assert.deepEqual(settings, { bindings: [] });
        state.workerBindings = state.workerBindings.filter(
          (binding) => binding.type === "secret_text",
        );
        if (!state.retainProducerBindingOnPatch) {
          state.producerBindings.clear();
        }
      }
      return success({ bindings: structuredClone(state.workerBindings) });
    }
    if (resource === `/workers/scripts/${WORKER_NAME}/references` && method === "GET") {
      return success(structuredClone(state.references));
    }
    if (resource === `/workers/tails/by-consumer/${WORKER_NAME}` && method === "GET") {
      return success(structuredClone(state.tailProducers));
    }
    if (resource === `/workers/scripts/${WORKER_NAME}/deployments` && method === "GET") {
      state.deploymentReads += 1;
      const deploymentId =
        state.driftDeploymentOnSecondRead && state.deploymentReads > 1
          ? "66666666-6666-4666-8666-666666666666"
          : state.deploymentId;
      return success({
        deployments: [
          {
            id: deploymentId,
            versions: [{ version_id: state.versionId, percentage: 100 }],
          },
        ],
      });
    }
    if (
      resource === `/workers/scripts/${WORKER_NAME}/versions/${VERSION_ID}` &&
      method === "GET"
    ) {
      return success({
        id: VERSION_ID,
        annotations: {
          "workers/tag": managedDecommissionTombstoneTag(OPERATION_ID),
          "workers/message": managedDecommissionTombstoneMessage(OPERATION_ID),
        },
        resources: {
          bindings: state.workerBindings.filter(
            (binding) => binding.type === "secret_text" || binding.type === "version_metadata",
          ),
        },
      });
    }
    if (resource === `/workers/scripts/${WORKER_NAME}/content/v2` && method === "GET") {
      assert.equal(parsed.searchParams.get("version"), VERSION_ID);
      return new Response(MANAGED_DECOMMISSION_TOMBSTONE_SOURCE, {
        status: 200,
        headers: { "Content-Type": "application/javascript+module" },
      });
    }
    if (resource === "/event_subscriptions/subscriptions" && method === "GET") {
      return success(structuredClone(state.eventSubscriptions));
    }
    if (resource === `/workers/services/${WORKER_NAME}` && method === "DELETE") {
      const force = parsed.searchParams.get("force");
      assert.ok(force === "false" || force === "true");
      if (force === "false" && state.rejectNonForceWorkerDelete) {
        return new Response(
          JSON.stringify({
            success: false,
            errors: state.nonForceWorkerDeleteErrorCodes.map((code) => ({
              code,
              message: "Cannot delete this Worker as it is a consumer for a Queue.",
            })),
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      }
      state.worker = false;
      if (!state.retainProducerBindingOnWorkerDelete) {
        state.producerBindings.clear();
      }
      for (const queue of state.queues.values()) {
        queue.consumers = queue.consumers.filter(
          (consumer) => !isManagedFixtureConsumer(consumer),
        );
      }
      return success(null);
    }
    if (resource === `/workers/scripts/${WORKER_NAME}`) {
      return state.worker
        ? new Response("worker module", { status: 200, headers: { "Content-Type": "text/plain" } })
        : missing();
    }
    throw new Error(`unexpected Cloudflare fixture request: ${method} ${resource}`);
  };
  return { state, calls, request };
}

function isManagedFixtureConsumer(consumer) {
  return fixtureConsumerName(consumer) === WORKER_NAME;
}

function fixtureConsumerName(consumer) {
  return consumer?.script || consumer?.service || consumer?.script_name || null;
}

function workerForceDeletes(fake) {
  return fake.calls.filter(
    ({ method, path }) =>
      method === "DELETE" &&
      path.includes("/workers/services/") &&
      new URL(`https://example.test${path}`).searchParams.get("force") === "true",
  );
}

function queueById(state, id) {
  return [...state.queues.values()].find((queue) => queue.queue_id === id) || null;
}

function publicQueue(queue, state) {
  let producerVisible = state.producerBindings.has(queue.queue_name);
  if (
    queue.queue_name === DEDICATED_QUEUE &&
    !producerVisible &&
    state.producerDetachPollsRemaining > 0
  ) {
    state.producerDetachPollsRemaining -= 1;
    producerVisible = true;
  }
  const producers = producerVisible
    ? [{ script: WORKER_NAME }]
    : [];
  const result = {
    queue_id: queue.queue_id,
    queue_name: queue.queue_name,
    consumers: structuredClone(queue.consumers),
    consumers_total_count: queue.consumers.length,
    producers,
    producers_total_count: producers.length,
  };
  if (state.omitProducerArray && queue.queue_name === DEDICATED_QUEUE) {
    delete result.producers;
  }
  return result;
}

function success(result) {
  return new Response(JSON.stringify({ success: true, result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function missing() {
  return new Response(JSON.stringify({ success: false }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}
