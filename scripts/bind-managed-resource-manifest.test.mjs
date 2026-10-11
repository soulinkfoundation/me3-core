import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bindManagedResourceManifest } from "./bind-managed-resource-manifest.mjs";

const installationId = "mi-1234567890abcdef";
const workerName = `me3-${installationId}`;
const queueNames = [`${workerName}-social-publish`, `${workerName}-social-publish-dlq`];

test("binds the exact D1 id and rejects a queue subset that differs from the release", () => {
  const root = mkdtempSync(join(tmpdir(), "me3-managed-bind-"));
  const configPath = join(root, "wrangler.toml");
  writeFileSync(
    configPath,
    [
      `name = "${workerName}"`,
      "[vars]",
      'ME3_DEPLOYMENT_MODE = "managed"',
      `ME3_MANAGED_INSTALLATION_ID = "${installationId}"`,
      "[[durable_objects.bindings]]",
      'name = "ME3_USER_AGENT"',
      'class_name = "Me3UserAgent"',
      "[[d1_databases]]",
      'binding = "DB"',
      `database_name = "${workerName}-d1"`,
      'database_id = "00000000-0000-0000-0000-000000000000"',
      "[[r2_buckets]]",
      'binding = "SITE_ASSETS"',
      `bucket_name = "${workerName}-r2"`,
      "[[queues.producers]]",
      'binding = "SOCIAL_PUBLISH_QUEUE"',
      `queue = "${queueNames[0]}"`,
      "[[queues.consumers]]",
      `queue = "${queueNames[0]}"`,
      `dead_letter_queue = "${queueNames[1]}"`,
      "[[queues.consumers]]",
      `queue = "${queueNames[1]}"`,
      "",
    ].join("\n"),
  );
  try {
    const manifest = bindManagedResourceManifest({
      configPath,
      installationId,
      workerName,
      d1Name: `${workerName}-d1`,
      d1Id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      r2Name: `${workerName}-r2`,
      queueNames,
    });
    const retired = [`${workerName}-assistant-job-events`, `${workerName}-assistant-job-events-dlq`];
    const historical = { configPath, installationId, workerName, d1Name: `${workerName}-d1`,
      d1Id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", r2Name: `${workerName}-r2`, queueNames: [...queueNames, ...retired] };
    assert.deepEqual(bindManagedResourceManifest({ ...historical, releaseTag: "v0.1.214" }).queueNames, [...queueNames].sort());
    assert.throws(() => bindManagedResourceManifest({ ...historical, releaseTag: "v0.1.213" }), /does not match the pinned release/);
    assert.throws(() => bindManagedResourceManifest({ ...historical, releaseTag: "v0.1.214", queueNames: [...historical.queueNames, `${workerName}-foreign-events`] }), /does not match the pinned release/);
    assert.equal(manifest.d1Id, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    assert.match(readFileSync(configPath, "utf8"), /database_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"/);
    assert.throws(
      () =>
        bindManagedResourceManifest({
          configPath,
          installationId,
          workerName,
          d1Name: `${workerName}-d1`,
          d1Id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          r2Name: `${workerName}-r2`,
          queueNames: [queueNames[0]],
        }),
      /does not match the pinned release/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
