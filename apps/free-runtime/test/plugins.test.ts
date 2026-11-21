import { describe, expect, it } from "vitest";
import { freeApiAccess, freePluginList } from "../src/policy";

// Failure mode (seen on production, 2026-11-21): the apps build their menu from GET /api/plugins. With it
// blocked, iOS hid Tasks, Writing, Mission and Calendar from free users. Unfiltered, it would offer paid
// plugins, and the activate route would let a free user switch them on.
describe("plugins a free user's app sees", () => {
  it("can read the list but not change it", () => {
    expect(freeApiAccess("GET", "/api/plugins", { news: false })).toBe("allow");
    expect(freeApiAccess("POST", "/api/plugins/me3.accounts/activate", { news: false })).toBe("upgrade");
    expect(freeApiAccess("POST", "/api/plugins", { news: false })).toBe("upgrade");
  });

  it("lists only the free plan's plugins", () => {
    const body = { catalogVersion: 3, plugins: ["me3.accounts", "me3.agent-chat", "me3.calendar", "me3.email-campaigns", "me3.journal", "me3.landing-pages", "me3.mission-control", "me3.social-publishing", "me3.soup"].map((id) => ({ id, enabled: true })) };
    expect(freePluginList(body, { news: false }).plugins.map((plugin) => plugin.id)).toEqual(["me3.agent-chat", "me3.calendar", "me3.journal", "me3.mission-control"]);
    expect(freePluginList(body, { news: true }).plugins.map((plugin) => plugin.id)).toContain("me3.soup");
    expect(freePluginList(body, { news: false }).catalogVersion).toBe(3);
    expect(freePluginList({ error: "x" } as never, { news: false })).toEqual({ error: "x" });
  });
});
