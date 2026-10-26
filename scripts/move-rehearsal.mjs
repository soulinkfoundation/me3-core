#!/usr/bin/env node

// Rehearses a whole move from Hosted by ME3 to self-hosting with no Cloudflare
// or GitHub account: a hosted install on the last released ME3 is seeded with
// awkward data, exported and sealed like the hosted lifecycle does, unlocked
// and restored like restore-portable.yml does, migrated to this checkout, and
// imported into Wrangler's local D1 and R2, which apply D1's import rules.
//
//   pnpm move:rehearsal [-- --from v0.1.240] [-- --keep]
//
// Every run writes report.json and report.md under .move-rehearsal/.

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createManagedExportEnvelope,
  extractManagedExportEnvelope,
} from "./managed-export-envelope.mjs";
import {
  buildD1Import,
  importIntoCloudflare,
  migrateRestoredDatabase,
  readSiteAssetsBucket,
  restoreAtSourceVersion,
} from "./move-restore.mjs";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PASSPHRASE = "move-rehearsal-passphrase-not-secret";
const BIG_FILE_BYTES = 300_000;
const BIG_NOTE_CHARS = 250_000;

const args = parseArgs(process.argv.slice(2));
const startedAt = new Date();
const runDir = join(REPO_ROOT, ".move-rehearsal", startedAt.toISOString().replace(/[:.]/g, "-"));
const work = join(runDir, "work");
const report = {
  revision: git(["rev-parse", "HEAD"]),
  from: args.from || latestReleaseTag(),
  command: `node scripts/move-rehearsal.mjs ${process.argv.slice(2).join(" ")}`.trim(),
  startedAt: startedAt.toISOString(),
  steps: [],
  ok: false,
};
mkdirSync(work, { recursive: true });
const sourceDir = join(runDir, "source");

