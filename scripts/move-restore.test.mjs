import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildD1Import,
  downloadMoveExport,
  migrateRestoredDatabase,
  readArchiveCoreTag,
  readSiteAssetsBucket,
  restoreAtSourceVersion,
  sourceCoreForArchive,
} from "./move-restore.mjs";
import {
  PROOF_PASSPHRASE,
  createMigratedDatabase,
  seedProofInstallation,
} from "./portable-proof.mjs";
import { exportPortableV1, resolveCoreInfo } from "./portable-v1.mjs";

const rootDir = path.resolve(import.meta.dirname, "..");
const workflow = readFileSync(path.join(rootDir, ".github/workflows/restore-portable.yml"), "utf8");

test("the D1 import creates every table first and leaves out Wrangler tables", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "me3-move-import-"));
  try {
    const database = path.join(directory, "source.sqlite");
    const setup = spawnSync("sqlite3", [database], {
      encoding: "utf8",
      input: [
        "CREATE TABLE notes (id TEXT PRIMARY KEY, owner_id TEXT REFERENCES owners(id), body TEXT);",
        "CREATE TABLE owners (id TEXT PRIMARY KEY);",
        "CREATE TABLE _cf_KV (key TEXT PRIMARY KEY, value BLOB);",
        "CREATE TABLE counters (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT);",
        "CREATE VIRTUAL TABLE notes_search USING fts5(body);",
        "CREATE TRIGGER notes_search_insert AFTER INSERT ON notes BEGIN INSERT INTO notes_search(body) VALUES (new.body); END;",
        "INSERT INTO owners VALUES ('o1');",
        "INSERT INTO notes VALUES ('n1', 'o1', 'line one' || char(10) || 'it''s two');",
        "INSERT INTO _cf_KV VALUES ('a', 'b');",
        "INSERT INTO counters (label) VALUES ('first');",
        "CREATE TABLE files (path TEXT PRIMARY KEY, content BLOB NOT NULL, note TEXT);",
        "INSERT INTO files VALUES ('big.bin', randomblob(250000), replace(printf('%.300000c', 'x'), 'x', 'é'));",
      ].join("\n"),
    });
    assert.equal(setup.status, 0, setup.stderr);

    const sql = buildD1Import(database);
    assert.equal(sql.split("\n")[0], "PRAGMA defer_foreign_keys = true;");
    assert.doesNotMatch(sql, /_cf_KV|writable_schema|sqlite_sequence|notes_search_data/);
    assert.ok(sql.indexOf("CREATE TABLE owners") < sql.indexOf('INSERT INTO "notes"'));
    assert.ok(sql.indexOf('INSERT INTO "notes"') < sql.indexOf("CREATE TRIGGER notes_search_insert"));

    const imported = path.join(directory, "imported.sqlite");
    const load = spawnSync("sqlite3", [imported], {
      encoding: "utf8",
      input: `PRAGMA foreign_keys = ON;\n${sql}`,
    });
    assert.equal(load.status, 0, load.stderr);
    const query = (statement) =>
      spawnSync("sqlite3", [imported, statement], { encoding: "utf8" }).stdout.trim();
    assert.equal(query("SELECT body FROM notes;"), "line one\nit's two");
    assert.equal(query("SELECT COUNT(*) FROM notes_search WHERE notes_search MATCH 'two';"), "1");
    assert.equal(query("SELECT seq FROM sqlite_sequence WHERE name = 'counters';"), "1");
    // D1 rejects statements over 100 KB, so big rows arrive in pieces intact.
    assert.ok(sql.split("\n").every((line) => Buffer.byteLength(line) < 100_000));
    assert.equal(query("SELECT length(content), length(note) FROM files;"), "250000|300000");
    assert.equal(
      query(`ATTACH '${database}' AS source; SELECT COUNT(*) FROM files f JOIN source.files s ON s.path = f.path WHERE s.content = f.content AND s.note = f.note;`),
      "1",
    );
    assert.doesNotMatch(query("SELECT name FROM sqlite_master;"), /_me3_import_value/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the restored files go to the SITE_ASSETS bucket only", () => {
  const toml = [
    "[[r2_buckets]]",
    'binding = "OTHER"',
    'bucket_name = "other"',
    "",
    "[[r2_buckets]]",
    'binding = "SITE_ASSETS"',
    'bucket_name = "owner-site-assets"',
    "",
    "[vars]",
    'bucket_name = "not-this"',
  ].join("\n");
  assert.equal(readSiteAssetsBucket(toml), "owner-site-assets");
  assert.equal(readSiteAssetsBucket('[[r2_buckets]]\nbinding = "OTHER"\nbucket_name = "x"\n'), null);
});

