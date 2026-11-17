import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACCOUNTS_REMOVALS_SCHEMA, syncWebsiteIncomeEntries } from "./accounts";
import { ACCOUNTS_EMAIL_TRIAGE_SCHEMA } from "./accounts-email-triage";
import { deliverInboundEmail, type ForwardableEmailMessageLike } from "./mailbox-inbound";
import { MAIL_TRIAGE_SCHEMA } from "./mailbox-triage";
import { PAY_DIRECTLY_HOLDS_SCHEMA, PAY_DIRECTLY_MATCH_SCHEMA, PAY_DIRECTLY_SCHEMA, PAY_PAGE_SCHEMA } from "./pay-directly";
import { listWaitingPayments, type WaitingPayment } from "./pay-directly-bookings";
import { confirmWaiting, dismissWaitingMatch } from "./pay-directly-holds";
import { matchPaymentEmail, namesAreSimilar, parsePaymentEmail } from "./payment-email-matching";
import { PAYMENT_EMAIL_RULES } from "./payment-email-rules";
import type { Env } from "./types";

// Failure modes this file guards:
// - an email is matched to the wrong waiting order, or one of two fitting orders is picked for the owner;
// - an ordinary receipt, a PayPal payment the owner SENT, or mail from another sender is read as money arriving;
// - a match marks anything paid by itself;
// - the income is counted twice: once filed from the email by Accounts triage and once from the order;
// - a payment email that fits nothing stops being filed as income.
//
// SYNTHETIC FIXTURES. None of the emails below are real provider emails. They are written by hand
// to exercise the rules in payment-email-rules.ts, which are themselves unverified guesses. The
// names, amounts and addresses are invented. Replace them with real samples when there are some.
const SYNTHETIC = {
  paypal: {
    fromAddress: "service@paypal.com",
    subject: "You've got money",
    textBody: "Hello Clara Byrne,\n\nAna Silva sent you €60.00 EUR.\n\nNote from Ana Silva: for the intro session\n\nTransaction ID: 0AB12345CD678901E",
  },
  paypalWithReference: {
    fromAddress: "service@paypal.com",
    subject: "You've got money",
    textBody: "Hello Clara Byrne,\n\nA. Silva sent you €60.00 EUR.\n\nNote from A. Silva: ME3-4F7K",
  },
  wise: {
    fromAddress: "noreply@wise.com",
    subject: "You received 25.00 GBP from Tom Reilly",
    textBody: "Hi Clara,\n\nTom Reilly sent you 25.00 GBP.\nReference: ME3-9QX2\n\nThe money is in your GBP balance.",
  },
  revolutBusiness: {
    fromAddress: "no-reply@revolut.com",
    subject: "Payment received",
    textBody: "You received €15.00 from Maeve Doyle to your Revolut Business account.",
  },
  paypalSent: {
    fromAddress: "service@paypal.com",
    subject: "Receipt for your payment to Northwind Hosting",
    textBody: "You sent a payment of €60.00 EUR to Northwind Hosting.",
  },
};

const waiting = (over: Partial<WaitingPayment>): WaitingPayment => ({
  kind: "booking", id: "b1", reference: "ME3-4F7K", customerName: "Ana Silva", customerEmail: "ana@example.invalid",
  title: "Intro session", amountCents: 6000, currency: "EUR", createdAt: "2026-11-15T10:00:00Z", saysPaidAt: null,
  remindedAt: null, bookingType: "one_to_one", startsAt: "2026-11-20T10:00:00.000Z", quantity: 1, heldUntil: null,
  ownerWarnedAt: null, needsDecision: false, needsYou: false, match: null, ...over,
});

