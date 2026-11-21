import { describe, expect, it } from "vitest";
import { createD1Adapter } from "../src/d1-adapter";
import { freeApiAccess, freeTour } from "../src/policy";
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
});
