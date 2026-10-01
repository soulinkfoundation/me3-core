import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyManagedUpgradeConfig } from "./verify-managed-upgrade-config.mjs";

const installationId = "mi-1234567890abcdef";
const workerName = `me3-${installationId}`;
const d1Name = `${workerName}-d1`;
const d1Id = "22222222-2222-4222-8222-222222222222";
const r2Name = `${workerName}-r2`;
const queueNames = [
  `${workerName}-social-publish`,
  `${workerName}-social-publish-dlq`,
];

test("accepts only a deploy config bound to the complete frozen resources", () => {
  const directory = mkdtempSync(join(tmpdir(), "me3-upgrade-config-"));
  const configPath = join(directory, "wrangler.toml");
  const safeConfig = config();
  writeFileSync(configPath, safeConfig);
  try {
    assert.equal(contract(configPath).d1Id, d1Id);

    const unsafeConfigs = [
      safeConfig.replace(d1Id, "33333333-3333-4333-8333-333333333333"),
      `${safeConfig}\n[[kv_namespaces]]\nbinding = "EXTRA"\nid = "abc"\n`,
      safeConfig.replace(
        'new_sqlite_classes = ["Me3UserAgent"]',
        'new_sqlite_classes = ["Me3UserAgent", "ExtraAgent"]',
      ),
      safeConfig.replace("workers_dev = false", "workers_dev = true"),
      safeConfig.replace(
        'CORE_API_ORIGIN = "https://owner.me3.app"',
        'CORE_API_ORIGIN = "https://other.me3.app"',
      ),
      `${safeConfig}\n[[env.production.routes]]\npattern = "owner.me3.app/*"\n`,
    ];
    for (const unsafe of unsafeConfigs) {
      writeFileSync(configPath, unsafe);
      assert.throws(() => contract(configPath), /upgrade config is invalid/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("accepts an optional isolated SDK agent binding when the SDK runtime is enabled", () => {
  const directory = mkdtempSync(join(tmpdir(), "me3-sdk-upgrade-config-"));
  const configPath = join(directory, "wrangler.toml");
  const sdkConfig = config().replace(
    'ME3_DEPLOYMENT_MODE = "managed"',
    'ME3_DEPLOYMENT_MODE = "managed"\nME3_ASSISTANT_RUNTIME = "sdk"',
  ).replace(
    '[[migrations]]',
    '[[durable_objects.bindings]]\nname = "ME3_SDK_USER_AGENT"\nclass_name = "Me3SdkUserAgent"\n[[migrations]]',
  ).replace(
    'new_sqlite_classes = ["Me3UserAgent"]',
    'new_sqlite_classes = ["Me3UserAgent"]\n[[migrations]]\ntag = "sdk"\nnew_sqlite_classes = ["Me3SdkUserAgent"]',
  );
  try {
    writeFileSync(configPath, sdkConfig);
    assert.equal(contract(configPath).d1Id, d1Id);
    writeFileSync(configPath, sdkConfig.replace('name = "ME3_SDK_USER_AGENT"', 'name = "MISSING_SDK_AGENT"'));
    assert.throws(() => contract(configPath), /upgrade config is invalid/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function contract(configPath) {
  return verifyManagedUpgradeConfig({
    configPath,
    installationId,
    workerName,
    d1Name,
    d1Id,
    r2Name,
    queueNames,
    durableObjectNamespaceId: "b".repeat(32),
    publicOrigin: "https://owner.me3.app",
  });
}

function config() {
  return [
    `name = "${workerName}"`,
    "workers_dev = false",
    "[vars]",
    'ME3_DEPLOYMENT_MODE = "managed"',
    `ME3_MANAGED_INSTALLATION_ID = "${installationId}"`,
    'CORE_WEB_ORIGIN = "https://owner.me3.app"',
    'CORE_API_ORIGIN = "https://owner.me3.app"',
    "[[durable_objects.bindings]]",
    'name = "ME3_USER_AGENT"',
    'class_name = "Me3UserAgent"',
    "[[migrations]]",
    'tag = "initial"',
    'new_sqlite_classes = ["Me3UserAgent"]',
    "[[d1_databases]]",
    'binding = "DB"',
    `database_name = "${d1Name}"`,
    `database_id = "${d1Id}"`,
    "[[r2_buckets]]",
    'binding = "SITE_ASSETS"',
    `bucket_name = "${r2Name}"`,
    "[[queues.producers]]",
    'binding = "SOCIAL_PUBLISH_QUEUE"',
    `queue = "${queueNames[0]}"`,
    "[[queues.consumers]]",
    `queue = "${queueNames[0]}"`,
    `dead_letter_queue = "${queueNames[1]}"`,
    "[[queues.consumers]]",
    `queue = "${queueNames[1]}"`,
    "",
  ].join("\n");
}
