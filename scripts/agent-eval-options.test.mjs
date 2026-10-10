import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("offline CLI records an explicit grader without a paid call and rejects unsupported graders", () => {
  const directory = mkdtempSync(join(tmpdir(), "me3-grader-options-"));
  try {
    const path = join(directory, "report.json");
    const args = ["--import", "tsx", "scripts/evaluate-agent.mjs", "--runtime=new", "--model=scripted-fixture", "--limit=1", "--repeat=1", "--date=2026-10-10", `--report=${path}`];
    const result = spawnSync(process.execPath, [...args, "--grader-model=anthropic:claude-sonnet-5.5"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(report.graderModel, "anthropic:claude-sonnet-5.5"); assert.equal(report.live, false); assert.equal(report.gate.passed, false);
    assert.equal(report.graderOutput.mode, "anthropic-json-schema");
    assert.equal(report.graderOutput.requestField, "output_config.format");
    const rejected = spawnSync(process.execPath, [...args, "--grader-model=openai:unapproved-cheap-model"], { encoding: "utf8" });
    assert.notEqual(rejected.status, 0); assert.match(rejected.stderr, /grader/i);
  } finally { rmSync(directory, { recursive: true }); }
});
