import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const rootDir = path.resolve(import.meta.dirname, "..");
const workflow = readFileSync(
  path.join(rootDir, ".github/workflows/upgrade-managed-install.yml"),
  "utf8",
);

test("requires the exact attempt, releases, commit, and complete frozen identities", () => {
  for (const input of [
    "attempt_id",
    "installation_id",
    "current_release_tag",
    "target_release_tag",
    "target_release_sha",
    "worker_name",
    "d1_name",
    "d1_id",
    "r2_name",
    "queue_names",
    "durable_object_namespace_id",
    "public_origin",
    "canonical_hostname",
    "zone_id",
    "callback_url",
  ]) {
    assert.match(workflow, new RegExp(`^      ${input}:\\n`, "m"));
  }
  assert.match(
    workflow,
    /group: managed-install-\$\{\{ inputs\.installation_id \}\}/,
  );
  assert.match(
    workflow,
    /ME3_MANAGED_ATTEMPT_ID: \$\{\{ inputs\.attempt_id \}\}/,
  );
});

test("checks out and verifies the immutable target before build or deployment", () => {
  const checkout = getStep("Check out the exact target release");
  const verify = getStep("Verify the immutable target release");
  const build = getStep("Build the pinned target release");
  const deploy = getStep("Deploy the target to the existing Worker");

  assert.match(checkout, /ref: \$\{\{ inputs\.target_release_tag \}\}/);
  assert.match(verify, /git -C source rev-parse HEAD/);
  assert.match(verify, /--target-release-sha "\$ME3_MANAGED_TARGET_RELEASE_SHA"/);
  assert.match(deploy, /--tag "\$ME3_MANAGED_TARGET_RELEASE_TAG"/);
  assert.ok(workflow.indexOf(verify) < workflow.indexOf(build));
  assert.ok(workflow.indexOf(build) < workflow.indexOf(deploy));
});

test("reuses frozen resources and contains no first-install or destructive operation", () => {
  const binding = getStep("Bind only the frozen managed resources");
  assert.match(binding, /prepare-cloudflare-deploy\.mjs/);
  assert.match(binding, /configure-managed-upgrade-origin\.mjs/);
  assert.match(binding, /--skip-create/);
  assert.match(binding, /bind-managed-resource-manifest\.mjs/);
  assert.match(binding, /verify-managed-upgrade-config\.mjs/);
  assert.match(binding, /\n\s+false \\\n/);

  for (const unsafe of [
    /provision-managed-queues\.mjs/,
    /attach-managed-custom-domain\.mjs/,
    /recover-managed-provision-manifest\.mjs/,
    /wrangler d1 create/,
    /wrangler r2 bucket create/,
    /wrangler delete/,
  ]) {
    assert.doesNotMatch(workflow, unsafe);
  }
});

test("installs hosted provider secrets before deploying the target", () => {
  const installSecret = getStep("Install the hosted provider secrets");
  const deploy = getStep("Deploy the target to the existing Worker");
  const secretWrites = workflow.match(/wrangler secret put/g) || [];

  assert.equal(secretWrites.length, 1);
  assert.doesNotMatch(installSecret, /OPENAI_API_KEY/);
  assert.match(
    installSecret,
    /ME3_MANAGED_PEXELS_API_KEY: \$\{\{ secrets\.ME3_MANAGED_PEXELS_API_KEY \}\}/,
  );
  assert.match(
    installSecret,
    /wrangler secret put PEXELS_API_KEY --config wrangler\.toml/,
  );
  assert.match(
    installSecret,
    /ME3_MANAGED_FAILURE_STAGE=preparing/,
  );
  assert.doesNotMatch(installSecret, /ME3_AI_IMAGE_GENERATION_/);
  assert.ok(workflow.indexOf(installSecret) < workflow.indexOf(deploy));
});

test("refuses stale state before migration and re-attests resources and live target after deploy", () => {
  const currentResources = getStep(
    "Verify every current Cloudflare resource identity",
  );
  const currentRuntime = getStep(
    "Verify the attested current release at the live origin",
  );
  const migrate = getStep("Apply migrations to the frozen D1 database");
  const deploy = getStep("Deploy the target to the existing Worker");
  const targetResources = getStep(
    "Re-verify every frozen Cloudflare resource identity",
  );
  const targetRuntime = getStep(
    "Verify health and mobile at the live target origin",
  );
  const complete = getStep("Complete the exact upgrade attempt");

  assert.match(
    currentRuntime,
    /--expected-release-tag "\$ME3_MANAGED_CURRENT_RELEASE_TAG"/,
  );
  assert.match(
    targetRuntime,
    /--expected-release-tag "\$ME3_MANAGED_TARGET_RELEASE_TAG"/,
  );
  assert.ok(workflow.indexOf(currentResources) < workflow.indexOf(migrate));
  assert.ok(workflow.indexOf(currentRuntime) < workflow.indexOf(migrate));
  assert.ok(workflow.indexOf(deploy) < workflow.indexOf(targetResources));
  assert.ok(workflow.indexOf(deploy) < workflow.indexOf(targetRuntime));
  assert.ok(workflow.indexOf(targetResources) < workflow.indexOf(complete));
  assert.ok(workflow.indexOf(targetRuntime) < workflow.indexOf(complete));
});

test("reports attempt-correlated stages and only completes after live verification", () => {
  for (const stage of [
    "validating",
    "checking_current",
    "preparing",
    "building",
    "migrating",
    "deploying",
    "verifying",
    "completed",
  ]) {
    assert.match(workflow, new RegExp(`ME3_MANAGED_STAGE: ${stage}`));
  }
  const complete = getStep("Complete the exact upgrade attempt");
  const failure = getStep("Report a safe upgrade failure");
  assert.match(complete, /ME3_MANAGED_STATUS: succeeded/);
  assert.match(failure, /if: failure\(\)/);
  assert.match(failure, /ME3_MANAGED_ERROR_CODE: workflow_failed/);
  assert.match(
    failure,
    /ME3_MANAGED_STAGE: \$\{\{ env\.ME3_MANAGED_FAILURE_STAGE \}\}/,
  );
});

test("does not expose deploy or callback credentials to install and build", () => {
  const install = getStep("Install the pinned target release");
  const build = getStep("Build the pinned target release");
  for (const step of [install, build]) {
    assert.doesNotMatch(step, /CLOUDFLARE_API_TOKEN/);
    assert.doesNotMatch(step, /ME3_MANAGED_UPGRADE_CALLBACK_SECRET/);
    assert.doesNotMatch(step, /ME3_MANAGED_OPENAI_API_KEY/);
  }
});

function getStep(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `Missing workflow step: ${name}`);
  const end = workflow.indexOf("\n      - name: ", start + 1);
  return workflow.slice(start, end === -1 ? undefined : end);
}
