import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MANAGED_CAMPAIGN_PROTOCOL_VERSION,
  type ManagedCampaignDeliveryRequest,
} from "../../../shared/managed-campaign-contract";
import {
  applyManagedCampaignEvent,
  cancelCampaignDelivery,
  dispatchDueCampaignJobs,
  getCampaignTransportStatus,
  handleCampaignUnsubscribe,
  receivePostmarkCampaignEvent,
  sendCampaignTest,
  startCampaignAddOnCheckout,
  startCampaignDelivery,
} from "./campaign-delivery";
import { getCampaignResults } from "./campaign-results";
import { createCampaign, deleteCampaign, duplicateCampaign, getCampaign, listCampaignLayouts, saveCampaignDraft } from "./campaigns";
import { updateEmailProviderSettings } from "./email-providers";
import type { Env } from "./types";

const migrationFiles = [
  "../migrations/0041_email_campaign_foundations.sql",
  "../migrations/0042_email_campaign_assets.sql",
  "../migrations/0043_email_campaign_delivery.sql",
  "../migrations/0044_site_branding.sql",
  "../migrations/0091_email_campaign_approvals.sql",
  "../migrations/0092_campaign_mailing_address.sql",
  "../migrations/0093_site_branding_email_logo.sql",
];
const migrations = migrationFiles.map((path) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8"),
);

type SqliteValue = null | number | string | Uint8Array;

class SqliteD1Statement {
  private values: SqliteValue[] = [];
  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
  ) {}
  bind(...values: unknown[]) {
    this.values = values as SqliteValue[];
    return this;
  }
  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) || null;
  }
  async all<T>() {
    return {
      results: this.database.prepare(this.sql).all(...this.values) as T[],
      success: true as const,
      meta: {},
    };
  }
  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return {
      results: [],
      success: true as const,
      meta: { changes: Number(result.changes) },
    };
  }
}

