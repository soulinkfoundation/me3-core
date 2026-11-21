import { describe, expect, it } from "vitest";
import { createD1Adapter } from "../src/d1-adapter";
import { createSqliteHost } from "./sqlite-host";

// Failure modes this guards (each one silently corrupts Core behaviour that works on real D1):
// 1. meta.changes carries a stale count after a statement that changed nothing.
// 2. a failed batch leaves its earlier statements applied.
// 3. booleans or typed arrays are rejected or stored wrongly; undefined is silently bound.
// 4. BLOB columns come back as ArrayBuffer instead of D1's number[].
// 5. first() returns undefined, or the whole row, when asked for one column.
// 6. exec() stops after the first statement of a multi-statement script.
function setup() {
  const db = createD1Adapter(createSqliteHost());
  return { db, ready: db.exec("CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER, flag INTEGER, data BLOB); CREATE TABLE u (id TEXT PRIMARY KEY);") };
}

describe("D1 adapter over Durable Object SQLite", () => {
  it("runs every statement of a script", async () => {
    const { db, ready } = setup();
    await ready;
    expect((await db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").first<{ n: number }>())?.n).toBe(2);
  });

  it("reports changes for the statement just run, never a stale count", async () => {
    const { db, ready } = setup();
    await ready;
    expect((await db.prepare("INSERT INTO t (id, n) VALUES (?, ?), (?, ?)").bind("a", 1, "b", 2).run()).meta.changes).toBe(2);
    expect((await db.prepare("UPDATE t SET n = 9 WHERE id = ?").bind("missing").run()).meta.changes).toBe(0);
    expect((await db.prepare("INSERT OR IGNORE INTO t (id, n) VALUES (?, ?)").bind("a", 5).run()).meta.changes).toBe(0);
    expect((await db.prepare("SELECT * FROM t").all()).meta.changes).toBe(0);
    expect((await db.prepare("UPDATE t SET n = n + 1").run()).meta.changes).toBe(2);
  });

  it("rolls a failed batch back completely", async () => {
    const { db, ready } = setup();
    await ready;
    await expect(db.batch([
      db.prepare("INSERT INTO u (id) VALUES (?)").bind("one"),
      db.prepare("INSERT INTO u (id) VALUES (?)").bind("one"),
    ])).rejects.toThrow();
    expect((await db.prepare("SELECT count(*) AS n FROM u").first<{ n: number }>())?.n).toBe(0);
    const results = await db.batch([db.prepare("INSERT INTO u (id) VALUES (?)").bind("two"), db.prepare("SELECT id FROM u")]);
    expect(results[1].results).toEqual([{ id: "two" }]);
  });

  it("binds booleans and bytes like D1 and refuses undefined", async () => {
    const { db, ready } = setup();
    await ready;
    await db.prepare("INSERT INTO t (id, flag, data) VALUES (?, ?, ?)").bind("a", true, new Uint8Array([1, 2, 3])).run();
    const row = await db.prepare("SELECT flag, data FROM t WHERE id = ?").bind("a").first<{ flag: number; data: number[] }>();
    expect(row).toEqual({ flag: 1, data: [1, 2, 3] });
    await expect(db.prepare("INSERT INTO t (id, n) VALUES (?, ?)").bind("b", undefined).run()).rejects.toThrow(/undefined/);
  });

  it("returns null or one column from first()", async () => {
    const { db, ready } = setup();
    await ready;
    expect(await db.prepare("SELECT * FROM t WHERE id = ?").bind("none").first()).toBeNull();
    await db.prepare("INSERT INTO t (id, n) VALUES ('a', 7)").run();
    expect(await db.prepare("SELECT n FROM t").first("n")).toBe(7);
  });
});
