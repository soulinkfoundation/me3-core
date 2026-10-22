#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultUpstreamName = "upstream";
const defaultUpstreamUrl = "https://github.com/soulinkfoundation/me3-core.git";
const defaultManifestUrl =
  "https://raw.githubusercontent.com/soulinkfoundation/me3-core/main/updates/stable.json";

const args = parseArgs(process.argv.slice(2));
const rootDir = resolveRootDir();
const coreMetadataPath = path.join(rootDir, "me3-core.json");
const packageJsonPath = path.join(rootDir, "package.json");
const wranglerConfigPath = path.join(rootDir, "wrangler.toml");

if (!existsSync(packageJsonPath)) {
  fail("Could not find package.json. Run this from the root of your ME3 repository.");
}

if (!isGitRepository()) {
  fail("This does not look like a Git repository. Run this from your copied ME3 repo.");
}

if (isMergeInProgress()) {
  fail("A Git merge is already in progress. Resolve it first, then run pnpm update:core again.");
}

const status = capture("git", ["status", "--porcelain"]);
if (status.trim() && !args.allowDirty) {
  fail(
    [
      "Your working tree has uncommitted changes.",
      "Commit or stash them before updating, or rerun with --allow-dirty if you know these changes are safe.",
      "",
      status.trim(),
    ].join("\n"),
  );
}

const coreMetadata = await loadInstalledCoreMetadata();
const installedVersion = normalizeVersion(coreMetadata.version);
const manifestUrl =
  args.manifestUrl ||
  process.env.ME3_UPDATE_MANIFEST_URL ||
  coreMetadata.updateManifestUrl ||
  defaultManifestUrl;
const manifest = await loadManifest(manifestUrl);
const latest = manifest.latest || {};
const targetTag = args.tag || latest.tag || (latest.version ? `v${latest.version}` : "");
const targetVersion = normalizeVersion(args.tag || latest.version || targetTag);

if (!targetTag) {
  fail("Could not determine the ME3 release tag to merge.");
}

printHeader(`ME3 installed: ${installedVersion || "unknown"}`);
console.log(`ME3 target:    ${targetTag}${targetVersion ? ` (${targetVersion})` : ""}`);
console.log(`Manifest:           ${manifestUrl}`);

if (!args.tag && targetVersion && installedVersion && compareVersions(installedVersion, targetVersion) >= 0) {
  console.log("");
  console.log("ME3 is already up to date.");
  process.exit(0);
}

await confirmProceed(`Update this repository to ${targetTag}?`);

ensureUpstreamRemote();

if (!args.skipFetch) {
  run("git", ["fetch", args.upstreamName, "refs/tags/*:refs/tags/*"]);
}

const targetCommit = resolveCommit(targetTag);
if (!targetCommit) {
  fail(`Could not find ${targetTag}. Check the tag name or run git fetch ${args.upstreamName} 'refs/tags/*:refs/tags/*'.`);
}

if (isAncestor(targetCommit, "HEAD")) {
  console.log("");
  console.log(`${targetTag} is already merged into this repository.`);
  process.exit(0);
}

if (!hasMergeBase("HEAD", targetCommit)) {
  await connectUnrelatedHistory();
}

preserveInstallOwnedFiles();

const mergeResult = run("git", ["merge", "--no-edit", targetTag], { allowFailure: true });
if (mergeResult.status !== 0) {
  console.error("");
  console.error("Git stopped because the update has conflicts.");
  console.error("Resolve the conflicted files, then run:");
  console.error("");
  console.error("  git add <resolved-files>");
  console.error("  git merge --continue");
  console.error("  pnpm install");
  console.error("  pnpm update:doctor");
  console.error("  pnpm build");
  console.error("");
  console.error("For install-owned files, keep your copied repo's Cloudflare resource values.");
  process.exit(mergeResult.status || 1);
}

if (!args.skipInstall) run("pnpm", ["install"]);
if (!args.skipCloudflareProvision) await provisionCloudflareQueues();
if (!args.skipDoctor) run("pnpm", ["update:doctor"]);
if (!args.skipBuild) run("pnpm", ["build"]);

