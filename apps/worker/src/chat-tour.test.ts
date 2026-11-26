import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Env } from "./types";
import { registerAssistantRoutes } from "./routes/assistant";
import { chatTour, type ChatTour, type TourContext } from "./chat-tour";

// Failure modes (me3-q6la.5):
// - the tour loses the owner's place when they leave Chat, reload, or switch apps;
// - a step ticks before the owner has done it, or never ticks once they have;
// - a step points at a feature that's switched off on this install;
// - the website step isn't last, or offers Make my website to an owner whose site is built;
// - a bad progress write (unknown step or status) is saved instead of refused;
// - a free owner gets a one-step tour, or is led to paid features (Inbox, Accounts, Social, the website).
const base: TourContext = {
  plan: "paid", siteBuilt: false, calendarConnected: false, hasTaskOrReminder: false, layout: null, accounts: true, social: true, seen: [],
  progress: { status: "new", stepId: null },
};
const tour = (context: Partial<TourContext> = {}) => chatTour({ ...base, ...context });
const step = (context: Partial<TourContext>, id: string) => tour(context).steps.find(item => item.id === id)!;
const layout = (patch: Partial<NonNullable<TourContext["layout"]>>) => ({ order: ["today"], hidden: ["inbox", "people"], pinned: [], earned: [], ...patch });

describe("chatTour", () => {
  it("walks Home, the calendar, email, Accounts and Social, and ends on the website", () => {
    expect(tour().steps.map(item => item.id)).toEqual(["home", "calendar", "email", "accounts", "social", "website"]);
    expect(tour().steps.every(item => !item.done)).toBe(true);
  });

  it("leaves out Accounts and Social when they're switched off", () => {
    expect(tour({ accounts: false, social: false }).steps.map(item => item.id)).toEqual(["home", "calendar", "email", "website"]);
  });

  it("ticks Home once a card is added, and email only once the email card is on Home", () => {
    expect(step({ layout: layout({ pinned: ["accounts"] }) }, "home").done).toBe(true);
    expect(step({ layout: layout({ pinned: ["accounts"] }) }, "email").done).toBe(false);
    expect(step({ layout: layout({ hidden: ["people"], pinned: ["inbox"] }) }, "email").done).toBe(true);
    expect(step({ layout: layout({ pinned: ["inbox"] }) }, "email").done).toBe(false); // still hidden
  });

  it("ticks Accounts and Social once opened during the tour", () => {
    expect(step({ seen: ["accounts"] }, "accounts").done).toBe(true);
    expect(step({ seen: ["accounts"] }, "social").done).toBe(false);
  });

  it("points the owner at what to tap, in order, and gives a button only to the website", () => {
    expect(step({}, "home").targets.map(target => target.id)).toEqual(["home_tab", "add_to_home"]);
    expect(step({}, "calendar").targets.map(target => target.id)).toEqual(["home_tab", "connect_calendar"]);
    expect(step({}, "email").targets.map(target => target.id)).toEqual(["home_tab", "add_to_home", "add_inbox"]);
    expect(step({}, "accounts").targets).toEqual([]);
    expect(step({}, "social").targets).toEqual([]);
    expect(step({}, "website").targets).toEqual([]);
    for (const id of ["home", "calendar", "email", "accounts", "social"]) expect(step({}, id).task).toBeNull();
    for (const item of tour().steps) for (const target of item.targets) expect(target.hint).not.toBe("");
  });

  // Failure mode: a step explains a screen the owner isn't looking at (Socials shown on Accounts, then Home).
  it("ties each step to its screen, and never walks the menu", () => {
    expect(tour().steps.map(item => item.screen)).toEqual(["home", "home", "home", "accounts", "social", "chat"]);
    expect(tour().steps.some(item => item.targets.some(target => target.id === "profile_menu"))).toBe(false);
  });

  it("offers Make my website until the site is built, then the editor", () => {
    expect(step({}, "website").task).toEqual({ kind: "site_ask", label: "Make my website" });
    const built = step({ siteBuilt: true }, "website");
    expect(built.task).toEqual({ kind: "open", label: "Open the editor", to: "website" });
    expect(built.done).toBe(true);
  });

  it("ticks the calendar once one is connected", () => {
    expect(step({}, "calendar").done).toBe(false);
    expect(step({ calendarConnected: true }, "calendar").done).toBe(true);
  });

  it("gives a free owner Home, the calendar, a reminder and their page, and nothing paid", () => {
    const free = tour({ plan: "free" });
    expect(free.steps.map(item => item.id)).toEqual(["home", "calendar", "ask", "page"]);
    expect(free.steps[0].body).not.toContain("Inbox");
    expect(free.steps.map(item => item.screen)).toEqual(["home", "home", "chat", "home"]);
    expect(step({ plan: "free" }, "ask").targets.map(target => target.id)).toEqual(["chat_tab", "chat_composer"]);
    expect(step({ plan: "free" }, "ask").done).toBe(false);
    expect(step({ plan: "free", hasTaskOrReminder: true }, "ask").done).toBe(true);
    expect(step({ plan: "free" }, "page").task).toEqual({ kind: "open", label: "Claim my page", to: "page" });
    expect(tour({ plan: "free", progress: { status: "active", stepId: "accounts" } }).progress.stepId).toBeNull();
  });

  it("forgets a saved step this install no longer shows", () => {
    expect(tour({ social: false, progress: { status: "active", stepId: "social" } }).progress.stepId).toBeNull();
  });
});

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function fixture(plan?: string) {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  const directory = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(file, directory), "utf8"));
  raw.exec(`INSERT INTO owner_profile(id,username) VALUES('owner','synthetic');`);
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
  const env = { DB, ME3_TOUR: plan } as unknown as Env;
  const get = async () => (await app.request("/api/assistant/tour", {}, env)).json() as Promise<ChatTour>;
  const put = (body: unknown) => app.request("/api/assistant/tour/progress", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, env);
  return { raw, get, put };
}

