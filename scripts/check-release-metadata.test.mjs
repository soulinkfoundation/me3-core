import assert from "node:assert/strict";
import { test } from "node:test";
import { coreMetadataProblem, releaseMetadataProblem } from "./check-release-metadata.mjs";

const previous = { version: "0.1.230", tag: "v0.1.230" };

test("flags a release that adds migrations without migrationRequired", () => {
  const problem = releaseMetadataProblem({
    latest: { version: "0.1.231", tag: "v0.1.231", migrationRequired: false },
    previous,
    changedMigrationFiles: ["apps/worker/migrations/0079_site_badge.sql"],
  });
  assert.match(problem, /v0\.1\.231 changes migrations since v0\.1\.230/);
});

test("accepts a release that adds migrations and says so", () => {
  assert.equal(
    releaseMetadataProblem({
      latest: { version: "0.1.231", tag: "v0.1.231", migrationRequired: true },
      previous,
      changedMigrationFiles: ["apps/worker/migrations/0079_site_badge.sql"],
    }),
    null,
  );
});

test("accepts a release without migrations either way", () => {
  assert.equal(
    releaseMetadataProblem({
      latest: { version: "0.1.231", tag: "v0.1.231", migrationRequired: false },
      previous,
      changedMigrationFiles: [],
    }),
    null,
  );
});

test("flags me3-core.json that still names an earlier release's notes", () => {
  const latest = { version: "0.1.249", tag: "v0.1.249" };
  assert.match(
    coreMetadataProblem({
      coreMetadata: {
        version: "0.1.249",
        releaseNotesUrl: "https://github.com/soulinkfoundation/me3-core/releases/tag/v0.1.245",
      },
      latest,
    }),
    /releaseNotesUrl https:\/\/github\.com\/soulinkfoundation\/me3-core\/releases\/tag\/v0\.1\.249/,
  );
  assert.equal(
    coreMetadataProblem({
      coreMetadata: {
        version: "0.1.249",
        releaseNotesUrl: "https://github.com/soulinkfoundation/me3-core/releases/tag/v0.1.249",
      },
      latest,
    }),
    null,
  );
});
