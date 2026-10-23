#!/usr/bin/env node

// Restores a Hosted by ME3 export into a freshly created, empty self-hosted
// install. It runs inside the owner's repository (restore-portable.yml), so
// owner credentials never leave their own GitHub and Cloudflare accounts.
//
// The archive can only be restored by the exact Core version that made it, so
// the restore runs in a checkout of that version. The restored database is then
// brought forward with this repository's own D1 migrations, exactly like a
// normal update, before it is imported into the empty remote D1 database.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const IMPORT_SKIPPED_STATEMENTS = new Set([
  "PRAGMA foreign_keys=OFF;",
  "BEGIN TRANSACTION;",
  "COMMIT;",
  "ROLLBACK; -- due to errors",
]);

export class MoveRestoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MoveRestoreError";
    this.code = code;
  }
}

export async function downloadMoveExport({ url, token, output, fetchImpl = fetch }) {
  if (!url || !/^https:\/\//.test(url)) {
    throw new MoveRestoreError("MOVE_EXPORT_URL_INVALID", "The move export URL must be https");
  }
  if (!token) throw new MoveRestoreError("MOVE_EXPORT_TOKEN_MISSING", "The move export token is missing");
  if (existsSync(output)) throw new MoveRestoreError("OUTPUT_EXISTS", "The export download already exists");
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/octet-stream" },
    redirect: "error",
  });
  if (!response.ok || !response.body) {
    throw new MoveRestoreError(
      "MOVE_EXPORT_DOWNLOAD_FAILED",
      `ME3 could not provide the export (HTTP ${response.status})`,
    );
  }
  const expected = String(response.headers.get("x-me3-export-sha256") || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) {
    throw new MoveRestoreError("MOVE_EXPORT_CHECKSUM_MISSING", "The export download has no checksum");
  }
  mkdirSync(dirname(output), { recursive: true });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(output, { mode: 0o600 }));
  const actual = createHash("sha256").update(readFileSync(output)).digest("hex");
  if (actual !== expected) {
    rmSync(output, { force: true });
    throw new MoveRestoreError("MOVE_EXPORT_CHECKSUM_MISMATCH", "The export download is incomplete");
  }
  return { output, sha256: actual };
}

export function readArchiveCoreTag(archive) {
  const manifest = JSON.parse(readFileSync(join(archive, "manifest.json"), "utf8"));
  const tag = String(manifest?.core?.tag || "");
  if (!TAG_PATTERN.test(tag)) {
    throw new MoveRestoreError("ARCHIVE_CORE_TAG_INVALID", "The export does not name a released ME3 version");
  }
  return { tag, version: String(manifest.core.version || ""), commit: String(manifest.core.commit || "") };
}

// Runs in the checkout of the archive's own Core version: an empty, fully
// migrated database from that version, then that version's portable restore.
export async function restoreAtSourceVersion({ source, archive, work, passphrase }) {
  if (!passphrase) throw new MoveRestoreError("PASSPHRASE_MISSING", "The export passphrase is missing");
  const proof = await import(pathToFileURL(join(source, "scripts/portable-proof.mjs")).href);
  const database = proof.createMigratedDatabase(join(work, "source-d1"));
  const r2Directory = join(work, "r2");
  const portable = await import(pathToFileURL(join(source, "scripts/portable-v1.mjs")).href);
  const restored = await portable.restorePortableV1({
    archive,
    targetDatabase: database,
    targetR2Directory: r2Directory,
    passphrase,
    core: sourceCoreForArchive(portable.resolveCoreInfo(source), archive),
  });
  const output = join(work, "restored.sqlite");
  copyFileSync(database, output);
  return { database: output, r2Directory, restored };
}

// Hosted exports made before the export recorded its release checkout carry
// the commit of the lifecycle controls that ran it instead. The release
// version and tag still have to match exactly; only that commit is taken
// from the archive.
export function sourceCoreForArchive(sourceCore, archive) {
  const archiveCore = JSON.parse(readFileSync(join(archive, "manifest.json"), "utf8")).core || {};
  if (sourceCore.version !== archiveCore.version || sourceCore.tag !== archiveCore.tag) return sourceCore;
  return { ...sourceCore, commit: archiveCore.commit };
}

// Brings the restored database forward with this repository's migrations by
// running Wrangler's own local migrator against it.
export function migrateRestoredDatabase({ database, work, root = REPO_ROOT, wrangler = defaultWrangler }) {
  const persist = join(work, "target-d1");
  wrangler(["d1", "migrations", "apply", "DB", "--local", "--config", "wrangler.toml", "--persist-to", persist], root);
  const files = listFiles(persist).filter(
    (path) => path.endsWith(".sqlite") && !path.endsWith("metadata.sqlite"),
  );
  if (files.length !== 1) {
    throw new MoveRestoreError("MIGRATE_TARGET_AMBIGUOUS", "Could not identify the local D1 database");
  }
  for (const suffix of ["-wal", "-shm"]) rmSync(`${files[0]}${suffix}`, { force: true });
  copyFileSync(database, files[0]);
  wrangler(["d1", "migrations", "apply", "DB", "--local", "--config", "wrangler.toml", "--persist-to", persist], root);
  run("sqlite3", [files[0], "PRAGMA wal_checkpoint(TRUNCATE);"]);
  return { database: files[0] };
}

