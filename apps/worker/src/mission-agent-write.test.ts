import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createDomainTools } from "../../../packages/agent/src/tools/index";
import { readOwnerMission } from "@me3-core/plugin-mission-control";
import type { AgentToolContext } from "../../../packages/agent/src/types";

// ME3 drafts a Mission with the owner in chat and saves it. Failure modes: the SQL fails on a real database or
// drops goals saved beside it; a written Mission is replaced without the owner agreeing; another owner's row is
// touched; the tool can't be found by the model.
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));

function fixture() {
  const raw = new DatabaseSync(":memory:");
  databases.push(raw);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(file, migrations), "utf8"));
  const db = { prepare(sql: string) {
    const bound = (values: (string | number | null)[]) => ({
      async first() { return raw.prepare(sql).get(...values) || null; },
      async all() { return { results: raw.prepare(sql).all(...values) }; },
      async run() { raw.prepare(sql).run(...values); return { meta: { changes: 1 } }; },
    });
    return { ...bound([]), bind: (...values: (string | number | null)[]) => bound(values) };
  } } as unknown as D1Database;
  const tool = createDomainTools().find(item => item.name === "core_mission_statement_save")!;
  const context = (approved = false) => ({
    db, ownerId: "alice", threadId: "t", turnId: "turn", requestId: "req", toolCallId: "call", approved,
    enabledPluginIds: new Set(["me3.mission-control"]), signal: new AbortController().signal,
  }) as unknown as AgentToolContext;
  return { raw, db, tool, context };
}

describe("Mission agent tool", () => {
  it("saves a first draft from the answers and keeps goals", async () => {
    const { raw, db, tool, context } = fixture();
    raw.prepare("INSERT INTO mission_dashboard_settings (user_id, settings_json, mission_statement) VALUES ('alice', ?, ?)")
      .run(JSON.stringify({ goals: [{ id: "run", title: "Run 10k", status: "active" }] }), "I am here to help [who/what] become [desired change].");
    raw.prepare("INSERT INTO mission_dashboard_settings (user_id, mission_statement) VALUES ('bob', 'Bob keeps his.')").run();

    expect(tool).toBeDefined();
    expect(tool.group).toBe("mission");
    const result = await tool.execute({ who: "first-time founders", change: "launch with confidence", how: "coaching and simple tools" }, context());

    expect(result).toMatchObject({ status: "ok", data: { mission: { statement: "I help first-time founders launch with confidence by coaching and simple tools." } } });
    expect(JSON.parse(String(raw.prepare("SELECT settings_json FROM mission_dashboard_settings WHERE user_id = 'alice'").get()?.settings_json)))
      .toMatchObject({ goals: [{ id: "run" }], missionAnswers: { who: "first-time founders" } });
    expect(raw.prepare("SELECT mission_statement FROM mission_dashboard_settings WHERE user_id = 'bob'").get()?.mission_statement).toBe("Bob keeps his.");
  });

  it("asks before replacing a Mission the owner already wrote", async () => {
    const { db, tool, context } = fixture();
    await tool.execute({ statement: "I help my family thrive by being present." }, context());

    const pending = await tool.execute({ statement: "I help makers ship." }, context());
    expect(pending.status).toBe("needs_approval");
    expect((await readOwnerMission(db, "alice")).statement).toBe("I help my family thrive by being present.");

    await tool.execute({ statement: "I help makers ship." }, context(true));
    expect((await readOwnerMission(db, "alice")).statement).toBe("I help makers ship.");
  });
});
