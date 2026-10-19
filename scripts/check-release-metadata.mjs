#!/usr/bin/env node
// Fails when the newest release in updates/stable.json ships Worker/D1 migrations
// without migrationRequired: true. Run it after bumping release metadata and before
// tagging: it compares the previous release tag with the new tag, or with HEAD when
// the new tag does not exist yet.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MIGRATION_PATHS = ["apps/worker/migrations", "apps/worker/src/core-runtime-migrations.ts"];

export function releaseMetadataProblem({ latest, previous, changedMigrationFiles }) {
  if (!latest || !previous) return null;
  if (changedMigrationFiles.length && latest.migrationRequired !== true) {
    return `${latest.tag || latest.version} changes migrations since ${previous.tag} (${changedMigrationFiles.join(", ")}) but migrationRequired is not true in updates/stable.json.`;
  }
  return null;
}

function git(args) {
  return execFileSync("git", args, { cwd: rootDir, encoding: "utf8" }).trim();
}

function tagExists(tag) {
  try {
    git(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const manifest = JSON.parse(await readFile(path.join(rootDir, "updates/stable.json"), "utf8"));
  const [newest, previous] = manifest.releases || [];
  // Installs read the top-level latest entry, so both copies of the flag must agree.
  const latest = newest && {
    ...newest,
    migrationRequired: newest.migrationRequired === true && manifest.latest?.migrationRequired === true,
  };
  if (!previous?.tag || !tagExists(previous.tag)) {
    console.log("No earlier tagged release to compare against.");
    return;
  }
  const target = latest?.tag && tagExists(latest.tag) ? latest.tag : "HEAD";
  const changed = git(["diff", "--name-only", `${previous.tag}..${target}`, "--", ...MIGRATION_PATHS])
    .split("\n")
    .filter(Boolean);
  const problem = releaseMetadataProblem({ latest, previous, changedMigrationFiles: changed });
  if (problem) {
    console.error(problem);
    process.exitCode = 1;
    return;
  }
  console.log(`${latest.tag || latest.version}: migrationRequired matches the migrations since ${previous.tag}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
