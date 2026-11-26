import { describe, expect, it } from "vitest";
import { createD1Adapter } from "../src/d1-adapter";
import { FREE_PLAN_NOTE, freeApiAccess, freeStarters } from "../src/policy";
import { activateUserDatabase, prepareUserDatabase } from "../src/user-database";
import { createSqliteHost } from "./sqlite-host";

// Failure modes (owner device test, 21 Nov 2026):
// - Home's Today card and the profile header read the site and contact lists on every refresh; with those
//   refused, Home showed "Couldn't refresh. This is part of a paid ME3 plan." A free ME3 has no sites, so that
//   list can simply be empty and anything beyond it must stay off.
// - Free owners want to load contacts from their phones (Nov 2026): People is the whole contacts API, as paid.
// - The first-run tour led free users to Inbox, Accounts, Social and the website builder (Core now writes the
//   free tour itself under ME3_TOUR=free: see apps/worker/src/chat-tour.test.ts).
// - A user with no name in ME3 Cloud showed as "ME3 Owner", and a name edited in the app was overwritten
//   at the next sign-in.
describe("free plan app polish", () => {
  it("lets the apps read the (empty) site list, and nothing else there", () => {
    expect(freeApiAccess("GET", "/api/sites", { news: false })).toBe("allow");
    for (const [method, path] of [["POST", "/api/sites"], ["GET", "/api/sites/ada/content"], ["PUT", "/api/sites/ada"], ["GET", "/api/mailbox"]]) {
      expect(freeApiAccess(method, path, { news: false }), `${method} ${path}`).toBe("upgrade");
    }
  });

  it("gives a free owner the whole People (contacts) API, as on paid", () => {
    for (const [method, path] of [
      ["GET", "/api/contacts"], ["POST", "/api/contacts"], ["PUT", "/api/contacts/c1"], ["DELETE", "/api/contacts/c1"],
      ["POST", "/api/contacts/outreach/import"], ["POST", "/api/contacts/c1/in-touch"], ["PUT", "/api/contacts/c1/reminder"],
      ["DELETE", "/api/contacts/c1/reminder"], ["GET", "/api/contacts/avatar?url=https://a.example/x.png"],
    ]) {
      expect(freeApiAccess(method, path, { news: false }), `${method} ${path}`).toBe("allow");
    }
    expect(FREE_PLAN_NOTE).toContain("contacts");
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
