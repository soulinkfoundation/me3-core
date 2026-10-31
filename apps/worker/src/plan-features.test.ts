import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MANAGED_AI_BILLING_POLICY_SECRET } from "./managed-ai-billing";
import { offerPagesPlanAccess, socialPlanAccess, syncCampaignPlanAccess, syncOfferPagesPlanAccess, syncSocialPlanAccess } from "./plan-features";
import type { Env } from "./types";

function fixture(options: {
  managed: boolean;
  tier?: string | null;
  plugin?: { enabled: number; source?: string; id?: string };
}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE install_secrets (name TEXT PRIMARY KEY, value TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE plugin_installations (
      plugin_id TEXT PRIMARY KEY, version TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'installed', granted_permissions_json TEXT NOT NULL DEFAULT '[]',
      setup_state_json TEXT NOT NULL DEFAULT '{}', installed_at TEXT, updated_at TEXT
    );
    CREATE TABLE social_publications (id TEXT PRIMARY KEY, status TEXT, error_code TEXT, error_message TEXT, updated_at TEXT);
    INSERT INTO social_publications (id, status) VALUES ('scheduled-1', 'scheduled'), ('posted-1', 'published');
    CREATE TABLE email_campaigns (id TEXT PRIMARY KEY, status TEXT, cancelled_at TEXT, failure_reason TEXT, updated_at TEXT);
    CREATE TABLE email_campaign_recipient_jobs (id TEXT PRIMARY KEY, campaign_id TEXT, status TEXT, provider_reason TEXT, updated_at TEXT);
    INSERT INTO email_campaigns (id, status) VALUES ('campaign-scheduled', 'scheduled'), ('campaign-sent', 'sent');
    INSERT INTO email_campaign_recipient_jobs (id, campaign_id, status)
      VALUES ('job-queued', 'campaign-scheduled', 'queued'), ('job-delivered', 'campaign-sent', 'delivered');
  `);
  if (options.tier !== undefined) {
    sqlite.prepare("INSERT INTO install_secrets (name, value) VALUES (?, ?)")
      .run(MANAGED_AI_BILLING_POLICY_SECRET, JSON.stringify({ billingSource: "stripe", tier: options.tier }));
  }
  if (options.plugin) {
    sqlite.prepare(
      `INSERT INTO plugin_installations (plugin_id, version, enabled, status, setup_state_json)
       VALUES (?, '0.1.0', ?, ?, ?)`,
    ).run(
      options.plugin.id || "me3.social-publishing",
      options.plugin.enabled,
      options.plugin.enabled ? "installed" : "disabled",
      JSON.stringify(options.plugin.source ? { source: options.plugin.source } : {}),
    );
  }
  const statement = (sql: string, values: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    async first<T>() { return (sqlite.prepare(sql).get(...(values as string[])) || null) as T | null; },
    async run() { sqlite.prepare(sql).run(...(values as string[])); return { success: true }; },
  });
  const DB = {
    prepare: (sql: string) => statement(sql),
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      for (const item of statements) await item.run();
      return [];
    },
  };
  const env = { DB, ME3_DEPLOYMENT_MODE: options.managed ? "managed" : "self_hosted" } as unknown as Env;
  const plugin = () =>
    sqlite.prepare("SELECT enabled, status, setup_state_json FROM plugin_installations").get() as
      | { enabled: number; status: string; setup_state_json: string }
      | undefined;
  const campaign = (id: string) =>
    (sqlite.prepare("SELECT status FROM email_campaigns WHERE id = ?").get(id) as { status: string }).status;
  const job = (id: string) =>
    (sqlite.prepare("SELECT status FROM email_campaign_recipient_jobs WHERE id = ?").get(id) as { status: string }).status;
  const publication = (id: string) =>
    (sqlite.prepare("SELECT status FROM social_publications WHERE id = ?").get(id) as { status: string }).status;
  return { env, plugin, publication, campaign, job };
}

describe("Social plan access", () => {
  it("switches Social on for a Business owner without a plugin to activate", async () => {
    const { env, plugin } = fixture({ managed: true, tier: "business" });
    expect(await syncSocialPlanAccess(env)).toBe("included");
    expect(plugin()).toMatchObject({ enabled: 1, status: "installed", setup_state_json: '{"source":"plan"}' });
  });

  it("locks Social for a Starter owner", async () => {
    const { env, plugin } = fixture({ managed: true, tier: "pro" });
    expect(await syncSocialPlanAccess(env)).toBe("locked");
    expect(plugin()).toBeUndefined();
  });

  it("cancels scheduled posts and keeps history after a downgrade", async () => {
    const { env, plugin, publication } = fixture({ managed: true, tier: "pro", plugin: { enabled: 1, source: "plan" } });
    expect(await syncSocialPlanAccess(env)).toBe("locked");
    expect(plugin()).toMatchObject({ enabled: 0, status: "disabled" });
    expect(publication("scheduled-1")).toBe("cancelled");
    expect(publication("posted-1")).toBe("published");
  });

  it("takes nothing away before ME3 Cloud reports a tier", async () => {
    const { env, publication } = fixture({ managed: true, plugin: { enabled: 1, source: "plan" } });
    expect(await syncSocialPlanAccess(env)).toBe("included");
    expect(publication("scheduled-1")).toBe("scheduled");
  });

  it("includes Social on self-hosted installs", async () => {
    const { env } = fixture({ managed: false });
    expect(await socialPlanAccess(env)).toBe("included");
  });
});

describe("Campaigns plan access", () => {
  it("switches Campaigns on for a Business owner without a plugin to activate", async () => {
    const { env, plugin } = fixture({ managed: true, tier: "business" });
    expect(await syncCampaignPlanAccess(env)).toBe("included");
    expect(plugin()).toMatchObject({ enabled: 1, status: "installed", setup_state_json: '{"source":"plan"}' });
  });

  it("switches it off after a downgrade, cancelling scheduled sends and keeping sent history", async () => {
    const { env, plugin, campaign, job } = fixture({
      managed: true,
      tier: "pro",
      plugin: { enabled: 1, source: "plan", id: "me3.email-campaigns" },
    });
    expect(await syncCampaignPlanAccess(env)).toBe("locked");
    expect(plugin()).toMatchObject({ enabled: 0, status: "disabled" });
    expect(campaign("campaign-scheduled")).toBe("cancelled");
    expect(job("job-queued")).toBe("cancelled");
    expect(campaign("campaign-sent")).toBe("sent");
    expect(job("job-delivered")).toBe("delivered");
  });

  it("keeps Campaigns on for self-hosted installs and leaves an owner's own switch alone", async () => {
    expect(await syncCampaignPlanAccess(fixture({ managed: false }).env)).toBe("included");
    const owned = fixture({ managed: true, tier: "pro", plugin: { enabled: 1, id: "me3.email-campaigns" } });
    expect(await syncCampaignPlanAccess(owned.env)).toBe("locked");
    expect(owned.plugin()).toMatchObject({ enabled: 1 });
  });
});

describe("Offer pages plan access", () => {
  it("switches offer pages on for Business and self-hosted owners", async () => {
    const business = fixture({ managed: true, tier: "business" });
    expect(await syncOfferPagesPlanAccess(business.env)).toBe("included");
    expect(business.plugin()).toMatchObject({ enabled: 1, status: "installed", setup_state_json: '{"source":"plan"}' });
    expect(await offerPagesPlanAccess(fixture({ managed: false }).env)).toBe("included");
  });

  it("switches them off after a downgrade to Starter", async () => {
    const { env, plugin } = fixture({ managed: true, tier: "pro", plugin: { enabled: 1, source: "plan", id: "me3.landing-pages" } });
    expect(await syncOfferPagesPlanAccess(env)).toBe("locked");
    expect(plugin()).toMatchObject({ enabled: 0, status: "disabled" });
  });
});
