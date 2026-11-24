import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import { registerWheelOfLifeRoutes } from "./wheel-of-life";
import type { AppHono } from "../http/types";
import type { Env } from "../types";

class SqliteD1 {
  raw = new DatabaseSync(":memory:");
  constructor() {
    this.raw.exec(`
      CREATE TABLE mission_wheel_settings (
        user_id TEXT PRIMARY KEY DEFAULT 'owner', segments_json TEXT NOT NULL DEFAULT '[]',
        schema_version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE mission_wheel_snapshots (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL DEFAULT 'owner', segments_json TEXT NOT NULL DEFAULT '[]',
        notes_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    `);
  }
  prepare(sql: string) {
    const statement = this.raw.prepare(sql);
    let values: unknown[] = [];
    const wrapper = {
      bind: (...next: unknown[]) => { values = next; return wrapper; },
      run: async () => ({ meta: { changes: Number(statement.run(...(values as never[])).changes) } }),
      first: async <T>() => (statement.get(...(values as never[])) || null) as T | null,
      all: async <T>() => ({ results: statement.all(...(values as never[])) as T[] }),
    };
    return wrapper;
  }
}

const segments = ["health", "spirituality", "work", "finances", "home", "joy"].map((id, index) => ({
  id, label: id, helper: "", color: "#26806f", emoji: "⭐", value: index + 3,
}));

let env: Env;
let owner: string | null;

function app() {
  const hono = new Hono() as AppHono;
  registerWheelOfLifeRoutes(hono, {
    requireOwner: async () => owner,
    unauthorized: (c: any) => c.json({ error: "Unauthorized" }, 401),
  } as never);
  return hono;
}

async function request(path: string, method: string, body?: unknown) {
  return app().request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }, env);
}

async function saveSnapshot(notes: Record<string, string> = {}) {
  const response = await request("/api/journal/wheel/snapshots", "POST", { segments, notes });
  expect(response.status).toBe(201);
  return (await response.json()) as { snapshot: { id: string; segments: Array<{ id: string; notes: string }> } };
}

const notesOf = (snapshot: { segments: Array<{ id: string; notes: string }> }) =>
  Object.fromEntries(snapshot.segments.map((segment) => [segment.id, segment.notes]));

beforeEach(() => {
  env = { DB: new SqliteD1() as unknown as D1Database } as Env;
  owner = "alice";
});

describe("adding notes to a saved Wheel snapshot", () => {
  it("merges notes into the snapshot on both URLs and returns it in the POST shape", async () => {
    const created = await saveSnapshot({ work: "Busy month" });

    const first = await request(`/api/journal/wheel/snapshots/${created.snapshot.id}`, "PATCH", {
      notes: { home: "  Moved flat  " },
    });
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as typeof created;
    expect(Object.keys(firstBody)).toEqual(["snapshot"]);
    expect(Object.keys(firstBody.snapshot).sort()).toEqual(Object.keys(created.snapshot).sort());
    expect(notesOf(firstBody.snapshot)).toMatchObject({ work: "Busy month", home: "Moved flat", joy: "" });

    const second = await request(`/api/mission-control/wheel/snapshots/${created.snapshot.id}`, "PATCH", {
      notes: { work: "", joy: "x".repeat(700), unknown: "ignored" },
    });
    expect(second.status).toBe(200);
    const secondNotes = notesOf(((await second.json()) as typeof created).snapshot);
    expect(secondNotes).toMatchObject({ work: "", home: "Moved flat" });
    expect(secondNotes.joy).toHaveLength(600);
    expect(secondNotes).not.toHaveProperty("unknown");

    const listed = (await (await request("/api/journal/wheel/snapshots", "GET")).json()) as {
      snapshots: Array<typeof created.snapshot>;
    };
    expect(notesOf(listed.snapshots[0])).toEqual(secondNotes);
  });

  it("returns 404 for an unknown snapshot or another owner's snapshot", async () => {
    const created = await saveSnapshot();
    expect((await request("/api/journal/wheel/snapshots/missing", "PATCH", { notes: { work: "hi" } })).status).toBe(404);

    owner = "bob";
    const response = await request(`/api/mission-control/wheel/snapshots/${created.snapshot.id}`, "PATCH", {
      notes: { work: "not mine" },
    });
    expect(response.status).toBe(404);

    owner = "alice";
    const listed = (await (await request("/api/journal/wheel/snapshots", "GET")).json()) as {
      snapshots: Array<typeof created.snapshot>;
    };
    expect(notesOf(listed.snapshots[0]).work).toBe("");
  });

  it("requires an owner", async () => {
    owner = null;
    expect((await request("/api/journal/wheel/snapshots/any", "PATCH", { notes: {} })).status).toBe(401);
  });
});
