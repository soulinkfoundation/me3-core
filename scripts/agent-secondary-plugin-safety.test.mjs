import assert from "node:assert/strict";
import { test } from "node:test";
import { createDomainTools } from "../packages/agent/src/tools/index.ts";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";

const tool = name => createDomainTools().find(item => item.name === name);
const pluginFor = source => source === "journal" ? "me3.journal" : "me3.mission-control";
const idFor = source => source === "journal" ? "eval-journal" : "eval-task";
const snapshots = seed => ["social_packages", "social_variants", "me3_agent_targets", "me3_agent_selections"].map(table => seed.raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
function fixture() {
  const seed = createSeededAgentEvalInstallation("2026-10-14");
  const controller = new AbortController();
  const context = { db: seed.db, ownerId: seed.ownerId, threadId: "eval-thread", turnId: "secondary-plugins", requestId: "secondary-plugins", toolCallId: "secondary-call", idempotencyKey: "secondary-key", ownerTimezone: "Europe/Dublin", messageText: "Use only enabled owner content.", messages: [], enabledPluginIds: new Set(["me3.social-publishing", "me3.journal", "me3.mission-control"]), signal: controller.signal };
  let reads = 0, afterRead, onPermission;
  const prepare = seed.db.prepare.bind(seed.db);
  seed.db.prepare = sql => {
    const statement = prepare(sql);
    return { ...statement, bind(...values) {
      const bound = statement.bind(...values);
      return { ...bound, async first() {
        if (/FROM (?:journal_entries|mission_tasks|mission_projects)\b/.test(sql)) reads++;
        const row = await bound.first();
        if (sql.includes("FROM plugin_installations")) onPermission?.(values[0]);
        if (/FROM (?:journal_entries|mission_tasks)\b/.test(sql)) afterRead?.();
        return row;
      }, async all() {
        if (/FROM (?:owner_content_search|mission_projects)\b/.test(sql)) reads++;
        const rows = await bound.all();
        if (sql.includes("FROM owner_content_search")) afterRead?.();
        return rows;
      } };
    } };
  };
  return { seed, context, controller, reset: () => { reads = 0; }, reads: () => reads,
    disable: source => seed.raw.prepare("UPDATE plugin_installations SET enabled=0,status='disabled' WHERE plugin_id=?").run(pluginFor(source)),
    afterRead: hook => { afterRead = hook; }, onPermission: hook => { onPermission = hook; } };
}

for (const [sourceType, disabled] of [["journal", "journal"], ["mission_task", "mission_task"], ["all", "journal"]]) {
  test(`owner content ${sourceType} refuses persisted disabled ${disabled} before indexed source access`, async () => {
    const f = fixture();
    try {
      f.disable(disabled); f.seed.reopen(); const before = snapshots(f.seed);
      const result = await tool("core_owner_content_search").execute({ query: "launch", sourceType }, f.context);
      assert.equal(result.status, "error"); assert.match(result.error, /disabled|unavailable/i);
      assert.equal(f.reads(), 0); assert.deepEqual(snapshots(f.seed), before);
    } finally { f.seed.close(); }
  });
}

test("journal search cannot read task project metadata through a secondary filter after Tasks is disabled", async () => {
  const f = fixture();
  try {
    f.disable("mission_task");
    const result = await tool("core_owner_content_search").execute({ query: "launch", sourceType: "journal", projectName: "ME3 Launch" }, f.context);
    assert.equal(result.status, "error"); assert.match(result.error, /disabled|unavailable/i); assert.equal(f.reads(), 0);
  } finally { f.seed.close(); }
});

test("owner content rechecks secondary eligibility after indexed reads before returning private results or remembering targets", async () => {
  const f = fixture();
  try {
    const before = snapshots(f.seed); f.afterRead(() => f.disable("journal"));
    const result = await tool("core_owner_content_search").execute({ query: "launch", sourceType: "journal" }, f.context);
    assert.equal(result.status, "error"); assert.match(result.error, /disabled|unavailable/i); assert.deepEqual(snapshots(f.seed), before);
  } finally { f.seed.close(); }
});

test("all-content search still searches only the caller-enabled source without consulting a disabled excluded source", async () => {
  const f = fixture();
  try {
    f.disable("journal"); f.context.enabledPluginIds.delete("me3.journal");
    const result = await tool("core_owner_content_search").execute({ query: "launch", sourceType: "all" }, f.context);
    assert.equal(result.status, "ok"); assert.ok(result.data.results.length > 0);
    assert.ok(result.data.results.every(row => row.sourceType === "mission_task"));
  } finally { f.seed.close(); }
});