describe("reading a payment email (synthetic examples, formats unverified)", () => {
  it("says every rule is still unverified against real provider emails", () => {
    // Flip a rule to verified only after checking it against a real email from that provider.
    expect(PAYMENT_EMAIL_RULES.map((rule) => [rule.provider, rule.verified])).toEqual([
      ["paypal", false], ["wise", false], ["revolut", false],
    ]);
  });

  it("takes the provider, amount, payer and any reference", () => {
    expect(parsePaymentEmail(SYNTHETIC.paypal)).toEqual({
      provider: "paypal", providerLabel: "PayPal", amountCents: 6000, currency: "EUR", payerName: "Ana Silva", reference: null,
    });
    expect(parsePaymentEmail(SYNTHETIC.paypalWithReference)).toMatchObject({ payerName: "A. Silva", reference: "ME3-4F7K" });
    expect(parsePaymentEmail(SYNTHETIC.wise)).toEqual({
      provider: "wise", providerLabel: "Wise", amountCents: 2500, currency: "GBP", payerName: "Tom Reilly", reference: "ME3-9QX2",
    });
    expect(parsePaymentEmail(SYNTHETIC.revolutBusiness)).toMatchObject({ provider: "revolut", amountCents: 1500, currency: "EUR", payerName: "Maeve Doyle" });
  });

  it("ignores money the owner sent, other senders, and look-alike domains", () => {
    expect(parsePaymentEmail(SYNTHETIC.paypalSent)).toBeNull();
    expect(parsePaymentEmail({ ...SYNTHETIC.paypal, fromAddress: "billing@shop.example" })).toBeNull();
    expect(parsePaymentEmail({ ...SYNTHETIC.paypal, fromAddress: "service@paypal.com.evil.example" })).toBeNull();
    expect(parsePaymentEmail({ ...SYNTHETIC.paypal, fromAddress: "service@notpaypal.com" })).toBeNull();
    expect(parsePaymentEmail({ fromAddress: "service@paypal.com", subject: "Your statement is ready", textBody: "Balance €60.00" })).toBeNull();
  });
});

describe("matching a payment email to waiting orders", () => {
  const ana = waiting({});
  const tom = waiting({ kind: "order", id: "o1", reference: "ME3-9QX2", customerName: "Tom Reilly", title: "Notebook set", amountCents: 2500, currency: "GBP", startsAt: null, bookingType: null });

  it("matches by reference where the email carries one, whatever the payer is called", () => {
    expect(matchPaymentEmail(parsePaymentEmail(SYNTHETIC.wise)!, [ana, tom])).toEqual({ by: "reference", references: ["ME3-9QX2"] });
    // The PayPal note carries the reference, so the initial-only name does not matter.
    expect(matchPaymentEmail(parsePaymentEmail(SYNTHETIC.paypalWithReference)!, [tom, ana])).toEqual({ by: "reference", references: ["ME3-4F7K"] });
  });

  it("otherwise needs the same amount and currency and a similar payer name", () => {
    const email = parsePaymentEmail(SYNTHETIC.paypal)!;
    expect(matchPaymentEmail(email, [ana, tom])).toEqual({ by: "amount_and_name", references: ["ME3-4F7K"] });
    expect(matchPaymentEmail(email, [waiting({ amountCents: 6100 })])).toBeNull();
    expect(matchPaymentEmail(email, [waiting({ currency: "USD" })])).toBeNull();
    expect(matchPaymentEmail(email, [waiting({ customerName: "Bea Okafor" })])).toBeNull();
    // No payer name in the email and no reference: nothing to go on.
    expect(matchPaymentEmail({ ...email, payerName: null }, [ana])).toBeNull();
    expect(namesAreSimilar("Ana Silva", "ana silva-costa")).toBe(true);
    expect(namesAreSimilar("José Núñez", "Jose Nunez")).toBe(true);
    expect(namesAreSimilar("Ana Silva", "Al Sims")).toBe(false);
  });

  it("returns every order that fits instead of picking one", () => {
    const sister = waiting({ id: "b2", reference: "ME3-2LM8", customerName: "Rita Silva", title: "Group class" });
    expect(matchPaymentEmail(parsePaymentEmail(SYNTHETIC.paypal)!, [ana, sister, tom])).toEqual({
      by: "amount_and_name", references: ["ME3-4F7K", "ME3-2LM8"],
    });
  });
});

// From the inbound email to the owner's Waiting list, on real SQLite with the real migrations.
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach((db) => db.close()); vi.restoreAllMocks(); });

