import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanModelTitle, fallbackArchivedTitle, sqliteTimestampToIso, titleArchivedThread } from "./assistant-thread-title";
import type { Env } from "./types";

// Failure modes: archived main chats stay "ME3"; a bad or failed model reply leaves no title;
// titling overwrites a name the owner chose; an empty chat gets a junk title; clients get a
// timestamp they can't parse.

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));

function fixture() {
  const raw = new DatabaseSync(":memory:");
  databases.push(raw);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  raw.exec("INSERT INTO owner_profile(id, username) VALUES ('alice', 'alice')");
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
  const env = { DB: { prepare } } as unknown as Env;
  function thread(id: string, title: string, status = "archived") {
    raw.prepare("INSERT INTO assistant_threads(id, owner_id, title, origin_surface, status) VALUES (?, 'alice', ?, 'assistant', ?)").run(id, title, status);
  }
  let clock = 0;
  function message(threadId: string, role: string, content: string) {
    clock += 1;
    raw.prepare("INSERT INTO assistant_messages(id, owner_id, thread_id, role, content, created_at) VALUES (?, 'alice', ?, ?, ?, ?)")
      .run(crypto.randomUUID(), threadId, role, content, `2026-11-15 10:00:${String(clock).padStart(2, "0")}`);
  }
  const titleOf = (id: string) => (raw.prepare("SELECT title FROM assistant_threads WHERE id = ?").get(id) as { title: string }).title;
  return { env, thread, message, titleOf };
}

describe("archived chat titles", () => {
  it("titles an archived ME3 chat from the model, reading the conversation in order", async () => {
    const { env, thread, message, titleOf } = fixture();
    thread("t1", "ME3");
    message("t1", "user", "Move my dentist to Thursday");
    message("t1", "assistant", "Done, Thursday at 10 am.");
    let seen = "";
    const title = await titleArchivedThread(env, "alice", "t1", async (_env, _owner, transcript) => { seen = transcript; return "Dentist moved to Thursday"; });
    expect(title).toBe("Dentist moved to Thursday");
    expect(titleOf("t1")).toBe("Dentist moved to Thursday");
    expect(seen).toBe("Owner: Move my dentist to Thursday\nME3: Done, Thursday at 10 am.");
  });

  it("falls back to the first thing the owner said when the model fails or has nothing", async () => {
    const { env, thread, message, titleOf } = fixture();
    thread("t1", "ME3");
    thread("t2", "ME3");
    for (const id of ["t1", "t2"]) {
      message(id, "user", "Plan my week around the school run");
      message(id, "user", "Also book the car service");
    }
    await titleArchivedThread(env, "alice", "t1", async () => { throw new Error("model down"); });
    await titleArchivedThread(env, "alice", "t2", async () => null);
    expect(titleOf("t1")).toBe("Plan my week around the school run");
    expect(titleOf("t2")).toBe("Plan my week around the school run");
  });

  it("never replaces a title the owner chose, an active chat, or an empty chat", async () => {
    const { env, thread, message, titleOf } = fixture();
    thread("named", "Lisbon trip");
    thread("active", "ME3", "active");
    thread("empty", "ME3");
    message("named", "user", "Flights to Lisbon");
    message("active", "user", "Hello");
    const generate = async () => "Something else";
    expect(await titleArchivedThread(env, "alice", "named", generate)).toBeNull();
    expect(await titleArchivedThread(env, "alice", "active", generate)).toBeNull();
    expect(await titleArchivedThread(env, "alice", "empty", generate)).toBeNull();
    expect([titleOf("named"), titleOf("active"), titleOf("empty")]).toEqual(["Lisbon trip", "ME3", "ME3"]);
  });

  it("keeps model titles short and plain", () => {
    expect(cleanModelTitle('"Dentist and weekly plan."')).toBe("Dentist and weekly plan");
    expect(cleanModelTitle("Title: Garden quotes\nExtra line")).toBe("Garden quotes");
    expect(cleanModelTitle("ok")).toBeNull();
    expect(cleanModelTitle("x".repeat(80))).toBeNull();
    expect(fallbackArchivedTitle("a ".repeat(50))?.length).toBeLessThanOrEqual(60);
    expect(fallbackArchivedTitle("   ")).toBeNull();
  });

  it("sends SQLite timestamps as ISO 8601 in UTC", () => {
    expect(sqliteTimestampToIso("2026-11-15 00:07:09")).toBe("2026-11-15T00:07:09Z");
    expect(sqliteTimestampToIso("2026-11-15T00:07:09.000Z")).toBe("2026-11-15T00:07:09.000Z");
    expect(sqliteTimestampToIso(null)).toBeNull();
  });
});