test("the archive must name a released Core tag", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "me3-move-tag-"));
  try {
    writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({ core: { tag: "v0.1.236", version: "0.1.236" } }));
    assert.equal(readArchiveCoreTag(directory).tag, "v0.1.236");
    writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({ core: { tag: "main; rm -rf /" } }));
    assert.throws(() => readArchiveCoreTag(directory), { code: "ARCHIVE_CORE_TAG_INVALID" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the download is authenticated and checksum verified", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "me3-move-download-"));
  const body = Buffer.from("envelope-bytes");
  const sha256 = createHash("sha256").update(body).digest("hex");
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(body, { headers: { "X-ME3-Export-SHA256": sha256 } });
  };
  try {
    const output = path.join(directory, "owner.me3export");
    await downloadMoveExport({ url: "https://api.me3.app/api/install/move/export", token: "t", output, fetchImpl });
    assert.equal(calls[0].init.headers.Authorization, "Bearer t");
    assert.deepEqual(readFileSync(output), body);

    const bad = path.join(directory, "bad.me3export");
    await assert.rejects(
      downloadMoveExport({
        url: "https://api.me3.app/x",
        token: "t",
        output: bad,
        fetchImpl: async () => new Response(body, { headers: { "X-ME3-Export-SHA256": "0".repeat(64) } }),
      }),
      { code: "MOVE_EXPORT_CHECKSUM_MISMATCH" },
    );
    assert.equal(existsSync(bad), false);
    await assert.rejects(
      downloadMoveExport({ url: "http://api.me3.app/x", token: "t", output: bad, fetchImpl }),
      { code: "MOVE_EXPORT_URL_INVALID" },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("an export restores, migrates forward and imports as valid SQL", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "me3-move-restore-"));
  try {
    const source = createMigratedDatabase(path.join(root, "source"));
    const sourceR2 = path.join(root, "source-r2");
    seedProofInstallation(source, sourceR2);
    const archive = path.join(root, "snapshot.me3-portable");
    await exportPortableV1({ database: source, r2Directory: sourceR2, output: archive, passphrase: PROOF_PASSPHRASE });

    const work = path.join(root, "work");
    const restored = await restoreAtSourceVersion({ source: rootDir, archive, work, passphrase: PROOF_PASSPHRASE });
    const migrated = migrateRestoredDatabase({ database: restored.database, work });

    const dump = spawnSync("sqlite3", [migrated.database, ".dump"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    assert.equal(dump.status, 0);
    const imported = path.join(root, "imported.sqlite");
    const load = spawnSync("sqlite3", [imported], {
      input: `PRAGMA foreign_keys = ON;\n${buildD1Import(migrated.database)}`,
      encoding: "utf8",
    });
    assert.equal(load.status, 0, load.stderr);

    const count = (database, sql) =>
      spawnSync("sqlite3", [database, sql], { encoding: "utf8" }).stdout.trim();
    for (const table of ["users", "install_secrets", "d1_migrations"]) {
      assert.equal(count(imported, `SELECT COUNT(*) FROM ${table};`), count(migrated.database, `SELECT COUNT(*) FROM ${table};`));
    }
    assert.equal(
      count(imported, "SELECT COUNT(*) FROM sqlite_master WHERE name LIKE '\\_cf\\_%' ESCAPE '\\';"),
      "0",
    );
    assert.ok(restored.restored.r2Objects > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a hosted export restores at its release even when it recorded another commit", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "me3-move-core-"));
  try {
    const source = createMigratedDatabase(path.join(root, "source"));
    const sourceR2 = path.join(root, "source-r2");
    seedProofInstallation(source, sourceR2);
    const releaseCore = resolveCoreInfo();
    const archive = path.join(root, "snapshot.me3-portable");
    await exportPortableV1({
      database: source,
      r2Directory: sourceR2,
      output: archive,
      passphrase: PROOF_PASSPHRASE,
      core: { ...releaseCore, commit: "0".repeat(40) },
    });

    assert.equal(sourceCoreForArchive(releaseCore, archive).commit, "0".repeat(40));
    assert.equal(
      sourceCoreForArchive({ ...releaseCore, version: "999.0.0" }, archive).version,
      "999.0.0",
    );
    const restored = await restoreAtSourceVersion({
      source: rootDir,
      archive,
      work: path.join(root, "work"),
      passphrase: PROOF_PASSPHRASE,
    });
    assert.ok(restored.restored.r2Objects > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the workflow restores before it deploys and always removes restore files", () => {
  const order = [
    "Require move secrets",
    "Download the export",
    "Unlock and check the export",
    "Check out the exported ME3 version",
    "Restore data and files",
    "Remove restore files",
    "Deploy to Cloudflare",
  ].map((name) => workflow.indexOf(`- name: ${name}`));
  assert.ok(order.every((index) => index > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(workflow, /- name: Remove restore files\n\s+if: always\(\)/);
  assert.doesNotMatch(workflow, /db:migrations:apply/);
  assert.match(workflow, /persist-credentials: false/);
  for (const secret of ["ME3_MOVE_PASSPHRASE", "ME3_MOVE_EXPORT_TOKEN"]) {
    assert.doesNotMatch(workflow.split("jobs:")[1].split("steps:")[0], new RegExp(secret));
  }
});
