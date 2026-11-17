import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

type SentEmail = { toAddress: string; subject: string; textBody: string; htmlBody: string };
const { emails, scheduleReminders, cancelReminders } = vi.hoisted(() => ({
  emails: [] as SentEmail[],
  scheduleReminders: vi.fn(async () => 2),
  cancelReminders: vi.fn(async () => undefined),
}));

vi.mock("./email-providers", () => ({
  EmailProviderDeliveryUnknownError: class extends Error {},
  sendEmailWithProvider: vi.fn(async (_env: unknown, _ownerId: string, input: SentEmail) => {
    emails.push(input);
    return { providerMessageId: `message-${emails.length}` };
  }),
}));
vi.mock("./booking-meetings", () => ({
  BookingMeetingError: class extends Error {},
  resolveBookingMeeting: vi.fn(async () => ({
    provider: "soulink",
    guestUrl: "https://soulink.example/join/guest-link",
    hostUrl: "https://soulink.example/host/host-link",
    guestTokenHash: "hash",
  })),
}));
vi.mock("./booking-reminders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./booking-reminders")>()),
  scheduleBookingRemindersForBooking: scheduleReminders,
  cancelPendingBookingReminders: cancelReminders,
}));
vi.mock("./payment-notifications", () => ({
  dispatchWebsitePaymentNotification: vi.fn(async () => ({ outcome: "sent" })),
}));

import { syncWebsiteIncomeEntries } from "./accounts";
import { resolveOneToOneBookingOffer, serializeBooking, type CoreBookIntent } from "./booking";
import { cancelOwnerBooking } from "./booking-changes";
import { bookFreeOneToOne, finalizePaidBookingCheckout } from "./booking-checkout";
import { createConfirmedEventBooking, resolveEventBookingOffer, resolveEventOccurrence } from "./event-booking";
import { PAY_DIRECTLY_HOLDS_SCHEMA, PAY_DIRECTLY_MATCH_SCHEMA, PAY_DIRECTLY_SCHEMA, PAY_PAGE_SCHEMA } from "./pay-directly";
import { listWaitingPayments, markBookingPaid } from "./pay-directly-bookings";
import type { DbBooking, DbSite, Env } from "./types";

// Failure modes this file guards:
// - a pay-directly booking is announced as booked (email, meeting link, reminders) before the owner is paid;
// - a held booking stops blocking its slot or its class seats;
// - marking paid sends the booked email twice, records the income twice, or takes the wrong amount
//   (per attendee instead of the total, or the listed price instead of the amount the buyer chose);
// - Waiting misses an order, booking or event, or still lists something paid or cancelled;
// - cancelling a held booking leaves the slot blocked, or a paid one is cancelled without the refund warning;
// - free and card (Stripe) bookings change.

const site: DbSite = {
  id: "site-1", user_id: "owner", username: "kieran", site_type: "profile", site_role: "profile",
  template_id: null, custom_domain: null, custom_domain_status: null, custom_domain_cf_id: null,
  created_at: "2026-11-01T10:00:00Z", updated_at: "2026-11-01T10:00:00Z", published_at: "2026-11-01T10:00:00Z",
};

const bookIntent = {
  enabled: true,
  reminders: { enabled: true },
  bookingTypes: [
    {
      type: "one_to_one",
      availability: { timezone: "UTC", windows: { monday: ["09:00-17:00"] } },
      offers: [
        {
          id: "strategy", title: "Strategy call", duration: 60, meetingProvider: "soulink",
          pricing: { enabled: true, suggestedAmount: 60, currency: "EUR", paymentMethod: "manual", paymentInstructions: "Thank you!" },
        },
        { id: "intro", title: "Intro call", duration: 60, meetingProvider: "soulink" },
        {
          id: "card", title: "Card call", duration: 60, meetingProvider: "soulink",
          pricing: { enabled: true, suggestedAmount: 80, currency: "EUR", paymentMethod: "stripe" },
        },
      ],
    },
    {
      type: "class",
      classes: [
        {
          id: "movement", title: "Movement class", duration: 60, timezone: "UTC", capacity: 3,
          recurrence: { frequency: "weekly", weekday: "monday", startTime: "18:00", startDate: "2099-01-05" },
          pricing: { enabled: true, suggestedAmount: 20, currency: "EUR", paymentMethod: "manual", paymentInstructions: "" },
        },
      ],
    },
  ],
} as unknown as CoreBookIntent;

