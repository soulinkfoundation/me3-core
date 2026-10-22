import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const script = path.resolve(import.meta.dirname, "update-core.mjs");
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "ME3 Test",
  GIT_AUTHOR_EMAIL: "test@example.test",
  GIT_COMMITTER_NAME: "ME3 Test",
  GIT_COMMITTER_EMAIL: "test@example.test",
};

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" }).trim();
}

function writeRelease(dir, version, line2) {
  writeFileSync(path.join(dir, "package.json"), `${JSON.stringify({ name: "me3", version })}\n`);
  writeFileSync(
    path.join(dir, "me3-core.json"),
    `${JSON.stringify({ schemaVersion: 1, version, updateManifestUrl: "updates/stable.json" })}\n`,
  );
  writeFileSync(path.join(dir, "app.txt"), `line1\n${line2}\nline3\n`);
}

test("a copy of an unreleased upstream commit updates to the next release without conflicts", () => {
  const root = mkdtempSync(path.join(tmpdir(), "me3-update-base-"));
  const upstream = path.join(root, "upstream");
  const copy = path.join(root, "copy");
  try {
    mkdirSync(path.join(upstream, "scripts"), { recursive: true });
    mkdirSync(path.join(upstream, "updates"), { recursive: true });
    copyFileSync(script, path.join(upstream, "scripts/update-core.mjs"));
    writeFileSync(path.join(upstream, "updates/stable.json"), `${JSON.stringify({ latest: { tag: "v0.1.2" } })}\n`);
    git(upstream, "init", "-q", "-b", "main");
    writeRelease(upstream, "0.1.1", "line2");
    git(upstream, "add", ".");
    git(upstream, "commit", "-q", "-m", "release v0.1.1");
    git(upstream, "tag", "v0.1.1");
    // Unreleased work on main that the Deploy button copies before v0.1.2.
    writeRelease(upstream, "0.1.1", "two");
    git(upstream, "commit", "-q", "-am", "feat: change line two");
    writeRelease(upstream, "0.1.2", "two");
    writeFileSync(path.join(upstream, "app.txt"), "line1\ntwo\nline3 released\n");
    git(upstream, "commit", "-q", "-am", "release v0.1.2");
    git(upstream, "tag", "v0.1.2");

    mkdirSync(copy);
    execFileSync("sh", ["-c", `git -C "${upstream}" archive HEAD~1 | tar -x -C "${copy}"`]);
    git(copy, "init", "-q", "-b", "main");
    git(copy, "add", ".");
    git(copy, "commit", "-q", "-m", "Initial commit");
    git(copy, "fetch", "-q", upstream, "refs/tags/*:refs/tags/*");

    const result = spawnSync(
      "node",
      [
        "scripts/update-core.mjs",
        "--yes",
        "--tag",
        "v0.1.2",
        "--skip-fetch",
        "--skip-install",
        "--skip-cloudflare-provision",
        "--skip-doctor",
        "--skip-build",
      ],
      { cwd: copy, env: gitEnv, encoding: "utf8" },
    );

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(readFileSync(path.join(copy, "app.txt"), "utf8"), "line1\ntwo\nline3 released\n");
    assert.equal(JSON.parse(readFileSync(path.join(copy, "me3-core.json"), "utf8")).version, "0.1.2");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
