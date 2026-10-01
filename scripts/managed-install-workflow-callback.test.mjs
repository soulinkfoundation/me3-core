import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { sendManagedInstallWorkflowCallback } from "./managed-install-workflow-callback.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const workflow = readFileSync(
  path.join(rootDir, ".github/workflows/provision-managed-install.yml"),
  "utf8",
);
const callbackEnv = {
  ME3_MANAGED_CALLBACK_URL:
    "https://api.me3.app/api/managed-install/provisioning/callback",
  ME3_MANAGED_CALLBACK_SECRET: "test-callback-secret",
  ME3_MANAGED_INSTALLATION_ID: "mi-1234567890abcdef",
  ME3_MANAGED_RELEASE_TAG: "v1.2.3",
  ME3_MANAGED_CANONICAL_HOSTNAME: "owner.me3.app",
  ME3_MANAGED_STATUS: "ready",
  ME3_MANAGED_ORIGIN: "https://owner.me3.app",
  ME3_MANAGED_D1_ID: "11111111-1111-4111-8111-111111111111",
  ME3_MANAGED_QUEUE_NAMES:
    '["me3-mi-1234567890abcdef-assistant-job-events"]',
  ME3_MANAGED_DO_NAMESPACE_ID: "a".repeat(32),
};

test("a rejected activation callback fails without exposing its response or secret", async () => {
  let requestBody;

  await assert.rejects(
    sendManagedInstallWorkflowCallback(callbackEnv, async (_url, init) => {
      assert.equal(init.headers.Authorization, "Bearer test-callback-secret");
      requestBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({ ok: false, errorCode: "activation_failed" }),
        { status: 409 },
      );
    }),
    (error) => {
      assert.equal(error.message, "managed callback returned 409");
      assert.doesNotMatch(error.message, /activation_failed|test-callback-secret/);
      return true;
    },
  );

  assert.deepEqual(requestBody, {
    installationId: "mi-1234567890abcdef",
    releaseTag: "v1.2.3",
    status: "ready",
    origin: "https://owner.me3.app",
    d1Id: "11111111-1111-4111-8111-111111111111",
    queueNames: ["me3-mi-1234567890abcdef-assistant-job-events"],
    durableObjectNamespaceId: "a".repeat(32),
  });
});

test("every callback status reports the exact managed release tag", async () => {
  for (const status of ["provisioning", "ready", "failed"]) {
    let requestBody;
    await sendManagedInstallWorkflowCallback(
      {
        ...callbackEnv,
        ME3_MANAGED_STATUS: status,
        ...(status === "provisioning"
          ? { ME3_MANAGED_STAGE: "resources" }
          : {}),
      },
      async (_url, init) => {
        requestBody = JSON.parse(init.body);
        return new Response(null, { status: 204 });
      },
    );

    assert.equal(requestBody.releaseTag, callbackEnv.ME3_MANAGED_RELEASE_TAG);
  }
});

test("the workflow binds callbacks and deployment to the exact dispatch release tag", () => {
  assert.match(
    workflow,
    /ME3_MANAGED_RELEASE_TAG: \$\{\{ inputs\.release_tag \}\}/,
  );
  assert.match(
    getStep("Check out the exact ME3 release"),
    /ref: \$\{\{ inputs\.release_tag \}\}/,
  );
  assert.match(
    getStep("Publish the managed Worker"),
    /--tag "\$ME3_MANAGED_RELEASE_TAG"/,
  );
});

test("rejects a missing or non-stable callback release tag", async () => {
  for (const releaseTag of ["", "1.2.3", "v1.2.3-rc.1", "V1.2.3"]) {
    await assert.rejects(
      sendManagedInstallWorkflowCallback(
        { ...callbackEnv, ME3_MANAGED_RELEASE_TAG: releaseTag },
        async () => new Response(null, { status: 204 }),
      ),
      /callback configuration is invalid/,
    );
  }
});

test("ready cannot activate without every immutable resource identifier", async () => {
  await assert.rejects(
    sendManagedInstallWorkflowCallback(
      { ...callbackEnv, ME3_MANAGED_DO_NAMESPACE_ID: "" },
      async () => new Response(null, { status: 204 }),
    ),
    /complete resource manifest/,
  );
});

test("a failure callback carries exact recovered Worker deployment proof", async () => {
  let requestBody;
  await sendManagedInstallWorkflowCallback(
    {
      ...callbackEnv,
      ME3_MANAGED_STATUS: "failed",
      ME3_MANAGED_WORKER_PRESENT: "true",
      ME3_MANAGED_WORKER_PUBLIC: "false",
      ME3_MANAGED_ORIGIN: "",
    },
    async (_url, init) => {
      requestBody = JSON.parse(init.body);
      return new Response(null, { status: 204 });
    },
  );

  assert.equal(requestBody.workerPresent, true);
  assert.equal(requestBody.workerPublic, false);
  assert.equal(Object.hasOwn(requestBody, "origin"), false);

  await assert.rejects(
    sendManagedInstallWorkflowCallback(
      {
        ...callbackEnv,
        ME3_MANAGED_STATUS: "failed",
        ME3_MANAGED_WORKER_PRESENT: "false",
        ME3_MANAGED_WORKER_PUBLIC: "true",
        ME3_MANAGED_ORIGIN: "",
      },
      async () => new Response(null, { status: 204 }),
    ),
    /resource manifest is invalid/,
  );
  await assert.rejects(
    sendManagedInstallWorkflowCallback(
      {
        ...callbackEnv,
        ME3_MANAGED_STATUS: "failed",
        ME3_MANAGED_WORKER_PRESENT: "true",
        ME3_MANAGED_WORKER_PUBLIC: "true",
        ME3_MANAGED_ORIGIN: "https://unrelated.example",
      },
      async () => new Response(null, { status: 204 }),
    ),
    /resource manifest is invalid/,
  );
});