console.log("");
console.log(`ME3 updated to ${targetTag}.`);
console.log("When you are ready to deploy it through Cloudflare Workers Builds, run:");
console.log("");
console.log("  git push origin main");

async function connectUnrelatedHistory() {
  const baseTag =
    args.baseTag ||
    findCopiedUpstreamCommit(targetCommit) ||
    (installedVersion ? `v${installedVersion}` : "");
  if (!baseTag) {
    fail("This repo has unrelated upstream history and no installed version was found for a safe base tag.");
  }

  if (!resolveCommit(baseTag)) {
    fail(
      [
        `This repo has unrelated upstream history, but ${baseTag} was not found.`,
        "Fetch tags or pass --base-tag vX.Y.Z for the version your install was created from.",
      ].join("\n"),
    );
  }

  console.log("");
  console.log("This looks like a Deploy-button-created repository with copied files but no upstream ancestry.");
  console.log(`Connecting Git history at the ME3 version this repo was copied from: ${baseTag}`);
  console.log("Your current files are kept; this only records the common base for future updates.");
  await confirmProceed(`Connect upstream history at ${baseTag}?`);

  run("git", [
    "merge",
    "-s",
    "ours",
    "--allow-unrelated-histories",
    baseTag,
    "-m",
    `Connect ME3 upstream history at ${baseTag}`,
  ]);
}

// A Deploy-button copy starts with one commit holding the exact upstream tree
// it was copied from. That can be an unreleased commit newer than the
// installed version's tag, so the tag alone is the wrong merge base.
function findCopiedUpstreamCommit(target) {
  const roots = capture("git", ["rev-list", "--max-parents=0", "HEAD"], { allowFailure: true })
    .split(/\s+/)
    .filter(Boolean);
  if (roots.length !== 1) return "";
  const tree = capture("git", ["rev-parse", `${roots[0]}^{tree}`], { allowFailure: true }).trim();
  if (!tree) return "";
  const history = capture("git", ["log", "--format=%H %T", target], { allowFailure: true });
  for (const line of history.split("\n")) {
    const [commit, commitTree] = line.split(" ");
    if (commitTree === tree) return commit;
  }
  return "";
}

function ensureUpstreamRemote() {
  const existingUrl = capture("git", ["remote", "get-url", args.upstreamName], { allowFailure: true }).trim();
  if (existingUrl) {
    console.log(`Using ${args.upstreamName}: ${existingUrl}`);
    return;
  }

  run("git", ["remote", "add", args.upstreamName, args.upstreamUrl]);
}

function preserveInstallOwnedFiles() {
  run("git", ["config", "merge.me3-install-ours.driver", "true"]);
  const attributesPath = capture("git", ["rev-parse", "--git-path", "info/attributes"]).trim();
  const line = "wrangler.toml merge=me3-install-ours";
  const existing = existsSync(attributesPath) ? readFileSync(attributesPath, "utf8") : "";
  if (existing.split(/\r?\n/).includes(line)) return;

  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(attributesPath, `${existing}${prefix}${line}\n`);
}

async function loadInstalledCoreMetadata() {
  try {
    return JSON.parse(await readFile(coreMetadataPath, "utf8"));
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    return {
      version: packageJson.version,
      updateManifestUrl: defaultManifestUrl,
    };
  }
}

