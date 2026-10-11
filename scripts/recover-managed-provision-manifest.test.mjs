import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { recoverManagedProvisionManifest } from "./recover-managed-provision-manifest.mjs";

const ACCOUNT_ID = "a".repeat(32);
const INSTALLATION_ID = "mi-1234567890abcdef";
const WORKER_NAME = `me3-${INSTALLATION_ID}`;
const D1_ID = "11111111-1111-4111-8111-111111111111";
const DO_ID = "d".repeat(32);
const ZONE_ID = "b".repeat(32);
const HOSTNAME = "owner.me3.app";
const ORIGIN = `https://${HOSTNAME}`;

test("recovers an exact public Worker origin after deploy output was lost", async () => {
  const config = createConfig();
  try {
    const fake = createCloudflareFixture({ workerState: "public" });
    const manifest = await recoverManagedProvisionManifest(config.input, fake.request, {
      sleep: async () => {},
    });

    assert.deepEqual(manifest, {
      installationId: INSTALLATION_ID,
      workerPresent: true,
      workerPublic: true,
      origin: ORIGIN,
      d1Id: D1_ID,
      queueNames: [`${WORKER_NAME}-booking-reminders`],
      durableObjectNamespaceId: DO_ID,
    });
    assert.equal(
      fake.calls.some(({ path }) => path === `/workers/domains`),
      true,
    );
    assert.equal(fake.publicCalls.length, 2);
    assert.equal(fake.publicCalls.every(({ authorization }) => authorization === null), true);
  } finally {
    config.cleanup();
  }
});

test("records a present but private bootstrap Worker without inventing an origin", async () => {
  const config = createConfig();
  try {
    const fake = createCloudflareFixture({ workerState: "private" });
    const manifest = await recoverManagedProvisionManifest(config.input, fake.request);

    assert.equal(manifest.workerPresent, true);
    assert.equal(manifest.workerPublic, false);
    assert.equal(Object.hasOwn(manifest, "origin"), false);
    assert.equal(fake.publicCalls.length, 0);
  } finally {
    config.cleanup();
  }
});

test("records an absent Worker as explicit deployment proof", async () => {
  const config = createConfig();
  try {
    const fake = createCloudflareFixture({ workerState: "absent" });
    const manifest = await recoverManagedProvisionManifest(config.input, fake.request);

    assert.equal(manifest.workerPresent, false);
    assert.equal(manifest.workerPublic, false);
    assert.equal(Object.hasOwn(manifest, "origin"), false);
    assert.equal(
      fake.calls.some(({ path }) => path.endsWith("/subdomain")),
      false,
    );
  } finally {
    config.cleanup();
  }
});

test("keeps public proof but withholds an origin when runtime identity cannot be verified", async () => {
  const config = createConfig();
  try {
    const sleeps = [];
    const fake = createCloudflareFixture({ workerState: "public", validProbe: false });
    const manifest = await recoverManagedProvisionManifest(config.input, fake.request, {
      sleep: async (milliseconds) => sleeps.push(milliseconds),
    });

    assert.equal(manifest.workerPresent, true);
    assert.equal(manifest.workerPublic, true);
    assert.equal(Object.hasOwn(manifest, "origin"), false);
    assert.deepEqual(sleeps, [250, 500, 1_000, 2_000]);
    assert.equal(fake.publicCalls.length, 10);
  } finally {
    config.cleanup();
  }
});

test("treats an enabled preview route as ever-public without inventing a stable origin", async () => {
  const config = createConfig();
  try {
    const fake = createCloudflareFixture({ workerState: "preview" });
    const manifest = await recoverManagedProvisionManifest(config.input, fake.request);

    assert.equal(manifest.workerPresent, true);
    assert.equal(manifest.workerPublic, true);
    assert.equal(Object.hasOwn(manifest, "origin"), false);
    assert.equal(fake.publicCalls.length, 0);
  } finally {
    config.cleanup();
  }
});

function createConfig() {
  const root = mkdtempSync(join(tmpdir(), "me3-managed-recovery-test-"));
  const configPath = join(root, "wrangler.toml");
  writeFileSync(
    configPath,
    [
      `name = "${WORKER_NAME}"`,
      "workers_dev = true",
      "[[d1_databases]]",
      'binding = "DB"',
      `database_name = "${WORKER_NAME}-d1"`,
      `database_id = "${D1_ID}"`,
      "[[queues.producers]]",
      `queue = "${WORKER_NAME}-booking-reminders"`,
      "",
    ].join("\n"),
  );
  return {
    input: {
      accountId: ACCOUNT_ID,
      apiToken: "cloudflare-api-token",
      installationId: INSTALLATION_ID,
      workerName: WORKER_NAME,
      d1Name: `${WORKER_NAME}-d1`,
      canonicalHostname: HOSTNAME,
      zoneId: ZONE_ID,
      configPath,
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function createCloudflareFixture({ workerState, validProbe = true }) {
  const calls = [];
  const publicCalls = [];
  const request = async (url, init = {}) => {
    const parsed = new URL(url);
    if (parsed.hostname !== "api.cloudflare.com") {
      publicCalls.push({
        path: parsed.pathname,
        authorization: new Headers(init.headers).get("Authorization"),
      });
      if (parsed.pathname === "/health") {
        return successPublic({
          ok: validProbe,
          service: "me3-core",
          bindings: { db: true, userAgent: true, workersAi: true },
        });
      }
      if (parsed.pathname === "/api/mobile/config") {
        return successPublic({
          installId: "core_44444444-4444-4444-8444-444444444444",
          publicURL: validProbe ? ORIGIN : "https://wrong.example",
          mobileApiVersion: 1,
          auth: { pairing: "owner-approved-code" },
        });
      }
      throw new Error(`unexpected public request: ${parsed.pathname}`);
    }

    assert.equal(
      new Headers(init.headers).get("Authorization"),
      "Bearer cloudflare-api-token",
    );
    const prefix = `/client/v4/accounts/${ACCOUNT_ID}`;
    assert.equal(parsed.pathname.startsWith(prefix), true);
    const path = parsed.pathname.slice(prefix.length);
    calls.push({ path, search: parsed.search });

    if (path === `/workers/scripts/${WORKER_NAME}`) {
      return workerState === "absent"
        ? new Response(JSON.stringify({ success: false }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          })
        : new Response("export default {}", { status: 200 });
    }
    if (path === `/workers/scripts/${WORKER_NAME}/subdomain`) {
      return successApi({
        enabled: false,
        previews_enabled: workerState === "preview",
      });
    }
    if (path === "/workers/domains") {
      return successApi(
        workerState === "public"
          ? [{
              id: "domain-id",
              hostname: HOSTNAME,
              service: WORKER_NAME,
              zone_id: ZONE_ID,
              zone_name: "me3.app",
            }]
          : [],
      );
    }
    if (path === "/d1/database") {
      return successApi([{ uuid: D1_ID, name: `${WORKER_NAME}-d1` }]);
    }
    if (path === "/workers/durable_objects/namespaces") {
      return successApi([{ id: DO_ID, script: WORKER_NAME, class: "Me3UserAgent" }]);
    }
    throw new Error(`unexpected Cloudflare API request: ${path}`);
  };
  return { calls, publicCalls, request };
}

function successApi(result) {
  return new Response(JSON.stringify({ success: true, result }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function successPublic(result) {
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
