import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recordOwnerActivity } from "./mission-activity";
import { registerMissionControlRoutes } from "./routes/mission-control";
import { socialPublishActivityHooks } from "./social-publishing";
import type { AppHono, OwnerRouteDeps } from "./http/types";
import type { Env } from "./types";

// Failure modes: a retried activity shows twice, a long post title floods the
// list, an activity write failure breaks the work it describes, or the
// Recent work endpoint does not return what was recorded.
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });

function ownerActivityFixture() {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  raw.exec(readFileSync(new URL("../migrations/0001_initial_public_schema.sql", import.meta.url), "utf8"));
  raw.exec(`INSERT INTO owner_profile(id) VALUES('owner'),('other');
    INSERT INTO plugin_installations(plugin_id,version,enabled,status) VALUES('me3.mission-control','0.1.0',1,'installed');`);
  const prepare = (sql: string) => {
    const query = raw.prepare(sql); let values: unknown[] = [];
    const statement = { bind(...args: unknown[]) { values = args; return statement; },
      async first() { return query.get(...values as never[]) ?? null; },
      async all() { return { results: query.all(...values as never[]) }; },
      async run() { return { meta: { changes: Number(query.run(...values as never[]).changes) } }; },
    }; return statement;
  };
  const env = { DB: { prepare } } as unknown as Env;
  const activity = () => raw.prepare("SELECT user_id, plugin_id, activity_type, title, summary, related_id FROM mission_plugin_activity ORDER BY created_at").all();
  return { raw, env, activity };
}

describe("owner activity in Recent work", () => {
  it("returns recorded work from the plugin-activity endpoint", async () => {
    const f = ownerActivityFixture();
    await recordOwnerActivity(f.env, "owner", { pluginId: "me3.accounts", activityType: "accounts.email_entry_filed", title: "Filed a receipt from Acme", summary: "€24.50 added to Accounts.", status: "succeeded", relatedId: "entry-1" });
    await recordOwnerActivity(f.env, "other", { pluginId: "me3.accounts", activityType: "accounts.email_entry_filed", title: "Someone else's receipt", relatedId: "entry-2" });

    const app = new Hono() as AppHono;
    registerMissionControlRoutes(app, { requireOwner: async () => "owner", unauthorized: () => Response.json({}, { status: 401 }) } as unknown as OwnerRouteDeps);
    const response = await app.request("/api/mission-control/plugin-activity", {}, f.env);

    expect(response.status).toBe(200);
    expect((await response.json() as { activity: unknown[] }).activity).toEqual([expect.objectContaining({
      pluginId: "me3.accounts", activityType: "accounts.email_entry_filed", title: "Filed a receipt from Acme",
      summary: "€24.50 added to Accounts.", status: "succeeded", relatedId: "entry-1",
    })]);
  });

  it("records the same related work once, but unrelated work every time", async () => {
    const f = ownerActivityFixture();
    const input = { pluginId: "me3.mission-control", activityType: "daily_briefing.sent", title: "Sent your morning briefing", relatedId: "daily-briefing:2026-10-20" };
    expect(await recordOwnerActivity(f.env, "owner", input)).toBe(true);
    expect(await recordOwnerActivity(f.env, "owner", input)).toBe(false);
    expect(await recordOwnerActivity(f.env, "other", input)).toBe(true);
    const unrelated = { pluginId: "me3.mission-control", activityType: "weekly_review.submitted", title: "Weekly Review submitted" };
    await recordOwnerActivity(f.env, "owner", unrelated);
    await recordOwnerActivity(f.env, "owner", unrelated);
    expect(f.activity()).toHaveLength(4);
  });

  it("keeps titles to one short line", async () => {
    const f = ownerActivityFixture();
    await recordOwnerActivity(f.env, "owner", { pluginId: "me3.agent-chat", activityType: "agent.computer_job.completed", title: `Researched:\n${"cheap flights ".repeat(20)}` });
    const [row] = f.activity() as Array<{ title: string }>;
    expect(row.title).toHaveLength(120);
    expect(row.title).toMatch(/^Researched: cheap flights .*…$/);
  });

  it("records a published post under Social Publishing, once per Publication", async () => {
    const f = ownerActivityFixture();
    const hooks = socialPublishActivityHooks(f.env);
    const event = { userId: "owner", publicationId: "pub-1", variantId: "version-1", platform: "linkedin" as const, platformLabel: "LinkedIn", title: "Launch week recap", platformPostUrl: null };
    await hooks.onPublished!(event); await hooks.onPublished!(event);
    await hooks.onPublished!({ ...event, publicationId: "pub-2", platform: "x", platformLabel: "X", title: null });
    expect(f.activity()).toEqual([
      { user_id: "owner", plugin_id: "me3.social-publishing", activity_type: "social.post_published", title: "Posted “Launch week recap” to LinkedIn", summary: "Live on LinkedIn.", related_id: "pub-1" },
      { user_id: "owner", plugin_id: "me3.social-publishing", activity_type: "social.post_published", title: "Posted to X", summary: "Live on X.", related_id: "pub-2" },
    ]);
  });

  it("never throws when the activity write fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = { DB: { prepare() { throw new Error("D1 unavailable"); } } } as unknown as Env;
    await expect(recordOwnerActivity(env, "owner", { pluginId: "me3.accounts", activityType: "accounts.email_entry_filed", title: "Filed a receipt" })).resolves.toBe(false);
  });
});
