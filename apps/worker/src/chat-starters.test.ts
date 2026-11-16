import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Env } from "./types";
import { registerAssistantRoutes } from "./routes/assistant";
import { chatStarters, localClock, type ChatStarterContext } from "./chat-starters";

// Failure modes (me3-q6la.1):
// - a returning owner is shown the first-run welcome (or a new owner is not);
// - a broken read (site, mail, calendar) sends an established owner back into first run;
// - starters go past the cap, or repeat;
// - a generic starter (Wrap up today) shows where nothing real backs it;
// - the owner's time zone is ignored, so a meeting shows at the wrong time.

const base: ChatStarterContext = { hour: 9, firstName: null, siteMissing: false, hasSpoken: true, missionMissing: false, nextEvent: null, reply: null };
const ids = (context: Partial<ChatStarterContext>) => chatStarters({ ...base, ...context }).starters.map(starter => starter.id);

describe("chatStarters", () => {
  it("welcomes a new owner with the three onboarding starters", () => {
    const result = chatStarters({ ...base, siteMissing: true, hasSpoken: false, firstName: "Sam", nextEvent: { title: "Call", time: "10:00" } });
    expect(result.firstRun).toBe(true);
    expect(result.greeting?.title).toBe("Hi Sam, I'm ME3");
    expect(result.starters.map(starter => starter.id)).toEqual(["site", "help", "tour"]);
    expect(result.starters[0].action).toBe("site_ask");
  });

  it("is not first run once the owner has a bio or has spoken", () => {
    expect(chatStarters({ ...base, siteMissing: false, hasSpoken: false }).firstRun).toBe(false);
    const spoken = chatStarters({ ...base, siteMissing: true, hasSpoken: true });
    expect(spoken.firstRun).toBe(false);
    expect(spoken.greeting).toBeNull();
    expect(spoken.starters.map(starter => starter.label)).toContain("Build my site");
  });

  it("puts the owner's own meeting and email first and stops at four, without repeats", () => {
    const list = ids({ nextEvent: { title: "Priya", time: "15:00" }, reply: { name: "Tom", subject: "Invoice" }, siteMissing: true, missionMissing: true });
    expect(list).toEqual(["prep", "reply", "site", "mission"]);
    expect(ids({ reply: { name: "Tom", subject: "" } })).toEqual(["reply", "help"]);
    expect(new Set(ids({})).size).toBe(ids({}).length);
  });

  it("names the person and keeps long titles short", () => {
    const [prep, reply] = chatStarters({ ...base, nextEvent: { title: "Quarterly planning with the whole design team", time: "15:00" }, reply: { name: "Tom Baker", subject: "Invoice" } }).starters;
    expect(prep.label.length).toBeLessThanOrEqual(40);
    expect(prep.prompt).toContain("Quarterly planning with the whole design team at 15:00");
    expect(reply.label).toBe("Reply to Tom Baker");
    expect(reply.prompt).toContain("Invoice");
  });

  it("offers no generic time-of-day starter, only What can you help with? when there's nothing real", () => {
    for (const hour of [7, 13, 18, 23]) expect(ids({ hour })).toEqual(["help"]);
  });
});

describe("localClock", () => {
  it("uses the owner's zone and falls back to UTC for an unknown one", () => {
    const now = new Date("2026-11-16T08:30:00Z");
    expect(localClock(now, "Asia/Tokyo").hour).toBe(17);
    expect(localClock(now, "Not/AZone").hour).toBe(8);
    expect(localClock(now, null).hour).toBe(8);
  });
});

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function fixture() {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  const directory = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(file, directory), "utf8"));
  raw.exec(`INSERT INTO owner_profile(id,username) VALUES('owner','synthetic');
    INSERT INTO assistant_threads(id,owner_id,title) VALUES('thread','owner','Synthetic');
    INSERT INTO sites(id,user_id,username,site_role) VALUES('site','owner','synthetic','profile');`);
  const DB = { prepare(sql: string) {
    const query = raw.prepare(sql); let values: unknown[] = [];
    const statement = { bind(...args: unknown[]) { values = args; return statement; },
      async first<T>() { return (query.get(...values as never[]) ?? null) as T | null; },
      async all<T>() { return { results: query.all(...values as never[]) as T[] }; },
      async run() { query.run(...values as never[]); return { success: true }; } };
    return statement;
  } };
  const app = new Hono<{ Bindings: Env }>();
  registerAssistantRoutes(app as never, { requireOwner: async () => "owner", unauthorized: () => new Response("Unauthorized", { status: 401 }), getSessionOwnerId: async () => "owner", getSetupRequired: async () => [] } as never);
  const me = (profile: object) => raw.prepare("INSERT OR REPLACE INTO site_files(site_id,path,content) VALUES('site','src/me.json',?)").run(new TextEncoder().encode(JSON.stringify(profile)));
  const say = () => raw.prepare("INSERT INTO assistant_messages(id,owner_id,thread_id,role,content,created_at) VALUES('m1','owner','thread','user','Hi','2026-11-16T08:00:00Z')").run();
  const get = async () => (await app.request("/api/assistant/starters?tz=Europe/London", {}, { DB } as unknown as Env)).json() as Promise<{ firstRun: boolean; greeting: { title: string } | null; starters: Array<{ id: string }> }>;
  return { me, say, get, raw };
}

describe("GET /api/assistant/starters", () => {
  it("welcomes a new owner by first name, then stops once they have spoken", async () => {
    const { me, say, get } = fixture();
    me({ name: "Sam Carter", bio: "" });
    const first = await get();
    expect(first.firstRun).toBe(true);
    expect(first.greeting?.title).toBe("Hi Sam, I'm ME3");
    expect(first.starters.map(starter => starter.id)).toEqual(["site", "help", "tour"]);
    say();
    expect((await get()).firstRun).toBe(false);
  });

  it("does not send an owner with a bio back into first run", async () => {
    const { me, get } = fixture();
    me({ name: "Sam Carter", bio: "Yoga teacher in Bristol." });
    const result = await get();
    expect(result.firstRun).toBe(false);
    expect(result.starters.map(starter => starter.id)).not.toContain("site");
  });

  it("treats an unreadable site as built rather than first run", async () => {
    const { get, raw } = fixture();
    raw.prepare("INSERT INTO site_files(site_id,path,content) VALUES('site','src/me.json',?)").run(new TextEncoder().encode("{not json"));
    expect((await get()).firstRun).toBe(false);
  });
});
