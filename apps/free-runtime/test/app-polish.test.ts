import { describe, expect, it } from "vitest";
import { createD1Adapter } from "../src/d1-adapter";
import { FREE_PLAN_NOTE, freeApiAccess, freeStarters, freeTour } from "../src/policy";
import { activateUserDatabase, prepareUserDatabase } from "../src/user-database";
import { createSqliteHost } from "./sqlite-host";

// Failure modes (owner device test, 21 Nov 2026):
// - Home's Today card and the profile header read the site and contact lists on every refresh; with those
//   refused, Home showed "Couldn't refresh. This is part of a paid ME3 plan." A free ME3 has none, so the
//   lists can simply be empty. Anything beyond the bare lists must stay off.
// - The first-run tour led free users to Inbox, Accounts, Social and the website builder.
// - A user with no name in ME3 Cloud showed as "ME3 Owner", and a name edited in the app was overwritten
//   at the next sign-in.
describe("free plan app polish", () => {
  it("lets the apps read the (empty) site and contact lists, and nothing else there", () => {
    expect(freeApiAccess("GET", "/api/sites", { news: false })).toBe("allow");
    expect(freeApiAccess("GET", "/api/contacts", { news: false })).toBe("allow");
    for (const [method, path] of [["POST", "/api/sites"], ["GET", "/api/sites/ada/content"], ["PUT", "/api/sites/ada"], ["POST", "/api/contacts"], ["GET", "/api/contacts/1"], ["GET", "/api/mailbox"]]) {
      expect(freeApiAccess(method, path, { news: false }), `${method} ${path}`).toBe("upgrade");
    }
  });

  it("keeps only the Home step of the tour", () => {
    const step = (id: string) => ({ id, title: id, body: "Tap Add to Home and pick the cards you want to see each day. Inbox is a good one to start with.", targets: [] });
    const tour = freeTour({ steps: ["home", "email", "accounts", "social", "website"].map(step), progress: { status: "active", stepId: "accounts" } });
    expect(tour.steps.map((item) => item.id)).toEqual(["home"]);
    expect(tour.steps[0].body).not.toContain("Inbox");
    expect(tour.progress).toEqual({ status: "active", stepId: null });
    expect(freeTour({ steps: [step("home")], progress: { status: "active", stepId: "home" } }).progress.stepId).toBe("home");
    expect(freeTour({ error: "nope" } as never)).toEqual({ error: "nope" });
  });

  it("names a user after their handle or email when ME3 Cloud has no name, and keeps a name they set", async () => {
    const host = createSqliteHost();
    const db = createD1Adapter(host);
    await prepareUserDatabase(host, db);
    const name = () => db.prepare("SELECT name FROM owner_profile WHERE id = 'owner'").first("name");
    await activateUserDatabase(db, { userId: "u1", email: "ada.lovelace@example.test", name: null, handle: null });
    expect(await name()).toBe("ada.lovelace");
    await db.prepare("UPDATE owner_profile SET name = 'Ada' WHERE id = 'owner'").run();
    await activateUserDatabase(db, { userId: "u1", email: "ada.lovelace@example.test", name: "Cloud Name", handle: "ada" });
    expect(await name()).toBe("Ada");
    expect(await db.prepare("SELECT username FROM owner_profile WHERE id = 'owner'").first("username")).toBe("ada");
  });

  // Failure modes: a free user's first screen says "Your assistant, website and inbox in one place" and offers
  // "Make my website"; the agent offers email or a website it has no tools for; push registration answers
  // "ME3 Cloud is not linked" because a free ME3 never received the token ME3 Cloud's relay checks.
  it("greets a free user without the website and inbox, and never leaves them without a starter", () => {
    const first = freeStarters({ firstRun: true, greeting: { title: "Hi Ada, I'm ME3", body: "Your assistant, website and inbox in one place. Where shall we start?" }, starters: [{ id: "site", label: "Make my website" }, { id: "help", label: "What can you help with?" }, { id: "tour", label: "Show me around" }] });
    expect(first.starters.map((item) => item.id)).toEqual(["help", "tour"]);
    expect(first.greeting?.body).toBe("Your assistant for your tasks, goals, journal and day. Where shall we start?");
    const later = freeStarters({ firstRun: false, greeting: null, starters: [{ id: "reply", label: "Reply to Sam" }, { id: "site", label: "Build my site" }, { id: "mission", label: "Draft my mission" }] });
    expect(later.starters.map((item) => item.id)).toEqual(["mission"]);
    expect(freeStarters({ error: "x" } as never)).toEqual({ error: "x" });
  });

  it("tells the agent what the free plan leaves out", () => {
    for (const word of ["free", "email", "website", "paid", "upgrade"]) expect(FREE_PLAN_NOTE.toLowerCase(), word).toContain(word);
    expect(FREE_PLAN_NOTE.length).toBeLessThan(700);
  });

  it("stores the token ME3 Cloud issues for its push relay, and replaces it at the next sign-in", async () => {
    const host = createSqliteHost();
    const db = createD1Adapter(host);
    await prepareUserDatabase(host, db);
    const token = () => db.prepare("SELECT value FROM install_secrets WHERE name = 'ME3_CLOUD_CORE_TOKEN'").first("value");
    await activateUserDatabase(db, { userId: "u1", email: "a@example.test", name: null, handle: null });
    expect(await token()).toBeNull();
    await activateUserDatabase(db, { userId: "u1", email: "a@example.test", name: null, handle: null, coreToken: "first-token" });
    expect(await token()).toBe("first-token");
    await activateUserDatabase(db, { userId: "u1", email: "a@example.test", name: null, handle: null, coreToken: "second-token" });
    expect(await token()).toBe("second-token");
    await activateUserDatabase(db, { userId: "u1", email: "a@example.test", name: null, handle: null });
    expect(await token()).toBe("second-token");
  });
});
