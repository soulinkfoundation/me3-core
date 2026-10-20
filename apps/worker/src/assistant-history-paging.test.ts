import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Env } from "./types";
import { registerAssistantRoutes } from "./routes/assistant";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

type Page = { messages: Array<{ id: string; text: string }>; hasMore: boolean };

function fixture(messageCount: number) {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  const directory = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(file, directory), "utf8"));
  raw.exec(`INSERT INTO owner_profile(id,username) VALUES('owner','synthetic');
    INSERT INTO assistant_threads(id,owner_id,title) VALUES('thread','owner','Synthetic'),('other-thread','owner','Other');`);
  const insert = raw.prepare("INSERT INTO assistant_messages(id,owner_id,thread_id,role,content,created_at) VALUES(?,?,?,?,?,?)");
  // Pairs share a timestamp so the rowid tiebreak is exercised.
  for (let index = 1; index <= messageCount; index++) {
    insert.run(`m${index}`, "owner", "thread", index % 2 ? "user" : "assistant", `Message ${index}`, `2026-10-20T09:${String(Math.ceil(index / 2)).padStart(2, "0")}:00Z`);
  }
  insert.run("other", "owner", "other-thread", "user", "Other thread", "2026-10-20T08:00:00Z");
  const DB = { prepare(sql: string) {
    const query = raw.prepare(sql); let values: unknown[] = [];
    const statement = { bind(...args: unknown[]) { values = args; return statement; },
      async first<T>() { return (query.get(...values as never[]) ?? null) as T | null; },
      async all<T>() { return { results: query.all(...values as never[]) as T[] }; } };
    return statement;
  } };
  const app = new Hono<{ Bindings: Env }>();
  registerAssistantRoutes(app as never, { requireOwner: async () => "owner", unauthorized: () => new Response("Unauthorized", { status: 401 }), getSessionOwnerId: async () => "owner", getSetupRequired: async () => [] } as never);
  const get = async (query: string) => {
    const response = await app.request(`/api/assistant/threads/thread/messages${query}`, {}, { DB } as unknown as Env);
    return { status: response.status, body: await response.json() as Page };
  };
  return { get };
}

const ids = (page: Page) => page.messages.map(message => message.id);

describe("assistant thread history paging", () => {
  it("returns the whole thread oldest first when no limit is given", async () => {
    const { body } = await fixture(5).get("");
    expect(ids(body)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(body.hasMore).toBe(false);
  });

  it("returns the newest page oldest first and walks back without gaps or repeats", async () => {
    const { get } = fixture(7);
    const newest = (await get("?limit=3")).body;
    expect(ids(newest)).toEqual(["m5", "m6", "m7"]);
    expect(newest.hasMore).toBe(true);

    const middle = (await get("?limit=3&before=m5")).body;
    expect(ids(middle)).toEqual(["m2", "m3", "m4"]);
    expect(middle.hasMore).toBe(true);

    const oldest = (await get("?limit=3&before=m2")).body;
    expect(ids(oldest)).toEqual(["m1"]);
    expect(oldest.hasMore).toBe(false);
  });

  it("reports no more history when the page holds the whole thread", async () => {
    const { body } = await fixture(3).get("?limit=3");
    expect(ids(body)).toEqual(["m1", "m2", "m3"]);
    expect(body.hasMore).toBe(false);
  });

  it("rejects a cursor from another thread", async () => {
    expect((await fixture(3).get("?limit=2&before=other")).status).toBe(400);
  });
});
