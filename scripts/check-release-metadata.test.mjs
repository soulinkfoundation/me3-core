import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseMetadataProblem } from "./check-release-metadata.mjs";

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
