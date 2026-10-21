import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const script = path.join(import.meta.dirname, "managed-install-background.sh");

function withRunnerTemp(run) {
  const runnerTemp = mkdtempSync(path.join(tmpdir(), "me3-background-"));
  const background = (...args) =>
    spawnSync("bash", [script, ...args], {
      encoding: "utf8",
      env: { ...process.env, RUNNER_TEMP: runnerTemp, ME3_BACKGROUND_TIMEOUT_SECONDS: "20" },
    });
  try {
    run(background);
  } finally {
    rmSync(runnerTemp, { recursive: true, force: true });
  }
}

test("start returns while the task runs, even when the caller reads its output", () => {
  withRunnerTemp((background) => {
    const started = Date.now();
    const result = background("start", "slow", "bash", "-c", "sleep 2; echo finished");
    assert.equal(result.status, 0, result.stderr);
    assert.ok(Date.now() - started < 1500, "start waited for the task");

    const waited = background("wait", "slow");
    assert.equal(waited.status, 0, waited.stdout);
    assert.match(waited.stdout, /finished/);
  });
});

test("wait fails for a failed or never-started task and settle ignores both", () => {
  withRunnerTemp((background) => {
    assert.equal(background("start", "ok", "true").status, 0);
    assert.equal(background("start", "broken", "bash", "-c", "echo nope; exit 3").status, 0);

    const waited = background("wait", "ok", "broken");
    assert.equal(waited.status, 1);
    assert.match(waited.stdout, /broken failed with exit status 3/);
    assert.match(waited.stdout, /nope/);

    const missing = background("wait", "missing");
    assert.equal(missing.status, 1);
    assert.match(missing.stdout, /missing was never started/);

    assert.equal(background("settle", "ok", "broken", "missing").status, 0);
  });
});

test("a task name is started once and must be plain", () => {
  withRunnerTemp((background) => {
    assert.equal(background("start", "once", "true").status, 0);
    assert.notEqual(background("start", "once", "true").status, 0);
    assert.notEqual(background("start", "../escape", "true").status, 0);
    assert.notEqual(background("start", "nothing").status, 0);
  });
});
