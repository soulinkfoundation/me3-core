import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadOwnerSnapshotContext } from "../../../packages/agent-chat/src/owner-snapshot";
import { createAgentSocialPost } from "../../../packages/agent-chat/src/social-content";

const createSocialPost = vi.hoisted(() => vi.fn(async (_env, _owner, input) => input));
vi.mock("@me3-core/plugin-social-publishing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@me3-core/plugin-social-publishing")>()),
  createSocialPost,
}));

afterEach(() => vi.clearAllMocks());

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE sites (id TEXT, user_id TEXT, site_type TEXT, site_role TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE site_files (site_id TEXT, path TEXT, content TEXT, updated_at TEXT);
    INSERT INTO sites VALUES ('studio', 'owner', 'profile', 'organization', '2020-01-01', '2026-09-09');
    INSERT INTO sites VALUES ('personal', 'owner', 'profile', 'profile', '2021-01-01', '2026-01-01');
    INSERT INTO sites VALUES ('someone-else', 'other', 'profile', 'profile', '2019-01-01', '2027-01-01');
  `);
  for (const [id, name] of [["studio", "Business identity"], ["personal", "Personal identity"], ["someone-else", "Other owner"]]) {
    for (const path of ["src/me.json", "public/me.json"]) {
      sqlite.prepare("INSERT INTO site_files VALUES (?, ?, ?, '2026-01-01')")
        .run(id, path, JSON.stringify({ name, bio: name }));
    }
  }
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          // Execute the site selection SQL; unrelated owner context is empty.
          const query = /FROM sites\b/.test(sql) ? sqlite.prepare(sql) : null;
          return {
            async first<T>() { return (query?.get(...values as string[]) || null) as T | null; },
            async all<T>() { return { results: (query?.all(...values as string[]) || []) as T[] }; },
            async run() { throw new Error("Unexpected write in site selection"); },
          };
        },
      };
    },
    async batch() { return []; },
  };
  return { db, sqlite };
}

const source = { sourceType: "journal" as const, requestedRef: "entry", id: "entry", title: "Journal", content: "Entry", snapshot: "{}" };
const draft = { ideaText: "Idea", linkedinBody: "Draft" };

describe("personal site selection", () => {
  it("keeps newer business content and other owners out of the owner snapshot", async () => {
    const { db, sqlite } = fixture();
    try {
      const result = await loadOwnerSnapshotContext({ db, ownerId: "owner", owner: null, meJsonUrl: null });
      expect(result.prompt).toContain("Personal identity");
      expect(result.prompt).not.toContain("Business identity");
      expect(result.prompt).not.toContain("Other owner");
    } finally { sqlite.close(); }
  });

  it("defaults personal social drafts to the profile even when a business site is older", async () => {
    const { db, sqlite } = fixture();
    try {
      await createAgentSocialPost(db, "owner", source, draft);
      expect(createSocialPost).toHaveBeenCalledWith(expect.anything(), "owner", expect.objectContaining({ siteId: "personal" }));
    } finally { sqlite.close(); }
  });

  it("does not silently use a business site when no personal profile exists", async () => {
    const { db, sqlite } = fixture();
    try {
      sqlite.exec("DELETE FROM sites WHERE id = 'personal'");
      await expect(createAgentSocialPost(db, "owner", source, draft)).rejects.toThrow("Create a ME3 profile");
      expect(createSocialPost).not.toHaveBeenCalled();
    } finally { sqlite.close(); }
  });

  it("preserves explicit social draft site selection", async () => {
    const { db, sqlite } = fixture();
    try {
      await createAgentSocialPost(db, "owner", source, { ...draft, siteId: "studio" });
      expect(createSocialPost).toHaveBeenCalledWith(expect.anything(), "owner", expect.objectContaining({ siteId: "studio" }));
    } finally { sqlite.close(); }
  });
});
