import { describe, expect, it } from "vitest";
import { buildLandingPageDocument } from "@me3-core/plugin-landing-pages";
import { updateAgentLandingPageDraft } from "../../../packages/agent-chat/src/landing-pages";

function database(race = false) {
  const document = buildLandingPageDocument({ username: "owner", brief: "Launch", template: "waitlist", profile: { name: "Owner", bio: null, avatar: null, profileUrl: "/" } });
  const draftJson = JSON.stringify(document); const writes: Array<{ sql: string; values: unknown[] }> = [];
  const db = { prepare(sql: string) { return { bind(...values: unknown[]) { return {
    async first<T>() { return (sql.includes("plugin_installations") ? { enabled: 1, status: "installed" } : { id: "page-1", site_id: "site-1", slug: "launch", title: "Launch", template_id: "waitlist", draft_json: draftJson, updated_at: "2026-10-10", published_at: null, published_revision_id: null }) as T; },
    async all<T>() { return { results: [{ id: "site-1", username: "owner", site_role: "profile", updated_at: "2026-10-10" }] as T[] }; },
    async run() { writes.push({ sql, values }); return { meta: { changes: race && sql.includes("draft_json = ?") ? 0 : 1 } }; },
  }; } }; } };
  return { db, draftJson, writes };
}

describe("new agent landing-page reviewed revisions", () => {
  it("rejects a different draft even when its update timestamp matches", async () => {
    const { db, writes } = database();
    await expect(updateAgentLandingPageDraft({ DB: db }, "owner", { pageId: "page-1", headline: "New" }, { draftJson: "changed", updatedAt: "2026-10-10" })).rejects.toThrow(/changed/i);
    expect(writes).toHaveLength(0);
  });
  it("atomically rejects changes racing the update", async () => {
    const { db, draftJson, writes } = database(true);
    await expect(updateAgentLandingPageDraft({ DB: db }, "owner", { pageId: "page-1", headline: "New" }, { draftJson, updatedAt: "2026-10-10" })).rejects.toThrow(/changed/i);
    expect(writes[0].sql).toContain("AND draft_json = ?");
    expect(writes[0].values.at(-1)).toBe(draftJson);
  });
});
