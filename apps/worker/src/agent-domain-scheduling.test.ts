import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStableAgentSchedulingServices } from "./agent-domain-scheduling";
import type { AgentStatement } from "../../../packages/agent/src/types";
import type { Env } from "./types";
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.unstubAllGlobals(); });

function fixture() {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(file, migrations), "utf8"));
  raw.exec(`INSERT INTO owner_profile(id,username,name,timezone) VALUES ('alice','alice','Alice','Europe/Dublin'),('bob','bob','Bob','UTC');
    INSERT INTO contacts(id,user_id,name,source,source_ref,status,metadata) VALUES ('a1','alice','Ada','soulink','peer-a1','active','{"nodeId":"peer-a1"}'),('a2','alice','Ada','soulink','peer-a2','active','{"nodeId":"peer-a2"}'),('b1','bob','Ada','soulink','peer-b1','active','{"nodeId":"peer-b1"}');
    INSERT INTO agent_channel_connections(id,user_id,channel,status,setup_token,provider_user_id,provider_thread_id,provider_connection_id) VALUES ('conn','alice','soulink','active','synthetic-test-token','alice-node','test-channel','messaging');
    INSERT INTO scheduling_time_types(id,user_id,title,duration_minutes,timezone,windows_json) VALUES ('type','alice','Call',30,'Europe/Dublin','{}');`);
  const slots = JSON.stringify([{ startsAt: "2099-10-12T09:00:00.000Z", endsAt: "2099-10-12T09:30:00.000Z", timezone: "UTC", localDate: "2099-10-12", localStartTime: "09:00", localEndDate: "2099-10-12", localEndTime: "09:30" }]);
  for (const [id, owner, contact] of [["req-1", "alice", "a1"], ["req-2", "alice", "a2"], ["req-b", "bob", "b1"]]) raw.prepare(`INSERT INTO scheduling_requests(id,user_id,contact_id,time_type_id,status,requester_name,target_name,date_range_start,date_range_end,candidate_slots_json,policy_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, owner, contact, "type", "review_required", "Ada", owner, "2099-10-12", "2099-10-15", slots, JSON.stringify({ protocolVersion: "2026-08-24", role: "target", peerNodeId: `peer-${contact}`, durationMinutes: 30, expiresAt: "2099-10-15T09:00:00.000Z", meetingUrl: null }));
  let changeDuringOwnerRead = false;
  function statement(sql: string, values: unknown[] = []): AgentStatement {
    return { bind: (...bound) => statement(sql, bound), async first<T>() { if (changeDuringOwnerRead && sql.includes("SELECT id, name, timezone")) { raw.prepare("UPDATE scheduling_requests SET reason='Racing change' WHERE id='req-1'").run(); changeDuringOwnerRead = false; } return (raw.prepare(sql).get(...values as never[]) ?? null) as T | null; }, async all<T>() { return { results: raw.prepare(sql).all(...values as never[]) as T[] }; }, async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }; } };
  }
  const env = { DB: { prepare: (sql: string) => statement(sql), async batch(statements: AgentStatement[]) { raw.exec("BEGIN"); try { const results = await Promise.all(statements.map(statement => statement.run())); raw.exec("COMMIT"); return results; } catch (error) { raw.exec("ROLLBACK"); throw error; } } } } as unknown as Env;
  const relay: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    if (url.endsWith("/agent-relay")) {
      const message = JSON.parse(String(init.body)); relay.push(message);
      if (message.kind === "schedule.decline") expect(raw.prepare("SELECT status FROM scheduling_requests WHERE id=?").get(message.requestId)).toMatchObject({ status: "cancelled" });
      if (message.kind === "schedule.options") expect(raw.prepare("SELECT status FROM scheduling_requests WHERE id=?").get(message.requestId)).toMatchObject({ status: "candidates_shared" });
    }
    return new Response(JSON.stringify({ ok: true, result: { status: "declined" } }), { status: 200 });
  }));
  return { raw, env, relay, services: createStableAgentSchedulingServices(env, "alice"), race() { changeDuringOwnerRead = true; } };
}

describe("stable new agent scheduling bridge", () => {
  it("returns distinct stable same-name contacts and owner-scoped requests", async () => {
    const f = fixture(); const found = await f.services.searchContacts({ query: "Ada" });
    expect(found.contacts.map(contact => contact.id).sort()).toEqual(["a1", "a2"]);
    expect(await f.services.getRequest!("req-b")).toBeNull();
    expect(await f.services.getRequest!("req-1")).toMatchObject({ id: "req-1", contactId: "a1", options: [expect.objectContaining({ option: 1 })] });
  });
  it("refuses an approved request changed after review before relaying", async () => {
    const f = fixture(); const expected = (await f.services.getRequest!("req-1"))!;
    f.raw.prepare("UPDATE scheduling_requests SET reason='Changed by owner' WHERE id='req-1'").run();
    await expect(f.services.decline!({ requestId: "req-1", expected }, "effect-1")).rejects.toThrow(/changed/i);
    expect(f.relay).toHaveLength(0);
  });
  it("declines one exact reviewed request, commits before relay, and does not repeat", async () => {
    const f = fixture(); const expected = (await f.services.getRequest!("req-1"))!;
    const result = await f.services.decline!({ requestId: "req-1", expected }, "effect-1");
    expect(result).toMatchObject({ id: "req-1", status: "cancelled" }); expect(f.relay).toHaveLength(1);
    expect(f.raw.prepare("SELECT status FROM scheduling_requests WHERE id='req-2'").get()).toMatchObject({ status: "review_required" });
    await expect(f.services.decline!({ requestId: "req-1", expected }, "effect-1")).rejects.toThrow(); expect(f.relay).toHaveLength(1);
  });
  it("rejects a request changed between preparation and the atomic transition", async () => {
    const f = fixture(); const expected = (await f.services.getRequest!("req-1"))!; f.race();
    await expect(f.services.approve!({ requestId: "req-1", expected, confirmed: true }, "effect-1")).rejects.toThrow(/changed/i);
    expect(f.relay).toHaveLength(0);
    expect(f.raw.prepare("SELECT status FROM scheduling_requests WHERE id='req-1'").get()).toMatchObject({ status: "review_required" });
  });
  it("offers only the exact approved incoming option instead of every candidate", async () => {
    const f = fixture();
    const first = JSON.parse(String(f.raw.prepare("SELECT candidate_slots_json FROM scheduling_requests WHERE id='req-1'").get()!.candidate_slots_json))[0];
    const second = { ...first, startsAt: "2099-10-12T10:00:00.000Z", endsAt: "2099-10-12T10:30:00.000Z", localStartTime: "10:00", localEndTime: "10:30" };
    f.raw.prepare("UPDATE scheduling_requests SET candidate_slots_json=? WHERE id='req-1'").run(JSON.stringify([first, second]));
    const expected = (await f.services.getRequest!("req-1"))!;
    await f.services.approve!({ requestId: "req-1", option: 2, expected, confirmed: true }, "effect-1");
    expect(f.relay).toEqual([expect.objectContaining({ kind: "schedule.options", requestId: "req-1", candidateSlots: [second] })]);
    expect(JSON.parse(String(f.raw.prepare("SELECT candidate_slots_json FROM scheduling_requests WHERE id='req-1'").get()!.candidate_slots_json))).toEqual([second]);
    expect(f.raw.prepare("SELECT status FROM scheduling_requests WHERE id='req-2'").get()).toMatchObject({ status: "review_required" });
    await expect(f.services.approve!({ requestId: "req-1", option: 2, expected, confirmed: true }, "effect-1")).rejects.toThrow(/changed/i);
    expect(f.relay).toHaveLength(1);
  });
});
