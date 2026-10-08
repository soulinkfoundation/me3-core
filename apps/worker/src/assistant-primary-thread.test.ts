import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { resolvePrimaryAssistantThread } from "./assistant-primary-thread";
import { registerAssistantRoutes } from "./routes/assistant";
import { dispatchAgentChannelTurn } from "./agent-channels";
import { Me3UserAgent } from "./user-agent";
import { listAgentMailboxMessages } from "./agent-chat";
import { runCoreAgentToolTurn } from "@me3-core/plugin-agent-chat";
import type { Env } from "./types";

const databases: DatabaseSync[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
  vi.useRealTimers();
});

function fixture() {
  const raw = new DatabaseSync(":memory:");
  databases.push(raw);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  raw.exec("PRAGMA foreign_keys = ON");
  raw.exec("INSERT INTO owner_profile(id, username) VALUES ('alice', 'alice'), ('bob', 'bob')");
  const prepare = (sql: string) => {
    let params: (string | number | null)[] = [];
    const statement = {
      bind(...values: (string | number | null)[]) { params = values; return statement; },
      async first() { return raw.prepare(sql).get(...params) || null; },
      async all() { return { results: raw.prepare(sql).all(...params) }; },
      async run() { return { success: true, meta: { changes: Number(raw.prepare(sql).run(...params).changes) } }; },
    };
    return statement;
  };
  const env = { DB: {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      raw.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        raw.exec("COMMIT");
        return results;
      } catch (error) { raw.exec("ROLLBACK"); throw error; }
    },
  } } as unknown as Env;
  // Serialize batches as D1 does, including when callers resolve concurrently.
  const batch = env.DB.batch.bind(env.DB);
  let pending: Promise<unknown> = Promise.resolve();
  env.DB.batch = ((statements: D1PreparedStatement[]) => {
    const result = pending.then(() => batch(statements));
    pending = result.catch(() => {});
    return result;
  }) as D1Database["batch"];
  function thread(id: string, owner = "alice", project: string | null = null, origin = "assistant") {
    raw.prepare("INSERT INTO assistant_threads(id, owner_id, title, project_id, origin_surface) VALUES (?, ?, ?, ?, ?)")
      .run(id, owner, id, project, origin);
  }
  function connect(channel = "channel-1") {
    raw.prepare(`INSERT INTO agent_channel_connections(id, user_id, channel, status, setup_token, provider_thread_id)
      VALUES ('connection', 'alice', 'soulink', 'active', 'dispatch-token', ?)
      ON CONFLICT(user_id, channel) DO UPDATE SET provider_thread_id = excluded.provider_thread_id`).run(channel);
  }
  const app = new Hono<{ Bindings: Env }>();
  registerAssistantRoutes(app, {
    requireOwner: async (c) => c.req.header("X-Test-Owner") || null,
    unauthorized: () => new Response("Unauthorized", { status: 401 }),
    getSessionOwnerId: async (c) => c.req.header("X-Test-Owner") || null,
    getSetupRequired: async () => [],
  });
  return { raw, env, app, thread, connect };
}

function reminderSelectionFixture(runtime: "legacy" | "sdk", duplicate = true) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
  const f = fixture();
  f.env.ME3_ASSISTANT_RUNTIME = runtime;
  f.env.ME3_DEPLOYMENT_MODE = "self_hosted";
  f.env.ME3_AI_CHAT_PROVIDER = "workers-ai";
  f.env.ME3_AI_CHAT_MODEL = "scripted-fixture";
  f.env.ME3_JEV_ROUTER_MODE = "off";
  const insert = f.raw.prepare(`INSERT INTO user_reminders(id,user_id,title,notes,remind_at,timezone,recurrence_rule)
    VALUES (?, ?, 'ME3 QA check launch', 'Keep these notes', ?, 'Europe/Dublin', 'weekly:fri')`);
  insert.run("first-reminder", "alice", "2027-01-15T12:00:00.000Z");
  if (duplicate) insert.run("second-reminder", "alice", "2027-01-17T12:00:00.000Z");
  insert.run("other-owner-reminder", "bob", "2027-01-15T12:00:00.000Z");
  const outputs: unknown[] = [];
  const modelInputs: unknown[] = [];
  f.env.AI = { run: async (_model: unknown, input: unknown) => {
    modelInputs.push(input);
    if (!outputs.length) throw new Error("Unexpected model step");
    return outputs.shift();
  } } as unknown as Ai;
  // Every request opens a new agent/cache; the conversation and selection must come from D1.
  f.env.ME3_SDK_USER_AGENT = {
    idFromName: (id: string) => id,
    get: () => {
      const cache = new Map<string, unknown>();
      const state = { storage: {
        get: async (key: string) => cache.get(key), put: async (key: string, value: unknown) => { cache.set(key, value); },
        delete: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) cache.delete(key); },
      } } as unknown as DurableObjectState;
      const agent = new Me3UserAgent(state, f.env);
      return { fetch: (url: string, init: RequestInit) => agent.fetch(new Request(url, init)) };
    },
  } as unknown as DurableObjectNamespace;
  f.env.ME3_USER_AGENT = f.env.ME3_SDK_USER_AGENT;
  const rows = () => f.raw.prepare("SELECT id,user_id,title,notes,remind_at,timezone,recurrence_rule,status FROM user_reminders ORDER BY id").all();
  const call = (operation: "update" | "cancel", id = "first-reminder") => ({ tool_calls: [{
    id: "guessed", name: `core_reminders_${operation}`, arguments: operation === "cancel" ? { reminderId: id }
      : { reminderId: id, title: "ME3 QA check launch", date: "2027-01-16", time: "09:30", timezone: "Europe/Dublin" },
  }] });
  const send = async (messageText: string) => {
    outputs.unshift({ tool_calls: [{ id: "list-first", name: "core_reminders_list", arguments: {} }] });
    const primary = await resolvePrimaryAssistantThread(f.env, "alice");
    const response = await f.app.fetch(new Request("https://install.test/api/assistant/chat/turn", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Test-Owner": "alice" },
      body: JSON.stringify({ requestId: crypto.randomUUID(), threadId: primary.id, messageText }),
    }), f.env);
    if (response.status !== 200) throw new Error(`Assistant returned ${response.status}: ${await response.text()}`);
    return await response.json() as { replyText: string; reminderAction: { kind: string } | null };
  };
  return { ...f, outputs, modelInputs, rows, call, send };
}

