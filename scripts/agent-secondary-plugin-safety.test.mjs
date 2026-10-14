import assert from "node:assert/strict";
import { test } from "node:test";
import { createDomainTools } from "../packages/agent/src/tools/index.ts";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";

const tool = name => createDomainTools().find(item => item.name === name);
const pluginFor = source => source === "journal" ? "me3.journal" : "me3.mission-control";
const idFor = source => source === "journal" ? "eval-journal" : "eval-task";
const snapshots = seed => ["social_packages", "social_variants", "social_suggestions", "me3_agent_targets", "me3_agent_selections"].map(table => seed.raw.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
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
const sourceArgs = sourceType => ({ sourceType, sourceId: idFor(sourceType) });
const draftArgs = sourceType => ({ ...sourceArgs(sourceType), ideaText: "Keep the private source", linkedinBody: "An independently authored draft." });
const suggestionsArgs = sourceType => ({ ...sourceArgs(sourceType), quoteText: "I need a calmer launch week.", quoteSourceExcerpt: "I need a calmer launch week.", shortPostText: "Calmer launch", shortPostSourceExcerpt: "I need a calmer launch week.", threadText: "A calmer launch", threadSourceExcerpt: "I need a calmer launch week.", carouselOutlineText: "Slide: Calm", carouselSourceExcerpt: "I need a calmer launch week." });

for (const source of ["journal", "mission_task"]) {
  for (const operation of ["read", "draft", "suggestions"]) {
    test(`persisted disabled ${source} blocks social ${operation} before secondary read or write despite stale caller eligibility`, async () => {
      const f = fixture();
      try {
        if (operation !== "read") assert.equal((await tool("core_social_source_read").execute(sourceArgs(source), f.context)).status, "ok");
        f.disable(source); f.seed.reopen(); f.reset();
        const before = snapshots(f.seed);
        const name = operation === "read" ? "core_social_source_read" : `core_social_${operation}_create`;
        const args = operation === "read" ? sourceArgs(source) : operation === "draft" ? draftArgs(source) : suggestionsArgs(source);
        const result = await tool(name).execute(args, f.context);
        assert.equal(result.status, "error"); assert.match(result.error, /disabled|unavailable/i);
        assert.equal(f.reads(), 0, "a disabled secondary source must not be queried");
        assert.deepEqual(snapshots(f.seed), before);
      } finally { f.seed.close(); }
    });
  }
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

for (const operation of ["read", "draft"]) {
  test(`secondary permission is rechecked after awaited social source read before ${operation === "read" ? "publication" : "draft creation"}`, async () => {
    const f = fixture();
    try {
      if (operation === "draft") await tool("core_social_source_read").execute(sourceArgs("journal"), f.context);
      const before = snapshots(f.seed);
      f.afterRead(() => f.disable("journal"));
      const result = await tool(operation === "read" ? "core_social_source_read" : "core_social_draft_create").execute(operation === "read" ? sourceArgs("journal") : draftArgs("journal"), f.context);
      assert.equal(result.status, "error"); assert.match(result.error, /disabled|unavailable/i);
      assert.deepEqual(snapshots(f.seed), before);
    } finally { f.seed.close(); }
  });
}

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

test("Stop during the awaited secondary permission read prevents the private source read", async () => {
  const f = fixture();
  try {
    f.onPermission(id => { if (id === "me3.journal") f.controller.abort(); });
    const result = await tool("core_social_source_read").execute(sourceArgs("journal"), f.context);
    assert.equal(result.status, "error"); assert.match(result.error, /abort|cancel/i); assert.equal(f.reads(), 0);
  } finally { f.seed.close(); }
});
