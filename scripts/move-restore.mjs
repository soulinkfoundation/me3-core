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

// Builds the D1 import from the database itself rather than a SQLite .dump.
// D1 enforces foreign keys while importing, so every table is created before
// any row is inserted; it also rejects the writable_schema trick .dump uses
// for full-text search tables, so those are recreated with CREATE VIRTUAL
// TABLE and refilled. Triggers, indexes and views come last so inserting rows
// doesn't fire them. Wrangler's own _cf_ tables and sqlite_sequence are left
// out; D1 rebuilds sqlite_sequence from the inserted rows.
export function buildD1Import(database) {
  const objects = sqliteJson(
    database,
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid;",
  );
  const virtualTables = objects
    .filter((object) => object.type === "table" && /^CREATE VIRTUAL TABLE/i.test(object.sql))
    .map((object) => object.name);
  const internal = (name) =>
    name.startsWith("sqlite_") ||
    name.startsWith("_cf_") ||
    virtualTables.some((table) => FTS_SHADOW_SUFFIXES.some((suffix) => name === `${table}${suffix}`));
  const tables = objects.filter((object) => object.type === "table" && !internal(object.name));
  const statements = ["PRAGMA defer_foreign_keys = true;"];
  for (const table of tables) statements.push(`${table.sql};`);
  statements.push(`CREATE TABLE ${IMPORT_STAGING_TABLE} (id INTEGER PRIMARY KEY, v TEXT NOT NULL);`);
  const staging = { next: 0 };
  for (const table of inDependencyOrder(database, tables)) {
    const rows = insertStatements(database, table.name, virtualTables.includes(table.name), staging);
    if (rows) statements.push(rows);
  }
  statements.push(`DROP TABLE ${IMPORT_STAGING_TABLE};`);
  for (const type of ["index", "trigger", "view"]) {
    for (const object of objects) {
      if (object.type === type && !internal(object.name) && !internal(object.tbl_name || "")) {
        statements.push(`${object.sql};`);
      }
    }
  }
  return statements.join("\n");
}

const FTS_SHADOW_SUFFIXES = ["_data", "_idx", "_content", "_docsize", "_config"];

// Parents before children, so each row's foreign keys already exist even
// where the import isn't one deferred transaction. Cycles keep their order.
function inDependencyOrder(database, tables) {
  const names = new Set(tables.map((table) => table.name));
  const parents = new Map(
    tables.map((table) => [
      table.name,
      new Set(
        sqliteJson(database, `PRAGMA foreign_key_list(${quoteSqlString(table.name)});`)
          .map((key) => key.table)
          .filter((parent) => parent !== table.name && names.has(parent)),
      ),
    ]),
  );
  const ordered = [];
  const placed = new Set();
  let progress = true;
  while (progress) {
    progress = false;
    for (const table of tables) {
      if (placed.has(table.name)) continue;
      if ([...parents.get(table.name)].every((parent) => placed.has(parent))) {
        ordered.push(table);
        placed.add(table.name);
        progress = true;
      }
    }
  }
  return [...ordered, ...tables.filter((table) => !placed.has(table.name))];
}

// D1 rejects any SQL statement over 100 KB, so a row that would be larger
// (a big site file or note) is staged in pieces in a helper table and then
// inserted from there.
const D1_ROW_BYTES = 90_000;
const D1_VALUE_BYTES = 20_000;
const TEXT_CHUNK_CHARS = 10_000;
const BLOB_CHUNK_BYTES = 20_000;
const IMPORT_STAGING_TABLE = "_me3_import_value";

function insertStatements(database, table, keepRowid, staging) {
  const columns = sqliteJson(database, `PRAGMA table_xinfo(${quoteSqlString(table)});`)
    .filter((column) => Number(column.hidden) === 0)
    .map((column) => column.name);
  const names = keepRowid ? ["rowid", ...columns] : columns;
  if (names.length === 0) return "";
  const tableName = quoteSqlIdentifier(table);
  const columnList = names.map(quoteSqlIdentifier).join(", ");
  const rowBytes = names
    .map((name) => `length(CAST(quote(${quoteSqlIdentifier(name)}) AS BLOB))`)
    .join(" + ");
  const values = names.map((name) => `quote(${quoteSqlIdentifier(name)})`).join(" || ', ' || ");
  const select =
    `SELECT 'INSERT INTO ${tableName.replaceAll("'", "''")} (${columnList.replaceAll("'", "''")}) VALUES (' || ` +
    `${values} || ');' FROM ${tableName} WHERE ${rowBytes} <= ${D1_ROW_BYTES};`;
  const statements = [
    run("sqlite3", ["-batch", "-noheader", database, select], {
      maxBuffer: 2 * 1024 * 1024 * 1024,
    }).stdout.trim(),
  ];
  const largeRows = sqliteJson(
    database,
    `SELECT rowid AS id FROM ${tableName} WHERE ${rowBytes} > ${D1_ROW_BYTES};`,
  );
  for (const { id } of largeRows) {
    const expressions = names.map((name) =>
      valueExpression(database, tableName, quoteSqlIdentifier(name), id, staging, statements),
    );
    statements.push(`INSERT INTO ${tableName} (${columnList}) VALUES (${expressions.join(", ")});`);
  }
  return statements.filter(Boolean).join("\n");
}

function valueExpression(database, tableName, column, rowid, staging, statements) {
  const [info] = sqliteJson(
    database,
    `SELECT typeof(${column}) AS type, length(CAST(quote(${column}) AS BLOB)) AS bytes,
            length(${column}) AS size
     FROM ${tableName} WHERE rowid = ${Number(rowid)};`,
  );
  if (info.bytes <= D1_VALUE_BYTES || !["text", "blob"].includes(info.type)) {
    return sqliteValue(database, `quote(${column})`, tableName, rowid);
  }
  const key = ++staging.next;
  const blob = info.type === "blob";
  const step = blob ? BLOB_CHUNK_BYTES : TEXT_CHUNK_CHARS;
  for (let start = 1; start <= info.size; start += step) {
    const piece = blob
      ? quoteSqlString(sqliteValue(database, `hex(substr(${column}, ${start}, ${step}))`, tableName, rowid))
      : sqliteValue(database, `quote(substr(${column}, ${start}, ${step}))`, tableName, rowid);
    statements.push(
      start === 1
        ? `INSERT INTO ${IMPORT_STAGING_TABLE} (id, v) VALUES (${key}, ${piece});`
        : `UPDATE ${IMPORT_STAGING_TABLE} SET v = v || ${piece} WHERE id = ${key};`,
    );
  }
  const staged = `(SELECT v FROM ${IMPORT_STAGING_TABLE} WHERE id = ${key})`;
  return blob ? `unhex(${staged})` : staged;
}

function sqliteValue(database, expression, tableName, rowid) {
  return run("sqlite3", [
    "-batch",
    "-noheader",
    database,
    `SELECT ${expression} FROM ${tableName} WHERE rowid = ${Number(rowid)};`,
  ]).stdout.replace(/\n$/, "");
}

function sqliteJson(database, sql) {
  const output = run("sqlite3", ["-batch", "-json", database, sql]).stdout.trim();
  return output ? JSON.parse(output) : [];
}

function quoteSqlIdentifier(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function quoteSqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function importIntoCloudflare({ database, r2Directory, work, root = REPO_ROOT, wrangler = defaultWrangler }) {
  const importFile = join(work, "import.sql");
  writeFileSync(importFile, buildD1Import(database), { mode: 0o600 });
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
