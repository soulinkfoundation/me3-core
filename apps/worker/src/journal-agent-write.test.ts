import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { runCoreAgentToolTurn } from "@me3-core/plugin-agent-chat";
import { registerJournalRoutes } from "./routes/journal";
import { getJournalDay, updateJournalDay } from "./journal";
import type { Env } from "./types";
import type { AppContext } from "./http/types";

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));

function fixture(runtime: "sdk" | "legacy") {
  const raw = new DatabaseSync(":memory:");
  databases.push(raw);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  raw.exec("INSERT INTO owner_profile(id, username) VALUES ('alice','alice'), ('bob','bob')");
  const env = { DB: { prepare(sql: string) {
    const bound = (values: (string | number | null)[]) => ({
      async first() { return raw.prepare(sql).get(...values) || null; },
      async all() { return { results: raw.prepare(sql).all(...values) }; },
      async run() {
        // D1 counts trigger changes, including the Journal search index.
        const before = Number(raw.prepare("SELECT total_changes() AS changes").get()?.changes);
        raw.prepare(sql).run(...values);
        return { meta: { changes: Number(raw.prepare("SELECT total_changes() AS changes").get()?.changes) - before } };
      },
    });
    return { ...bound([]), bind: (...values: (string | number | null)[]) => bound(values) };
  } } } as unknown as Env;
  const app = new Hono<{ Bindings: Env }>();
  registerJournalRoutes(app, {
    requireOwner: async (c: AppContext) => c.req.header("X-Test-Owner") || null,
    unauthorized: () => new Response("Unauthorized", { status: 401 }),
  } as never);
  const outputs: unknown[] = [];
  const run = vi.fn(async () => outputs.shift() || { response: "Done." });
  const call = (name: string, args: Record<string, unknown>, id = name) => ({
    tool_calls: [{ id, name, arguments: args }],
  });
  const read = (date = "2026-10-08") => call("core_journal_read", { mode: "date", date });
  const save = (args: Record<string, unknown>) => call("core_journal_save", {
    date: "2026-10-08", mode: "create", body: "ME3 QA reflection.", expectedRevision: null, ...args,
  });
  const send = (requestId = "journal-save") => runCoreAgentToolTurn({
    db: env.DB, userId: "alice", requestId, turnId: requestId, runtime, ownerTimezone: "Europe/Dublin",
    route: { providerId: "workers-ai", model: "scripted-fixture", configured: true,
      backupModel: null, apiKey: null, aiGateway: null, ai: { run } },
    messages: [{ role: "user", content: "Save or update my Journal for 8 October 2026 as requested." }],
  });
  const snapshot = () => raw.prepare("SELECT * FROM journal_entries ORDER BY user_id, entry_date").all();
  return { raw, env, app, outputs, call, read, save, send, run, snapshot };
}

describe("native conditional Journal writes with search-index triggers", () => {
  const path = "/api/journal/days/2026-10-08";
  const headers = { "X-Test-Owner": "alice", "Content-Type": "application/json" };

  it("creates a missing day successfully and rejects a duplicate without changing it", async () => {
    const f = fixture("sdk");
    await updateJournalDay(f.env, "bob", "2026-10-08", { body: "Other owner writing" });
    const other = f.snapshot();
    const missing = await f.app.request(path, { headers }, f.env);
    expect(missing.headers.get("ETag")).toBe('"journal-missing"');
    expect(await missing.json()).toEqual({ entry: null });
    const input = { method: "PATCH", headers: { ...headers, "If-Match": '"journal-missing"' }, body: JSON.stringify({ body: "Slow Saturday", bodyFormat: "markdown" }) };
    const created = await f.app.request(path, input, f.env);
    expect(created.status).toBe(200);
    expect(created.headers.get("ETag")).toBe('"journal-1"');
    expect(await created.json()).toMatchObject({ entry: { body: "Slow Saturday", revision: 1 } });
    const before = f.snapshot();
    expect((await f.app.request(path, input, f.env)).status).toBe(409);
    expect(f.snapshot()).toEqual(before);
    expect(f.snapshot().filter(row => row.user_id === "bob")).toEqual(other);
    expect(f.raw.prepare("SELECT body FROM owner_content_search WHERE user_id = 'alice' AND source_type = 'journal'").get()?.body).toBe("Slow Saturday");
  });

  it("edits a current day successfully and rejects stale edits and deletes", async () => {
    const f = fixture("sdk");
    await updateJournalDay(f.env, "alice", "2026-10-08", { body: "Original" });
    const input = { method: "PATCH", headers: { ...headers, "If-Match": '"journal-1"' }, body: JSON.stringify({ body: "Saved edit" }) };
    const edited = await f.app.request(path, input, f.env);
    expect(edited.status).toBe(200);
    expect(edited.headers.get("ETag")).toBe('"journal-2"');
    expect(await edited.json()).toMatchObject({ entry: { body: "Saved edit", revision: 2 } });
    const before = f.snapshot();
    expect((await f.app.request(path, input, f.env)).status).toBe(409);
    expect((await f.app.request(path, { method: "DELETE", headers: input.headers }, f.env)).status).toBe(409);
    expect(f.snapshot()).toEqual(before);
    expect((await getJournalDay(f.env, "alice", "2026-10-08")).entry?.body).toBe("Saved edit");
  });

  it("archives a current day successfully and restores it with the missing validator", async () => {
    const f = fixture("sdk");
    await updateJournalDay(f.env, "alice", "2026-10-08", { body: "Original" });
    const deleted = await f.app.request(path, { method: "DELETE", headers: { ...headers, "If-Match": '"journal-1"' } }, f.env);
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true });
    expect((await getJournalDay(f.env, "alice", "2026-10-08")).entry).toBeNull();
    expect(f.raw.prepare("SELECT source_id FROM owner_content_search WHERE user_id = 'alice' AND source_type = 'journal'").all()).toEqual([]);
    const restored = await f.app.request(path, { method: "PATCH", headers: { ...headers, "If-Match": '"journal-missing"' }, body: JSON.stringify({ body: "Restored" }) }, f.env);
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ entry: { body: "Restored", revision: 3, archivedAt: null } });
  });
});

