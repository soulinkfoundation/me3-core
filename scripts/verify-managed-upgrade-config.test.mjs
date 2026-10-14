import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    const historical = [...queueNames, `${workerName}-assistant-job-events`, `${workerName}-assistant-job-events-dlq`];
    assert.deepEqual(contract(configPath, { queueNames: historical, releaseTag: "v0.1.214" }).queueNames, [...queueNames].sort());
    assert.throws(() => contract(configPath, { queueNames: historical, releaseTag: "v0.1.213" }), /upgrade config is invalid/);
    assert.throws(() => contract(configPath, { queueNames: [...historical, `${workerName}-foreign-events`], releaseTag: "v0.1.214" }), /upgrade config is invalid/);


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

test("accepts historical SDK binding and creation metadata without a runtime selector", () => {
  const directory = mkdtempSync(join(tmpdir(), "me3-sdk-upgrade-config-"));
  const configPath = join(directory, "wrangler.toml");
  const sdkConfig = config().replace(
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

test("accepts the isolated agent runtime only with its exact binding and additive migration", () => {
  const directory = mkdtempSync(join(tmpdir(), "me3-agent-upgrade-config-"));
  const configPath = join(directory, "wrangler.toml");
  const agentConfig = config().replace(
    '[[migrations]]',
    '[[durable_objects.bindings]]\nname = "ME3_AGENT"\nclass_name = "Me3Agent"\n[[migrations]]',
  ).replace(
    'new_sqlite_classes = ["Me3UserAgent"]',
    'new_sqlite_classes = ["Me3UserAgent"]\n[[migrations]]\ntag = "2026-10-10-me3-agent"\nnew_sqlite_classes = ["Me3Agent"]',
  );
  try {
    writeFileSync(configPath, agentConfig);
    assert.equal(contract(configPath).d1Id, d1Id);
    for (const unsafe of [
      agentConfig.replace('name = "ME3_AGENT"', 'name = "MISSING_AGENT"'),
      agentConfig.replace('class_name = "Me3Agent"', 'class_name = "OtherAgent"'),
      `${agentConfig}\n[[durable_objects.bindings]]\nname = "ME3_AGENT"\nclass_name = "Me3Agent"\n`,
      `${agentConfig}\n[[migrations]]\ntag = "delete"\ndeleted_classes = ["Me3UserAgent"]\n`,
    ]) {
      writeFileSync(configPath, unsafe);
      assert.throws(() => contract(configPath), /upgrade config is invalid/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("accepts only the exact SDK retirement while retaining both live namespace identities", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "me3-sdk-retirement-"));
  const configPath = join(directory, "wrangler.toml");
  const tag = "2026-10-12-retire-sdk-user-agent";
  const deletion = `[[migrations]]\ntag = "${tag}"\ndeleted_classes = ["Me3SdkUserAgent"]\n`;
  const retired = config().replace(
    '[[migrations]]',
    '[[durable_objects.bindings]]\nname = "ME3_AGENT"\nclass_name = "Me3Agent"\n[[migrations]]',
  ) + '\n[[migrations]]\ntag = "2026-10-01-me3-sdk-user-agent"\nnew_sqlite_classes = ["Me3SdkUserAgent"]\n'
    + '\n[[migrations]]\ntag = "2026-10-10-me3-agent"\nnew_sqlite_classes = ["Me3Agent"]\n' + deletion;
  try {
    await t.test("unbound SDK creation is rejected because managed Workers never exported it", () => {
      writeFileSync(configPath, retired);
      assert.throws(() => contract(configPath), /upgrade config is invalid/);
    });
    await t.test("exact SDK tombstone is accepted without recreating the class", () => {
      writeFileSync(configPath, retired.replace('\n[[migrations]]\ntag = "2026-10-01-me3-sdk-user-agent"\nnew_sqlite_classes = ["Me3SdkUserAgent"]\n', ""));
      assert.equal(contract(configPath).durableObjectNamespaceId, "b".repeat(32));
      assert.equal(contract(configPath).d1Id, d1Id);
    });
    for (const [name, unsafe] of [
      ["wrong tag", retired.replace(tag, "other-retirement")],
      ["normal namespace deletion", retired.replace('deleted_classes = ["Me3SdkUserAgent"]', 'deleted_classes = ["Me3UserAgent"]')],
      ["new agent deletion", retired.replace('deleted_classes = ["Me3SdkUserAgent"]', 'deleted_classes = ["Me3Agent"]')],
      ["extra class deletion", retired.replace('deleted_classes = ["Me3SdkUserAgent"]', 'deleted_classes = ["Me3SdkUserAgent", "ForeignAgent"]')],
      ["duplicate migration", retired + deletion],
      ["duplicate deletion key", retired + 'deleted_classes = ["Me3SdkUserAgent"]\n'],
      ["rename", retired + 'renamed_classes = [{ from = "Me3UserAgent", to = "Other" }]\n'],
      ["transfer", retired + 'transferred_classes = [{ from = "Me3UserAgent", from_script = "foreign", to = "Other" }]\n'],
      ["mixed class creation", retired + 'new_sqlite_classes = ["Me3SdkUserAgent"]\n'],
      ["retired class still bound", retired.replace('[[migrations]]', '[[durable_objects.bindings]]\nname = "ME3_SDK_USER_AGENT"\nclass_name = "Me3SdkUserAgent"\n[[migrations]]')],
      ["missing new namespace", retired.replace('name = "ME3_AGENT"', 'name = "MISSING_AGENT"')],
      ["normal namespace rebound", retired.replace('class_name = "Me3UserAgent"', 'class_name = "Me3Agent"')],
      ["foreign normal namespace", retired.replace('class_name = "Me3UserAgent"', 'class_name = "Me3UserAgent"\nscript_name = "foreign-worker"')],
      ["foreign new namespace", retired.replace('class_name = "Me3Agent"', 'class_name = "Me3Agent"\nenvironment = "foreign"')],
      ["quoted foreign deletion", retired + '\n[[migrations]]\ntag = "foreign"\n"deleted_classes" = ["Me3UserAgent"]\n'],
      ["quoted rename", retired + '\n[[migrations]]\ntag = "foreign"\n"renamed_classes" = [{ from = "Me3UserAgent", to = "Other" }]\n'],
      ["quoted transfer", retired + '\n[[migrations]]\ntag = "foreign"\n\'transferred_classes\' = [{ from = "Me3UserAgent", from_script = "foreign", to = "Other" }]\n'],
      ["quoted foreign creation", retired + '\n[[migrations]]\ntag = "foreign"\n"new_sqlite_classes" = ["ForeignAgent"]\n'],
      ["escaped normal deletion key", retired + '\n[[migrations]]\ntag = "foreign"\n"deleted_\\u0063lasses" = ["Me3UserAgent"]\n'],
      ["escaped rename key", retired + '\n[[migrations]]\ntag = "foreign"\n"renamed_\\u0063lasses" = [{ from = "Me3UserAgent", to = "Other" }]\n'],
      ["escaped transfer key", retired + '\n[[migrations]]\ntag = "foreign"\n"transferred_\\u0063lasses" = [{ from = "Me3UserAgent", from_script = "foreign", to = "Other" }]\n'],
      ["escaped foreign creation key", retired + '\n[[migrations]]\ntag = "foreign"\n"new_sqlite_\\u0063lasses" = ["ForeignAgent"]\n'],
      ["escaped foreign namespace key", retired.replace('class_name = "Me3UserAgent"', 'class_name = "Me3UserAgent"\n"script_\\u006eame" = "foreign-worker"')],
      ["obsolete SDK runtime selector", retired.replace('ME3_DEPLOYMENT_MODE = "managed"', 'ME3_DEPLOYMENT_MODE = "managed"\nME3_ASSISTANT_RUNTIME = "sdk"')],
      ["obsolete agent runtime selector", retired.replace('ME3_DEPLOYMENT_MODE = "managed"', 'ME3_DEPLOYMENT_MODE = "managed"\nME3_ASSISTANT_RUNTIME = "agent"')],
      ["obsolete Jev selector", retired.replace('ME3_DEPLOYMENT_MODE = "managed"', 'ME3_DEPLOYMENT_MODE = "managed"\nME3_JEV_ROUTER_MODE = "off"')],
    ]) {
      await t.test(name, () => {
        writeFileSync(configPath, unsafe);
        assert.throws(() => contract(configPath), name === "normal namespace rebound"
          ? /managed Durable Object binding is invalid/
          : /upgrade config is invalid/);
      });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("both shipped configs retain normal namespace history and deploy only the new chat agent", async (t) => {
  for (const relative of ["../wrangler.toml", "../apps/worker/wrangler.core.example.toml"]) {
    await t.test(relative, () => {
      const value = readFileSync(new URL(relative, import.meta.url), "utf8");
      assert.match(value, /name = "ME3_USER_AGENT"\s+class_name = "Me3UserAgent"/);
      assert.match(value, /name = "ME3_AGENT"\s+class_name = "Me3Agent"/);
      assert.doesNotMatch(value, /name = "ME3_SDK_USER_AGENT"/);
      assert.match(value, /tag = "2026-05-11-me3-core-user-agent"\s+new_sqlite_classes = \["Me3UserAgent"\]/);
      assert.match(value, /tag = "2026-10-10-me3-agent"\s+new_sqlite_classes = \["Me3Agent"\]/);
      if (relative === "../wrangler.toml") {
        // Deployed root installs never created the SDK class (me3 v0.1.219 upgrade failure).
        assert.doesNotMatch(value, /Me3SdkUserAgent/);
      } else {
        assert.match(value, /tag = "2026-10-01-me3-sdk-user-agent"\s+new_sqlite_classes = \["Me3SdkUserAgent"\]/);
        assert.match(value, /tag = "2026-10-12-retire-sdk-user-agent"\s+deleted_classes = \["Me3SdkUserAgent"\]/);
      }
      assert.doesNotMatch(value, /^\s*(?:#\s*)?ME3_(?:ASSISTANT_RUNTIME|JEV_ROUTER_MODE)\s*=/m);
    });
  }
});

function contract(configPath, overrides = {}) {
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
    ...overrides,
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
