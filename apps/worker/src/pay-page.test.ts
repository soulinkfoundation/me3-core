import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SentEmail = { toAddress: string; subject: string; textBody: string; htmlBody: string };
const { emails } = vi.hoisted(() => ({ emails: [] as SentEmail[] }));

vi.mock("./email-providers", () => ({
  EmailProviderDeliveryUnknownError: class extends Error {},
  sendEmailWithProvider: vi.fn(async (_env: unknown, _ownerId: string, input: SentEmail) => {
    emails.push(input);
    return { providerMessageId: `message-${emails.length}` };
  }),
}));
vi.mock("./booking-meetings", () => ({
  BookingMeetingError: class extends Error {},
  validExternalMeetingUrl: () => null,
  resolveBookingMeeting: vi.fn(async () => ({
    provider: "soulink", guestUrl: "https://soulink.example/join/guest-link",
    hostUrl: "https://soulink.example/host/host-link", guestTokenHash: "hash",
  })),
}));
vi.mock("./booking-reminders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./booking-reminders")>()),
  scheduleBookingRemindersForBooking: vi.fn(async () => 0),
  cancelPendingBookingReminders: vi.fn(async () => undefined),
}));
vi.mock("./payment-notifications", () => ({
  dispatchWebsitePaymentNotification: vi.fn(async () => ({ outcome: "sent" })),
}));

import type { CoreBookIntent } from "./booking";
import { cancelOwnerBooking } from "./booking-changes";
import { createConfirmedEventBooking, resolveEventBookingOffer, resolveEventOccurrence } from "./event-booking";
import type { AppBindings } from "./http/types";
import { PAY_DIRECTLY_HOLDS_SCHEMA, PAY_DIRECTLY_SCHEMA, PAY_PAGE_SCHEMA, prepareDirectPayment } from "./pay-directly";
import { listWaitingPayments, markBookingPaid } from "./pay-directly-bookings";
import { registerBookingRoutes } from "./routes/booking";
import { registerEventBookingRoutes } from "./routes/event-booking";
import { listAgentOfferings } from "./agent-commerce";
import { resolvePaidOneToOneOffer, serializePublicBookingOffer, resolveOneToOneBookingOffer } from "./booking";
import { registerPayRoutes } from "./routes/pay";
import type { DbSite, Env } from "./types";

// Failure modes this file guards:
// - the pay page or its data can be reached without the order's own link, or by guessing from a reference;
// - bank details leak into a public booking response or the payment email instead of staying behind the link;
// - the page shows the wrong amount, reference or methods, or offers a bank account in another currency;
// - a QR code appears for a UK account or a non-euro order, or is missing for a euro IBAN order;
// - wording claims a link carries the reference when it does not (PayPal, Revolut);
// - "I've paid" never reaches the owner's Waiting list, can be replayed without limit, or works on a paid order;
// - payment details stay visible after the order is paid or cancelled.

const IBAN = "IE29AIBK93115212345678";
const site: DbSite = {
  id: "site-1", user_id: "owner", username: "kieran", site_type: "profile", site_role: "profile",
  template_id: null, custom_domain: null, custom_domain_status: null, custom_domain_cf_id: null,
  created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", published_at: "2026-11-01T10:00:00Z",
};

const bookIntent = {
  enabled: true,
  bookingTypes: [
    {
      type: "one_to_one",
      availability: { timezone: "UTC", windows: { monday: ["09:00-17:00"] } },
      offers: [{
        id: "strategy", title: "Strategy call", duration: 60,
        pricing: { enabled: true, suggestedAmount: 60, currency: "EUR", paymentMethod: "manual", paymentInstructions: "Cash on the day is fine too." },
      }, {
        // "Let them choose": a card offer whose buyer may pay directly instead.
        id: "choice", title: "Coaching hour", duration: 60,
        pricing: { enabled: true, suggestedAmount: 90, currency: "EUR", paymentMethod: "stripe", allowPayDirectly: true },
      }, {
        id: "card", title: "Card only", duration: 60,
        pricing: { enabled: true, suggestedAmount: 90, currency: "EUR", paymentMethod: "stripe" },
      }],
    },
    {
      type: "class",
      classes: [{
        id: "movement", title: "Movement class", duration: 60, timezone: "UTC", capacity: 10,
        recurrence: { frequency: "weekly", weekday: "monday", startTime: "18:00", startDate: "2099-01-05" },
        pricing: { enabled: true, suggestedAmount: 20, currency: "EUR", paymentMethod: "manual" },
      }, {
        id: "workshop", title: "Workshop", duration: 60, timezone: "UTC", capacity: 10,
        recurrence: { frequency: "weekly", weekday: "monday", startTime: "12:00", startDate: "2099-01-05" },
        pricing: { enabled: true, suggestedAmount: 30, currency: "EUR", paymentMethod: "stripe", allowPayDirectly: true },
      }],
    },
  ],
} as unknown as CoreBookIntent;

