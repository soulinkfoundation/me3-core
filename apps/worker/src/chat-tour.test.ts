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
// - a bad progress write (unknown step or status) is saved instead of refused.
const base: TourContext = {
  siteBuilt: false, emailAddress: "maya@inbox.me3.app", layout: null, accounts: true, social: true, seen: [],
  progress: { status: "new", stepId: null },
};
const tour = (context: Partial<TourContext> = {}) => chatTour({ ...base, ...context });
const step = (context: Partial<TourContext>, id: string) => tour(context).steps.find(item => item.id === id)!;
const layout = (patch: Partial<NonNullable<TourContext["layout"]>>) => ({ order: ["today"], hidden: ["inbox", "people"], pinned: [], earned: [], ...patch });

describe("chatTour", () => {
  it("walks Home, email, Accounts and Social, and ends on the website", () => {
    expect(tour().steps.map(item => item.id)).toEqual(["home", "email", "accounts", "social", "website"]);
    expect(tour().steps.every(item => !item.done)).toBe(true);
  });

  it("leaves out Accounts and Social when they're switched off", () => {
    expect(tour({ accounts: false, social: false }).steps.map(item => item.id)).toEqual(["home", "email", "website"]);
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
    expect(step({}, "email").targets.map(target => target.id)).toEqual(["home_tab", "add_to_home", "add_inbox"]);
    expect(step({}, "accounts").targets.map(target => target.id)).toEqual(["profile_menu", "menu_accounts"]);
    expect(step({}, "social").targets.map(target => target.id)).toEqual(["profile_menu", "menu_social"]);
    expect(step({}, "website").targets.map(target => target.id)).toEqual(["chat_tab"]);
    for (const id of ["home", "email", "accounts", "social"]) expect(step({}, id).task).toBeNull();
    for (const item of tour().steps) for (const target of item.targets) expect(target.hint).not.toBe("");
  });

  it("offers Make my website until the site is built, then the editor", () => {
    expect(step({}, "website").task).toEqual({ kind: "site_ask", label: "Make my website" });
    const built = step({ siteBuilt: true }, "website");
    expect(built.task).toEqual({ kind: "open", label: "Open the editor", to: "website" });
    expect(built.done).toBe(true);
  });

  it("offers ME3's address to copy only when there is one", () => {
    expect(step({}, "email").copy).toEqual({ label: "Copy my address", value: "maya@inbox.me3.app" });
    expect(step({ emailAddress: null }, "email").copy).toBeNull();
  });

  it("forgets a saved step this install no longer shows", () => {
    expect(tour({ social: false, progress: { status: "active", stepId: "social" } }).progress.stepId).toBeNull();
  });
});

const databases: DatabaseSync[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function fixture() {
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
  const env = { DB } as unknown as Env;
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