describe("owner selection at the reminder write boundary", () => {
  it.each(["legacy", "sdk"] as const)("prepares server choices by the owner's exact title without inventing an ID in %s", async runtime => {
    for (const operation of ["update", "cancel"] as const) {
      const f = reminderSelectionFixture(runtime); const before = f.rows();
      const { reminderId: _id, ...args } = f.call(operation).tool_calls[0].arguments;
      const call = { tool_calls: [{ id: "by-title", name: `core_reminders_${operation}`, arguments: { ...args, reminderTitle: "ME3 QA check launch" } }] };
      f.outputs.push(call, { response: "Done." });
      const first = await f.send(operation === "cancel" ? "Cancel my ME3 QA check launch reminder."
        : "Move my ME3 QA check launch reminder to 16 January 2027 at 9:30am in Europe/Dublin.");
      expect(first.replyText).toContain("Which reminder do you mean?");
      expect(first.reminderAction).toBeNull();
      expect(f.rows()).toEqual(before);
      f.outputs.push(call, { response: "Done." });
      const selected = await f.send("1");
      expect(selected.reminderAction?.kind).toBe(operation === "cancel" ? "cancelled" : "updated");
      expect(f.rows()).toEqual(before.map(row => row.id === "first-reminder"
        ? operation === "cancel" ? { ...row, status: "cancelled" } : { ...row, remind_at: "2027-01-16T09:30:00.000Z" }
        : row));
    }
  });

  it.each(["legacy", "sdk"] as const)("resolves a single exact owner title while preserving saved fields in %s", async runtime => {
    const f = reminderSelectionFixture(runtime, false); const before = f.rows();
    const { reminderId: _id, title: _title, ...args } = f.call("update").tool_calls[0].arguments;
    f.outputs.push({ tool_calls: [{ id: "by-title", name: "core_reminders_update", arguments: { ...args, reminderTitle: "ME3 QA check launch" } }] }, { response: "Moved it." });
    const result = await f.send("Move my ME3 QA check launch reminder to 16 January 2027 at 9:30am in Europe/Dublin.");
    expect(result.reminderAction?.kind).toBe("updated");
    expect(f.rows()).toEqual(before.map(row => row.id === "first-reminder" ? { ...row, remind_at: "2027-01-16T09:30:00.000Z" } : row));
  });

  it.each(["legacy", "sdk"] as const)("uses an explicit original due date to select the second same-title record in %s", async runtime => {
    const f = reminderSelectionFixture(runtime); const before = f.rows();
    const { reminderId: _id, title: _title, ...args } = f.call("update").tool_calls[0].arguments;
    f.outputs.push({ tool_calls: [{ id: "by-title-and-date", name: "core_reminders_update", arguments: { ...args, reminderTitle: "ME3 QA check launch" } }] }, { response: "Moved it." });
    const result = await f.send("Move my ME3 QA check launch reminder originally due on 17 January 2027 to 16 January 2027 at 9:30am in Europe/Dublin.");
    expect(result.reminderAction?.kind).toBe("updated");
    expect(f.rows()).toEqual(before.map(row => row.id === "second-reminder" ? { ...row, remind_at: "2027-01-16T09:30:00.000Z" } : row));
  });

  it.each(["missing", "other owner", "unrequested", "conflicting ID"])("does not write to a %s title selector", async failure => {
    const f = reminderSelectionFixture("sdk");
    f.raw.exec("INSERT INTO user_reminders(id,user_id,title,remind_at) VALUES ('bob-only','bob','ME3 QA private title','2027-01-15T12:00:00.000Z'), ('unrelated','alice','ME3 QA unrelated','2027-01-15T12:00:00.000Z')");
    const before = f.rows();
    const args = failure === "conflicting ID" ? { reminderId: "first-reminder", reminderTitle: "ME3 QA unrelated" }
      : { reminderTitle: failure === "other owner" ? "ME3 QA private title" : failure === "unrequested" ? "ME3 QA unrelated" : "ME3 QA missing" };
    f.outputs.push({ tool_calls: [{ id: "by-title", name: "core_reminders_cancel", arguments: args }] }, { response: "Done." });
    await f.send(`Cancel my ${failure === "unrequested" || failure === "conflicting ID" ? "ME3 QA check launch" : args.reminderTitle} reminder.`);
    expect(f.rows()).toEqual(before);
  });

  it.each(["legacy", "sdk"] as const)("asks for a server selection when the model appends the reminder noun in %s", async runtime => {
    for (const duplicate of [true, false]) {
      const f = reminderSelectionFixture(runtime, duplicate); const before = f.rows();
      const { reminderId: _id, title: _title, ...args } = f.call("update").tool_calls[0].arguments;
      const call = { tool_calls: [{ id: "descriptor", name: "core_reminders_update", arguments: { ...args, reminderTitle: "ME3 QA check launch reminder" } }] };
      f.outputs.push(call, { response: "Done." });
      const first = await f.send("Move my ME3 QA check launch reminder to 16 January 2027 at 9:30am in Europe/Dublin.");
      expect(first.replyText).toContain("Which reminder do you mean?");
      expect(first.reminderAction).toBeNull();
      expect(f.rows()).toEqual(before);
      f.outputs.push(call, { response: "Done." });
      await f.send("1");
      expect(f.rows()).toEqual(before.map(row => row.id === "first-reminder" ? { ...row, remind_at: "2027-01-16T09:30:00.000Z" } : row));
    }
  });

  it.each(["pending", "cancelled"])("honours an actual %s title ending in reminder without substituting its shorter name", async status => {
    const f = reminderSelectionFixture("sdk");
    f.raw.prepare("INSERT INTO user_reminders(id,user_id,title,remind_at,status) VALUES ('literal','alice','ME3 QA check launch reminder','2027-01-20T12:00:00.000Z',?)").run(status);
    const before = f.rows();
    f.outputs.push({ tool_calls: [{ id: "literal", name: "core_reminders_cancel", arguments: { reminderTitle: "ME3 QA check launch reminder" } }] }, { response: "Done." });
    await f.send("Cancel my ME3 QA check launch reminder.");
    expect(f.rows()).toEqual(before.map(row => row.id === "literal" && status === "pending" ? { ...row, status: "cancelled" } : row));
  });

  it.each(["legacy", "sdk"] as const)("keeps a descriptor clarification pending through model retries in the same %s turn", async runtime => {
    for (const retry of ["stable ID", "shorter title"]) {
      const f = reminderSelectionFixture(runtime, false); const before = f.rows();
      const { reminderId: _id, title: _title, ...args } = f.call("update").tool_calls[0].arguments;
      const first = { tool_calls: [{ id: "descriptor", name: "core_reminders_update", arguments: { ...args, reminderTitle: "ME3 QA check launch reminder" } }] };
      const second = retry === "stable ID" ? f.call("update")
        : { tool_calls: [{ id: "retry", name: "core_reminders_update", arguments: { ...args, reminderTitle: "ME3 QA check launch" } }] };
      f.outputs.push(first, second, { response: "Done." });
      const result = await f.send("Move my ME3 QA check launch reminder to 16 January 2027 at 9:30am in Europe/Dublin.");
      expect(f.rows()).toEqual(before);
      expect(result.reminderAction).toBeNull();
      expect(result.replyText).toContain("Which reminder do you mean?");
    }
  });

  it("retains the required owner question when a later read would mask it", async () => {
    const f = reminderSelectionFixture("sdk", false); const before = f.rows();
    const { reminderId: _id, title: _title, ...args } = f.call("update").tool_calls[0].arguments;
    f.outputs.push({ tool_calls: [{ id: "descriptor", name: "core_reminders_update", arguments: { ...args, reminderTitle: "ME3 QA check launch reminder" } }] },
      { tool_calls: [{ id: "read-again", name: "core_reminders_list", arguments: {} }] }, { response: "Done, moved it." });
    const result = await f.send("Move my ME3 QA check launch reminder to 16 January 2027 at 9:30am in Europe/Dublin.");
    expect(f.rows()).toEqual(before);
    expect(result.replyText).toContain("Which reminder do you mean?");
    expect(result.reminderAction).toBeNull();
  });

  it.each(["legacy", "sdk"] as const)("does not treat a preceding title as permission after the owner changes target in %s", async runtime => {
    const f = reminderSelectionFixture(runtime, false);
    f.raw.exec("INSERT INTO user_reminders(id,user_id,title,remind_at) VALUES ('new-target','alice','ME3 QA unrelated','2027-01-15T12:00:00.000Z')");
    f.outputs.push({ response: "Here are your reminders." });
    await f.send("List my ME3 QA check launch reminders.");
    const before = f.rows();
    f.outputs.push({ tool_calls: [{ id: "stale-title", name: "core_reminders_cancel", arguments: { reminderTitle: "ME3 QA check launch" } }] }, { response: "Cancelled it." });
    const result = await f.send("Cancel my ME3 QA unrelated reminder.");
    expect(f.rows()).toEqual(before);
    expect(result.reminderAction).toBeNull();
    expect(result.replyText).toContain("Which reminder do you mean?");
  });

  it.each(["legacy", "sdk"] as const)("moves an explicit stable ID without asking for or replacing its title in %s", async runtime => {
    const f = reminderSelectionFixture(runtime); const before = f.rows();
    const { title: _title, ...args } = f.call("update").tool_calls[0].arguments;
    f.outputs.push({ tool_calls: [{ id: "move", name: "core_reminders_update", arguments: args }] }, { response: "Moved it." });
    const result = await f.send("Move reminder ID first-reminder to 16 January 2027 at 9:30am in Europe/Dublin.");
    expect(result.reminderAction?.kind).toBe("updated");
    expect(f.rows()).toEqual(before.map(row => row.id === "first-reminder" ? { ...row, remind_at: "2027-01-16T09:30:00.000Z" } : row));
  });

  it("still applies an explicitly requested title change to the selected record", async () => {
    const f = reminderSelectionFixture("sdk"); const before = f.rows();
    const args = { ...f.call("update").tool_calls[0].arguments, title: "ME3 QA renamed" };
    f.outputs.push({ tool_calls: [{ id: "rename", name: "core_reminders_update", arguments: args }] }, { response: "Renamed and moved it." });
    await f.send("Rename reminder ID first-reminder to ME3 QA renamed and move it to 16 January 2027 at 9:30am in Europe/Dublin.");
    expect(f.rows()).toEqual(before.map(row => row.id === "first-reminder"
      ? { ...row, title: "ME3 QA renamed", remind_at: "2027-01-16T09:30:00.000Z" } : row));
  });

  it.each(["legacy", "sdk"] as const)("blocks guessed duplicate targets and accepts a natural date selection after a fresh %s agent", async runtime => {
    const f = reminderSelectionFixture(runtime);
    const before = f.rows();
    f.outputs.push(f.call("update"), { response: "Done — I guessed the first reminder." });
    const first = await f.send("Move my ME3 QA check launch reminder to 16 January 2027 at 9:30am in Europe/Dublin.");
    expect(f.rows()).toEqual(before);
    expect(first.replyText).toContain("Which reminder");
    expect(first.replyText).not.toContain("Done");
    expect(first.reminderAction).toBeNull();
    f.outputs.push(f.call("update"), { response: "Done." });
    await f.send("The one originally due on 15 January 2027. Move only that reminder to 16 January 2027 at 9:30am in Europe/Dublin.");
    expect(f.rows()).toEqual(before.map(row => row.id === "first-reminder" ? { ...row, remind_at: "2027-01-16T09:30:00.000Z" } : row));
    expect(f.raw.prepare("SELECT count(*) AS n FROM assistant_primary_threads WHERE owner_id='alice'").get()?.n).toBe(1);
    expect(f.raw.prepare("SELECT count(*) AS n FROM assistant_messages WHERE owner_id='alice'").get()?.n).toBe(4);
  });

  it.each(["legacy", "sdk"] as const)("blocks a guessed cancellation and uses the stored numbered selection in %s", async runtime => {
    const f = reminderSelectionFixture(runtime); const before = f.rows();
    f.outputs.push(f.call("cancel"), { response: "Done." });
    await f.send("Cancel my ME3 QA check launch reminder.");
    expect(f.rows()).toEqual(before);
    f.outputs.push(f.call("cancel"), { response: "Done." });
    await f.send("1");
    expect(f.rows()).toEqual(before.map(row => row.id === "first-reminder" ? { ...row, status: "cancelled" } : row));
  });

  it.each(["legacy", "sdk"] as const)("restores the server choice IDs and proposed move for a fresh %s model turn", async runtime => {
    const f = reminderSelectionFixture(runtime);
    f.outputs.push(f.call("update"), { response: "Done." });
    await f.send("Move my ME3 QA check launch reminder to 16 January 2027 at 9:30am in Europe/Dublin.");
    const next = f.modelInputs.length;
    f.outputs.push(f.call("update"), { response: "Moved it." });
    await f.send("1");
    const context = JSON.stringify(f.modelInputs[next]);
    expect(context).toContain("Saved reminder selection");
    expect(context).toContain("first-reminder");
    expect(context).toContain("second-reminder");
    expect(context).toContain("2027-01-16T09:30:00.000Z");
    expect(context).not.toContain("other-owner-reminder");
  });

  it.each(["legacy", "sdk"] as const)("binds an owner number to the saved target despite model ID mistakes in %s", async runtime => {
    for (const operation of ["update", "cancel"] as const) for (const modelId of ["1", "second-reminder"]) {
      const f = reminderSelectionFixture(runtime); const before = f.rows();
      f.outputs.push(f.call(operation), { response: "Done." });
      await f.send(operation === "cancel" ? "Cancel my ME3 QA check launch reminder."
        : "Move my ME3 QA check launch reminder to 16 January 2027 at 9:30am in Europe/Dublin.");
      f.outputs.push(f.call(operation, modelId), { response: "Done." });
      const result = await f.send("1");
      expect(result.reminderAction?.kind).toBe(operation === "cancel" ? "cancelled" : "updated");
      expect(f.rows()).toEqual(before.map(row => row.id === "first-reminder"
        ? operation === "cancel" ? { ...row, status: "cancelled" } : { ...row, remind_at: "2027-01-16T09:30:00.000Z" }
        : row));
    }
  });

  it.each(["no server receipt", "different operation"])("does not interpret a number as authorization with %s", async failure => {
    const f = reminderSelectionFixture("sdk"); const before = f.rows();
    if (failure === "different operation") f.outputs.push(f.call("update"));
    f.outputs.push({ response: "Which reminder? 1. January 15. 2. January 17." });
    await f.send("Move my ME3 QA check launch reminder to 16 January 2027 at 9:30am in Europe/Dublin.");
    f.outputs.push(f.call("cancel"), { response: "Done." });
    await f.send("1");
    expect(f.rows()).toEqual(before);
  });

  it.each(["legacy", "sdk"] as const)("recognizes an explicit source date after a model question omits titles in %s", async runtime => {
    for (const operation of ["update", "cancel"] as const) {
      const f = reminderSelectionFixture(runtime); const before = f.rows();
      f.outputs.push({ response: "Which one? 1. 15 January 2027 at noon. 2. 17 January 2027 at noon." });
      await f.send(operation === "cancel" ? "Cancel my ME3 QA check launch reminder."
        : "Move my ME3 QA check launch reminder to 16 January 2027 at 9:30am in Europe/Dublin.");
      f.outputs.push(f.call(operation), { response: "Done." });
      const result = await f.send(`The one originally due on 15 January 2027. ${operation === "cancel" ? "Cancel only that reminder." : "Move only that reminder to 16 January 2027 at 9:30am in Europe/Dublin."}`);
      expect(result.reminderAction?.kind).toBe(operation === "cancel" ? "cancelled" : "updated");
      expect(f.rows()).toEqual(before.map(row => row.id === "first-reminder"
        ? operation === "cancel" ? { ...row, status: "cancelled" } : { ...row, remind_at: "2027-01-16T09:30:00.000Z" }
        : row));
    }
  });

  it.each(["changed record", "removed selected record", "no selection", "changed destination", "expired choice"])("does not authorize a %s from a prior choice list", async failure => {
    const f = reminderSelectionFixture("sdk");
    f.outputs.push(f.call("update"), { response: "Done." });
    await f.send("Move my ME3 QA check launch reminder to 16 January 2027 at 9:30am in Europe/Dublin.");
    if (failure === "changed record") f.raw.exec("UPDATE user_reminders SET remind_at='2027-01-18T12:00:00.000Z' WHERE id='first-reminder'");
    if (failure === "removed selected record") f.raw.exec("DELETE FROM user_reminders WHERE id='first-reminder'");
    if (failure === "expired choice") f.raw.exec("UPDATE agent_tool_executions SET updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-31 minutes')");
    const before = f.rows();
    const call = f.call("update", failure === "removed selected record" ? "second-reminder" : "first-reminder");
    if (failure === "changed destination") call.tool_calls[0].arguments.time = "10:30";
    f.outputs.push(call, { response: "Done." });
    const result = await f.send(failure === "no selection" ? "Go ahead" : "1");
    expect(f.rows()).toEqual(before);
    expect(result.replyText).toContain(failure === "removed selected record" ? "became unavailable" : "Which reminder");
    expect(result.reminderAction).toBeNull();
  });

  it("does not cancel a reminder ID the owner explicitly excluded", async () => {
    const f = reminderSelectionFixture("sdk"); const before = f.rows();
    f.outputs.push(f.call("cancel"), { response: "Done." });
    const result = await f.send("Cancel my ME3 QA check launch reminder, but not reminder ID first-reminder.");
    expect(f.rows()).toEqual(before);
    expect(result.replyText).toContain("Which reminder");
    expect(result.reminderAction).toBeNull();
  });

  it.each(["source date", "stable ID"])("does not substitute a single remaining reminder for a missing %s", async identifier => {
    const f = reminderSelectionFixture("sdk", false); const before = f.rows();
    f.outputs.push(f.call("update"), { response: "Done." });
    const target = identifier === "source date" ? "ME3 QA check launch reminder due on 17 January 2027" : "reminder ID missing-reminder";
    const result = await f.send(`Move my ${target} to 16 January 2027 at 9:30am in Europe/Dublin.`);
    expect(f.rows()).toEqual(before);
    expect(result.replyText).toContain("Which reminder");
    expect(result.reminderAction).toBeNull();
  });

  it.each(["update", "cancel"] as const)("reports a concurrent edit instead of claiming a successful %s", async operation => {
    const f = reminderSelectionFixture("sdk");
    const prepare = f.env.DB.prepare.bind(f.env.DB);
    let changed = false;
    f.env.DB.prepare = (sql => {
      const statement = prepare(sql);
      const bind = statement.bind.bind(statement);
      statement.bind = (...values: unknown[]) => {
        const bound = bind(...values);
        const run = bound.run.bind(bound);
        bound.run = async () => {
          if (!changed && sql.includes("UPDATE user_reminders")) {
            changed = true;
            f.raw.exec("UPDATE user_reminders SET remind_at='2027-01-18T12:00:00.000Z',notes='Concurrent owner edit' WHERE id='first-reminder'");
          }
          return run();
        };
        return bound;
      };
      return statement;
    }) as D1Database["prepare"];
    f.outputs.push(f.call(operation), { response: "Done." });
    const result = await f.send(`${operation === "cancel" ? "Cancel" : "Move"} reminder ID first-reminder${operation === "update" ? " to 16 January 2027 at 9:30am in Europe/Dublin" : ""}.`);
    expect(changed).toBe(true);
    expect(f.raw.prepare("SELECT remind_at,notes,status FROM user_reminders WHERE id='first-reminder'").get())
      .toEqual({ remind_at: "2027-01-18T12:00:00.000Z", notes: "Concurrent owner edit", status: "pending" });
    expect(result.replyText).toContain("changed");
    expect(result.replyText).not.toContain("Done");
    expect(result.reminderAction).toBeNull();
  });

  it.each(["single match", "explicit ID", "explicit due date"])("keeps a %s usable without an extra selection turn", async control => {
    const f = reminderSelectionFixture("sdk", control !== "single match"); const before = f.rows();
    f.outputs.push(f.call("update"), { response: "Done." });
    const target = control === "explicit ID" ? "reminder ID first-reminder" : control === "explicit due date"
      ? "ME3 QA check launch reminder due on 15 January 2027" : "ME3 QA check launch reminder";
    const result = await f.send(`Move my ${target} to 16 January 2027 at 9:30am in Europe/Dublin.`);
    expect(result.reminderAction?.kind).toBe("updated");
    expect(f.rows()).toEqual(before.map(row => row.id === "first-reminder" ? { ...row, remind_at: "2027-01-16T09:30:00.000Z" } : row));
  });
});