class SqliteD1 {
  raw = new DatabaseSync(":memory:");
  constructor() {
    this.raw.exec(`
      CREATE TABLE owner_profile (id TEXT PRIMARY KEY, name TEXT, email TEXT, timezone TEXT);
      INSERT INTO owner_profile VALUES ('owner', 'Kieran Butler', 'kieran@example.invalid', 'UTC');
      CREATE TABLE sites (id TEXT PRIMARY KEY, user_id TEXT, username TEXT, site_type TEXT, site_role TEXT, template_id TEXT,
        custom_domain TEXT, custom_domain_status TEXT, custom_domain_cf_id TEXT, created_at TEXT, updated_at TEXT, published_at TEXT);
      INSERT INTO sites (id, user_id, username, site_role, published_at) VALUES ('site-1', 'owner', 'kieran', 'profile', '2026-11-01');
      CREATE TABLE site_files (site_id TEXT, path TEXT, content BLOB, content_type TEXT, size INTEGER, sha256 TEXT, updated_at TEXT);
      CREATE TABLE bookings (
        id TEXT PRIMARY KEY, site_id TEXT NOT NULL, offer_id TEXT, booking_type TEXT,
        guest_name TEXT NOT NULL, guest_email TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL, calendar_event_id TEXT, status TEXT NOT NULL DEFAULT 'confirmed',
        notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, cancelled_at TEXT,
        payment_intent_id TEXT, amount_paid INTEGER, suggested_amount INTEGER, currency TEXT,
        payment_status TEXT DEFAULT 'not_required', is_free_booking INTEGER NOT NULL DEFAULT 0, paid_at TEXT,
        page_id TEXT, action_id TEXT, campaign TEXT, quantity INTEGER NOT NULL DEFAULT 1, meeting_provider TEXT,
        meeting_url TEXT, meeting_host_url TEXT, meeting_guest_token_hash TEXT, meeting_title TEXT
      );
      CREATE TABLE booking_holds (
        id TEXT PRIMARY KEY, site_id TEXT NOT NULL, booking_id TEXT, offer_id TEXT, booking_type TEXT NOT NULL,
        hold_token TEXT UNIQUE, slot_start TEXT NOT NULL, slot_end TEXT NOT NULL, status TEXT NOT NULL,
        expires_at TEXT NOT NULL, created_at TEXT, updated_at TEXT, quantity INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE booking_reminders (id TEXT, booking_id TEXT, status TEXT);
      CREATE TABLE commerce_orders (
        id TEXT PRIMARY KEY, site_id TEXT NOT NULL, product_slug TEXT NOT NULL, product_title TEXT NOT NULL,
        buyer_name TEXT NOT NULL, buyer_email TEXT NOT NULL, amount_paid INTEGER, amount_due INTEGER, currency TEXT,
        status TEXT NOT NULL DEFAULT 'pending', payment_method TEXT NOT NULL DEFAULT 'stripe', payment_intent_id TEXT,
        paid_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT
      );
      CREATE TABLE agent_commerce_rate_limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, request_count INTEGER NOT NULL);
    `);
    for (const sql of [...PAY_DIRECTLY_SCHEMA, ...PAY_PAGE_SCHEMA, ...PAY_DIRECTLY_HOLDS_SCHEMA.filter((sql) => sql.includes("commerce_direct_payments"))]) this.raw.exec(sql);
    this.raw.prepare("INSERT INTO site_files (site_id, path, content) VALUES ('site-1', 'src/me.json', ?)")
      .run(Buffer.from(JSON.stringify({ name: "Kieran Butler", intents: { book: bookIntent } })));
    this.raw.exec(`INSERT INTO commerce_payment_methods (id, user_id, kind, link, account_name, iban, bic, sort_code, account_number, currency, enabled, sort_order) VALUES
      ('m-paypal', 'owner', 'paypal', 'https://paypal.me/kieran', NULL, NULL, NULL, NULL, NULL, NULL, 1, 0),
      ('m-revolut', 'owner', 'revolut', 'https://revolut.me/kieran', NULL, NULL, NULL, NULL, NULL, NULL, 1, 1),
      ('m-wise', 'owner', 'wise', 'https://wise.com/pay/business/kieranltd', NULL, NULL, NULL, NULL, NULL, NULL, 1, 2),
      ('m-eur', 'owner', 'bank', NULL, 'Kieran Butler', '${IBAN}', 'AIBKIE2D', NULL, NULL, 'EUR', 1, 3),
      ('m-gbp', 'owner', 'bank', NULL, 'Kieran Butler', NULL, NULL, '401234', '12345678', 'GBP', 1, 4)`);
  }
  prepare(sql: string) {
    const statement = this.raw.prepare(sql);
    let values: unknown[] = [];
    const wrapper = {
      bind: (...next: unknown[]) => { values = next; return wrapper; },
      run: async () => ({ meta: { changes: Number(statement.run(...(values as never[])).changes) } }),
      first: async <T>() => (statement.get(...(values as never[])) || null) as T | null,
      all: async <T>() => ({ results: statement.all(...(values as never[])) as T[] }),
    };
    return wrapper;
  }
  async batch(statements: Array<{ run(): Promise<unknown> }>) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

let database: SqliteD1;
let env: Env;
let app: Hono<AppBindings>;

const call = (path: string, init?: RequestInit) => app.fetch(new Request(`https://kieran.example${path}`, init), env);
const details = async (payPath: string) => (await (await call(`${payPath}/details`)).json()) as { ok: boolean; payment: Record<string, any> };

async function bookCall(): Promise<{ payUrl: string; body: Record<string, any>; raw: string }> {
  const response = await call("/api/book/kieran/free", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offerId: "strategy", localDate: "2099-01-05", localTime: "10:00", guestName: "Ada Lovelace", guestEmail: "ada@example.invalid" }),
  });
  const raw = await response.text();
  expect(response.status, raw).toBe(200);
  const body = JSON.parse(raw);
  return { payUrl: body.payUrl, body, raw };
}