try {
  await step("Check out the released ME3 the hosted install runs", () => {
    git(["worktree", "add", "--detach", sourceDir, report.from]);
    symlinkSync(join(REPO_ROOT, "node_modules"), join(sourceDir, "node_modules"));
    return report.from;
  });

  const hosted = await step("Seed a hosted install with awkward data", async () => {
    const proof = await import(pathToFileURL(join(sourceDir, "scripts/portable-proof.mjs")).href);
    const database = proof.createMigratedDatabase(join(work, "hosted-d1"));
    const r2Directory = join(work, "hosted-r2");
    proof.seedProofInstallation(database, r2Directory);
    // A site file over D1's 100 KB statement limit, and a long journal entry
    // that the search index triggers copy into the full-text table.
    sqlite(database, `
      INSERT INTO site_files (site_id, path, content, content_type, size)
      SELECT id, 'big/hero.bin', randomblob(${BIG_FILE_BYTES}), 'application/octet-stream', ${BIG_FILE_BYTES}
      FROM sites LIMIT 1;
      UPDATE journal_entries
      SET body = replace(printf('%.${BIG_NOTE_CHARS}c', 'x'), 'x', 'é');`);
    mkdirSync(join(r2Directory, "sites", "rehearsal", "public", "files"), { recursive: true });
    writeFileSync(join(r2Directory, "sites", "rehearsal", "public", "files", "avatar.jpg"), randomBytes(50_000));
    return { database, r2Directory, rows: tableCounts(database) };
  });

  const archive = join(work, "hosted-portable");
  await step("Export it the way the hosted lifecycle does", () => {
    const env = { ...process.env, ME3_PORTABLE_PASSPHRASE: PASSPHRASE };
    run("node", [join(REPO_ROOT, "scripts/prepare-managed-portable-capture.mjs"), hosted.database], { env });
    run("node", [
      join(REPO_ROOT, "scripts/portable.mjs"), "export",
      "--db", hosted.database, "--r2-dir", hosted.r2Directory, "--output", archive,
      "--managed-hosted", "--core-root", sourceDir,
    ], { env });
    run("node", [join(REPO_ROOT, "scripts/portable.mjs"), "verify", "--archive", archive, "--core-root", sourceDir], { env });
  });

  const envelope = join(work, "owner.me3export");
  await step("Seal the export for the owner's download", () =>
    createManagedExportEnvelope({
      archive,
      output: envelope,
      passphrase: PASSPHRASE,
      installationId: "mi-0000000000000001",
      operationId: "00000000-0000-4000-8000-000000000001",
      keyVersion: "v1",
    }),
  );

  const portable = join(work, "portable");
  await step("Unlock and check the export", () =>
    extractManagedExportEnvelope({ envelope, output: portable, passphrase: PASSPHRASE, coreFromArchive: true }),
  );

  const restored = await step("Restore at the exported version", () =>
    restoreAtSourceVersion({ source: sourceDir, archive: portable, work: join(work, "restore"), passphrase: PASSPHRASE }),
  );

  const migrated = await step("Migrate to this checkout", () =>
    migrateRestoredDatabase({ database: restored.database, work: join(work, "migrate") }),
  );

  const target = join(work, "target");
  const persist = join(target, "state");
  await step("Import into local D1 and R2", () => {
    mkdirSync(target, { recursive: true });
    const config = `${readFileSync(join(REPO_ROOT, "wrangler.toml"), "utf8")}
[[r2_buckets]]
binding = "SITE_ASSETS"
bucket_name = "move-rehearsal-files"
`;
    writeFileSync(join(target, "wrangler.toml"), config);
    return importIntoCloudflare({
      database: migrated.database,
      r2Directory: restored.r2Directory,
      work: target,
      root: target,
      wrangler: (wranglerArgs) => localWrangler(wranglerArgs, join(target, "wrangler.toml"), persist),
    });
  });

  await step("Check every row and file arrived", () => {
    const expected = tableCounts(migrated.database);
    const names = Object.keys(expected);
    const imported = {};
    for (let start = 0; start < names.length; start += 20) {
      const [row] = d1Json(join(target, "wrangler.toml"), persist, tableCountSql(names.slice(start, start + 20)));
      Object.assign(imported, JSON.parse(row.counts));
    }
    const missing = Object.entries(expected).filter(([table, count]) => Number(imported[table]) !== count);
    if (missing.length) {
      throw new Error(`Row counts differ: ${missing.map(([table, count]) => `${table} ${imported[table]}/${count}`).join(", ")}`);
    }
    const [big] = d1Json(join(target, "wrangler.toml"), persist,
      "SELECT length(content) AS bytes, hex(substr(content, 1, 16)) AS head FROM site_files WHERE path = 'big/hero.bin';");
    const [source] = JSON.parse(sqlite(migrated.database,
      "SELECT length(content) AS bytes, hex(substr(content, 1, 16)) AS head FROM site_files WHERE path = 'big/hero.bin';", ["-json"]));
    if (big?.bytes !== source.bytes || big?.head !== source.head) throw new Error("The large site file changed on import");
    const [search] = d1Json(join(target, "wrangler.toml"), persist,
      "SELECT COUNT(*) AS hits FROM owner_content_search WHERE owner_content_search MATCH 'é*';");
    const bucket = readSiteAssetsBucket(readFileSync(join(target, "wrangler.toml"), "utf8"));
    const files = listFiles(restored.r2Directory);
    for (const file of files) {
      const key = relative(restored.r2Directory, file).split(sep).join("/");
      const copy = localWrangler(["r2", "object", "get", `${bucket}/${key}`, "--remote", "--pipe"], null, persist, "buffer");
      if (sha256(copy) !== sha256(readFileSync(file))) throw new Error(`File ${key} changed on upload`);
    }
    return { tables: Object.keys(expected).length, rows: Object.values(expected).reduce((a, b) => a + b, 0), files: files.length, searchHits: search.hits };
  });

  report.ok = true;
} catch {
  report.ok = false;
} finally {
  report.finishedAt = new Date().toISOString();
  writeFileSync(join(runDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(runDir, "report.md"), renderReport(report));
  if (existsSync(sourceDir)) git(["worktree", "remove", "--force", sourceDir], { allowFailure: true });
  if (!args.keep) rmSync(work, { recursive: true, force: true });
  console.log(renderReport(report));
  console.log(`Report: ${relative(REPO_ROOT, join(runDir, "report.md"))}`);
  process.exitCode = report.ok ? 0 : 1;
}

async function step(name, action) {
  const started = Date.now();
  try {
    const result = await action();
    report.steps.push({ name, ok: true, seconds: (Date.now() - started) / 1000, detail: summarize(result) });
    return result;
  } catch (error) {
    report.steps.push({ name, ok: false, seconds: (Date.now() - started) / 1000, error: String(error?.message || error).slice(0, 4000) });
    throw error;
  }
}

function summarize(result) {
  if (result === undefined || result === null) return null;
  if (typeof result !== "object") return result;
  const copy = { ...result };
  for (const key of Object.keys(copy)) if (typeof copy[key] === "string" && copy[key].startsWith(REPO_ROOT)) delete copy[key];
  return copy;
}

function renderReport(value) {
  const lines = [
    `# Move rehearsal: ${value.ok ? "passed" : "FAILED"}`,
    "",
    `- From hosted release: ${value.from}`,
    `- To this checkout: ${value.revision}`,
    `- Command: \`${value.command}\``,
    `- Started: ${value.startedAt}`,
    "",
  ];
  for (const item of value.steps) {
    lines.push(`- ${item.ok ? "✓" : "✗"} ${item.name} (${item.seconds.toFixed(1)}s)`);
    if (item.detail && typeof item.detail === "object" && !Array.isArray(item.detail)) {
      const shown = Object.entries(item.detail).filter(([, v]) => typeof v !== "object");
      if (shown.length) lines.push(`  ${shown.map(([k, v]) => `${k}: ${v}`).join(", ")}`);
    }
    if (item.error) for (const line of item.error.split("\n")) lines.push(`  ${line}`);
  }
  return `${lines.join("\n")}\n`;
}

function localWrangler(wranglerArgs, config, persist, encoding = "utf8") {
  const rewritten = [];
  for (let index = 0; index < wranglerArgs.length; index += 1) {
    const value = wranglerArgs[index];
    if (value === "--remote") rewritten.push("--local", "--persist-to", persist);
    else if (value === "--config") {
      index += 1;
      if (config) rewritten.push("--config", config);
    } else rewritten.push(value);
  }
  if (config === null) rewritten.push("--config", join(work, "target", "wrangler.toml"));
  const result = spawnSync("pnpm", ["exec", "wrangler", ...rewritten], {
    cwd: REPO_ROOT,
    encoding: encoding === "buffer" ? "buffer" : "utf8",
    env: { ...process.env, CI: "1" },
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`wrangler ${wranglerArgs.slice(0, 3).join(" ")} failed: ${String(result.stderr || result.stdout).trim().slice(-2000)}`);
  }
  return encoding === "buffer" ? result.stdout : { stdout: result.stdout };
}

function d1Json(config, persist, sql) {
  const { stdout } = localWrangler(["d1", "execute", "DB", "--remote", "--json", "--command", sql], config, persist);
  return JSON.parse(stdout)[0].results;
}

function tableCounts(database) {
  const tables = JSON.parse(sqlite(database,
    `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'owner_content_search_%';`, ["-json"]));
  const names = tables.map((table) => table.name);
  if (!names.length) return {};
  const counts = {};
  for (let start = 0; start < names.length; start += 20) {
    const [row] = JSON.parse(sqlite(database, tableCountSql(names.slice(start, start + 20)), ["-json"]));
    Object.assign(counts, JSON.parse(row.counts));
  }
  return counts;
}

// One JSON column, because D1 caps result columns and compound SELECT terms;
// callers pass at most 20 tables to stay under the function argument cap.
function tableCountSql(names) {
  return `SELECT json_object(${names.map((name) => `'${name}', (SELECT COUNT(*) FROM "${name}")`).join(", ")}) AS counts;`;
}

function sqlite(database, sql, flags = []) {
  return run("sqlite3", ["-batch", ...flags, database, sql]).stdout;
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, ...options });
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${(result.stderr || result.stdout || "").trim().slice(-2000)}`);
  }
  return result;
}

function git(gitArgs, { allowFailure = false } = {}) {
  const result = spawnSync("git", gitArgs, { cwd: REPO_ROOT, encoding: "utf8" });
  if (result.status !== 0 && !allowFailure) throw new Error(`git ${gitArgs[0]} failed: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

function latestReleaseTag() {
  const manifest = JSON.parse(readFileSync(join(REPO_ROOT, "updates/stable.json"), "utf8"));
  return manifest.latest?.tag || `v${manifest.latest?.version}`;
}

function listFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function parseArgs(values) {
  const parsed = { keep: false, from: "" };
  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--keep") parsed.keep = true;
    else if (values[index] === "--from") parsed.from = values[++index] || "";
    else if (values[index].startsWith("--from=")) parsed.from = values[index].slice(7);
  }
  return parsed;
}