async function loadManifest(source) {
  if (!/^https?:\/\//i.test(source)) {
    return JSON.parse(await readFile(path.resolve(rootDir, source), "utf8"));
  }

  const response = await fetch(source, {
    headers: {
      Accept: "application/json",
      "User-Agent": `me3-core-update/${installedVersion || "unknown"}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Could not load update manifest: ${response.status} ${response.statusText}`);
  }

  const value = await response.json();
  if (!value || typeof value !== "object" || !value.latest) {
    throw new Error("Update manifest is missing a latest release entry");
  }
  return value;
}

function parseArgs(values) {
  const parsed = {
    allowDirty: false,
    baseTag: "",
    manifestUrl: "",
    skipBuild: false,
    skipCloudflareProvision: false,
    skipDoctor: false,
    skipFetch: false,
    skipInstall: false,
    tag: "",
    upstreamName: defaultUpstreamName,
    upstreamUrl: defaultUpstreamUrl,
    yes: false,
  };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--") {
      continue;
    } else if (value === "--allow-dirty") {
      parsed.allowDirty = true;
    } else if (value === "--base-tag") {
      parsed.baseTag = values[index + 1] || "";
      index += 1;
    } else if (value.startsWith("--base-tag=")) {
      parsed.baseTag = value.slice("--base-tag=".length);
    } else if (value === "--manifest-url") {
      parsed.manifestUrl = values[index + 1] || "";
      index += 1;
    } else if (value.startsWith("--manifest-url=")) {
      parsed.manifestUrl = value.slice("--manifest-url=".length);
    } else if (value === "--skip-build") {
      parsed.skipBuild = true;
    } else if (value === "--skip-cloudflare-provision") {
      parsed.skipCloudflareProvision = true;
    } else if (value === "--skip-doctor") {
      parsed.skipDoctor = true;
    } else if (value === "--skip-fetch") {
      parsed.skipFetch = true;
    } else if (value === "--skip-install") {
      parsed.skipInstall = true;
    } else if (value === "--tag") {
      parsed.tag = values[index + 1] || "";
      index += 1;
    } else if (value.startsWith("--tag=")) {
      parsed.tag = value.slice("--tag=".length);
    } else if (value === "--upstream-name") {
      parsed.upstreamName = values[index + 1] || "";
      index += 1;
    } else if (value.startsWith("--upstream-name=")) {
      parsed.upstreamName = value.slice("--upstream-name=".length);
    } else if (value === "--upstream-url") {
      parsed.upstreamUrl = values[index + 1] || "";
      index += 1;
    } else if (value.startsWith("--upstream-url=")) {
      parsed.upstreamUrl = value.slice("--upstream-url=".length);
    } else if (value === "--yes" || value === "-y") {
      parsed.yes = true;
    } else if (value === "--help" || value === "-h") {
      printHelp();
      process.exit(0);
    } else {
      fail(`Unknown option: ${value}`);
    }
  }

  return parsed;
}

async function provisionCloudflareQueues() {
  if (!existsSync(wranglerConfigPath)) return;

  const config = await readFile(wranglerConfigPath, "utf8");
  const queueNames = parseQueueNames(config);
  if (queueNames.length === 0) return;

  printHeader("Provisioning Cloudflare queues");
  const existingQueueNames = getExistingCloudflareQueueNames();
  for (const queueName of queueNames) {
    if (existingQueueNames.has(queueName)) {
      console.log(`OK existing ${queueName}`);
      continue;
    }

    const result = run("pnpm", ["exec", "wrangler", "queues", "create", queueName], {
      allowFailure: true,
      quiet: true,
    });
    const output = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (result.status === 0 || /already exists/i.test(output)) {
      console.log(`OK ${queueName}`);
      continue;
    }

    console.error(output.trim());
    fail(
      [
        `Could not create Cloudflare queue "${queueName}".`,
        "Run `pnpm exec wrangler login` if needed, then rerun `pnpm update:core`.",
        "To handle Cloudflare resources manually, rerun with --skip-cloudflare-provision.",
      ].join("\n"),
    );
  }
}

function getExistingCloudflareQueueNames() {
  const result = run("pnpm", ["exec", "wrangler", "queues", "list"], {
    allowFailure: true,
    quiet: true,
  });
  if (result.status !== 0) return new Set();

  return parseQueueListOutput(`${result.stdout || ""}\n${result.stderr || ""}`);
}

function parseQueueNames(config) {
  const queueNames = new Set();
  const queuePattern = /^\s*(?:queue|dead_letter_queue)\s*=\s*"([^"]+)"\s*$/gm;
  let match = queuePattern.exec(config);
  while (match) {
    const queueName = match[1]?.trim();
    if (queueName) queueNames.add(queueName);
    match = queuePattern.exec(config);
  }
  return [...queueNames].sort();
}