const profile = { name: "Kieran", intents: { book: bookIntent } } as never;
const slot = (localTime: string) => {
  const startsAtMs = Date.parse(`2099-01-05T${localTime}:00Z`);
  return {
    startsAt: new Date(startsAtMs).toISOString(), endsAt: new Date(startsAtMs + 3_600_000).toISOString(),
    startsAtMs, localDate: "2099-01-05", localTime,
  };
};

class SqliteD1 {
  raw = new DatabaseSync(":memory:");
  constructor() {
    this.raw.exec(`
      CREATE TABLE owner_profile (id TEXT PRIMARY KEY, name TEXT, email TEXT, timezone TEXT);
      INSERT INTO owner_profile VALUES ('owner', 'Kieran', 'kieran@example.invalid', 'UTC'), ('other', 'Other', 'other@example.invalid', 'UTC');
      CREATE TABLE sites (id TEXT PRIMARY KEY, user_id TEXT, username TEXT, site_type TEXT, site_role TEXT, template_id TEXT,
        custom_domain TEXT, custom_domain_status TEXT, custom_domain_cf_id TEXT, created_at TEXT, updated_at TEXT, published_at TEXT);
      INSERT INTO sites (id, user_id, username, site_role) VALUES ('site-1', 'owner', 'kieran', 'profile'), ('site-2', 'other', 'other', 'profile');
      CREATE TABLE site_files (site_id TEXT, path TEXT, content BLOB, content_type TEXT, size INTEGER, sha256 TEXT, updated_at TEXT);
      CREATE TABLE bookings (
        id TEXT PRIMARY KEY, site_id TEXT NOT NULL, offer_id TEXT, booking_type TEXT,
        guest_name TEXT NOT NULL, guest_email TEXT NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL, calendar_event_id TEXT,
        status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
        notes TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, cancelled_at TEXT,
        payment_intent_id TEXT, amount_paid INTEGER, suggested_amount INTEGER, currency TEXT,
        payment_status TEXT DEFAULT 'not_required'
          CHECK (payment_status IN ('pending', 'succeeded', 'failed', 'not_required')),
        is_free_booking INTEGER NOT NULL DEFAULT 0, paid_at TEXT, page_id TEXT, action_id TEXT, campaign TEXT,
        quantity INTEGER NOT NULL DEFAULT 1, meeting_provider TEXT, meeting_url TEXT, meeting_host_url TEXT,
        meeting_guest_token_hash TEXT, meeting_title TEXT
      );
      CREATE TABLE booking_holds (
        id TEXT PRIMARY KEY, site_id TEXT NOT NULL, booking_id TEXT, offer_id TEXT, booking_type TEXT NOT NULL,
        hold_token TEXT UNIQUE, slot_start TEXT NOT NULL, slot_end TEXT NOT NULL, status TEXT NOT NULL,
        expires_at TEXT NOT NULL, created_at TEXT, updated_at TEXT, quantity INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE commerce_orders (
        id TEXT PRIMARY KEY, site_id TEXT NOT NULL, product_slug TEXT NOT NULL, product_title TEXT NOT NULL,
        buyer_name TEXT NOT NULL, buyer_email TEXT NOT NULL, amount_paid INTEGER, amount_due INTEGER, currency TEXT,
        status TEXT NOT NULL DEFAULT 'pending', payment_method TEXT NOT NULL DEFAULT 'stripe', payment_intent_id TEXT,
        paid_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT
      );
      CREATE TABLE financial_entries (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, entry_type TEXT NOT NULL, date TEXT NOT NULL, description TEXT NOT NULL,
        category_id TEXT, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'USD', status TEXT NOT NULL DEFAULT 'pending',
        source TEXT NOT NULL DEFAULT 'manual', notes TEXT, source_ref TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP, gross_amount_cents INTEGER, refunded_amount_cents INTEGER NOT NULL DEFAULT 0,
        customer_name TEXT, customer_email TEXT, payment_intent_id TEXT, site_id TEXT, item_ref TEXT, item_title TEXT
      );
      CREATE UNIQUE INDEX idx_financial_entries_source_ref ON financial_entries(user_id, source_ref);
      CREATE TABLE financial_entry_removals (user_id TEXT NOT NULL, source_ref TEXT NOT NULL, payment_intent_id TEXT,
        removed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, source_ref));
    `);
    for (const sql of [...PAY_DIRECTLY_SCHEMA, ...PAY_PAGE_SCHEMA, ...PAY_DIRECTLY_HOLDS_SCHEMA.filter((sql) => sql.includes("commerce_direct_payments")), ...PAY_DIRECTLY_MATCH_SCHEMA]) this.raw.exec(sql);
    this.raw.prepare("INSERT INTO site_files (site_id, path, content) VALUES ('site-1', 'src/me.json', ?)")
      .run(Buffer.from(JSON.stringify({ name: "Kieran", intents: { book: bookIntent } })));
    this.raw.exec(`INSERT INTO commerce_payment_methods (id, user_id, kind, link, enabled, sort_order)
      VALUES ('method-paypal', 'owner', 'paypal', 'https://paypal.me/kieran', 1, 0)`);
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
const row = (id: string) => database.raw.prepare("SELECT * FROM bookings WHERE id = ?").get(id) as unknown as DbBooking;
const reference = (bookingId: string) =>
  (database.raw.prepare("SELECT * FROM commerce_direct_payments WHERE booking_id = ?").get(bookingId) || null) as
    { reference: string; method_id: string | null; method_kind: string | null } | null;
const emailsTo = (address: string) => emails.filter((email) => email.toAddress === address);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function bookOneToOne(offerId: string, localTime: string, guestEmail = "ada@example.invalid", amountDueCents?: number) {
  const offer = resolveOneToOneBookingOffer(bookIntent, offerId)!;
  return bookFreeOneToOne(env, {
    site, profile, bookIntent, offer, slot: slot(localTime), guestName: "Ada", guestEmail, notes: "",
    amountDueCents, paymentCurrency: amountDueCents ? "eur" : undefined,
  });
}

async function bookClass(quantity: number, guestEmail = "ben@example.invalid") {
  const offer = resolveEventBookingOffer(bookIntent, "class", "movement")!;
  return createConfirmedEventBooking(env, {
    site, bookIntent, offer, occurrence: resolveEventOccurrence(offer, "2099-01-05")!, quantity,
    guestName: "Ben", guestEmail, notes: "", amountDuePerAttendeeCents: 2000, paymentCurrency: "eur",
  });
}

beforeEach(() => {
  database = new SqliteD1();
  env = { DB: database as unknown as D1Database } as Env;
  emails.length = 0;
  scheduleReminders.mockClear();
  cancelReminders.mockClear();
});

describe("a pay-directly one-to-one booking", () => {
  it("holds the slot and sends payment details instead of a booked email, link or reminders", async () => {
    const result = await bookOneToOne("strategy", "10:00");
    expect(result).toMatchObject({ ok: true });
    const booking = (result as { booking: DbBooking }).booking;
    await flush();

    expect(row(booking.id)).toMatchObject({ status: "confirmed", payment_status: "pending", suggested_amount: 6000, amount_paid: null });
    // The public response and the owner apps never get a join link for an unpaid booking.
    expect(serializeBooking(row(booking.id))).toMatchObject({ paymentStatus: "pending", meetingUrl: null });
    expect(scheduleReminders).not.toHaveBeenCalled();

    const ref = reference(booking.id)!.reference;
    expect(ref).toMatch(/^ME3-/);
    const [guest] = emailsTo("ada@example.invalid");
    expect(emailsTo("ada@example.invalid")).toHaveLength(1);
    expect(guest.subject).toBe("Payment details: Strategy call");
    expect(guest.textBody).toContain(ref);
    expect(guest.textBody).toContain("https://paypal.me/kieran/60EUR");
    expect(guest.textBody).toContain("Thank you!");
    expect(guest.textBody).not.toMatch(/Your booking is confirmed\.|Join call|calendar\.google/i);
    expect(`${guest.textBody}${guest.htmlBody}`).not.toContain("soulink.example");

    const [owner] = emailsTo("kieran@example.invalid");
    expect(emailsTo("kieran@example.invalid")).toHaveLength(1);
    expect(owner.subject).toBe("Waiting for payment: Ada");
    expect(owner.textBody).toContain(ref);
    expect(owner.textBody).toContain("€60.00");

    // The held time is taken for everyone else.
    expect(await bookOneToOne("intro", "10:00", "eve@example.invalid")).toMatchObject({ ok: false, status: 409 });
  });

  it("holds the amount the buyer chose", async () => {
    const result = await bookOneToOne("strategy", "11:00", "ada@example.invalid", 4500);
    const booking = (result as { booking: DbBooking }).booking;
    expect(row(booking.id)).toMatchObject({ payment_status: "pending", suggested_amount: 4500 });
    const paid = await markBookingPaid(env, "owner", booking.id);
    expect(paid.booking).toMatchObject({ paymentStatus: "succeeded", amountPaid: 4500 });
  });

  it("leaves a free booking confirmed at once", async () => {
    const result = await bookOneToOne("intro", "12:00");
    const booking = (result as { booking: DbBooking }).booking;
    await flush();
    expect(row(booking.id)).toMatchObject({ status: "confirmed", payment_status: "not_required", is_free_booking: 1 });
    expect(scheduleReminders).toHaveBeenCalledTimes(1);
    const [guest] = emailsTo("ada@example.invalid");
    expect(guest.subject).toBe("Booking confirmed: Intro call");
    expect(guest.textBody).toContain("https://soulink.example/join/guest-link");
    expect((await listWaitingPayments(env, "owner")).waiting).toEqual([]);
  });

  it("leaves a card booking paid and confirmed at once", async () => {
    const at = slot("13:00");
    database.raw.prepare(`INSERT INTO booking_holds (id, site_id, offer_id, booking_type, hold_token, slot_start, slot_end, status, expires_at)
      VALUES ('hold', 'site-1', 'card', 'one_to_one', 'token', ?, ?, 'active', '2999-01-01T00:00:00Z')`).run(at.startsAt, at.endsAt);
    const result = await finalizePaidBookingCheckout(env, site, {
      payment_status: "paid", payment_intent: "pi_card", amount_total: 8000, amount_subtotal: 8000, currency: "eur",
      metadata: {
        purchase_kind: "booking", site_id: "site-1", offer_id: "card", hold_token: "token", guest_name: "Cy",
        guest_email: "cy@example.invalid", starts_at: at.startsAt, ends_at: at.endsAt, duration_minutes: "60",
      },
    } as never);
    await flush();
    expect(result).toMatchObject({ ok: true, booking: { paymentStatus: "succeeded", amountPaid: 8000, meetingUrl: "https://soulink.example/join/guest-link" } });
    expect(scheduleReminders).toHaveBeenCalledTimes(1);
    expect(emailsTo("cy@example.invalid")[0].subject).toBe("Booking confirmed: Card call");
    expect((await listWaitingPayments(env, "owner")).waiting).toEqual([]);
  });
});

describe("a pay-directly class booking", () => {
  it("holds the seats and sends payment details for the total, not a booked email", async () => {
    const booking = (await bookClass(2))!;
    await flush();
    expect(row(booking.id)).toMatchObject({ status: "confirmed", payment_status: "pending", suggested_amount: 4000, quantity: 2 });
    expect(scheduleReminders).not.toHaveBeenCalled();
    const [guest] = emailsTo("ben@example.invalid");
    expect(emailsTo("ben@example.invalid")).toHaveLength(1);
    expect(guest.subject).toBe("Payment details: Movement class");
    expect(guest.textBody).toContain("€40.00");
    expect(guest.textBody).toContain("https://paypal.me/kieran/40EUR");
    expect(guest.textBody).not.toMatch(/Your booking is confirmed\./i);
    expect(emailsTo("kieran@example.invalid")[0].subject).toBe("Waiting for payment: Ben");

    // Two of three seats are held, so a group of two no longer fits.
    expect(await bookClass(2, "dee@example.invalid")).toBeNull();
    expect(await bookClass(1, "dee@example.invalid")).not.toBeNull();
  });
});

describe("marking a booking paid", () => {
  it("confirms a one-to-one once: booked email, meeting link, reminders and income", async () => {
    const booking = ((await bookOneToOne("strategy", "10:00")) as { booking: DbBooking }).booking;
    await flush();
    emails.length = 0;

    const first = await markBookingPaid(env, "owner", booking.id, { methodId: "method-paypal" });
    await flush();
    expect(first).toMatchObject({
      ok: true, alreadyPaid: false,
      booking: { paymentStatus: "succeeded", amountPaid: 6000, meetingUrl: "https://soulink.example/join/guest-link" },
    });
    expect(row(booking.id)).toMatchObject({ status: "confirmed", payment_status: "succeeded", amount_paid: 6000 });
    expect(row(booking.id).paid_at).toBeTruthy();
    expect(reference(booking.id)).toMatchObject({ method_id: "method-paypal", method_kind: "paypal" });
    expect(scheduleReminders).toHaveBeenCalledTimes(1);
    const [guest] = emailsTo("ada@example.invalid");
    expect(guest.subject).toBe("Booking confirmed: Strategy call");
    expect(guest.textBody).toContain("https://soulink.example/join/guest-link");
    expect(guest.textBody).toContain("Payment: €60.00");
    expect(guest.textBody).not.toContain("Payment is not taken now");

    const paidAt = row(booking.id).paid_at;
    const again = await markBookingPaid(env, "owner", booking.id, { amountCents: 9900 });
    await flush();
    expect(again).toMatchObject({ ok: true, alreadyPaid: true, booking: { amountPaid: 6000 } });
    expect(row(booking.id)).toMatchObject({ amount_paid: 6000, paid_at: paidAt });
    expect(emailsTo("ada@example.invalid")).toHaveLength(1);
    expect(scheduleReminders).toHaveBeenCalledTimes(1);

    await syncWebsiteIncomeEntries(env, "owner");
    await syncWebsiteIncomeEntries(env, "owner");
    expect(database.raw.prepare("SELECT amount_cents, currency, status, source_ref FROM financial_entries").all()).toEqual([
      { amount_cents: 6000, currency: "EUR", status: "paid", source_ref: `website:booking:${booking.id}` },
    ]);
    expect((await listWaitingPayments(env, "owner")).waiting).toEqual([]);
  });

  it("records no income while a booking is only held", async () => {
    await bookOneToOne("strategy", "10:00");
    await bookClass(1);
    await syncWebsiteIncomeEntries(env, "owner");
    expect(database.raw.prepare("SELECT COUNT(*) AS count FROM financial_entries").get()).toEqual({ count: 0 });
  });

  it("confirms a class for the total across attendees, or the amount the owner received", async () => {
    const group = (await bookClass(2))!;
    const single = (await bookClass(1, "dee@example.invalid"))!;
    await flush();
    emails.length = 0;

    expect(await markBookingPaid(env, "owner", group.id)).toMatchObject({ booking: { paymentStatus: "succeeded", amountPaid: 4000, quantity: 2 } });
    expect(await markBookingPaid(env, "owner", single.id, { amountCents: 1500 })).toMatchObject({ booking: { amountPaid: 1500 } });
    await flush();
    expect(emailsTo("ben@example.invalid").map((email) => email.subject)).toEqual(["Booking confirmed: Movement class"]);
    expect(scheduleReminders).toHaveBeenCalledTimes(2);
  });

  it("refuses another owner, a free booking and a bad amount", async () => {
    const held = ((await bookOneToOne("strategy", "10:00")) as { booking: DbBooking }).booking;
    const free = ((await bookOneToOne("intro", "12:00")) as { booking: DbBooking }).booking;
    await expect(markBookingPaid(env, "other", held.id)).rejects.toMatchObject({ status: 404 });
    await expect(markBookingPaid(env, "owner", free.id)).rejects.toMatchObject({ status: 409 });
    await expect(markBookingPaid(env, "owner", held.id, { amountCents: -5 })).rejects.toMatchObject({ status: 400 });
    await expect(markBookingPaid(env, "owner", held.id, { methodId: "not-mine" })).rejects.toMatchObject({ status: 400 });
    expect(row(held.id).payment_status).toBe("pending");
  });
});

describe("Waiting", () => {
  it("lists orders, bookings and events awaiting payment, and nothing paid, cancelled or someone else's", async () => {
    const call = ((await bookOneToOne("strategy", "10:00")) as { booking: DbBooking }).booking;
    const lesson = (await bookClass(2))!;
    const paidCall = ((await bookOneToOne("strategy", "14:00", "paid@example.invalid")) as { booking: DbBooking }).booking;
    await markBookingPaid(env, "owner", paidCall.id);
    const dropped = ((await bookOneToOne("strategy", "15:00", "gone@example.invalid")) as { booking: DbBooking }).booking;
    await cancelOwnerBooking(env, "owner", dropped.id);
    await bookOneToOne("intro", "16:00", "free@example.invalid");
    database.raw.exec(`
      INSERT INTO commerce_orders (id, site_id, product_slug, product_title, buyer_name, buyer_email, amount_due, currency, status, payment_method, created_at)
      VALUES ('order-waiting', 'site-1', 'print', 'Signed print', 'Flo', 'flo@example.invalid', 2500, 'gbp', 'pending', 'manual', '2026-11-10 09:00:00'),
             ('order-paid', 'site-1', 'print', 'Signed print', 'Gus', 'gus@example.invalid', 2500, 'gbp', 'paid', 'manual', '2026-11-10 09:00:00'),
             ('order-card', 'site-1', 'print', 'Signed print', 'Hal', 'hal@example.invalid', 2500, 'gbp', 'pending', 'stripe', '2026-11-10 09:00:00'),
             ('order-other', 'site-2', 'print', 'Signed print', 'Ivy', 'ivy@example.invalid', 2500, 'gbp', 'pending', 'manual', '2026-11-10 09:00:00');
      INSERT INTO commerce_direct_payments (reference, user_id, order_id) VALUES ('ME3-PRNT', 'owner', 'order-waiting');
    `);

    const { waiting } = await listWaitingPayments(env, "owner");
    expect(waiting.map((item) => [item.kind, item.id]).sort()).toEqual([
      ["booking", call.id], ["event", lesson.id], ["order", "order-waiting"],
    ].sort());
    expect(waiting.find((item) => item.kind === "order")).toMatchObject({
      kind: "order", id: "order-waiting", reference: "ME3-PRNT", customerName: "Flo", customerEmail: "flo@example.invalid",
      title: "Signed print", amountCents: 2500, currency: "GBP", createdAt: "2026-11-10T09:00:00Z",
      saysPaidAt: null, remindedAt: null, bookingType: null, startsAt: null, quantity: 1,
    });
    expect(waiting.find((item) => item.kind === "booking")).toMatchObject({
      reference: reference(call.id)!.reference, customerName: "Ada", customerEmail: "ada@example.invalid",
      title: "Strategy call", amountCents: 6000, currency: "EUR", bookingType: "one_to_one",
      startsAt: "2099-01-05T10:00:00.000Z", quantity: 1,
    });
    expect(waiting.find((item) => item.kind === "event")).toMatchObject({
      reference: reference(lesson.id)!.reference, title: "Movement class", amountCents: 4000, bookingType: "class", quantity: 2,
    });
    expect((await listWaitingPayments(env, "other")).waiting.map((item) => item.id)).toEqual(["order-other"]);
  });
});

describe("cancelling a pay-directly booking", () => {
  it("frees a held slot and tells the buyer no payment is due", async () => {
    const booking = ((await bookOneToOne("strategy", "10:00")) as { booking: DbBooking }).booking;
    await flush();
    emails.length = 0;
    const result = await cancelOwnerBooking(env, "owner", booking.id);
    expect(result).toMatchObject({ booking: { status: "cancelled" }, guestEmail: "sent", payment: null });
    const [guest] = emailsTo("ada@example.invalid");
    expect(guest.subject).toBe("Booking cancelled: Strategy call");
    expect(guest.textBody).toMatch(/do not need to pay/i);
    expect(await bookOneToOne("intro", "10:00", "eve@example.invalid")).toMatchObject({ ok: true });
  });

  it("warns that ME3 moves no money when it was already marked paid, and can reverse the income", async () => {
    const kept = ((await bookOneToOne("strategy", "10:00")) as { booking: DbBooking }).booking;
    const reversed = ((await bookOneToOne("strategy", "11:00", "bea@example.invalid")) as { booking: DbBooking }).booking;
    await markBookingPaid(env, "owner", kept.id);
    await markBookingPaid(env, "owner", reversed.id);

    const first = await cancelOwnerBooking(env, "owner", kept.id);
    expect(first.payment).toMatchObject({ paidDirectly: true, amountCents: 6000, currency: "EUR", incomeReversed: false });
    expect(first.payment!.message).toMatch(/ME3 does not move money/);
    expect(first.payment!.message).toMatch(/refund Ada yourself/i);
    const entry = database.raw.prepare("SELECT id FROM financial_entries WHERE source_ref = ?").get(`website:booking:${kept.id}`) as { id: string };
    expect(first.payment!.incomeEntryId).toBe(entry.id);

    const second = await cancelOwnerBooking(env, "owner", reversed.id, { reverseIncome: true });
    expect(second.payment).toMatchObject({ paidDirectly: true, incomeReversed: true, incomeEntryId: null });
    await syncWebsiteIncomeEntries(env, "owner");
    expect(database.raw.prepare("SELECT source_ref FROM financial_entries").all()).toEqual([
      { source_ref: `website:booking:${kept.id}` },
    ]);
  });
});