describe("tour progress", () => {
  it("starts new, then keeps the owner's step and what they've opened across reads", async () => {
    const { get, put } = fixture();
    expect((await get()).progress).toEqual({ status: "new", stepId: null });
    expect((await put({ status: "active", stepId: "email" })).status).toBe(200);
    await put({ seen: "accounts" });
    const saved = await get();
    expect(saved.progress).toEqual({ status: "active", stepId: "email" });
    const accounts = saved.steps.find(item => item.id === "accounts");
    if (accounts) expect(accounts.done).toBe(true);
  });

  it("ticks Home and email from the layout the owner saved", async () => {
    const { raw, get } = fixture();
    raw.prepare("INSERT INTO home_layout(user_id, layout_json) VALUES('owner', ?)").run(JSON.stringify({ order: ["today"], hidden: ["people"], pinned: ["inbox"], earned: [] }));
    const steps = (await get()).steps;
    expect(steps.find(item => item.id === "home")?.done).toBe(true);
    expect(steps.find(item => item.id === "email")?.done).toBe(true);
  });

  it("ticks the calendar from a connected calendar, and a free owner's Ask me from a reminder", async () => {
    const { raw, get } = fixture("free");
    expect((await get()).steps.map(item => [item.id, item.done])).toEqual([["home", false], ["calendar", false], ["ask", false], ["page", false]]);
    raw.exec(`INSERT INTO calendar_sources(id, user_id, name) VALUES('cal', 'owner', 'Work')`);
    raw.exec(`INSERT INTO user_reminders(id, user_id, title, remind_at) VALUES('r1', 'owner', 'Call Mum', '2026-11-27T17:00:00Z')`);
    const steps = (await get()).steps;
    expect(steps.find(item => item.id === "calendar")?.done).toBe(true);
    expect(steps.find(item => item.id === "ask")?.done).toBe(true);
    raw.exec(`UPDATE calendar_sources SET status = 'archived'`);
    expect((await get()).steps.find(item => item.id === "calendar")?.done).toBe(false);
  });

  it("refuses an unknown step, status or place", async () => {
    const { put, get } = fixture();
    expect((await put({ stepId: "news" })).status).toBe(400);
    expect((await put({ status: "paused" })).status).toBe(400);
    expect((await put({ seen: "settings" })).status).toBe(400);
    expect((await get()).progress.status).toBe("new");
  });

  it("remembers a skip", async () => {
    const { put, get } = fixture();
    await put({ status: "skipped", stepId: "home" });
    expect((await get()).progress.status).toBe("skipped");
  });
});