describe("primary assistant conversation persisted in D1", () => {
  it.each([
    ["legacy", "2027-01-15", "2027-01-16", "2027-01-16T09:30:00.000Z"],
    ["sdk", "2027-01-15", "2027-01-16", "2027-01-16T09:30:00.000Z"],
    ["legacy", "2027-07-15", "2027-07-16", "2027-07-16T08:30:00.000Z"],
    ["sdk", "2027-07-15", "2027-07-16", "2027-07-16T08:30:00.000Z"],
  ] as const)("preserves requested reminder wall times through %s on %s", async (runtime, date, movedDate, expectedUtc) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
    const { env, raw } = fixture();
    raw.exec(`INSERT INTO user_reminders(id, user_id, title, remind_at, timezone)
      VALUES ('other-reminder', 'bob', 'Call Ada', '2027-01-15T12:00:00.000Z', 'Europe/Dublin')`);
    const run = vi.fn()
      .mockResolvedValueOnce({ tool_calls: [{ id: "create", name: "core_reminders_create", arguments: { title: "Call Ada", date, time: "12:00", timezone: "Europe/Dublin" } }] })
      .mockResolvedValueOnce({ response: "Saved the reminder." });
    const route = { providerId: "workers-ai", model: "scripted-fixture", configured: true, backupModel: null, apiKey: null, aiGateway: null, ai: { run } } as const;
    const turn = (requestId: string, text: string) => runCoreAgentToolTurn({
      db: env.DB, userId: "alice", requestId, turnId: requestId, ownerTimezone: "Europe/Dublin", runtime, route,
      messages: [{ role: "system", content: "You are ME3." }, { role: "user", content: text }],
    });
    const created = await turn("wall-create", `Remind me to call Ada on ${date} at noon in Europe/Dublin.`);
    expect(created.reminderAction?.kind).toBe("created");
    const first = raw.prepare("SELECT id, remind_at FROM user_reminders WHERE user_id = 'alice'").get();
    expect(first?.remind_at).toBe(`${date}T${date.includes("-07-") ? "11" : "12"}:00:00.000Z`);
    run.mockResolvedValueOnce({ tool_calls: [{ id: "move", name: "core_reminders_update", arguments: { reminderId: first?.id, title: "Call Ada", date: movedDate, time: "09:30", timezone: "Europe/Dublin" } }] })
      .mockResolvedValueOnce({ response: "Moved the reminder." });
    const moved = await turn("wall-move", `Move reminder ${String(first?.id)} to ${movedDate} at 9:30am in Europe/Dublin.`);
    expect(moved.reminderAction).toMatchObject({ kind: "updated", reminderId: first?.id, remindAt: expectedUtc });
    expect(raw.prepare("SELECT id, remind_at FROM user_reminders WHERE user_id = 'alice'").all()).toEqual([{ id: first?.id, remind_at: expectedUtc }]);
    expect(raw.prepare("SELECT remind_at FROM user_reminders WHERE user_id = 'bob'").get()?.remind_at).toBe("2027-01-15T12:00:00.000Z");
  });

  it.each([
    ["2027-02-30", "09:30", "Europe/Dublin", "YYYY-MM-DD"],
    ["2027-01-16", "25:30", "Europe/Dublin", "HH:MM"],
    ["2027-03-28", "01:30", "Europe/Dublin", "does not exist"],
    ["2027-10-31", "01:30", "Europe/Dublin", "occurs twice"],
    ["2027-01-16", "09:30", "IST", "IANA timezone"],
  ])("rejects invalid or ambiguous reminder wall time %s %s %s without a write", async (date, time, timezone, error) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-08T10:00:00Z"));
    const { env, raw } = fixture();
    const run = vi.fn()
      .mockResolvedValueOnce({ tool_calls: [{ id: "invalid", name: "core_reminders_create", arguments: { title: "Call Ada", date, time, timezone } }] })
      .mockResolvedValueOnce({ response: "Please choose a valid, unambiguous time." });
    await runCoreAgentToolTurn({
      db: env.DB, userId: "alice", requestId: "wall-invalid", turnId: "wall-invalid", ownerTimezone: "Europe/Dublin", runtime: "sdk",
      route: { providerId: "workers-ai", model: "scripted-fixture", configured: true, backupModel: null, apiKey: null, aiGateway: null, ai: { run } },
      messages: [{ role: "user", content: `Remind me to call Ada on ${date} at ${time} in ${timezone}.` }],
    });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM user_reminders").get()?.n).toBe(0);
    expect(raw.prepare("SELECT status, error_message FROM agent_tool_executions").get()).toMatchObject({ status: "failed", error_message: expect.stringContaining(error) });
  });

  it("finds sender and subject keywords through the real agent mailbox search before saving an unsent reply", async () => {
    const { env, raw, app } = fixture();
    env.ME3_ASSISTANT_RUNTIME = "sdk";
    env.ME3_DEPLOYMENT_MODE = "self_hosted";
    env.ME3_AI_MODEL = "scripted-fixture";
    raw.exec(`INSERT INTO mailbox_aliases(id, user_id, alias_local_part, forwarding_email, status)
      VALUES ('alice-mailbox', 'alice', 'alice', '', 'active'), ('bob-mailbox', 'bob', 'bob', '', 'active')`);
    const message = raw.prepare(`INSERT INTO mailbox_messages(id, mailbox_id, direction, message_kind, status,
      from_address, to_address, subject, text_body, folder)
      VALUES (?, ?, ?, 'email', 'received', 'ada@example.invalid', 'alice@example.invalid', ?, 'Ready?', ?)`);
    message.run("ada-launch", "alice-mailbox", "inbound", "ME3 QA launch checklist", "inbox");
    message.run("other-owner", "bob-mailbox", "inbound", "ME3 QA launch checklist", "inbox");
    message.run("other-direction", "alice-mailbox", "outbound", "ME3 QA launch checklist", "sent");
    message.run("other-folder", "alice-mailbox", "inbound", "ME3 QA launch checklist", "archive");
    message.run("missing-term", "alice-mailbox", "inbound", "QA update", "inbox");
    const outputs = [
      { tool_calls: [{ id: "find", name: "core_mailbox_search", arguments: { query: "Ada QA launch", direction: "inbound", folder: "inbox" } }] },
      { tool_calls: [{ id: "read", name: "core_mailbox_read", arguments: { messageId: "ada-launch" } }] },
      { tool_calls: [{ id: "draft", name: "core_mailbox_draft", arguments: { to: "ada@example.invalid", subject: "Re: ME3 QA launch checklist", body: "The QA checklist is ready.", replyToMessageId: "ada-launch" } }] },
      { response: "Saved an unsent reply draft." },
    ];
    const searches: Array<{ messages: Array<{ id: string }>; total: number }> = [];
    env.AI = { run: async (_model: string, input: { messages: Array<{ role: string; content: string }> }) => {
      const last = input.messages.at(-1);
      if (last?.role === "tool") {
        const result = JSON.parse(last.content);
        if (Array.isArray(result.messages)) searches.push(result);
      }
      return outputs.shift();
    } } as unknown as Ai;
    const cache = new Map<string, unknown>();
    const state = { storage: {
      get: async (key: string) => cache.get(key), put: async (key: string, value: unknown) => { cache.set(key, value); },
      delete: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) cache.delete(key); },
    } } as unknown as DurableObjectState;
    const agent = new Me3UserAgent(state, env);
    env.ME3_SDK_USER_AGENT = {
      idFromName: (id: string) => id,
      get: () => ({ fetch: (url: string, init: RequestInit) => agent.fetch(new Request(url, init)) }),
    } as unknown as DurableObjectNamespace;
    const primary = await resolvePrimaryAssistantThread(env, "alice");
    const response = await app.fetch(new Request("https://install.test/api/assistant/chat/turn", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Test-Owner": "alice" },
      body: JSON.stringify({ requestId: "native-email-reply", threadId: primary.id, messageText: "Find Ada's QA launch email and save an unsent reply." }),
    }), env);
    expect(response.status).toBe(200);
    expect(searches).toMatchObject([{ total: 1, messages: [{ id: "ada-launch" }] }]);
    expect(raw.prepare("SELECT mailbox_id, source_id, status, folder, sent_at FROM mailbox_messages WHERE message_kind = 'draft'").all())
      .toEqual([{ mailbox_id: "alice-mailbox", source_id: "ada-launch", status: "pending_approval", folder: "drafts", sent_at: null }]);
    // Ordinary mailbox searches retain phrase matching and do not opt into agent keyword semantics.
    expect((await listAgentMailboxMessages(env, "alice", { query: "Ada QA launch", direction: "inbound" })).total).toBe(0);
    expect((await listAgentMailboxMessages(env, "alice", { query: "QA launch", direction: "inbound", folder: "inbox" })).messages.map(item => item.id)).toEqual(["ada-launch"]);
  });

  it("runs native and Soulink turns through the real dispatcher with shared context and persistent reminder state", async () => {
    const { env, raw, app, connect } = fixture();
    env.ME3_ASSISTANT_RUNTIME = "sdk";
    env.ME3_DEPLOYMENT_MODE = "self_hosted";
    env.ME3_AI_MODEL = "scripted-fixture";
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const modelInputs: Array<{ messages: Array<{ content: string }> }> = [];
    const outputs = [
      { tool_calls: [{ id: "create", name: "core_reminders_create", arguments: { title: "Call Ada", date: tomorrow.slice(0, 10), time: tomorrow.slice(11, 16), timezone: "UTC" } }] },
      { response: "Reminder created for Call Ada." },
      { tool_calls: [{ id: "read", name: "core_reminders_list", arguments: {} }] },
      { response: "Call Ada is on your reminders." },
    ];
    env.AI = { run: async (_model: string, input: typeof modelInputs[number]) => { modelInputs.push(input); return outputs.shift(); } } as unknown as Ai;
    const cache = new Map<string, unknown>();
    const state = { storage: {
      get: async (key: string) => cache.get(key), put: async (key: string, value: unknown) => { cache.set(key, value); },
      delete: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) cache.delete(key); },
    } } as unknown as DurableObjectState;
    const agent = new Me3UserAgent(state, env);
    env.ME3_SDK_USER_AGENT = {
      idFromName: (id: string) => id,
      get: () => ({ fetch: (url: string, init: RequestInit) => agent.fetch(new Request(url, init)) }),
    } as unknown as DurableObjectNamespace;
    const primary = await resolvePrimaryAssistantThread(env, "alice");
    const native = await app.fetch(new Request("https://install.test/api/assistant/chat/turn", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Test-Owner": "alice" },
      body: JSON.stringify({ requestId: "native-create", threadId: primary.id, messageText: "Remind me tomorrow to call Ada." }),
    }), env);
    expect(native.status).toBe(200);
    expect(await native.json()).toMatchObject({ ok: true, threadId: primary.id });
    connect();
    const dispatch = () => new Request("https://install.test/api/agent/channels/soulink/dispatch", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer dispatch-token" },
      body: JSON.stringify({ sourceEventId: "soulink-read", conversationId: "channel-1", streamChannelId: "channel-1", messageText: "What reminders did we just create?" }),
    });
    const soulink = await app.fetch(dispatch(), env);
    expect(soulink.status).toBe(200);
    expect(await soulink.json()).toMatchObject({ ok: true, replyText: expect.stringContaining("Call Ada") });
    expect(JSON.stringify(modelInputs[2].messages)).toContain("Remind me tomorrow to call Ada");
    expect(raw.prepare("SELECT title FROM user_reminders WHERE user_id = 'alice'").all()).toEqual([{ title: "Call Ada" }]);
    expect(raw.prepare("SELECT DISTINCT thread_id FROM assistant_messages WHERE owner_id = 'alice'").all()).toEqual([{ thread_id: primary.id }]);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM assistant_messages").get()?.n).toBe(4);
    expect((await app.fetch(dispatch(), env)).status).toBe(200);
    expect(modelInputs).toHaveLength(4);
    // A new client session resolves from D1, with no local primary-thread cache.
    const fresh = await app.fetch(new Request("https://install.test/api/assistant/threads/primary", { method: "POST", headers: { "X-Test-Owner": "alice" } }), env);
    expect(await fresh.json()).toMatchObject({ thread: { id: primary.id } });
  });

  it("resolves concurrent first requests to exactly one thread and retains it after connecting Soulink", async () => {
    const { env, raw, connect } = fixture();
    const threads = await Promise.all(Array.from({ length: 10 }, () => resolvePrimaryAssistantThread(env, "alice")));
    expect(new Set(threads.map((thread) => thread.id)).size).toBe(1);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM assistant_threads").get()?.n).toBe(1);
    connect();
    expect((await resolvePrimaryAssistantThread(env, "alice")).id).toBe(threads[0].id);
  });

  it("adopts connected Soulink chat history and preserves separate scheduling history", async () => {
    const { env, raw, thread, connect } = fixture();
    connect();
    thread("soulink:channel-1", "alice", null, "soulink");
    thread("channel-1", "alice", null, "soulink");
    expect((await resolvePrimaryAssistantThread(env, "alice")).id).toBe("soulink:channel-1");
    expect(raw.prepare("SELECT COUNT(*) AS n FROM assistant_threads").get()?.n).toBe(2);
    connect("channel-2");
    expect((await resolvePrimaryAssistantThread(env, "alice")).id).toBe("soulink:channel-1");
  });

  it("does not adopt project threads or another owner's thread", async () => {
    const { env, raw, thread } = fixture();
    raw.exec("INSERT INTO mission_projects(id, user_id, name, slug) VALUES ('project', 'alice', 'Project', 'project')");
    thread("project-thread", "alice", "project");
    thread("bob-thread", "bob");
    const primary = await resolvePrimaryAssistantThread(env, "alice");
    expect(primary.id).not.toBe("project-thread");
    expect(primary.id).not.toBe("bob-thread");
    expect(primary.project_id).toBeNull();
    expect(primary.owner_id).toBe("alice");
  });

  it.each(["archived", "deleted"])("replaces a %s main thread without reviving or changing history", async (status) => {
    const { env, raw } = fixture();
    const first = await resolvePrimaryAssistantThread(env, "alice");
    raw.prepare("UPDATE assistant_threads SET status = ? WHERE id = ?").run(status, first.id);
    const next = await Promise.all(Array.from({ length: 5 }, () => resolvePrimaryAssistantThread(env, "alice")));
    expect(new Set(next.map((thread) => thread.id)).size).toBe(1);
    expect(next[0].id).not.toBe(first.id);
    expect(raw.prepare("SELECT status FROM assistant_threads WHERE id = ?").get(first.id)?.status).toBe(status);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM assistant_threads WHERE status = 'active'").get()?.n).toBe(1);
  });

  it("exposes an authenticated resolver independent of client-local history", async () => {
    const { app, env } = fixture();
    const request = (owner?: string) => new Request("https://install.test/api/assistant/threads/primary", {
      method: "POST", headers: owner ? { "X-Test-Owner": owner } : {},
    });
    expect((await app.fetch(request(), env)).status).toBe(401);
    const first = await (await app.fetch(request("alice"), env)).json() as { thread: { id: string } };
    const freshSession = await (await app.fetch(request("alice"), env)).json() as typeof first;
    const other = await (await app.fetch(request("bob"), env)).json() as typeof first;
    expect(freshSession.thread.id).toBe(first.thread.id);
    expect(other.thread.id).not.toBe(first.thread.id);
  });
});

