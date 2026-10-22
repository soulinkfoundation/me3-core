#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { TABLE_POLICIES, inspectPortableDatabase } from "./portable-v1.mjs";
import { createMigratedDatabase } from "./portable-proof.mjs";

const API_ROOT = "https://api.cloudflare.com/client/v4";
const MAX_EXPORT_POLLS = 300;

export async function captureManagedD1(
  input,
  {
    request = globalThis.fetch,
    createDatabase = createMigratedDatabase,
    wait = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
  } = {},
) {
  const accountId = String(input.accountId || "").toLowerCase();
  const databaseId = String(input.databaseId || "").toLowerCase();
  const outputDatabase = resolve(input.outputDatabase || "");
  const outputSql = resolve(input.outputSql || "");
  if (
    !/^[0-9a-f]{32}$/.test(accountId) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(databaseId) ||
    typeof input.apiToken !== "string" ||
    !input.apiToken ||
    !input.outputDatabase ||
    !input.outputSql ||
    existsSync(outputDatabase) ||
    existsSync(outputSql)
  ) {
    throw new Error("managed D1 capture contract is invalid");
  }
  const endpoint = `/accounts/${accountId}/d1/database/${databaseId}`;
  const cloudflare = async (path, init) => {
    const response = await request(`${API_ROOT}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${input.apiToken}`,
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success !== true || !Object.hasOwn(body, "result")) {
      throw new Error(`managed D1 API failed with status ${response.status}`);
    }
    return body.result;
  };

  const query = await cloudflare(`${endpoint}/query`, {
    method: "POST",
    body: JSON.stringify({ sql: "PRAGMA table_list;" }),
  });
  const rows = Array.isArray(query)
    ? query.flatMap((result) => (Array.isArray(result?.results) ? result.results : []))
    : [];
  const expectedTables = [...TABLE_POLICIES]
    .filter(([, policy]) => policy !== "derived")
    .map(([name]) => name)
    .sort();
  const observedTables = rows
    .filter(
      (row) =>
        row?.schema === "main" &&
        ["table", "virtual", "shadow"].includes(row?.type),
    )
    .map((row) => String(row.name))
    .filter((name) => !name.startsWith("sqlite_") && name !== "_cf_METADATA" && name !== "_cf_KV")
    .sort();
  const actualTables = rows
    .filter((row) => row?.schema === "main" && row?.type === "table")
    .map((row) => String(row.name))
    .filter(
      (name) =>
        !name.startsWith("sqlite_") &&
        name !== "_cf_METADATA" &&
        name !== "_cf_KV" &&
        TABLE_POLICIES.get(name) !== "derived",
    )
    .sort();
  const unknown = observedTables.filter((name) => !TABLE_POLICIES.has(name));
  const missing = expectedTables.filter((name) => !actualTables.includes(name));
  if (unknown.length || missing.length) {
    throw new Error(
      `managed D1 schema is not portable (unknown=${unknown.join(",")}; missing=${missing.join(",")})`,
    );
  }

  let exported = await cloudflare(`${endpoint}/export`, {
    method: "POST",
    body: JSON.stringify({
      output_format: "polling",
      dump_options: { no_schema: true, tables: actualTables },
    }),
  });
  const bookmark = exported?.at_bookmark;
  if (typeof bookmark !== "string" || !bookmark) {
    throw new Error("managed D1 export bookmark is unavailable");
  }
  for (let poll = 0; exported?.status !== "complete"; poll += 1) {
    if (exported?.status === "error" || poll >= MAX_EXPORT_POLLS) {
      throw new Error("managed D1 export did not complete");
    }
    await wait(1_000);
    exported = await cloudflare(`${endpoint}/export`, {
      method: "POST",
      body: JSON.stringify({ output_format: "polling", current_bookmark: bookmark }),
    });
    if (exported?.at_bookmark !== bookmark) {
      throw new Error("managed D1 export bookmark changed unexpectedly");
    }
  }
  const signedUrl = exported?.result?.signed_url;
  if (!isSafeSignedUrl(signedUrl)) throw new Error("managed D1 export URL is invalid");
  const download = await request(signedUrl);
  if (!download.ok || !download.body) throw new Error("managed D1 export download failed");
  await pipeline(Readable.fromWeb(download.body), createWriteStream(outputSql, { mode: 0o600 }));

  const temporaryDirectory = mkdtempSync(join(tmpdir(), "me3-managed-d1-"));
  try {
    const migrated = createDatabase(join(temporaryDirectory, "migrated"));
    // Empty every table the export fills, so rows migrations seed (Core quotes) don't collide.
    runSqlite(
      migrated,
      [
        "PRAGMA foreign_keys=OFF;",
        "DELETE FROM d1_migrations;",
        "DELETE FROM core_runtime_migrations;",
        ...actualTables.map((name) => `DELETE FROM "${name.replaceAll('"', '""')}";`),
      ].join("\n"),
    );
    readSqliteFile(migrated, outputSql);
    if (runSqlite(migrated, "PRAGMA integrity_check;").trim() !== "ok") {
      throw new Error("managed D1 capture integrity check failed");
    }
    if (runSqlite(migrated, "PRAGMA foreign_key_check;").trim()) {
      throw new Error("managed D1 capture foreign key check failed");
    }
    inspectPortableDatabase(migrated);
    copyFileSync(migrated, outputDatabase);
  } catch (error) {
    rmSync(outputDatabase, { force: true });
    throw error;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
  return {
    ok: true,
    databaseId,
    bookmark,
    tables: actualTables,
    outputDatabase,
    outputSql,
  };
}

function runSqlite(database, sql) {
  const result = spawnSync("sqlite3", [database], {
    input: `.bail on\n${sql}\n`,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error("managed D1 capture SQLite validation failed");
  return result.stdout;
}

function readSqliteFile(database, sqlPath) {
  const quoted = sqlPath.replaceAll("'", "''");
  const result = spawnSync("sqlite3", [database], {
    input: `.bail on\nPRAGMA foreign_keys=OFF;\n.read '${quoted}'\n`,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.status !== 0) {
    // The workflow log is public: name the failing constraint or schema object, never row data.
    const reason = String(result.stderr || "").match(
      /(?:UNIQUE|NOT NULL|CHECK|FOREIGN KEY) constraint failed: [\w., ]+|no such (?:table|column): \w+|table \w+ has no column named \w+/,
    )?.[0];
    throw new Error(`managed D1 SQL materialization failed${reason ? ` (${reason})` : ""}`);
  }
}

function isSafeSignedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(
    JSON.stringify(
      await captureManagedD1({
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
        apiToken: process.env.CLOUDFLARE_API_TOKEN,
        databaseId: process.env.D1_ID,
        outputSql: process.argv[2],
        outputDatabase: process.argv[3],
      }),
    ),
  );
}
