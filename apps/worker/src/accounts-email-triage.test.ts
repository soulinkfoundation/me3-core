import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNTS_REMOVALS_SCHEMA } from "./accounts";
import { ACCOUNTS_EMAIL_TRIAGE_SCHEMA, triageInboundInvoiceEmail } from "./accounts-email-triage";
import { MAIL_TRIAGE_SCHEMA, retryPendingMailTriage } from "./mailbox-triage";
import { deliverInboundEmail, handleInboundEmail, type ForwardableEmailMessageLike } from "./mailbox-inbound";
import { registerAccountsRoutes } from "./routes/accounts";
import type { AppHono, OwnerRouteDeps } from "./http/types";
import type { Env } from "./types";

// Failure modes: direct/managed replays or concurrent delivery double-file,
// non-invoice mail or another mailbox is scanned, disabled plugin/toggle still writes,
// medium-confidence/unpaid invoices auto-pay, MIME subjects fail scoring,
// ledger failure loses accepted email or cannot recover on a managed duplicate.
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });

function fixture() {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  raw.exec(readFileSync(new URL("../migrations/0001_initial_public_schema.sql", import.meta.url), "utf8"));
  for (const name of ["0021_managed_email_inbound_deliveries", "0048_mailbox_attachment_staging"]) {
    raw.exec(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8"));
  }
  for (const sql of [...ACCOUNTS_EMAIL_TRIAGE_SCHEMA, ...ACCOUNTS_REMOVALS_SCHEMA, ...MAIL_TRIAGE_SCHEMA]) raw.exec(sql);
  raw.exec(`INSERT INTO owner_profile(id) VALUES('owner'),('other');
    INSERT INTO mailbox_aliases(id,user_id,alias_local_part,forwarding_email,status) VALUES('mailbox','owner','owner','','active');
    INSERT INTO plugin_installations(plugin_id,version,enabled,status) VALUES('me3.accounts','0.1.0',1,'installed');`);
  const state = { failLedger: false };
  const prepare = (sql: string) => {
    const query = raw.prepare(sql); let values: unknown[] = [];
    const statement = { bind(...args: unknown[]) { values = args; return statement; },
      async first() { return query.get(...values as never[]) ?? null; },
      async all() { return { results: query.all(...values as never[]) }; },
      async run() {
        if (state.failLedger && sql.includes("INSERT OR IGNORE INTO financial_entries")) throw new Error("Synthetic ledger failure");
        return { meta: { changes: Number(query.run(...values as never[]).changes) } };
      },
    }; return statement;
  };
  const env = { ME3_MAIL_AVATARS: "off", DB: { prepare, async batch(statements: ReturnType<typeof prepare>[]) { for (const statement of statements) await statement.run(); } } } as unknown as Env;
  vi.spyOn(console, "error").mockImplementation(() => {});
  const entries = () => raw.prepare("SELECT * FROM financial_entries").all();
  return { raw, env, state, entries };
}

function mail(subject = "Receipt", body = "EUR 24.50", from = "shop@example.test", id: string | null = "receipt-1"): ForwardableEmailMessageLike {
  const bytes = new TextEncoder().encode([
    `From: ${from}`, "To: owner@me3.test", `Subject: ${subject}`,
    ...(id ? [`Message-ID: <${id}@example.test>`] : []), "Content-Type: text/plain; charset=utf-8", "", body,
  ].join("\r\n"));
  return { from, to: "owner@me3.test", rawSize: bytes.length, headers: new Headers(),
    raw: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
    canBeForwarded: false, forward: vi.fn(), setReject: vi.fn(),
  };
}

const managedDelivery = { deliveryId: "receipt-delivery", managedInstallationId: "test-managed", coreInstallId: "test-install", recipient: "owner@me3.test", bodySha256: "a".repeat(64) };

describe("Accounts invoice hook on the agent mailbox with real SQLite", () => {
  it("files one medium-confidence receipt for review directly from handleInboundEmail", async () => {
    const f = fixture(); const incoming = mail(); await handleInboundEmail(incoming, f.env);
    expect(incoming.setReject).not.toHaveBeenCalled();
    const message = f.raw.prepare("SELECT id FROM mailbox_messages").get()!;
    expect(f.entries()).toEqual([expect.objectContaining({
      user_id: "owner", entry_type: "expense", description: "Receipt", amount_cents: 2450,
      currency: "EUR", source: "email_triage", status: "needs_review",
      source_ref: `email:${message.id}`, source_email_id: message.id,
    })]);
  });

  it.each([false, true])("deduplicates concurrent deliveries and retries (managed=%s)", async managed => {
    const f = fixture(); const deliver = () => deliverInboundEmail(mail(), f.env, managed ? { managedDelivery } : {});
    await Promise.all([deliver(), deliver()]); await deliver();
    expect(f.entries()).toHaveLength(1);
  });

  it("deduplicates direct retries even when the provider omits Message-ID", async () => {
    const f = fixture();
    await deliverInboundEmail(mail("Receipt", "EUR 24.50", "shop@example.test", null), f.env);
    await deliverInboundEmail(mail("Receipt", "EUR 24.50", "shop@example.test", null), f.env);
    expect(f.entries()).toHaveLength(1);
  });

  it("shows each filed entry once in the agent's Recent work, named after the sender", async () => {
    const f = fixture();
    const activity = () => f.raw.prepare("SELECT plugin_id, activity_type, title, summary, related_id FROM mission_plugin_activity ORDER BY title").all();
    await deliverInboundEmail(mail(), f.env); await deliverInboundEmail(mail(), f.env);
    await deliverInboundEmail(mail("Your upcoming invoice", "Invoice total EUR 49.00 will be charged on 3 November.", "billing@northwind-hosting.test", "bill-1"), f.env);
    await deliverInboundEmail(mail("Payment received", "Payment received EUR 49.00. Thank you for your payment.", "billing@stripe.test", "payout-1"), f.env);
    await deliverInboundEmail(mail("Lunch tomorrow", "See you at noon", "friend@example.test", "lunch-1"), f.env);
    const entryId = (description: string) => (f.raw.prepare("SELECT id FROM financial_entries WHERE description = ?").get(description) as { id: string }).id;
    expect(activity()).toEqual([
      { plugin_id: "me3.accounts", activity_type: "accounts.email_entry_filed", title: "Filed a bill from Northwind Hosting", summary: "€49.00 added to Accounts.", related_id: entryId("Your upcoming invoice") },
      { plugin_id: "me3.accounts", activity_type: "accounts.email_entry_filed", title: "Filed a receipt from Example", summary: "€24.50 added to Accounts for you to check.", related_id: entryId("Receipt") },
      { plugin_id: "me3.accounts", activity_type: "accounts.email_entry_filed", title: "Logged a payment from Stripe", summary: "€49.00 added to Accounts.", related_id: entryId("Payment received") },
    ]);
  });

  it("does not log a receipt again after the owner clears Recent work", async () => {
    const f = fixture(); const delivery = await deliverInboundEmail(mail(), f.env);
    if (delivery.status !== "accepted") throw new Error("Expected accepted synthetic email");
    f.raw.exec("DELETE FROM mission_plugin_activity");
    expect(await triageInboundInvoiceEmail(f.env, "mailbox", delivery.messageId)).toBe(false);
    expect(f.raw.prepare("SELECT id FROM mission_plugin_activity").all()).toHaveLength(0);
  });

  it.each([
    ["Lunch tomorrow", "See you at noon", "friend@example.test"],
    ["Payment platform update", "Introducing a new feature. For example, total EUR 99.00. Learn more.", "billing@stripe.test"],
    ["Invoice attachment", "Please see the attached file", "billing@example.test"],
  ])("ignores non-transactional or unextractable mail: %s", async (subject, body, from) => {
    const f = fixture(); await deliverInboundEmail(mail(subject, body, from), f.env); expect(f.entries()).toHaveLength(0);
  });

  it("triages on a fresh installation, where Accounts is on by default", async () => {
    const f = fixture(); f.raw.exec("DELETE FROM plugin_installations");
    expect((await deliverInboundEmail(mail(), f.env)).status).toBe("accepted"); expect(f.entries()).toHaveLength(1);
  });

  it.each(["disabled", "setup_required", "toggle"])("does not triage when %s", async condition => {
    const f = fixture();
    if (condition === "disabled") f.raw.exec("UPDATE plugin_installations SET enabled=0,status='disabled'");
    if (condition === "setup_required") f.raw.exec("UPDATE plugin_installations SET status='setup_required'");
    if (condition === "toggle") f.raw.exec("INSERT INTO accounts_email_triage_settings(user_id,enabled) VALUES('owner',0)");
    expect((await deliverInboundEmail(mail(), f.env)).status).toBe("accepted"); expect(f.entries()).toHaveLength(0);
  });

  it("never reads outbound mail or a message outside the requested agent mailbox", async () => {
    const f = fixture(); f.raw.exec(`INSERT INTO mailbox_messages(id,mailbox_id,direction,message_kind,status,subject,text_body)
      VALUES('outbound','mailbox','outbound','email','sent','Receipt','EUR 24.50');`);
    expect(await triageInboundInvoiceEmail(f.env, "mailbox", "outbound")).toBe(false);
    const delivery = await deliverInboundEmail(mail(), f.env);
    if (delivery.status !== "accepted") throw new Error("Expected accepted synthetic email");
    expect(await triageInboundInvoiceEmail(f.env, "another-mailbox", delivery.messageId)).toBe(false);
    expect(f.entries()).toHaveLength(1);
  });

  it.each([
    ["Receipt", "Grand total EUR 49.00. Thank you for your payment.", "billing@hosting.test", "paid", "expense"],
    ["Invoice", "Amount due EUR 49.00. Unpaid invoice.", "billing@hosting.test", "needs_review", "expense"],
    ["Invoice", "Total EUR 49.00. Not paid.", "billing@hosting.test", "needs_review", "expense"],
    ["Payment received", "Payment received EUR 49.00. Thank you for your payment.", "billing@stripe.test", "paid", "income"],
    ["=?UTF-8?Q?Receipt_for_software?=", "EUR 24.50", "shop@example.test", "needs_review", "expense"],
    ["Your upcoming invoice", "Invoice total EUR 49.00 will be charged on 3 November. Invoice number 42.", "billing@hosting.test", "pending", "expense"],
    ["Invoice reminder", "Invoice #42 for EUR 49.00 is due. Grand total EUR 49.00. It will be paid automatically.", "billing@hosting.test", "pending", "expense"],
    ["Receipt", "Grand total EUR 49.00. Thank you for your payment. Your plan renews on 3 December.", "billing@hosting.test", "paid", "expense"],
  ])("uses confidence and payment evidence for %s", async (subject, body, from, status, entryType) => {
    const f = fixture(); await deliverInboundEmail(mail(subject, body, from), f.env);
    expect(f.entries()).toEqual([expect.objectContaining({ status, entry_type: entryType })]);
  });

  it("keeps the saved email on a ledger failure and files the receipt on the triage retry", async () => {
    const f = fixture(); f.state.failLedger = true;
    expect((await deliverInboundEmail(mail(), f.env, { managedDelivery })).status).toBe("accepted");
    expect(f.raw.prepare("SELECT id FROM mailbox_messages").all()).toHaveLength(1);
    expect(f.raw.prepare("SELECT status FROM mailbox_triage").get()).toEqual({ status: "failed" });
    expect(f.entries()).toHaveLength(0);
    f.state.failLedger = false;
    expect((await deliverInboundEmail(mail(), f.env, { managedDelivery })).status).toBe("duplicate");
    await retryPendingMailTriage(f.env, { olderThanMs: 0 });
    expect(f.entries()).toHaveLength(1);
    expect(f.raw.prepare("SELECT status, handled_kind FROM mailbox_triage").get()).toEqual({ status: "done", handled_kind: "receipt" });
  });

  it("saves an owner-scoped toggle through the authenticated Accounts route", async () => {
    const f = fixture(); const app = new Hono() as AppHono;
    let ownerId: string | null = "owner";
    registerAccountsRoutes(app, { requireOwner: async () => ownerId, unauthorized: () => Response.json({}, { status: 401 }) } as unknown as OwnerRouteDeps);
    const update = (enabled: unknown) => app.request("/api/accounts/email-triage", { method: "PUT", body: JSON.stringify({ enabled }), headers: { "Content-Type": "application/json" } }, f.env);
    expect((await update(false)).status).toBe(200);
    await deliverInboundEmail(mail(), f.env); expect(f.entries()).toHaveLength(0);
    ownerId = "other";
    expect(await (await app.request("/api/accounts/email-triage", {}, f.env)).json()).toEqual({ enabled: true });
    expect((await update("false")).status).toBe(400);
    ownerId = null; expect((await update(true)).status).toBe(401);
  });
});
