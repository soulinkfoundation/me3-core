import assert from "node:assert/strict";
import test from "node:test";
import { verifyManagedUpgradeRuntime } from "./verify-managed-upgrade-runtime.mjs";

const input = {
  publicOrigin: "https://owner.me3.app",
  canonicalHostname: "owner.me3.app",
  expectedReleaseTag: "v0.1.109",
};

test("attests health, mobile, and version through the exact live origin", async () => {
  const paths = [];
  const result = await verifyManagedUpgradeRuntime(
    input,
    async (value, init) => {
      const url = new URL(value);
      paths.push(url.pathname);
      assert.equal(url.origin, input.publicOrigin);
      assert.equal(init.redirect, "error");
      return runtimeResponse(url.pathname);
    },
    { attempts: 1, delayMs: 0 },
  );

  assert.deepEqual(paths.sort(), [
    "/api/core/version",
    "/api/mobile/config",
    "/health",
  ]);
  assert.equal(result.releaseTag, input.expectedReleaseTag);
  assert.equal(result.coreInstallId, coreInstallId());
});

test("rejects a stale live release even when every binding is healthy", async () => {
  await assert.rejects(
    verifyManagedUpgradeRuntime(
      input,
      async (value) => runtimeResponse(new URL(value).pathname, "0.1.108"),
      { attempts: 1, delayMs: 0 },
    ),
    /live runtime does not match/,
  );
});

test("reports which release response is stale", async () => {
  await assert.rejects(
    verifyManagedUpgradeRuntime(
      input,
      async (value) => runtimeResponse(new URL(value).pathname, "0.1.108"),
      { attempts: 1, delayMs: 0 },
    ),
    /health release \(received 0\.1\.108\/stable\).*core release \(received 0\.1\.108\/stable\)/,
  );
});

test("reports endpoint transport and response failures without response bodies", async () => {
  await assert.rejects(
    verifyManagedUpgradeRuntime(
      input,
      async (value) => {
        const path = new URL(value).pathname;
        if (path === "/health") return new Response("secret", { status: 503 });
        if (path === "/api/mobile/config") {
          return new Response("<html>not JSON</html>", {
            status: 200,
            headers: { "Content-Type": "text/html" },
          });
        }
        return runtimeResponse(path);
      },
      { attempts: 1, delayMs: 0 },
    ),
    /request failure: health \(HTTP 503\), mobile \(unexpected content type text\/html\)/,
  );
});

test("waits for the target release to replace a healthy stale Worker version", async () => {
  let healthCalls = 0;
  const result = await verifyManagedUpgradeRuntime(
    input,
    async (value) => {
      const path = new URL(value).pathname;
      if (path === "/health") healthCalls += 1;
      return runtimeResponse(path, healthCalls <= 1 ? "0.1.108" : "0.1.109");
    },
    { attempts: 2, delayMs: 0 },
  );
  assert.equal(result.version, "0.1.109");
  assert.equal(healthCalls, 2);
});

test("rejects a mobile response for another public origin", async () => {
  await assert.rejects(
    verifyManagedUpgradeRuntime(
      input,
      async (value) => {
        const path = new URL(value).pathname;
        if (path === "/api/mobile/config") {
          return json({
            installId: coreInstallId(),
            publicURL: "https://other.me3.app",
            mobileApiVersion: 1,
            auth: { pairing: "owner-approved-code" },
          });
        }
        return runtimeResponse(path);
      },
      { attempts: 1, delayMs: 0 },
    ),
    /live runtime does not match/,
  );
});

function runtimeResponse(path, version = "0.1.109") {
  if (path === "/health") {
    return json({
      ok: true,
      service: "me3-core",
      core: { version, releaseChannel: "stable" },
      bindings: {
        db: true,
        userAgent: true,
        workersAi: true,
        siteAssets: true,
      },
      hosts: { admin: "owner.me3.app", api: "owner.me3.app" },
    });
  }
  if (path === "/api/mobile/config") {
    return json({
      installId: coreInstallId(),
      publicURL: "https://owner.me3.app/mobile/",
      mobileApiVersion: 1,
      auth: { pairing: "owner-approved-code" },
    });
  }
  if (path === "/api/core/version") {
    return json({ version, releaseChannel: "stable" });
  }
  return new Response(null, { status: 404 });
}

function coreInstallId() {
  return "core_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
}

function json(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