function parseQueueListOutput(output) {
  const names = new Set();
  for (const line of output.split(/\r?\n/)) {
    const columns = line
      .split(/[│|]/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (columns.length < 2 || columns[0] === "id" || /^[-─]+$/.test(columns[0])) {
      continue;
    }
    const name = columns[1];
    if (/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) names.add(name);
  }
  return names;
}

function resolveRootDir() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const localRoot = path.resolve(scriptDir, "..");
  if (existsSync(path.join(localRoot, "package.json")) && existsSync(path.join(localRoot, "scripts"))) {
    return localRoot;
  }
  return process.cwd();
}

function isGitRepository() {
  return capture("git", ["rev-parse", "--is-inside-work-tree"], { allowFailure: true }).trim() === "true";
}

function isMergeInProgress() {
  return Boolean(capture("git", ["rev-parse", "--verify", "-q", "MERGE_HEAD"], { allowFailure: true }).trim());
}

function resolveCommit(ref) {
  return capture("git", ["rev-parse", "--verify", "-q", `${ref}^{commit}`], { allowFailure: true }).trim();
}

function isAncestor(ancestor, descendant) {
  return run("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
    allowFailure: true,
    quiet: true,
  }).status === 0;
}

function hasMergeBase(left, right) {
  return Boolean(capture("git", ["merge-base", left, right], { allowFailure: true }).trim());
}

function run(command, commandArgs, options = {}) {
  if (!options.quiet) console.log(`$ ${formatCommand([command, ...commandArgs])}`);
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: options.quiet ? "pipe" : "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    process.exit(result.status || 1);
  }
  return result;
}

function capture(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    if (options.allowFailure) return "";
    throw result.error;
  }

  if (result.status !== 0) {
    if (options.allowFailure) return "";
    fail(result.stderr.trim() || `${command} ${commandArgs.join(" ")} failed`);
  }

  return result.stdout;
}

async function confirmProceed(message) {
  if (args.yes) return;
  if (!process.stdin.isTTY) {
    fail(`${message} Rerun with --yes to confirm in a non-interactive shell.`);
  }

  const input = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await input.question(`${message} [y/N] `);
  input.close();

  if (!/^y(es)?$/i.test(answer.trim())) {
    fail("Update cancelled.");
  }
}

function printHeader(message) {
  console.log(message);
  console.log("-".repeat(message.length));
}

function normalizeVersion(value) {
  return String(value || "").trim().replace(/^v/i, "");
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);

  for (let index = 0; index < 3; index += 1) {
    if (a.parts[index] !== b.parts[index]) return a.parts[index] - b.parts[index];
  }

  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease);
}

function parseVersion(value) {
  const [version, prerelease = ""] = normalizeVersion(value).split("-", 2);
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  return {
    parts: [parts[0] || 0, parts[1] || 0, parts[2] || 0],
    prerelease,
  };
}

function formatCommand(parts) {
  return parts
    .map((part) => (/^[A-Za-z0-9_./:@=-]+$/.test(part) ? part : JSON.stringify(part)))
    .join(" ");
}

function isMissingFileError(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function printHelp() {
  console.log(`Usage: pnpm update:core -- [options]

Updates a copied ME3 repository from the upstream stable release tag.

Options:
  --tag vX.Y.Z                 Merge a specific release tag instead of latest stable
  --manifest-url <url|path>    Read a custom update manifest
  --upstream-name <name>       Git remote name to use (default: upstream)
  --upstream-url <url>         Git remote URL to add when missing
  --base-tag vX.Y.Z            Installed upstream tag for first Deploy-button history connection
  --allow-dirty                Allow update with uncommitted local changes
  --skip-fetch                 Do not fetch upstream tags first
  --skip-install               Do not run pnpm install after merge
  --skip-cloudflare-provision  Do not create Cloudflare queues from wrangler.toml
  --skip-doctor                Do not run pnpm update:doctor after merge
  --skip-build                 Do not run pnpm build after merge
  --yes, -y                    Skip confirmation prompts
  --help, -h                   Show this help
`);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