class SqliteD1Database {
  constructor(private readonly database: DatabaseSync) {}
  prepare(sql: string) {
    return new SqliteD1Statement(this.database, sql);
  }
  async batch(statements: SqliteD1Statement[]) {
    const results = [];
    this.database.exec("BEGIN");
    try {
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

describe("campaign delivery lifecycle", () => {
  let database: DatabaseSync;
  let env: Env;
  let campaignId: string;
  let requests: ManagedCampaignDeliveryRequest[];
  let fetcher: typeof fetch;
  let transportSenderRef: string;
  let transportProvider: "aws_ses" | "postmark";
  let transportRemaining: number;

  beforeEach(async () => {
    database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(`
      CREATE TABLE owner_profile (
        id TEXT PRIMARY KEY, email TEXT, name TEXT, username TEXT,
        bio TEXT, avatar_url TEXT, timezone TEXT, locale TEXT,
        assistant_name TEXT, password_hash TEXT
      );
      CREATE TABLE sites (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, username TEXT NOT NULL,
        custom_domain TEXT, custom_domain_status TEXT
      );
      CREATE TABLE subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT NOT NULL,
        email TEXT NOT NULL, first_name TEXT, last_name TEXT,
        source TEXT NOT NULL DEFAULT 'me3',
        subscribed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        unsubscribed_at TEXT, ip_hash TEXT,
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
      );
      CREATE TABLE install_secrets (
        name TEXT PRIMARY KEY, value TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO owner_profile (id, email, name, username)
      VALUES ('owner', 'owner@example.com', 'Owner Name', 'owner');
      INSERT INTO sites (id, user_id, username)
      VALUES ('site-1', 'owner', 'publisher');
      INSERT INTO subscribers
        (site_id, email, first_name, source, subscribed_at)
      VALUES
        ('site-1', 'Reader@Example.com', 'Reader', 'me3', '2026-08-20T10:00:00.000Z'),
        ('site-1', 'pending@example.com', NULL, 'manual', '2026-08-20T10:00:00.000Z');
      INSERT INTO install_secrets (name, value) VALUES
        ('ME3_CORE_INSTALL_ID', 'core_11111111-1111-4111-8111-111111111111'),
        ('ME3_CLOUD_CORE_TOKEN', 'managed-core-token');
    `);
    for (const migration of migrations) database.exec(migration);
    database.exec(
      `ALTER TABLE email_campaigns ADD COLUMN audience_filter_json TEXT NOT NULL DEFAULT '{"kind":"all"}'`,
    );
    database.exec(`
      INSERT INTO site_branding
        (site_id, display_name, logo_ref, accent_color, background_color,
         surface_color, text_color)
      VALUES
        ('site-1', 'Publisher brand', NULL, '#226644', '#f5f5f0', '#ffffff', '#18201d');
    `);
    env = {
      DB: new SqliteD1Database(database) as unknown as D1Database,
      ME3_DEPLOYMENT_MODE: "managed",
      ME3_CLOUD_API_ORIGIN: "https://api.me3.test",
      ME3_SITE_HOST: "publisher.example.com",
    } as Env;
    requests = [];
    transportSenderRef = "sender-1";
    transportProvider = "aws_ses";
    transportRemaining = 5_000;
    fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/managed-campaign/billing/status")) {
        return Response.json({
          addOn: {
            available: true,
            entitled: true,
            status: "active",
            planKey: "5k",
            allowance: 5_000,
            used: 0,
            remaining: transportRemaining,
            resetAt: "2026-09-01T00:00:00.000Z",
            cancelAtPeriodEnd: false,
            paidThroughAt: "2026-09-26T12:00:00.000Z",
            plans: [
              { key: "5k", allowance: 5_000, monthlyPriceUsd: 10, checkoutAvailable: true },
              { key: "10k", allowance: 10_000, monthlyPriceUsd: 15, checkoutAvailable: true },
              { key: "20k", allowance: 20_000, monthlyPriceUsd: 25, checkoutAvailable: true },
            ],
          },
        });
      }
      if (url.pathname.endsWith("/campaign-sender")) {
        return Response.json({
          connected: true,
          provider: transportProvider,
          sender: {
            ref: transportSenderRef,
            domain: "campaigns.example.com",
            fromAddress: "campaign@campaigns.example.com",
            status: "verified",
          },
          ready: true,
          instructions: [],
        });
      }
      if (url.pathname.endsWith("/callback-credentials")) {
        return Response.json({ callbackSecret: "a".repeat(64) });
      }
      if (url.pathname.endsWith("/deliveries")) {
        const request = JSON.parse(String(init?.body)) as ManagedCampaignDeliveryRequest;
        requests.push(request);
        return Response.json(
          {
            version: MANAGED_CAMPAIGN_PROTOCOL_VERSION,
            operationId: request.operationId,
            disposition: "accepted",
            replayed: false,
            acceptedAt: "2026-08-26T12:00:00.000Z",
          },
          { status: 202 },
        );
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const created = await createCampaign(env, "owner", { siteId: "site-1" });
    expect(created?.revision.document.brand).toMatchObject({
      name: "Publisher",
      accentColor: "#226644",
      backgroundColor: "#f4f5f4",
    });
    campaignId = String(created?.id);
    const document = created?.revision.document;
    await saveCampaignDraft(env, "owner", campaignId, {
      name: "Launch",
      subject: "A useful update",
      previewText: "A short preview",
      replyToAddress: "owner@example.com",
      document: { ...document, brand: { ...document?.brand, mailingAddress: "PO Box 12\nDublin 2" } },
    });
  });

  afterEach(() => database.close());

  /** What the owner saw when they approved: this revision, to this many people. */
  async function approved(extra: Record<string, unknown> = {}) {
    const current = await getCampaign(env, "owner", campaignId);
    return { revisionId: current!.revision.id, recipientCount: 1, ...extra };
  }

  it("records the owner's approval of the exact revision and count", async () => {
    await startCampaignDelivery(env, "owner", campaignId, await approved(), fetcher);

    const current = await getCampaign(env, "owner", campaignId);
    expect(current?.approval).toMatchObject({ revisionId: current?.revision.id, recipientCount: 1 });
  });

  it("refuses to send a revision the owner didn't approve", async () => {
    const stale = await approved();
    const current = await getCampaign(env, "owner", campaignId);
    await saveCampaignDraft(env, "owner", campaignId, {
      subject: "Edited after review",
      document: current!.revision.document,
    });

    await expect(startCampaignDelivery(env, "owner", campaignId, stale, fetcher)).rejects.toMatchObject({
      code: "campaign_changed",
      status: 409,
    });
    await expect(
      startCampaignDelivery(env, "owner", campaignId, { scheduledFor: null }, fetcher),
    ).rejects.toMatchObject({ code: "campaign_changed" });
    expect(database.prepare("SELECT status FROM email_campaigns WHERE id = ?").get(campaignId)).toEqual({
      status: "draft",
    });
  });

  it("puts the mailing address in the footer and remembers it for the site's next campaign", async () => {
    const current = await getCampaign(env, "owner", campaignId);
    expect(current?.revision.document.brand.mailingAddress).toBe("PO Box 12, Dublin 2");
    expect(current?.revision.renderedHtml).toContain("PO Box 12, Dublin 2");

    const next = await createCampaign(env, "owner", { siteId: "site-1" });
    expect(next?.revision.document.brand.mailingAddress).toBe("PO Box 12, Dublin 2");
  });

  it("refuses a real send without a mailing address", async () => {
    const current = await getCampaign(env, "owner", campaignId);
    await saveCampaignDraft(env, "owner", campaignId, {
      subject: "A useful update",
      document: { ...current!.revision.document, brand: { ...current!.revision.document.brand, mailingAddress: "" } },
    });

    await expect(startCampaignDelivery(env, "owner", campaignId, await approved(), fetcher)).rejects.toMatchObject({
      code: "mailing_address_required",
      status: 409,
    });
  });

  it("refuses a real send while layout starter text is left in", async () => {
    const current = await getCampaign(env, "owner", campaignId);
    await saveCampaignDraft(env, "owner", campaignId, {
      subject: "A useful update",
      document: {
        ...current!.revision.document,
        blocks: [{
          id: "details",
          type: "text",
          paragraphs: [
            { style: "bullet", spans: [{ text: "When", marks: ["bold"] }, { text: " · Fri 14 November" }] },
            { style: "bullet", spans: [{ text: "Price", marks: ["bold"] }, { text: " · Cost, or Free" }] },
          ],
        }],
      },
    });

    await expect(startCampaignDelivery(env, "owner", campaignId, await approved(), fetcher)).rejects.toMatchObject({
      code: "starter_text_left",
      message: 'Replace the starter text "Cost, or Free" first.',
    });
  });

  it("wears the Site's email logo and current colours, also when starting from a past email", async () => {
    database.exec(`UPDATE site_branding SET logo_ref = './files/logo.webp',
      email_logo_ref = './files/email-logo.png?v=abc', email_logo_width = 180, email_logo_height = 48`);
    const branded = await createCampaign(env, "owner", { siteId: "site-1" });
    expect(branded?.revision.document.brand).toMatchObject({
      logoUrl: "https://publisher.example.com/files/email-logo.png?v=abc",
      logoWidth: 180,
      logoHeight: 48,
    });
    expect(branded?.revision.renderedHtml).toContain('src="https://publisher.example.com/files/email-logo.png?v=abc"');

    database.exec("UPDATE site_branding SET accent_color = '#993311'");
    database.exec(`UPDATE email_campaigns SET audience_filter_json = '{"kind":"customers","itemRef":null}' WHERE id = '${campaignId}'`);
    const copy = await duplicateCampaign(env, "owner", campaignId, { allSubscribers: true });
    expect(copy?.revision.subject).toBe("A useful update");
    expect(copy?.audienceFilter).toEqual({ kind: "all" });
    expect(copy?.revision.document.brand).toMatchObject({
      accentColor: "#993311",
      logoUrl: "https://publisher.example.com/files/email-logo.png?v=abc",
      mailingAddress: "PO Box 12, Dublin 2",
    });
  });

  it("offers the three starting layouts filled in for the Site", async () => {
    const layouts = await listCampaignLayouts(env, "owner", { siteId: "site-1", month: "October" });
    expect(layouts.map((layout) => layout.name)).toEqual(["Newsletter", "News", "Event or offer"]);
    expect(layouts[0].subject).toBe("October at Publisher brand");
    expect(layouts[0].html).toContain("Your photo");
    expect(layouts[2].html).toContain("Cost, or Free");
  });

  it("refuses to send when the audience no longer matches the approved count", async () => {
    await expect(
      startCampaignDelivery(env, "owner", campaignId, await approved({ recipientCount: 2 }), fetcher),
    ).rejects.toMatchObject({ code: "audience_changed", status: 409 });
  });

  it("snapshots only eligible recipients and sends the protocol-v2 permission", async () => {
    const queued = await startCampaignDelivery(env, "owner", campaignId, await approved(), fetcher);
    expect(queued).toMatchObject({ eligibleCount: 1, excludedCount: 1 });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM email_campaign_audience_members").get(),
    ).toEqual({ count: 1 });

    transportSenderRef = "sender-2";
    await dispatchDueCampaignJobs(env, fetcher);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      version: "me3-managed-campaign/2",
      kind: "campaign",
      senderRef: "sender-1",
      recipient: {
        address: "reader@example.com",
        permission: { status: "marketable", method: "single_opt_in" },
      },
      content: { replyToAddress: "owner@example.com" },
    });
    expect(
      database.prepare(
        "SELECT status, request_json IS NOT NULL AS has_request FROM email_campaign_recipient_jobs",
      ).get(),
    ).toEqual({ status: "accepted", has_request: 1 });
  });

  it("keeps test sends single-recipient and permission-free", async () => {
    const result = await sendCampaignTest(env, "owner", campaignId, fetcher);

    expect(result).toMatchObject({ kind: "test", status: "accepted" });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      kind: "test",
      recipient: { address: "owner@example.com", permission: null },
    });
    expect(
      database.prepare(
        "SELECT COUNT(*) AS count FROM email_campaign_audience_snapshots",
      ).get(),
    ).toEqual({ count: 0 });
    await expect(getCampaign(env, "owner", campaignId)).resolves.toMatchObject({
      status: "draft",
    });
    const current = await getCampaign(env, "owner", campaignId);
    await expect(saveCampaignDraft(env, "owner", campaignId, {
      subject: "Edited after a test",
      document: current!.revision.document,
    })).resolves.toMatchObject({ status: "draft" });
  });

  it.each([
    "unsubscribed_at = CURRENT_TIMESTAMP",
    "delivery_status = 'suppressed'",
    "marketing_status = 'pending'",
    "email = 'changed@example.com'",
  ])("rechecks recipient permission before dispatch: %s", async (change) => {
    await startCampaignDelivery(env, "owner", campaignId, await approved(), fetcher);
    database.exec(`UPDATE subscribers SET ${change} WHERE id = 1`);

    await dispatchDueCampaignJobs(env, fetcher);

    expect(requests).toHaveLength(0);
    expect(database.prepare("SELECT status FROM email_campaign_recipient_jobs").get())
      .toEqual({ status: "cancelled" });
  });

  it("does not dispatch an incomplete audience snapshot", async () => {
    await startCampaignDelivery(env, "owner", campaignId, await approved(), fetcher);
    database.prepare("UPDATE email_campaigns SET audience_snapshot_id = NULL WHERE id = ?").run(campaignId);

    await dispatchDueCampaignJobs(env, fetcher);

    expect(requests).toHaveLength(0);
  });

  it("does not contact the managed provider when no delivery jobs need work", async () => {
    await expect(dispatchDueCampaignJobs(env, fetcher)).resolves.toEqual({ processed: 0, paused: 0 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps future delivery scheduled and honors cancellation before dispatch", async () => {
    await startCampaignDelivery(env, "owner", campaignId, await approved({
      scheduledFor: new Date(Date.now() + 60_000).toISOString(),
    }), fetcher);
    await dispatchDueCampaignJobs(env, fetcher);
    expect(requests).toHaveLength(0);
    await expect(getCampaign(env, "owner", campaignId)).resolves.toMatchObject({ status: "scheduled" });

    await cancelCampaignDelivery(env, "owner", campaignId, fetcher);
    database.exec("UPDATE email_campaign_recipient_jobs SET next_attempt_at = '2000-01-01T00:00:00Z'");
    await dispatchDueCampaignJobs(env, fetcher);
    expect(requests).toHaveLength(0);
    await expect(getCampaign(env, "owner", campaignId)).resolves.toMatchObject({ status: "cancelled" });
  });

  it("preserves delivery confirmation that arrives before the send response", async () => {
    const earlyCallbackFetcher: typeof fetch = async (input, init) => {
      const response = await fetcher(input, init);
      if (new URL(String(input)).pathname.endsWith("/deliveries")) {
        const request = requests.at(-1)!;
        await applyManagedCampaignEvent(env, {
          version: MANAGED_CAMPAIGN_PROTOCOL_VERSION,
          eventId: "early-delivery",
          sequence: 1,
          occurredAt: new Date().toISOString(),
          operationId: request.operationId,
          campaignRef: campaignId,
          recipientRef: request.recipient.ref,
          type: "delivery.delivered",
          reason: null,
        });
      }
      return response;
    };
    await startCampaignDelivery(env, "owner", campaignId, await approved(), earlyCallbackFetcher);
    await dispatchDueCampaignJobs(env, earlyCallbackFetcher);

    expect(database.prepare("SELECT status FROM email_campaign_recipient_jobs").get())
      .toEqual({ status: "delivered" });
    await expect(getCampaign(env, "owner", campaignId)).resolves.toMatchObject({ status: "sent" });
  });

  it("deletes a terminal failed campaign and its delivery records", async () => {
    const current = await getCampaign(env, "owner", campaignId);
    const revisionId = current?.revision.id;
    expect(revisionId).toBeTruthy();
    if (!revisionId) throw new Error("Expected campaign revision");
    database.prepare(
      `INSERT INTO email_campaign_recipient_jobs
       (id, campaign_id, revision_id, kind, recipient_ref, recipient_email,
        status, next_attempt_at, created_at, updated_at)
       VALUES ('failed-job', ?, ?, 'test', 'test-ref', 'owner@example.com',
               'failed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    ).run(campaignId, revisionId);
    database.prepare(
      "UPDATE email_campaigns SET status = 'failed' WHERE id = ?",
    ).run(campaignId);

    await expect(deleteCampaign(env, "owner", campaignId)).resolves.toEqual({ campaignId });
    expect(database.prepare("SELECT COUNT(*) AS count FROM email_campaigns").get()).toEqual({
      count: 0,
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM email_campaign_recipient_jobs").get(),
    ).toEqual({ count: 0 });
  });

  it("accepts the active Postmark managed sender", async () => {
    transportProvider = "postmark";

    await expect(getCampaignTransportStatus(env, fetcher)).resolves.toMatchObject({
      available: true,
      managed: true,
      ready: true,
      sender: {
        ref: "sender-1",
        fromAddress: "campaign@campaigns.example.com",
      },
    });
  });

  it("applies delivery outcomes idempotently to local campaign and subscriber truth", async () => {
    await startCampaignDelivery(env, "owner", campaignId, await approved(), fetcher);
    await dispatchDueCampaignJobs(env, fetcher);
    const operationId = requests[0]!.operationId;
    const recipientRef = requests[0]!.recipient.ref;
    const event = {
      version: MANAGED_CAMPAIGN_PROTOCOL_VERSION,
      eventId: "event-1",
      sequence: 2,
      occurredAt: "2026-08-26T12:01:00.000Z",
      operationId,
      campaignRef: campaignId,
      recipientRef,
      type: "recipient.unsubscribed" as const,
      reason: "unsubscribe" as const,
    };

    await expect(applyManagedCampaignEvent(env, event)).resolves.toBe(true);
    await expect(applyManagedCampaignEvent(env, event)).resolves.toBe(true);

    expect(
      database.prepare(
        "SELECT unsubscribed_at, delivery_status FROM subscribers WHERE lower(email) = 'reader@example.com'",
      ).get(),
    ).toEqual({
      unsubscribed_at: "2026-08-26T12:01:00.000Z",
      delivery_status: "suppressed",
    });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM email_campaign_events").get(),
    ).toEqual({ count: 1 });
    await expect(getCampaign(env, "owner", campaignId)).resolves.toMatchObject({
      status: "sent",
      progress: { suppressed: 1 },
    });
  });

  it("never asks ME3 Cloud about sending from a self-hosted installation", async () => {
    env.ME3_DEPLOYMENT_MODE = "self_hosted";
    await expect(getCampaignTransportStatus(env, fetcher)).resolves.toMatchObject({
      managed: false,
      ready: false,
      addOn: null,
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("never opens managed campaign billing from a self-hosted installation", async () => {
    env.ME3_DEPLOYMENT_MODE = "self_hosted";

    await expect(startCampaignAddOnCheckout(env, "5k", fetcher)).rejects.toMatchObject({
      code: "managed_installation_required",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps a campaign in draft when its audience exceeds the remaining allowance", async () => {
    transportRemaining = 0;

    await expect(
      startCampaignDelivery(env, "owner", campaignId, await approved(), fetcher),
    ).rejects.toMatchObject({ code: "campaign_allowance_insufficient" });
    expect(
      database.prepare("SELECT status FROM email_campaigns WHERE id = ?").get(campaignId),
    ).toEqual({ status: "draft" });
  });
  describe("self-hosted sending through the owner's own provider", () => {
    let providerRequests: Array<{ url: string; body: Record<string, unknown> }>;
    let providerResponse: () => Response;

    beforeEach(() => {
      env.ME3_DEPLOYMENT_MODE = "self_hosted";
      env.CORE_API_ORIGIN = "https://api.owner.test";
      database.exec(`
        CREATE TABLE email_provider_settings (
          user_id TEXT NOT NULL, provider_id TEXT NOT NULL,
          is_active INTEGER NOT NULL DEFAULT 0, encrypted_secret TEXT,
          secret_hint TEXT, secret_updated_at TEXT, config_json TEXT,
          last_status TEXT, last_status_checked_at TEXT, last_test_sent_at TEXT,
          last_test_error TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, provider_id)
        );
        CREATE TABLE email_send_audit (
          id TEXT PRIMARY KEY, user_id TEXT NOT NULL, mailbox_id TEXT,
          mailbox_message_id TEXT, provider_id TEXT NOT NULL,
          provider_message_id TEXT, provider_status TEXT,
          status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
          purpose TEXT NOT NULL DEFAULT 'test'
            CHECK (purpose IN ('test', 'draft', 'reply', 'workflow')),
          from_address TEXT, to_address TEXT, subject TEXT, thread_key TEXT,
          message_id_header TEXT, in_reply_to TEXT, references_header TEXT,
          metadata_json TEXT, error_message TEXT,
          created_by TEXT NOT NULL DEFAULT 'owner', approved_by_user_id TEXT,
          requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, sent_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      providerRequests = [];
      providerResponse = () =>
        Response.json({ ErrorCode: 0, Message: "OK", MessageID: crypto.randomUUID() });
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        providerRequests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
        return providerResponse();
      }));
    });

    afterEach(() => vi.unstubAllGlobals());

    async function connectPostmark() {
      await updateEmailProviderSettings(env, "owner", {
        activeProviderId: "postmark",
        providers: [{ id: "postmark", fromAddress: "news@owner.test", serverToken: "pm-server-token" }],
      });
    }

    async function sendToReader() {
      await connectPostmark();
      await startCampaignDelivery(env, "owner", campaignId, await approved(), fetcher);
      await dispatchDueCampaignJobs(env, fetcher);
      return database.prepare("SELECT id, status FROM email_campaign_recipient_jobs").get() as {
        id: string;
        status: string;
      };
    }

    function unsubscribeUrl() {
      const html = String(providerRequests[0]!.body.HtmlBody);
      return html.match(/https:\/\/api\.owner\.test\/api\/public\/campaigns\/unsubscribe\/[^"]+/)![0];
    }

    it("asks for a sender until the owner connects their own provider", async () => {
      await expect(getCampaignTransportStatus(env, fetcher, "owner")).resolves.toMatchObject({
        managed: false,
        ready: false,
        reason: "sender_not_connected",
        sender: null,
        addOn: null,
      });

      await connectPostmark();

      await expect(getCampaignTransportStatus(env, fetcher, "owner")).resolves.toMatchObject({
        available: true,
        managed: false,
        ready: true,
        reason: null,
        sender: { ref: "provider:postmark", fromAddress: "news@owner.test", domain: "owner.test" },
        provider: { id: "postmark", label: "Postmark", tracksDelivery: true },
        addOn: null,
      });
      expect(fetcher).not.toHaveBeenCalled();
    });

    it("keeps the campaign a draft when no sender is connected", async () => {
      await expect(
        startCampaignDelivery(env, "owner", campaignId, await approved(), fetcher),
      ).rejects.toMatchObject({ code: "sender_not_connected" });
      await expect(getCampaign(env, "owner", campaignId)).resolves.toMatchObject({ status: "draft" });
    });

    it("sends the approved email through the owner's Postmark with one-click unsubscribe", async () => {
      const job = await sendToReader();

      expect(fetcher).not.toHaveBeenCalled();
      expect(providerRequests).toHaveLength(1);
      const { url, body } = providerRequests[0]!;
      expect(url).toBe("https://api.postmarkapp.com/email");
      expect(body).toMatchObject({
        From: expect.stringContaining("news@owner.test"),
        To: "reader@example.com",
        Subject: "A useful update",
        ReplyTo: "owner@example.com",
        MessageStream: "broadcast",
        Metadata: expect.objectContaining({ me3_campaign_job: job.id }),
      });
      const link = unsubscribeUrl();
      expect(String(body.HtmlBody)).not.toContain("{{ME3_MANAGED_UNSUBSCRIBE_URL}}");
      expect(String(body.TextBody)).toContain(link);
      expect(body.Headers).toEqual(expect.arrayContaining([
        { Name: "List-Unsubscribe", Value: `<${link}>` },
        { Name: "List-Unsubscribe-Post", Value: "List-Unsubscribe=One-Click" },
      ]));
      expect(job.status).toBe("accepted");
      await expect(getCampaign(env, "owner", campaignId)).resolves.toMatchObject({ status: "sent" });
      await expect(getCampaignResults(env, campaignId)).resolves.toMatchObject({
        sentTo: 1,
        delivered: 1,
        didntArrive: 0,
      });
    });

    it("sends a test to the owner through their provider", async () => {
      await connectPostmark();

      await expect(sendCampaignTest(env, "owner", campaignId, fetcher)).resolves.toMatchObject({
        kind: "test",
        status: "accepted",
      });
      expect(providerRequests[0]!.body).toMatchObject({ To: "owner@example.com" });
      await expect(getCampaign(env, "owner", campaignId)).resolves.toMatchObject({ status: "draft" });
    });

    it("unsubscribes on the one-click POST but only shows a button on GET", async () => {
      await sendToReader();
      const link = unsubscribeUrl();
      const token = link.split("/").pop()!;
      const reader = () =>
        database.prepare(
          "SELECT unsubscribed_at FROM subscribers WHERE lower(email) = 'reader@example.com'",
        ).get() as { unsubscribed_at: string | null };

      const page = await handleCampaignUnsubscribe(env, token, new Request(link));
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("<form");
      expect(reader().unsubscribed_at).toBeNull();

      const oneClick = await handleCampaignUnsubscribe(env, token, new Request(link, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "List-Unsubscribe=One-Click",
      }));
      expect(oneClick.status).toBe(200);
      expect(reader().unsubscribed_at).not.toBeNull();
      await expect(getCampaignResults(env, campaignId)).resolves.toMatchObject({ unsubscribed: 1 });

      const forged = await handleCampaignUnsubscribe(env, `${token.split(".")[0]}.${"0".repeat(32)}`, new Request(link, {
        method: "POST",
        body: "List-Unsubscribe=One-Click",
      }));
      expect(forged.status).toBe(404);
    });

    it("records Postmark delivery and bounce webhooks, and refuses a wrong token", async () => {
      const job = await sendToReader();
      const transport = await getCampaignTransportStatus(env, fetcher, "owner");
      const eventsUrl = transport.provider!.deliveryEventsUrl!;
      expect(eventsUrl).toMatch(/^https:\/\/api\.owner\.test\/api\/public\/campaigns\/provider-events\/postmark\//);
      const token = eventsUrl.split("/").pop()!;
      const post = (body: Record<string, unknown>, withToken = token) =>
        receivePostmarkCampaignEvent(env, withToken, new Request(eventsUrl, {
          method: "POST",
          body: JSON.stringify(body),
        }));

      expect((await post({ RecordType: "Delivery" }, "wrong")).status).toBe(401);

      const delivered = await post({
        RecordType: "Delivery",
        MessageID: "pm-1",
        Recipient: "reader@example.com",
        DeliveredAt: "2026-08-26T12:01:00Z",
        Metadata: { me3_campaign_job: job.id },
      });
      expect(delivered.status).toBe(204);
      expect(database.prepare("SELECT status FROM email_campaign_recipient_jobs").get())
        .toEqual({ status: "delivered" });

      database.exec("UPDATE email_campaign_recipient_jobs SET status = 'accepted'");
      await post({
        RecordType: "Bounce",
        ID: 42,
        Type: "HardBounce",
        MessageID: "pm-1",
        Email: "reader@example.com",
        BouncedAt: "2026-08-26T12:02:00Z",
        Metadata: { me3_campaign_job: job.id },
      });
      expect(database.prepare("SELECT status FROM email_campaign_recipient_jobs").get())
        .toEqual({ status: "bounced" });
      expect(
        database.prepare(
          "SELECT delivery_status FROM subscribers WHERE lower(email) = 'reader@example.com'",
        ).get(),
      ).toEqual({ delivery_status: "bounced" });
      await expect(getCampaignResults(env, campaignId)).resolves.toMatchObject({
        delivered: 0,
        didntArrive: 1,
        didntArriveReasons: { bounced: 1 },
      });
    });

    it("waits and retries when the provider is busy, and stops on a refused address", async () => {
      providerResponse = () => Response.json({ ErrorCode: 429, Message: "Rate limit" }, { status: 429 });
      const busy = await sendToReader();
      expect(busy.status).toBe("retry_wait");
      await expect(getCampaign(env, "owner", campaignId)).resolves.toMatchObject({ status: "sending" });

      providerResponse = () =>
        Response.json({ ErrorCode: 406, Message: "Inactive recipient" }, { status: 422 });
      database.exec("UPDATE email_campaign_recipient_jobs SET next_attempt_at = '2000-01-01T00:00:00Z'");
      await dispatchDueCampaignJobs(env, fetcher);
      expect(database.prepare("SELECT status FROM email_campaign_recipient_jobs").get())
        .toEqual({ status: "rejected" });
      await expect(getCampaign(env, "owner", campaignId)).resolves.toMatchObject({ status: "failed" });
    });
  });
});