// D1 imports run in their own transaction and reject transaction control and
// Wrangler's internal tables, so the SQLite dump is adjusted for import.
export function buildD1Import(dump) {
  const lines = [];
  let skipping = false;
  for (const line of dump.split("\n")) {
    if (IMPORT_SKIPPED_STATEMENTS.has(line.trim())) continue;
    if (/^CREATE TABLE (IF NOT EXISTS )?["'`]?_cf_/i.test(line)) {
      skipping = !line.trim().endsWith(";");
      continue;
    }
    if (skipping) {
      if (line.trim().endsWith(";")) skipping = false;
      continue;
    }
    if (/^INSERT INTO ["'`]?_cf_/i.test(line)) continue;
    lines.push(line);
  }
  return ["PRAGMA defer_foreign_keys = true;", ...lines].join("\n");
}

export function importIntoCloudflare({ database, r2Directory, work, root = REPO_ROOT, wrangler = defaultWrangler }) {
  const dump = run("sqlite3", [database, ".dump"], { maxBuffer: 2 * 1024 * 1024 * 1024 }).stdout;
  const importFile = join(work, "import.sql");
  writeFileSync(importFile, buildD1Import(dump), { mode: 0o600 });
  wrangler(["d1", "execute", "DB", "--remote", "--config", "wrangler.toml", "--file", importFile, "--yes"], root);
  rmSync(importFile, { force: true });

  const objects = existsSync(r2Directory) ? listFiles(r2Directory) : [];
  if (objects.length) {
    const bucket = readSiteAssetsBucket(readFileSync(join(root, "wrangler.toml"), "utf8"));
    if (!bucket) {
      throw new MoveRestoreError("SITE_ASSETS_MISSING", "This install has no file storage for the restored files");
    }
    for (const file of objects) {
      const key = relative(r2Directory, file).split(sep).join("/");
      wrangler(["r2", "object", "put", `${bucket}/${key}`, "--file", file, "--remote", "--config", "wrangler.toml"], root);
    }
  }
  return { objects: objects.length };
}

export function readSiteAssetsBucket(toml) {
  for (const block of toml.split(/^\[\[r2_buckets\]\]\s*$/m).slice(1)) {
    const body = block.split(/^\[/m)[0];
    if (/^binding\s*=\s*"SITE_ASSETS"\s*$/m.test(body)) {
      return body.match(/^bucket_name\s*=\s*"([^"]+)"\s*$/m)?.[1] || null;
    }
  }
  return null;
}

function defaultWrangler(args, cwd) {
  return run("pnpm", ["exec", "wrangler", ...args], { cwd, env: { ...process.env, CI: "1" } });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    throw new MoveRestoreError(
      "COMMAND_FAILED",
      `${command} ${args[0] || ""} failed: ${(result.stderr || result.stdout || "").trim().slice(-2000)}`,
    );
  }
  return result;
}

function listFiles(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) files.push(...listFiles(path));
    else files.push(path);
  }
  return files.sort();
}

function parseArgs(values) {
  const args = {};
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith("--")) throw new MoveRestoreError("INVALID_ARGS", `Unexpected argument ${values[index]}`);
    args[values[index].slice(2)] = values[index + 1];
  }
  return args;
}

function required(args, key) {
  if (!args[key]) throw new MoveRestoreError("INVALID_ARGS", `--${key} is required`);
  return args[key];
}

async function main() {
  const [command, ...values] = process.argv.slice(2);
  const args = parseArgs(values);
  if (command === "download") {
    const result = await downloadMoveExport({
      url: process.env.ME3_MOVE_EXPORT_URL,
      token: process.env.ME3_MOVE_EXPORT_TOKEN,
      output: required(args, "output"),
    });
    console.log(JSON.stringify({ ok: true, sha256: result.sha256 }));
  } else if (command === "core-tag") {
    console.log(readArchiveCoreTag(required(args, "archive")).tag);
  } else if (command === "restore") {
    const work = required(args, "work");
    const restored = await restoreAtSourceVersion({
      source: required(args, "source"),
      archive: required(args, "archive"),
      work,
      passphrase: process.env.ME3_MOVE_PASSPHRASE,
    });
    const migrated = migrateRestoredDatabase({ database: restored.database, work });
    const imported = importIntoCloudflare({ database: migrated.database, r2Directory: restored.r2Directory, work });
    console.log(JSON.stringify({ ok: true, objects: imported.objects }));
  } else {
    throw new MoveRestoreError("INVALID_ARGS", "Use download, core-tag or restore");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, code: error.code || "MOVE_RESTORE_FAILED", error: error.message }));
    process.exit(1);
  });
}
