import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppBindings } from "./http/types";
import { registerSiteRoutes } from "./routes/sites";
import * as sites from "./sites";
import {
  confirmDoubleOptInSubscriber,
  getDoubleOptInConfirmationStatus,
  requestDoubleOptInSubscription,
} from "./subscriber-confirmations";
import * as transactionalEmails from "./transactional-emails";
import type {
  NewsletterSubscriptionConfirmationEmailDetails,
  TransactionalEmailResult,
} from "./transactional-emails";
import type { DbSite, Env } from "./types";

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

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return {
      results: [],
      success: true as const,
      meta: {
        changes: Number(result.changes),
        last_row_id: Number(result.lastInsertRowid),
      },
    };
  }
}

describe("subscriber double opt-in", () => {
  let database: DatabaseSync;
  let env: Env;
  let site: DbSite;

  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE subscribers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id TEXT NOT NULL,
        email TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        source TEXT NOT NULL DEFAULT 'me3',
        subscribed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        unsubscribed_at TEXT,
        ip_hash TEXT,
        page_id TEXT,
        action_id TEXT,
        campaign TEXT,
        marketing_status TEXT NOT NULL DEFAULT 'pending',
        marketing_permission_method TEXT,
        marketing_permission_granted_at TEXT,
        marketing_permission_evidence_json TEXT,
        delivery_status TEXT NOT NULL DEFAULT 'deliverable',
        delivery_status_changed_at TEXT,
        confirmation_token_hash TEXT,
        confirmation_expires_at TEXT,
        confirmation_requested_at TEXT,
        UNIQUE(site_id, email)
      );
    `);
    env = {
      DB: {
        prepare: (sql: string) => new SqliteD1Statement(database, sql),
      } as unknown as D1Database,
    } as Env;
    site = {
      id: "site-1",
      user_id: "owner-1",
      username: "publisher",
      site_type: "profile",
      site_role: "profile",
      profile_site_id: null,
      template_id: null,
      custom_domain: null,
      custom_domain_status: null,
      custom_domain_cf_id: null,
      created_at: "2026-09-03T09:00:00.000Z",
      updated_at: "2026-09-03T09:00:00.000Z",
      published_at: "2026-09-03T09:00:00.000Z",
    };
  });

  afterEach(() => {
    database.close();
    vi.restoreAllMocks();
  });

  it("keeps a signup pending until its emailed token is confirmed", async () => {
    let emailDetails: NewsletterSubscriptionConfirmationEmailDetails | null = null;
    const send = vi.fn(async (_env: Env, details: NewsletterSubscriptionConfirmationEmailDetails) => {
      emailDetails = details;
      return { status: "sent" } satisfies TransactionalEmailResult;
    });

    expect(await requestDoubleOptInSubscription(env, requestInput(site), send)).toBe("accepted");
    expect(send).toHaveBeenCalledOnce();
    const confirmationUrl = new URL(emailDetails!.confirmationUrl);
    const token = confirmationUrl.searchParams.get("token") || "";
    const pending = database.prepare(
      `SELECT marketing_status, marketing_permission_method, confirmation_token_hash
       FROM subscribers WHERE email = ?`,
    ).get("reader@example.com") as Record<string, string | null>;
    expect(pending.marketing_status).toBe("pending");
    expect(pending.marketing_permission_method).toBeNull();
    expect(pending.confirmation_token_hash).not.toBe(token);

    const confirmation = { siteId: site.id, email: "reader@example.com", token };
    expect(await getDoubleOptInConfirmationStatus(env, confirmation)).toBe("ready");
    vi.spyOn(sites, "getSiteByUsername").mockResolvedValue(site);
    const app = new Hono<AppBindings>();
    registerSiteRoutes(app, {
      requireOwner: async () => site.user_id,
      unauthorized: (c) => c.json({ error: "Unauthorized" }, 401),
    });
    const page = await app.request(confirmationUrl.toString(), {}, env);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<form method="post"');
    expect(await getDoubleOptInConfirmationStatus(env, confirmation)).toBe("ready");

    const submitted = await app.request(confirmationUrl.toString(), {
      method: "POST",
      body: new URLSearchParams({ email: confirmation.email, token }),
    }, env);
    expect(submitted.status).toBe(200);
    expect(await submitted.text()).toContain("Subscription confirmed");

    const confirmed = database.prepare(
      `SELECT marketing_status, marketing_permission_method,
              marketing_permission_evidence_json
       FROM subscribers WHERE email = ?`,
    ).get("reader@example.com") as Record<string, string>;
    expect(confirmed.marketing_status).toBe("marketable");
    expect(confirmed.marketing_permission_method).toBe("double_opt_in");
    expect(JSON.parse(confirmed.marketing_permission_evidence_json)).toMatchObject({
      method: "double_opt_in",
      pageId: "home",
      actionId: "newsletter",
    });
    expect(await confirmDoubleOptInSubscriber(env, confirmation)).toBe("already_confirmed");
    expect(database.prepare(
      "SELECT marketing_permission_evidence_json FROM subscribers WHERE email = ?",
    ).get(confirmation.email)).toEqual({
      marketing_permission_evidence_json: confirmed.marketing_permission_evidence_json,
    });
    const invalidPost = await app.request(confirmationUrl.toString(), { method: "POST" }, env);
    expect(invalidPost.status).toBe(400);
  });

  it("does not send another confirmation during the cooldown", async () => {
    const send = vi.fn(async () => ({ status: "sent" }) satisfies TransactionalEmailResult);

    await requestDoubleOptInSubscription(env, requestInput(site), send);
    expect(await requestDoubleOptInSubscription(env, requestInput(site), send)).toBe("accepted");
    expect(send).toHaveBeenCalledOnce();
  });

  it.each([false, true])("sends only one email for concurrent requests (resend: %s)", async (resend) => {
    const send = vi.fn(async () => ({ status: "sent" }) satisfies TransactionalEmailResult);
    if (resend) {
      await requestDoubleOptInSubscription(env, requestInput(site), send);
      database.exec("UPDATE subscribers SET confirmation_requested_at = '2026-01-01T00:00:00.000Z'");
      send.mockClear();
    }

    await Promise.all([
      requestDoubleOptInSubscription(env, requestInput(site), send),
      requestDoubleOptInSubscription(env, requestInput(site), send),
    ]);

    expect(send).toHaveBeenCalledOnce();
  });

  it.each(["marketable", "bounced", "complained", "suppressed"])("preserves %s subscribers without sending", async (status) => {
    const send = vi.fn(async () => ({ status: "sent" }) satisfies TransactionalEmailResult);
    await requestDoubleOptInSubscription(env, requestInput(site), send);
    database.prepare(`UPDATE subscribers SET confirmation_requested_at = NULL,
      marketing_status = ?, delivery_status = ?`).run(
      status === "marketable" ? "marketable" : "pending",
      status === "marketable" ? "deliverable" : status,
    );
    const before = database.prepare("SELECT * FROM subscribers").get();

    expect(await requestDoubleOptInSubscription(env, requestInput(site), send)).toBe("accepted");
    expect(send).toHaveBeenCalledOnce();
    expect(database.prepare("SELECT * FROM subscribers").get()).toEqual(before);
  });

  it("requires a new token when an unsubscribed reader rejoins", async () => {
    const send = vi.fn(async (_env: Env, _details: NewsletterSubscriptionConfirmationEmailDetails) => (
      { status: "sent" } satisfies TransactionalEmailResult
    ));
    await requestDoubleOptInSubscription(env, requestInput(site), send);
    const token = new URL(send.mock.calls[0][1].confirmationUrl).searchParams.get("token")!;
    const confirmation = { siteId: site.id, email: "reader@example.com", token };
    await confirmDoubleOptInSubscriber(env, confirmation);
    database.exec("UPDATE subscribers SET unsubscribed_at = CURRENT_TIMESTAMP");
    expect(await confirmDoubleOptInSubscriber(env, confirmation)).toBe("invalid");

    await requestDoubleOptInSubscription(env, requestInput(site), send);
    expect(send).toHaveBeenCalledTimes(2);
    expect(await confirmDoubleOptInSubscriber(env, confirmation)).toBe("invalid");
    confirmation.token = new URL(send.mock.calls[1][1].confirmationUrl).searchParams.get("token")!;
    expect(await confirmDoubleOptInSubscriber(env, confirmation)).toBe("confirmed");
  });

  it.each(["token", "email", "siteId", "expired"])("rejects a confirmation with invalid %s", async (invalid) => {
    const send = vi.fn(async (_env: Env, _details: NewsletterSubscriptionConfirmationEmailDetails) => (
      { status: "sent" } satisfies TransactionalEmailResult
    ));
    await requestDoubleOptInSubscription(env, requestInput(site), send);
    const token = new URL(send.mock.calls[0][1].confirmationUrl).searchParams.get("token")!;
    const confirmation = { siteId: site.id, email: "reader@example.com", token };
    if (invalid === "expired") {
      database.exec("UPDATE subscribers SET confirmation_expires_at = '1970-01-01T00:00:00.000Z'");
    } else {
      confirmation[invalid as keyof typeof confirmation] = "incorrect";
    }
    expect(await confirmDoubleOptInSubscriber(env, confirmation)).toBe("invalid");
    expect(database.prepare("SELECT marketing_status FROM subscribers").get()).toEqual({ marketing_status: "pending" });
  });

  it("allows an immediate retry when no email provider is available", async () => {
    const failedSend = vi.fn(async () => ({
      status: "skipped",
      error: "Email provider is not configured",
    }) satisfies TransactionalEmailResult);

    expect(await requestDoubleOptInSubscription(env, requestInput(site), failedSend)).toBe("unavailable");
    expect(database.prepare(
      "SELECT confirmation_requested_at FROM subscribers WHERE email = ?",
    ).get("reader@example.com")).toEqual({ confirmation_requested_at: null });

    const successfulSend = vi.fn(async () => ({ status: "sent" }) satisfies TransactionalEmailResult);
    expect(await requestDoubleOptInSubscription(env, requestInput(site), successfulSend)).toBe("accepted");
    expect(successfulSend).toHaveBeenCalledOnce();
  });

  describe("welcome email", () => {
    const welcomeProfile = (doubleOptIn: boolean) => JSON.stringify({
      name: "Publisher",
      intents: {
        subscribe: {
          enabled: true,
          title: "Letters",
          doubleOptIn,
          welcomeEmail: {
            enabled: true,
            subject: "Your free guide",
            message: "Thanks for joining {{newsletterName}}.",
            download: { path: "./files/downloads/guide.pdf", name: "the guide" },
          },
        },
      },
    });

    function siteApp(profileJson: string) {
      vi.spyOn(sites, "getSiteByUsername").mockResolvedValue(site);
      vi.spyOn(sites, "getSiteFileText").mockImplementation(async (_env, _siteId, path) =>
        path === "src/me.json" ? profileJson : null);
      vi.spyOn(sites, "getPublishedSiteBaseUrl").mockResolvedValue("https://publisher.example.com");
      vi.spyOn(transactionalEmails, "getOwnerContact").mockResolvedValue({ name: "Pub", email: "owner@example.com" });
      const welcome = vi.spyOn(transactionalEmails, "sendNewsletterWelcomeEmail")
        .mockResolvedValue({ status: "sent" });
      const app = new Hono<AppBindings>();
      registerSiteRoutes(app, {
        requireOwner: async () => site.user_id,
        unauthorized: (c) => c.json({ error: "Unauthorized" }, 401),
      });
      return { app, welcome };
    }

    it("sends the welcome and download once, on first confirmation", async () => {
      const { app, welcome } = siteApp(welcomeProfile(true));
      const send = vi.fn(async (_env: Env, _details: NewsletterSubscriptionConfirmationEmailDetails) => (
        { status: "sent" } satisfies TransactionalEmailResult
      ));
      await requestDoubleOptInSubscription(env, requestInput(site), send);
      const confirmationUrl = new URL(send.mock.calls[0][1].confirmationUrl);
      const token = confirmationUrl.searchParams.get("token")!;
      const confirm = () => app.request(confirmationUrl.toString(), {
        method: "POST",
        body: new URLSearchParams({ email: "reader@example.com", token }),
      }, env);

      const first = await confirm();
      expect(await first.text()).toContain('href="https://publisher.example.com/files/downloads/guide.pdf"');
      expect(welcome).toHaveBeenCalledOnce();
      expect(welcome.mock.calls[0][1]).toMatchObject({
        subscriberEmail: "reader@example.com",
        newsletterName: "Letters",
        replyToAddress: "owner@example.com",
        subject: "Your free guide",
        download: { url: "https://publisher.example.com/files/downloads/guide.pdf", name: "the guide" },
      });

      const again = await confirm();
      expect(await again.text()).toContain("Download the guide");
      const revisit = await app.request(confirmationUrl.toString(), {}, env);
      expect(await revisit.text()).toContain("Download the guide");
      expect(welcome).toHaveBeenCalledOnce();
    });

    it("sends the welcome right away without confirmation", async () => {
      const { app, welcome } = siteApp(welcomeProfile(false));
      const response = await app.request("https://publisher.example.com/api/sites/publisher/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "reader@example.com" }),
      }, env);

      expect(response.status).toBe(200);
      expect(welcome).toHaveBeenCalledOnce();
    });

    it("sends nothing generic when the owner has not written the email", async () => {
      const profile = JSON.parse(welcomeProfile(false));
      profile.intents.subscribe.welcomeEmail.message = " ";
      const { app, welcome } = siteApp(JSON.stringify(profile));
      await app.request("https://publisher.example.com/api/sites/publisher/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "reader@example.com" }),
      }, env);

      expect(welcome).not.toHaveBeenCalled();
    });
  });
});

function requestInput(site: DbSite) {
  return {
    site,
    email: "reader@example.com",
    firstName: "Reader",
    lastName: null,
    ipHash: "ip-hash",
    pageId: "home",
    actionId: "newsletter",
    campaign: null,
    confirmationOrigin: "https://publisher.example.com",
    siteName: "Publisher",
    newsletterName: "Publisher newsletter",
  };
}