test("the workflow treats activation as a gate and reports only a generic follow-up failure", () => {
  const activation = getStep("Activate through ME3 Cloud");
  const failure = getStep("Report a safe failure");

  assert.match(activation, /ME3_MANAGED_STATUS: ready/);
  assert.match(
    activation,
    /run: node control\/scripts\/managed-install-workflow-callback\.mjs/,
  );
  assert.doesNotMatch(activation, /continue-on-error:\s*true/);
  assert.match(failure, /if: failure\(\)/);
  assert.match(failure, /ME3_MANAGED_STATUS: failed/);
  assert.match(failure, /ME3_MANAGED_ERROR_CODE: workflow_failed/);
  assert.ok(workflow.indexOf(activation) < workflow.indexOf(failure));
});

test("the workflow provisions the managed email install identity and HTTPS gateway origin", () => {
  assert.match(
    workflow,
    /ME3_MANAGED_EMAIL_GATEWAY_ORIGIN: https:\/\/api\.me3\.app/,
  );
  const configureCalls = workflow.match(/configure-managed-install\.mjs[^\n]+/g) || [];
  assert.equal(configureCalls.length, 2);
  for (const call of configureCalls) {
    assert.match(call, /"\$ME3_MANAGED_INSTALLATION_ID"/);
    assert.match(call, /"\$ME3_MANAGED_EMAIL_GATEWAY_ORIGIN"/);
    assert.match(call, /"\$ME3_MANAGED_ORIGIN"/);
  }
});

test("the workflow installs hosted provider keys as Worker secret bindings", () => {
  const installSecret = getStep("Install the hosted provider secrets");
  const publish = getStep("Publish the managed Worker");

  assert.doesNotMatch(installSecret, /OPENAI_API_KEY/);
  assert.match(
    installSecret,
    /ME3_MANAGED_PEXELS_API_KEY: \$\{\{ secrets\.ME3_MANAGED_PEXELS_API_KEY \}\}/,
  );
  assert.match(
    installSecret,
    /wrangler secret put PEXELS_API_KEY --config wrangler\.toml/,
  );
  assert.doesNotMatch(installSecret, /ME3_AI_IMAGE_GENERATION_/);
  assert.ok(workflow.indexOf(installSecret) < workflow.indexOf(publish));
});

test("the workflow keeps workers.dev private and attaches the exact managed hostname", () => {
  const publish = getStep("Publish the managed Worker");
  const attach = getStep("Attach the permanent managed hostname");

  assert.match(workflow, /canonical_hostname:\n\s+description: Permanent owner-facing hostname/);
  assert.match(workflow, /zone_id:\n\s+description: Cloudflare zone containing the permanent hostname/);
  assert.match(workflow, /ME3_MANAGED_ORIGIN: https:\/\/\$\{\{ inputs\.canonical_hostname \}\}/);
  assert.match(publish, /configure-managed-install\.mjs[^\n]+ false /);
  assert.doesNotMatch(publish, /\.workers\.dev|tee |grep /);
  assert.match(attach, /attach-managed-custom-domain\.mjs/);
  assert.ok(workflow.indexOf(publish) < workflow.indexOf(attach));
});

test("the workflow waits for a newly published managed origin to become routable", () => {
  const verification = getStep("Verify the real managed origin");
  const requests = verification.match(/^\s+curl [^\n]+$/gm) || [];

  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.match(request, /--retry 15/);
    assert.match(request, /--retry-delay 2/);
    assert.match(request, /--retry-max-time 60/);
    assert.match(request, /--retry-all-errors/);
    assert.match(request, /--connect-timeout 10/);
  }
  assert.match(requests[0], /\/health/);
  assert.match(requests[1], /\/api\/mobile\/config/);
});

test("the workflow recovers authoritative Worker proof before a failure callback", () => {
  const publish = getStep("Publish the managed Worker");
  const recovery = getStep("Recover every known resource identifier");
  const failure = getStep("Report a safe failure");

  assert.match(recovery, /if: always\(\)/);
  assert.match(recovery, /recover-managed-provision-manifest\.mjs/);
  assert.ok(workflow.indexOf(publish) < workflow.indexOf(recovery));
  assert.ok(workflow.indexOf(recovery) < workflow.indexOf(failure));
});

function getStep(name) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  assert.notEqual(start, -1, `Missing workflow step: ${name}`);
  const end = workflow.indexOf("\n      - name: ", start + 1);
  return workflow.slice(start, end === -1 ? undefined : end);
}
