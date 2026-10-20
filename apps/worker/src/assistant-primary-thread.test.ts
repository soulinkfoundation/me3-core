import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { resolvePrimaryAssistantThread } from "./assistant-primary-thread";
import { registerAssistantRoutes } from "./routes/assistant";
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

describe("primary assistant conversation persisted in D1", () => {
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

  it("starts fresh with a new empty thread instead of adopting older chats", async () => {
    const { env, raw, thread } = fixture();
    thread("old-1"); thread("old-2");
    raw.exec("UPDATE assistant_threads SET last_message_at = '2026-01-02T00:00:00Z' WHERE id = 'old-1'");
    raw.exec("UPDATE assistant_threads SET last_message_at = '2026-01-01T00:00:00Z' WHERE id = 'old-2'");
    const first = await resolvePrimaryAssistantThread(env, "alice");
    expect(first.id).toBe("old-1");
    raw.prepare("UPDATE assistant_threads SET status = 'archived' WHERE id = ?").run(first.id);
    const fresh = await resolvePrimaryAssistantThread(env, "alice");
    expect(["old-1", "old-2"]).not.toContain(fresh.id);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM assistant_messages WHERE thread_id = ?").get(fresh.id)?.n).toBe(0);
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