describe("channel runtime selection", () => {
  it("passes effective default-enabled plugins to the SDK dispatcher while respecting disabled records", async () => {
    const { env, raw } = fixture();
    env.ME3_ASSISTANT_RUNTIME = "sdk";
    raw.exec("INSERT INTO plugin_installations(plugin_id, version, enabled, status) VALUES ('me3.mission-control', 'test', 0, 'disabled')");
    const dispatch = vi.fn(async (..._args: unknown[]) => ({ ok: true, replyText: "Ready" }));
    const cache = new Map<string, unknown>();
    const state = { storage: {
      get: async (key: string) => cache.get(key), put: async (key: string, value: unknown) => { cache.set(key, value); },
    } } as unknown as DurableObjectState;
    const agent = new Me3UserAgent(state, env, dispatch as never);
    await agent.fetch(new Request("https://agent.internal/dispatch/sandbox", {
      method: "POST", body: JSON.stringify({ userId: "alice", requestId: "request", connectionId: "c", sourceEventId: "e", turnId: "t", messageText: "Move tomorrow's meeting", replyToMessageId: null }),
    }));
    const plugins = dispatch.mock.calls[0][7] as ReadonlySet<string>;
    expect(plugins.has("me3.calendar")).toBe(true);
    expect(plugins.has("me3.journal")).toBe(true);
    expect(plugins.has("me3.mission-control")).toBe(false);
  });

  it("dispatches Soulink through the selected SDK namespace and fails clearly when its binding is absent", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true, replyText: "Done" }));
    const sdk = { idFromName: vi.fn((id) => id), get: vi.fn(() => ({ fetch })) };
    const legacy = { idFromName: vi.fn(), get: vi.fn() };
    const env = { ME3_ASSISTANT_RUNTIME: "sdk", ME3_SDK_USER_AGENT: sdk, ME3_USER_AGENT: legacy } as unknown as Env;
    const input = { userId: "alice", connectionId: "c", sourceEventId: "e", turnId: "t", threadId: "main", messageText: "Remind me", replyToMessageId: null };
    expect((await dispatchAgentChannelTurn(env, input)).ok).toBe(true);
    expect(sdk.idFromName).toHaveBeenCalledWith("alice");
    expect(legacy.get).not.toHaveBeenCalled();
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).threadId).toBe("main");
    delete env.ME3_SDK_USER_AGENT;
    expect((await dispatchAgentChannelTurn(env, input)).error).toContain("not configured");
  });
});
