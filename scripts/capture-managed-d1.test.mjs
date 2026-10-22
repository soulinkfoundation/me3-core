import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureManagedD1 } from "./capture-managed-d1.mjs";
import { createMigratedDatabase } from "./portable-proof.mjs";
import { TABLE_POLICIES } from "./portable-v1.mjs";

const ACCOUNT_ID = "a".repeat(32);
const DATABASE_ID = "11111111-1111-4111-8111-111111111111";

test("exports only classified tables at one bookmark and materializes filtered SQL", async () => {
  const root = mkdtempSync(join(tmpdir(), "me3-managed-d1-capture-test-"));
  const fixtureDatabase = createMigratedDatabase(join(root, "fixture"));
  const tableRows = sqliteJson(fixtureDatabase, "PRAGMA table_list;");
  const outputSql = join(root, "capture.sql");
  const outputDatabase = join(root, "capture.sqlite");
  const calls = [];
  let polls = 0;
  // A real D1 export carries the Core seed quotes the migrated target already has.
  const seededQuote = sqliteJson(fixtureDatabase, "SELECT * FROM quotes ORDER BY id LIMIT 1;")[0];
  const seededQuoteCount = sqliteScalar(fixtureDatabase, "SELECT COUNT(*) FROM quotes;");
  const exportedSql = `
    INSERT INTO "quotes" (${Object.keys(seededQuote).join(", ")})
    VALUES (${Object.values(seededQuote).map((value) => (value === null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`)).join(", ")});
    INSERT INTO managed_runtime_state
      (id, installation_id, state, generation, quiesced_at, suspended_at,
       credentials_revoked_at, storage_purged_at, last_request_id, created_at, updated_at)
    VALUES
      ('managed', 'mi-1234567890abcdef', 'quiesced', 2, CURRENT_TIMESTAMP,
       NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
  `;

  try {
    const result = await captureManagedD1(
      {
        accountId: ACCOUNT_ID,
        apiToken: "api-token",
        databaseId: DATABASE_ID,
        outputSql,
        outputDatabase,
      },
      {
        wait: async () => {},
        request: async (url, init = {}) => {
          calls.push({ url, init });
          if (url.endsWith("/query")) {
            return jsonResponse({ success: true, result: [{ results: tableRows }] });
          }
          if (url.endsWith("/export")) {
            const body = JSON.parse(init.body);
            if (!body.current_bookmark) {
              return jsonResponse({
                success: true,
                result: { status: "active", at_bookmark: "bookmark-1" },
              });
            }
            polls += 1;
            return jsonResponse({
              success: true,
              result: {
                status: "complete",
                at_bookmark: "bookmark-1",
                result: { signed_url: "https://download.example.test/capture.sql" },
              },
            });
          }
          assert.equal(url, "https://download.example.test/capture.sql");
          return new Response(exportedSql, { status: 200 });
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.bookmark, "bookmark-1");
    assert.equal(polls, 1);
    assert.match(readFileSync(outputSql, "utf8"), /mi-1234567890abcdef/);
    assert.equal(
      sqliteScalar(
        outputDatabase,
        "SELECT installation_id || ':' || state FROM managed_runtime_state WHERE id = 'managed';",
      ),
      "mi-1234567890abcdef:quiesced",
    );
    assert.equal(sqliteScalar(outputDatabase, "SELECT COUNT(*) FROM quotes;"), "1");
    assert.notEqual(seededQuoteCount, "0");
    const exportBody = JSON.parse(calls.find((call) => call.url.endsWith("/export")).init.body);
    assert.equal(exportBody.output_format, "polling");
    assert.equal(exportBody.dump_options.no_schema, true);
    assert.deepEqual(exportBody.dump_options.tables, result.tables);
    assert.equal(
      exportBody.dump_options.tables.some((name) => TABLE_POLICIES.get(name) === "derived"),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails closed before export when D1 has an unclassified table", async () => {
  const root = mkdtempSync(join(tmpdir(), "me3-managed-d1-unknown-test-"));
  const fixtureDatabase = createMigratedDatabase(join(root, "fixture"));
  const tableRows = sqliteJson(fixtureDatabase, "PRAGMA table_list;");
  let exportCalled = false;
  try {
    await assert.rejects(
      captureManagedD1(
        {
          accountId: ACCOUNT_ID,
          apiToken: "api-token",
          databaseId: DATABASE_ID,
          outputSql: join(root, "capture.sql"),
          outputDatabase: join(root, "capture.sqlite"),
        },
        {
          request: async (url) => {
            if (url.endsWith("/query")) {
              return jsonResponse({
                success: true,
                result: [{ results: [...tableRows, { schema: "main", name: "surprise", type: "table" }] }],
              });
            }
            exportCalled = true;
            throw new Error("export must not run");
          },
        },
      ),
      /unknown=surprise/,
    );
    assert.equal(exportCalled, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function sqliteJson(database, sql) {
  const result = spawnSync("sqlite3", ["-json", database], {
    input: `.bail on\n${sql}\n`,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout || "[]");
}

function sqliteScalar(database, sql) {
  const result = spawnSync("sqlite3", [database], {
    input: `.bail on\n${sql}\n`,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