function fixture() {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  const migration = (name: string) => raw.exec(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8"));
  ["0001_initial_public_schema", "0011_financial_entry_projects", "0017_site_pages_and_commerce", "0021_managed_email_inbound_deliveries",
    "0033_manual_payments", "0037_event_booking_capacity", "0048_mailbox_attachment_staging", "0053_booking_meeting"].forEach(migration);
  // The financial_entries part of 0050_accounts_customer_payments (the rest of it needs campaign tables).
  for (const column of ["gross_amount_cents INTEGER", "refunded_amount_cents INTEGER NOT NULL DEFAULT 0", "customer_name TEXT",
    "customer_email TEXT", "payment_intent_id TEXT", "site_id TEXT", "item_ref TEXT", "item_title TEXT"]) {
    raw.exec(`ALTER TABLE financial_entries ADD COLUMN ${column}`);
  }
  raw.exec("ALTER TABLE mailbox_messages ADD COLUMN spam_at TEXT");
  for (const sql of [...ACCOUNTS_EMAIL_TRIAGE_SCHEMA, ...ACCOUNTS_REMOVALS_SCHEMA, ...MAIL_TRIAGE_SCHEMA, ...PAY_DIRECTLY_SCHEMA,
    ...PAY_PAGE_SCHEMA, ...PAY_DIRECTLY_HOLDS_SCHEMA, ...PAY_DIRECTLY_MATCH_SCHEMA]) raw.exec(sql);
  ["0103_mailbox_canonical_thread_key", "0105_mailbox_conversations"].forEach(migration);
  raw.exec(`INSERT INTO owner_profile(id, name, email) VALUES('owner', 'Clara Byrne', 'clara@example.invalid');
    INSERT INTO mailbox_aliases(id,user_id,alias_local_part,forwarding_email,status) VALUES('mailbox','owner','owner','','active');
    INSERT INTO plugin_installations(plugin_id,version,enabled,status) VALUES('me3.accounts','0.1.0',1,'installed');
    INSERT INTO sites(id, user_id, username) VALUES('site', 'owner', 'clara');`);
  const prepare = (sql: string) => {
    const query = raw.prepare(sql); let values: unknown[] = [];
    const statement = { bind(...args: unknown[]) { values = args; return statement; },
      async first() { return query.get(...values as never[]) ?? null; },
      async all() { return { results: query.all(...values as never[]) }; },
      async run() { return { meta: { changes: Number(query.run(...values as never[]).changes) } }; },
    }; return statement;
  };
  const env = { ME3_MAIL_AVATARS: "off", DB: { prepare, async batch(statements: ReturnType<typeof prepare>[]) { for (const statement of statements) await statement.run(); } } } as unknown as Env;
  vi.spyOn(console, "error").mockImplementation(() => {});
  const hold = (id: string, reference: string, guest: string, amount = 6000, currency = "eur") => {
    raw.prepare(`INSERT INTO bookings (id, site_id, offer_id, booking_type, guest_name, guest_email, starts_at, ends_at, duration_minutes,
        status, suggested_amount, currency, payment_status, is_free_booking, meeting_title)
      VALUES (?, 'site', 'intro', 'one_to_one', ?, ?, '2099-01-05T10:00:00.000Z', '2099-01-05T11:00:00.000Z', 60, 'confirmed', ?, ?, 'pending', 0, 'Intro session')`)
      .run(id, guest, `${id}@example.invalid`, amount, currency);
    raw.prepare("INSERT INTO commerce_direct_payments (reference, user_id, booking_id) VALUES (?, 'owner', ?)").run(reference, id);
  };
  const entries = () => raw.prepare("SELECT amount_cents, currency, source, source_ref, status FROM financial_entries").all();
  return { raw, env, hold, entries };
}

let delivered = 0;
function mail(input: { fromAddress: string; subject: string; textBody: string }): ForwardableEmailMessageLike {
  delivered += 1;
  const bytes = new TextEncoder().encode([
    `From: ${input.fromAddress}`, "To: owner@me3.test", `Subject: ${input.subject}`, `Message-ID: <synthetic-${delivered}@example.test>`,
    "Content-Type: text/plain; charset=utf-8", "", input.textBody,
  ].join("\r\n"));
  return { from: input.fromAddress, to: "owner@me3.test", rawSize: bytes.length, headers: new Headers(),
    raw: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
    canBeForwarded: false, forward: vi.fn(), setReject: vi.fn(),
  };
}

describe("a payment email arriving in the owner's ME3 mailbox (synthetic emails)", () => {
  it("becomes a match on the right waiting booking, marks nothing paid, and is not filed as income", async () => {
    const f = fixture();
    f.hold("b1", "ME3-4F7K", "Ana Silva");
    f.hold("b2", "ME3-9QX2", "Tom Reilly", 2500, "gbp");
    await deliverInboundEmail(mail(SYNTHETIC.paypal), f.env);

    const { waiting: list } = await listWaitingPayments(f.env, "owner");
    const ana = list.find((item) => item.reference === "ME3-4F7K")!;
    expect(ana.match).toMatchObject({
      provider: "paypal", providerLabel: "PayPal", amountCents: 6000, currency: "EUR", payerName: "Ana Silva",
      subject: "You've got money", by: "amount_and_name", alsoFits: [],
    });
    expect(ana.needsYou).toBe(true);
    expect(list.find((item) => item.reference === "ME3-9QX2")!.match).toBeNull();
    // Never auto-confirmed, and not counted as income from the email.
    expect(f.raw.prepare("SELECT payment_status, amount_paid FROM bookings WHERE id = 'b1'").get()).toEqual({ payment_status: "pending", amount_paid: null });
    expect(f.entries()).toEqual([]);
  });

  it("records the income once when the owner confirms: from the booking, not from the email as well", async () => {
    const f = fixture();
    f.hold("b2", "ME3-9QX2", "Tom Reilly", 2500, "gbp");
    await deliverInboundEmail(mail(SYNTHETIC.wise), f.env);
    expect((await listWaitingPayments(f.env, "owner")).waiting[0].match).toMatchObject({ provider: "wise", by: "reference" });

    await confirmWaiting(f.env, "owner", "ME3-9QX2");
    await confirmWaiting(f.env, "owner", "ME3-9QX2").catch(() => undefined);
    expect(f.raw.prepare("SELECT payment_status, amount_paid FROM bookings WHERE id = 'b2'").get()).toEqual({ payment_status: "succeeded", amount_paid: 2500 });
    await syncWebsiteIncomeEntries(f.env, "owner");
    await syncWebsiteIncomeEntries(f.env, "owner");
    expect(f.entries()).toEqual([{ amount_cents: 2500, currency: "GBP", source: "manual", source_ref: "website:booking:b2", status: "paid" }]);
    expect((await listWaitingPayments(f.env, "owner")).waiting).toEqual([]);
  });

  it("asks the owner which booking when the email fits two, and clears the other once one is confirmed", async () => {
    const f = fixture();
    f.hold("b1", "ME3-4F7K", "Ana Silva");
    f.hold("b3", "ME3-2LM8", "Rita Silva");
    await deliverInboundEmail(mail(SYNTHETIC.paypal), f.env);
    const both = (await listWaitingPayments(f.env, "owner")).waiting;
    expect(both.map((item) => [item.reference, item.match?.alsoFits])).toEqual([["ME3-4F7K", ["ME3-2LM8"]], ["ME3-2LM8", ["ME3-4F7K"]]]);
    expect(f.raw.prepare("SELECT COUNT(*) AS paid FROM bookings WHERE payment_status = 'succeeded'").get()).toEqual({ paid: 0 });

    await confirmWaiting(f.env, "owner", "ME3-2LM8");
    const left = (await listWaitingPayments(f.env, "owner")).waiting;
    expect(left.map((item) => [item.reference, item.match])).toEqual([["ME3-4F7K", null]]);
  });

  it("puts a match away on Not yet and leaves the booking waiting", async () => {
    const f = fixture();
    f.hold("b1", "ME3-4F7K", "Ana Silva");
    await deliverInboundEmail(mail(SYNTHETIC.paypal), f.env);
    await dismissWaitingMatch(f.env, "owner", "ME3-4F7K");
    const [item] = (await listWaitingPayments(f.env, "owner")).waiting;
    expect(item).toMatchObject({ reference: "ME3-4F7K", match: null });
    expect(f.raw.prepare("SELECT status, payment_status FROM bookings WHERE id = 'b1'").get()).toEqual({ status: "confirmed", payment_status: "pending" });
    expect(f.entries()).toEqual([]);
  });

  it("still files a payment email that fits no waiting order as income, as before", async () => {
    const f = fixture();
    f.hold("b1", "ME3-4F7K", "Ana Silva");
    await deliverInboundEmail(mail({ fromAddress: "service@paypal.com", subject: "Payment received", textBody: "You received a payment of €85.00 EUR from Bea Okafor. Payment received. Thank you for your payment." }), f.env);
    expect((await listWaitingPayments(f.env, "owner")).waiting[0].match).toBeNull();
    expect(f.entries()).toEqual([expect.objectContaining({ amount_cents: 8500, currency: "EUR", source: "email_triage" })]);
  });
});