describe.each(["sdk", "legacy"] as const)("%s daily Journal agent writes through Core and native API", runtime => {
  it("creates one owner day, exposes it through the native API, and replays without a second save", async () => {
    const f = fixture(runtime);
    await updateJournalDay(f.env, "bob", "2026-10-08", { body: "Other owner writing" });
    const other = f.snapshot();
    f.outputs.push(f.save({ title: "ME3 QA reflection" }), { response: "Saved." });
    await f.send();
    const response = await f.app.request("/api/journal/days/2026-10-08", { headers: { "X-Test-Owner": "alice" } }, f.env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ entry: { title: "ME3 QA reflection", body: "ME3 QA reflection.", bodyFormat: "plain_text", revision: 1 } });
    const beforeReplay = f.snapshot();
    f.outputs.push(f.save({ title: "ME3 QA reflection" }), { response: "Saved." });
    await f.send();
    expect(f.snapshot()).toEqual(beforeReplay);
    expect(f.snapshot().filter(row => row.user_id === "bob")).toEqual(other);
  });

  it.each(["plain_text", "markdown", "html"])("appends to %s without replacing prior body, title, format or metadata", async format => {
    const f = fixture(runtime);
    const original = format === "html" ? '<p>Original writing.</p><img src="/api/journal/media/photo.png">' : "Original writing.";
    await updateJournalDay(f.env, "alice", "2026-10-08", { title: "Keep title", body: original, bodyFormat: format });
    f.raw.exec(`UPDATE journal_entries SET metadata_json = '{"ownerNote":"keep"}'`);
    f.outputs.push(f.read(), f.save({ mode: "append", body: "A <calmer> day & rest.", expectedRevision: 1 }), { response: "Appended." });
    await f.send();
    const entry = (await getJournalDay(f.env, "alice", "2026-10-08")).entry!;
    expect(entry).toMatchObject({ title: "Keep title", bodyFormat: format, revision: 2, metadata: { ownerNote: "keep" } });
    expect(entry.body).toBe(format === "html" ? `${original}\n<p>A &lt;calmer&gt; day &amp; rest.</p>` : `${original}\n\nA <calmer> day & rest.`);
    const beforeReplay = f.snapshot();
    f.outputs.push(f.read(), f.save({ mode: "append", body: "A <calmer> day & rest.", expectedRevision: 1 }), { response: "Appended." });
    await f.send();
    expect(f.snapshot()).toEqual(beforeReplay);
  });

  it("replaces explicitly after a current read while preserving the title when omitted", async () => {
    const f = fixture(runtime);
    await updateJournalDay(f.env, "alice", "2026-10-08", { title: "Keep", body: "Old content", bodyFormat: "html" });
    f.outputs.push(f.read(), f.save({ mode: "replace", body: "Replacement content", expectedRevision: 1 }), { response: "Replaced." });
    await f.send();
    expect((await getJournalDay(f.env, "alice", "2026-10-08")).entry).toMatchObject({ title: "Keep", body: "Replacement content", bodyFormat: "plain_text", revision: 2 });
  });

  it("does not re-append the same writing when a model retry changes the call ID and revision", async () => {
    const f = fixture(runtime);
    await updateJournalDay(f.env, "alice", "2026-10-08", { body: "Original", bodyFormat: "plain_text" });
    const args = { date: "2026-10-08", mode: "append", body: "One reflection", expectedRevision: 1 };
    f.outputs.push(f.read(), f.call("core_journal_save", args, "first-save"), f.read(),
      f.call("core_journal_save", { ...args, expectedRevision: 2 }, "retry-save"), { response: "Saved once." });
    await f.send();
    expect((await getJournalDay(f.env, "alice", "2026-10-08")).entry).toMatchObject({ body: "Original\n\nOne reflection", revision: 2 });
  });

  if (runtime === "sdk") it("replays an earlier append after another append in the same request", async () => {
    const f = fixture(runtime);
    await updateJournalDay(f.env, "alice", "2026-10-08", { body: "Original", bodyFormat: "plain_text" });
    const first = { date: "2026-10-08", mode: "append", body: "First reflection", expectedRevision: 1 };
    f.outputs.push(f.read(), f.call("core_journal_save", first, "first"), f.read(),
      f.call("core_journal_save", { ...first, body: "Second reflection", expectedRevision: 2 }, "second"), f.read(),
      f.call("core_journal_save", { ...first, expectedRevision: 3 }, "first-retry"), { response: "Saved both once." });
    await f.send();
    expect((await getJournalDay(f.env, "alice", "2026-10-08")).entry).toMatchObject({ body: "Original\n\nFirst reflection\n\nSecond reflection", revision: 3 });
  });

  it("rejects a guessed revision without an owner-scoped read in the current turn", async () => {
    const f = fixture(runtime);
    await updateJournalDay(f.env, "alice", "2026-10-08", { body: "Keep this writing" });
    const before = f.snapshot();
    f.outputs.push(f.save({ mode: "replace", expectedRevision: 1 }), { response: "Please read it first." });
    await f.send();
    expect(f.snapshot()).toEqual(before);
    expect(f.raw.prepare("SELECT error_message FROM agent_tool_executions WHERE tool_name = 'core_journal_save'").get()?.error_message).toContain("Read");
  });

  it("allows a corrected retry after a missing-read failure and retains the failed attempt", async () => {
    const f = fixture(runtime);
    await updateJournalDay(f.env, "alice", "2026-10-08", { body: "Original", bodyFormat: "plain_text" });
    const args = { date: "2026-10-08", mode: "append", body: "One reflection", expectedRevision: 1 };
    f.outputs.push(f.call("core_journal_save", args, "save-before-read"), f.read(),
      f.call("core_journal_save", args, "corrected-save"), { response: "Saved after reading." });
    await f.send();
    expect((await getJournalDay(f.env, "alice", "2026-10-08")).entry).toMatchObject({ body: "Original\n\nOne reflection", revision: 2 });
    expect(f.raw.prepare("SELECT status FROM agent_tool_executions WHERE tool_name = 'core_journal_save' ORDER BY rowid").all()).toEqual([{ status: "failed" }, { status: "succeeded" }]);
  });

  it("rejects an edit when a native client saves after the agent's read", async () => {
    const f = fixture(runtime);
    await updateJournalDay(f.env, "alice", "2026-10-08", { body: "Original" });
    f.run.mockImplementationOnce(async () => f.read()).mockImplementationOnce(async () => {
      await updateJournalDay(f.env, "alice", "2026-10-08", { title: "Native edit", body: "Concurrent owner writing" }, 1);
      return f.save({ mode: "append", expectedRevision: 1 });
    });
    await f.send();
    expect((await getJournalDay(f.env, "alice", "2026-10-08")).entry).toMatchObject({ title: "Native edit", body: "Concurrent owner writing", revision: 2 });
  });

  it.each(["existing", "archived"])("does not overwrite an %s day during create", async status => {
    const f = fixture(runtime);
    await updateJournalDay(f.env, "alice", "2026-10-08", { body: "Original writing" });
    if (status === "archived") f.raw.exec("UPDATE journal_entries SET archived_at = CURRENT_TIMESTAMP");
    const before = f.snapshot();
    f.outputs.push(f.save({}), { response: "No save." });
    await f.send();
    expect(f.snapshot()).toEqual(before);
    expect(f.raw.prepare("SELECT status FROM agent_tool_executions WHERE tool_name = 'core_journal_save'").get()?.status).toBe("failed");
  });

  it("rejects an impossible calendar date without saving", async () => {
    const f = fixture(runtime);
    f.outputs.push(f.save({ date: "2027-02-30" }), { response: "Invalid date." });
    await f.send();
    expect(f.snapshot()).toEqual([]);
    expect(f.raw.prepare("SELECT status FROM agent_tool_executions WHERE tool_name = 'core_journal_save'").get()?.status).toBe("failed");
  });

  it("blocks a queued save after Journal is disabled, preserving existing data", async () => {
    const f = fixture(runtime);
    await updateJournalDay(f.env, "alice", "2026-10-07", { body: "Keep earlier writing" });
    const before = f.snapshot();
    f.run.mockImplementationOnce(async () => {
      f.raw.exec("INSERT INTO plugin_installations(plugin_id, version, enabled, status) VALUES ('me3.journal','test',0,'disabled')");
      return f.save({});
    });
    await f.send();
    expect(f.snapshot()).toEqual(before);
    expect(f.raw.prepare("SELECT error_message FROM agent_tool_executions WHERE tool_name = 'core_journal_save'").get()?.error_message).toContain("disabled");
  });
});
