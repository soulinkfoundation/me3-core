import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyManagedUpgradeRelease } from "./verify-managed-upgrade-release.mjs";

test("pins a stable tag to its immutable commit and matching Core metadata", () => {
  const directory = mkdtempSync(join(tmpdir(), "me3-upgrade-release-"));
  const metadataPath = join(directory, "me3-core.json");
  writeFileSync(
    metadataPath,
    JSON.stringify({
      schemaVersion: 1,
      version: "0.1.109",
      releaseChannel: "stable",
      releaseNotesUrl:
        "https://github.com/soulinkfoundation/me3-core/releases/tag/v0.1.109",
    }),
  );
  const sha = "a".repeat(40);
  try {
    assert.deepEqual(
      verifyManagedUpgradeRelease({
        metadataPath,
        targetReleaseTag: "v0.1.109",
        targetReleaseSha: sha,
        actualReleaseSha: sha,
      }),
      { tag: "v0.1.109", version: "0.1.109", commitSha: sha },
    );
    for (const change of [
      { actualReleaseSha: "b".repeat(40) },
      { targetReleaseTag: "v0.1.108" },
    ]) {
      assert.throws(
        () =>
          verifyManagedUpgradeRelease({
            metadataPath,
            targetReleaseTag: "v0.1.109",
            targetReleaseSha: sha,
            actualReleaseSha: sha,
            ...change,
          }),
        /release metadata is invalid/,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("accepts the stale notes link only in the exact published v0.1.217 commit", () => {
  const directory = mkdtempSync(join(tmpdir(), "me3-upgrade-217-"));
  const metadataPath = join(directory, "me3-core.json");
  const sha = "e9706e7ba72db265e519fa087c8f507b34e5995d";
  const metadata = {
    schemaVersion: 1,
    version: "0.1.217",
    releaseChannel: "stable",
    releaseNotesUrl: "https://github.com/soulinkfoundation/me3-core/releases/tag/v0.1.216",
  };
  const input = {
    metadataPath,
    targetReleaseTag: "v0.1.217",
    targetReleaseSha: sha,
    actualReleaseSha: sha,
  };
  try {
    writeFileSync(metadataPath, JSON.stringify(metadata));
    assert.deepEqual(verifyManagedUpgradeRelease(input), {
      tag: "v0.1.217", version: "0.1.217", commitSha: sha,
    });
    assert.throws(() => verifyManagedUpgradeRelease({
      ...input, targetReleaseSha: "b".repeat(40), actualReleaseSha: "b".repeat(40),
    }), /release metadata is invalid/);
    for (const releaseNotesUrl of [
      "https://example.test/releases/tag/v0.1.216",
      "https://github.com/soulinkfoundation/me3-core/releases/tag/v0.1.215",
    ]) {
      writeFileSync(metadataPath, JSON.stringify({ ...metadata, releaseNotesUrl }));
      assert.throws(() => verifyManagedUpgradeRelease(input), /release metadata is invalid/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