async function addOrder(id: string, currency: string, amount: number, note = "") {
  database.raw.prepare(`INSERT INTO commerce_orders (id, site_id, product_slug, product_title, buyer_name, buyer_email, amount_due, currency, status, payment_method)
    VALUES (?, 'site-1', 'print', 'Signed print', 'Flo Reyes', 'flo@example.invalid', ?, ?, 'pending', 'manual')`).run(id, amount, currency);
  return prepareDirectPayment(env, "owner", { orderId: id, siteId: "site-1", amountMinor: amount, currency, note });
}

beforeEach(() => {
  database = new SqliteD1();
  env = { DB: database as unknown as D1Database, CORE_WEB_ORIGIN: "https://kieran.example" } as Env;
  app = new Hono<AppBindings>();
  registerBookingRoutes(app, { requireOwner: async () => null, unauthorized: (c: any) => c.json({ error: "Unauthorized" }, 401) } as never);
  registerPayRoutes(app);
  registerEventBookingRoutes(app);
  emails.length = 0;
});

describe("the buyer's journey on a published site", () => {
  it("books a pay-directly call, lands on the pay page, says paid, and shows in the owner's Waiting list", async () => {
    const { payUrl, body, raw } = await bookCall();
    expect(body.booking).toMatchObject({ paymentStatus: "pending", amountDue: 6000 });
    expect(payUrl).toMatch(/^\/api\/pay\/[A-Za-z0-9_-]{40,}$/);
    // Bank details stay behind the order's own link.
    expect(raw).not.toContain(IBAN);
    expect(raw).not.toContain("paypal.me");

    const reference = (database.raw.prepare("SELECT reference FROM commerce_direct_payments").get() as { reference: string }).reference;
    const page = await call(payUrl);
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toContain("text/html");
    expect(page.headers.get("Cache-Control")).toBe("no-store");
    expect(page.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(page.headers.get("X-Robots-Tag")).toContain("noindex");
    const html = await page.text();
    expect(html).toContain("Pay Kieran directly");
    expect(html).toContain("Strategy call");
    expect(html).toContain("€60.00");
    expect(html).toContain(reference);
    expect(html).toContain("https://paypal.me/kieran/60EUR");
    expect(html).toContain("Opens PayPal with €60.00 filled in");
    expect(html).toContain("https://revolut.me/kieran");
    expect(html).toContain("Opens Revolut. Enter €60.00 and add the reference");
    expect(html).toContain("Opens Wise with €60.00 and the reference filled in");
    expect(html).toContain("IE29 AIBK 9311 5212 3456 78");
    expect(html).toContain("<svg");
    expect(html).toContain("Cash on the day is fine too.");
    expect(html).toContain("I’ve paid");
    // Five days by default, but a booking is always released before it starts.
    expect(html).toMatch(/Held until <time datetime="\d{4}-/);
    // Never claim the reference travels in every link.
    expect(html).not.toMatch(/reference (is|travels) in (every|each|all)/i);
    // The UK account is not offered for a euro booking.
    expect(html).not.toContain("40-12-34");

    const paid = await call(`${payUrl}/paid`, { method: "POST" });
    expect(paid.status).toBe(303);
    expect(paid.headers.get("Location")).toBe(payUrl);
    const thanks = await (await call(payUrl)).text();
    expect(thanks).toContain("Thanks, Ada");
    expect(thanks).toContain("Waiting for Kieran");
    expect(thanks).toContain("€60.00");
    expect(thanks).toContain(reference);
    expect(thanks).toContain("Strategy call");

    const { waiting } = await listWaitingPayments(env, "owner");
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ kind: "booking", reference });
    expect(waiting[0].saysPaidAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("emails the pay page link with the amount and reference instead of the payment options", async () => {
    const { payUrl } = await bookCall();
    const guest = emails.find((email) => email.toAddress === "ada@example.invalid")!;
    const reference = (database.raw.prepare("SELECT reference FROM commerce_direct_payments").get() as { reference: string }).reference;
    expect(guest.subject).toBe("Payment details: Strategy call");
    expect(guest.textBody).toContain(`https://kieran.example${payUrl}`);
    expect(guest.textBody).toContain("Amount due: €60.00");
    expect(guest.textBody).toContain(reference);
    expect(guest.textBody).toContain("Cash on the day is fine too.");
    expect(`${guest.textBody}${guest.htmlBody}`).not.toContain("paypal.me");
    expect(`${guest.textBody}${guest.htmlBody}`).not.toContain(IBAN);
    const owner = emails.find((email) => email.toAddress === "kieran@example.invalid")!;
    expect(`${owner.textBody}${owner.htmlBody}`).not.toContain(payUrl);
  });
});

describe("reaching the pay page", () => {
  it("needs the order's own link: a wrong token, the reference or the booking id show nothing", async () => {
    const { payUrl, body } = await bookCall();
    const reference = (database.raw.prepare("SELECT reference FROM commerce_direct_payments").get() as { reference: string }).reference;
    for (const guess of ["nope", reference, body.booking.id, `${payUrl.split("/").pop()}x`]) {
      for (const path of [`/api/pay/${guess}`, `/api/pay/${guess}/details`]) {
        const response = await call(path);
        const text = await response.text();
        expect(response.status, path).toBe(404);
        expect(text).not.toContain(IBAN);
        expect(text).not.toContain("paypal.me");
      }
      expect((await call(`/api/pay/${guess}/paid`, { method: "POST" })).status).toBe(404);
    }
    expect(database.raw.prepare("SELECT says_paid_at FROM commerce_direct_payments").get()).toEqual({ says_paid_at: null });
  });

  it("limits how often I've paid can be sent from one address", async () => {
    const { payUrl } = await bookCall();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      statuses.push((await call(`${payUrl}/paid`, { method: "POST", headers: { "CF-Connecting-IP": "203.0.113.9" } })).status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 303)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    // The first tap is the one recorded.
    const first = database.raw.prepare("SELECT says_paid_at FROM commerce_direct_payments").get() as { says_paid_at: string };
    expect(first.says_paid_at).toBeTruthy();
  });

  it("stops showing payment details once the booking is paid or cancelled", async () => {
    const paidCall = await bookCall();
    await markBookingPaid(env, "owner", paidCall.body.booking.id);
    const paid = await details(paidCall.payUrl);
    expect(paid.payment).toMatchObject({ status: "paid", options: [], note: null });
    const paidHtml = await (await call(paidCall.payUrl)).text();
    expect(paidHtml).not.toContain("paypal.me");
    expect(paidHtml).not.toContain("IE29");
    await call(`${paidCall.payUrl}/paid`, { method: "POST" });
    expect(database.raw.prepare("SELECT says_paid_at FROM commerce_direct_payments WHERE booking_id = ?").get(paidCall.body.booking.id)).toEqual({ says_paid_at: null });

    const lesson = await bookClass(1);
    await cancelOwnerBooking(env, "owner", lesson.bookingId);
    expect((await details(lesson.payPath)).payment).toMatchObject({ status: "cancelled", options: [] });
    await call(`${lesson.payPath}/paid`, { method: "POST" });
    expect(database.raw.prepare("SELECT says_paid_at FROM commerce_direct_payments WHERE booking_id = ?").get(lesson.bookingId)).toEqual({ says_paid_at: null });
  });
});

async function bookClass(quantity: number) {
  const offer = resolveEventBookingOffer(bookIntent, "class", "movement")!;
  const booking = (await createConfirmedEventBooking(env, {
    site, bookIntent, offer, occurrence: resolveEventOccurrence(offer, "2099-01-05")!, quantity,
    guestName: "Ben Okri", guestEmail: "ben@example.invalid", notes: "", amountDuePerAttendeeCents: 2000, paymentCurrency: "eur",
  }))!;
  const token = (database.raw.prepare("SELECT pay_token FROM commerce_direct_payments WHERE booking_id = ?").get(booking.id) as { pay_token: string }).pay_token;
  return { bookingId: booking.id, payPath: `/api/pay/${token}` };
}

describe("what the pay page offers", () => {
  it("gives a euro IBAN order every method, with a scannable EPC QR that carries the amount and reference", async () => {
    const { payUrl } = await bookCall();
    const { payment } = await details(payUrl);
    expect(payment).toMatchObject({
      kind: "booking", status: "waiting", payeeName: "Kieran Butler", payeeFirstName: "Kieran", buyerFirstName: "Ada",
      title: "Strategy call", startsAt: "2099-01-05T10:00:00.000Z", quantity: 1, amountCents: 6000, currency: "EUR",
      note: "Cash on the day is fine too.", saysPaidAt: null,
    });
    expect(payment.options.map((option: any) => [option.kind, option.carriesAmount, option.carriesReference])).toEqual([
      ["paypal", true, false], ["revolut", false, false], ["wise", true, true], ["bank", true, true],
    ]);
    const bank = payment.options[3];
    expect(bank.bank).toMatchObject({ accountName: "Kieran Butler", iban: IBAN, bic: "AIBKIE2D", sortCode: null });
    expect(bank.epcQrPayload.split("\n")).toEqual([
      "BCD", "002", "1", "SCT", "AIBKIE2D", "Kieran Butler", IBAN, "EUR60.00", "", "", payment.reference,
    ]);
    // A real QR: square, with the three finder patterns' worth of modules, drawn as an SVG.
    expect(bank.epcQrSvg).toMatch(/^<svg[^>]+viewBox="0 0 (\d+) \1"/);
    expect(bank.epcQrSvg).toContain("<path");
    expect(payment.options.slice(0, 3).every((option: any) => option.epcQrSvg === null && option.bank === null)).toBe(true);
  });

  it("totals a class across attendees", async () => {
    const lesson = await bookClass(3);
    const { payment } = await details(lesson.payPath);
    expect(payment).toMatchObject({ kind: "event", title: "Movement class", quantity: 3, amountCents: 6000, currency: "EUR", note: null });
    expect(await (await call(lesson.payPath)).text()).toContain("3 places");
  });

  it("shows a UK account as sort code and account number with no QR", async () => {
    const order = await addOrder("order-gbp", "gbp", 2500);
    const { payment } = await details(order.payPath);
    expect(payment).toMatchObject({ kind: "order", title: "Signed print", amountCents: 2500, currency: "GBP", buyerFirstName: "Flo", startsAt: null });
    const bank = payment.options.find((option: any) => option.kind === "bank");
    expect(bank).toMatchObject({ epcQrPayload: null, epcQrSvg: null, carriesAmount: false, carriesReference: false });
    expect(bank.bank).toMatchObject({ sortCode: "401234", accountNumber: "12345678", iban: null });
    const html = await (await call(order.payPath)).text();
    expect(html).toContain("40-12-34");
    expect(html).toContain("12345678");
    expect(html).toContain("£25.00");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("IE29");
  });

  it("offers no bank account or QR for a dollar order", async () => {
    const order = await addOrder("order-usd", "usd", 4000);
    const { payment } = await details(order.payPath);
    expect(payment.options.map((option: any) => option.kind)).toEqual(["paypal", "revolut", "wise"]);
    const html = await (await call(order.payPath)).text();
    expect(html).toContain("https://paypal.me/kieran/40USD");
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("IE29");
  });

  it("shows the note and says the owner will be in touch when no saved method fits", async () => {
    database.raw.exec("UPDATE commerce_payment_methods SET enabled = 0");
    const order = await addOrder("order-note", "usd", 4000, "Pay me in person at the market.");
    // The email keeps the owner's note first, as it did before saved methods.
    expect(order.instructions.startsWith("Pay me in person at the market.")).toBe(true);
    const { payment } = await details(order.payPath);
    expect(payment).toMatchObject({ options: [], note: "Pay me in person at the market." });
    const html = await (await call(order.payPath)).text();
    expect(html).toContain("Pay me in person at the market.");
    expect(html).toContain("Kieran will be in touch about how to pay");
  });
});

// Failure modes: a "let them choose" offer cannot be paid directly, or can no longer be paid by card;
// a card-only offer can be booked without paying by sending payDirectly; an agent is offered
// (or can use) the pay-directly side; the flag changes what a pay-directly or free offer does.
describe("an offer that lets the buyer choose how to pay", () => {
  const book = (body: Record<string, unknown>) => call("/api/book/kieran/free", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ localDate: "2099-01-05", localTime: "14:00", guestName: "Ada Lovelace", guestEmail: "ada@example.invalid", ...body }),
  });

  it("holds the booking with a pay page when the buyer chooses to pay directly", async () => {
    const response = await book({ offerId: "choice", payDirectly: true });
    const body = (await response.json()) as Record<string, any>;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.booking).toMatchObject({ paymentStatus: "pending", amountDue: 9000 });
    expect((await details(body.payUrl)).payment).toMatchObject({ status: "waiting", title: "Coaching hour", amountCents: 9000 });
    expect(emails.find((email) => email.toAddress === "ada@example.invalid")!.subject).toBe("Payment details: Coaching hour");
  });

  it("still sends a buyer who does not choose that to card checkout", async () => {
    for (const body of [{ offerId: "choice" }, { offerId: "choice", payDirectly: false }, { offerId: "choice", payDirectly: "true" }]) {
      const response = await book(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Use checkout for paid booking offers" });
    }
    expect(database.raw.prepare("SELECT COUNT(*) AS count FROM bookings").get()).toEqual({ count: 0 });
    // The card route still takes it: it is a card offer.
    expect(resolvePaidOneToOneOffer(bookIntent, "choice")).toMatchObject({ id: "choice" });
    expect(resolvePaidOneToOneOffer(bookIntent, "strategy")).toBeNull();
  });

  it("does not let payDirectly skip payment on a card-only offer", async () => {
    const response = await book({ offerId: "card", payDirectly: true });
    expect(response.status).toBe(400);
    expect(database.raw.prepare("SELECT COUNT(*) AS count FROM bookings").get()).toEqual({ count: 0 });
  });

  it("tells the published site which offers show the chooser", () => {
    const pricing = (id: string) => serializePublicBookingOffer(resolveOneToOneBookingOffer(bookIntent, id)!).pricing;
    expect(pricing("choice")).toMatchObject({ paymentMethod: "stripe", allowPayDirectly: true });
    expect(pricing("card")).not.toHaveProperty("allowPayDirectly");
    expect(pricing("strategy")).not.toHaveProperty("allowPayDirectly");
  });

  it("holds a class the same way, and asks for checkout otherwise", async () => {
    const register = (body: Record<string, unknown>) => call("/api/book/kieran/events/class/workshop/register", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ localDate: "2099-01-05", quantity: 2, guestName: "Ben Okri", guestEmail: "ben@example.invalid", ...body }),
    });
    expect((await register({})).status).toBe(402);
    const response = await register({ payDirectly: true });
    const body = (await response.json()) as Record<string, any>;
    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(database.raw.prepare("SELECT payment_status, quantity, suggested_amount FROM bookings").get()).toEqual({ payment_status: "pending", quantity: 2, suggested_amount: 6000 });
    expect((await details(body.payUrl)).payment).toMatchObject({ kind: "event", amountCents: 6000 });
  });

  it("is a card-only offer to buying agents, who never see the pay-directly one", () => {
    const offerings = listAgentOfferings({ name: "Kieran", intents: { book: bookIntent } } as never, "EUR");
    const ids = offerings.map((entry) => entry.offering.id).join(" ");
    expect(ids).toContain("choice");
    expect(ids).toContain("workshop");
    expect(ids).not.toContain("strategy");
    expect(offerings.find((entry) => entry.offering.id.includes("choice"))!.offering).toMatchObject({ amount: 9000, free: false });
  });
});
