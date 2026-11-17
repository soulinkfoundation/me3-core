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
import { PAY_DIRECTLY_HOLDS_SCHEMA, PAY_DIRECTLY_SCHEMA, PAY_PAGE_SCHEMA } from "./pay-directly";
import { listWaitingPayments, markBookingPaid } from "./pay-directly-bookings";
import { getPayDirectlyHoldSettings, updatePayDirectlyHoldSettings } from "./commerce-settings";
import { keepHolding, releaseWaiting, remindWaitingBuyer, restoreReleasedBooking, runPayDirectlyFollowUps } from "./pay-directly-holds";
import { recordSaysPaid } from "./pay-page";
import { productAvailability } from "./product-stock";
import { holdState } from "./pay-directly";
import {
  parsePayDirectlyHoldSettings,
  payDirectlyDecideAtMs,
  payDirectlyTimeline,
} from "../../../shared/pay-directly";
import type { DbBooking, DbSite, Env } from "./types";

// Failure modes this file guards:
// - a buyer is reminded twice, or never; the owner is not warned before a booking is released;
// - something is released without the owner ever being warned (found late, or made before reminders existed);
// - a booking that starts soon is released after it has started, or one that says paid is released at all;
// - release leaves the slot, the seats or the stock held, or tells only one side;
// - a restored booking double-books a time that was taken meanwhile;
// - "I've paid" holds a booking for ever without the owner being asked to decide.

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
    for (const sql of [...PAY_DIRECTLY_SCHEMA, ...PAY_PAGE_SCHEMA, ...PAY_DIRECTLY_HOLDS_SCHEMA.filter((sql) => sql.includes("commerce_direct_payments"))]) this.raw.exec(sql);
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


const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** When every hold in these tests was made. The bookings themselves are in January 2099. */
const T0 = Date.parse("2098-12-01T09:00:00Z");
const at = (offsetMs: number) => new Date(T0 + offsetMs);
const sqlite = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const run = (offsetMs: number) => runPayDirectlyFollowUps(env, at(offsetMs));
const subjects = (address: string) => emailsTo(address).map((email) => email.subject);

async function heldCall(localTime = "10:00", guestEmail = "ada@example.invalid") {
  const booking = ((await bookOneToOne("strategy", localTime, guestEmail)) as { booking: DbBooking }).booking;
  database.raw.prepare("UPDATE bookings SET created_at = ? WHERE id = ?").run(sqlite(T0), booking.id);
  database.raw.prepare("UPDATE commerce_direct_payments SET created_at = ? WHERE booking_id = ?").run(sqlite(T0), booking.id);
  await flush();
  emails.length = 0;
  return booking;
}

beforeEach(() => {
  database = new SqliteD1();
  database.raw.exec(`CREATE TABLE commerce_settings (user_id TEXT PRIMARY KEY, encrypted_stripe_secret_key TEXT, stripe_key_hint TEXT, stripe_key_updated_at TEXT, preferred_stripe_provider TEXT NOT NULL DEFAULT 'auto',
    default_currency TEXT NOT NULL DEFAULT 'USD', created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE booking_reminders (id TEXT, booking_id TEXT, status TEXT);`);
  for (const sql of PAY_DIRECTLY_HOLDS_SCHEMA.filter((statement) => statement.includes("commerce_settings"))) database.raw.exec(sql);
  env = { DB: database as unknown as D1Database, CORE_WEB_ORIGIN: "https://kieran.example" } as Env;
  emails.length = 0;
  scheduleReminders.mockClear();
  cancelReminders.mockClear();
});

describe("the timing rules", () => {
  const settings = { remindAfterDays: 2, releaseAfterDays: 5 };

  it("reminds after 2 days, warns the owner the day before, and releases after 5", () => {
    expect(payDirectlyTimeline({ heldFromMs: T0, startsAtMs: null, ...settings })).toEqual({
      remindAtMs: T0 + 2 * DAY, warnOwnerAtMs: T0 + 4 * DAY, releaseAtMs: T0 + 5 * DAY,
    });
    // A booking far enough ahead follows the same clock.
    expect(payDirectlyTimeline({ heldFromMs: T0, startsAtMs: T0 + 30 * DAY, ...settings }).releaseAtMs).toBe(T0 + 5 * DAY);
  });

  it("releases a booking that starts sooner than the setting a day before it starts, and reminds sooner to match", () => {
    const timeline = payDirectlyTimeline({ heldFromMs: T0, startsAtMs: T0 + 3 * DAY, ...settings });
    expect(timeline.releaseAtMs).toBe(T0 + 2 * DAY);
    expect(timeline.remindAtMs).toBe(T0 + 0.8 * DAY);
    expect(timeline.warnOwnerAtMs).toBe(T0 + 2 * DAY - 16 * HOUR);
    expect(timeline.remindAtMs).toBeLessThan(timeline.releaseAtMs);
  });

  it("always releases a last-minute booking before it starts", () => {
    for (const lead of [90 * 60_000, 6 * HOUR, 20 * HOUR, 30 * HOUR]) {
      const timeline = payDirectlyTimeline({ heldFromMs: T0, startsAtMs: T0 + lead, ...settings });
      expect(timeline.releaseAtMs).toBeGreaterThan(T0);
      expect(timeline.releaseAtMs).toBeLessThan(T0 + lead);
      expect(timeline.remindAtMs).toBeLessThan(timeline.releaseAtMs);
      expect(timeline.warnOwnerAtMs).toBeLessThan(timeline.releaseAtMs);
    }
    expect(payDirectlyTimeline({ heldFromMs: T0, startsAtMs: T0 + 6 * HOUR, ...settings }).releaseAtMs).toBe(T0 + 3 * HOUR);
  });

  it("never releases without the owner's warning, even when the hold is found late", () => {
    const row = { created_at: sqlite(T0), hold_started_at: null, starts_at: null, says_paid_at: null, owner_warned_at: null };
    // Found on day 9 with no warning sent: release waits a day from now.
    expect(holdState(row, settings, T0 + 9 * DAY).releaseAtMs).toBe(T0 + 10 * DAY);
    // Warned on day 9: released a day after the warning.
    expect(holdState({ ...row, owner_warned_at: sqlite(T0 + 9 * DAY) }, settings, T0 + 9.5 * DAY).releaseAtMs).toBe(T0 + 10 * DAY);
    // Keep holding restarts the clock and forgets the old warning.
    expect(holdState({ ...row, hold_started_at: sqlite(T0 + 9 * DAY), owner_warned_at: sqlite(T0 + 4 * DAY) }, settings, T0 + 9 * DAY).releaseAtMs).toBe(T0 + 14 * DAY);
  });

  it("asks the owner to decide 3 days after I've paid, or a day before the booking if that is sooner", () => {
    expect(payDirectlyDecideAtMs({ saysPaidAtMs: T0, startsAtMs: null })).toBe(T0 + 3 * DAY);
    expect(payDirectlyDecideAtMs({ saysPaidAtMs: T0, startsAtMs: T0 + 2 * DAY })).toBe(T0 + DAY);
    expect(holdState({ created_at: sqlite(T0), hold_started_at: null, starts_at: null, says_paid_at: sqlite(T0 + DAY), owner_warned_at: null }, settings, T0 + 2 * DAY))
      .toMatchObject({ paused: true, decideAtMs: T0 + 4 * DAY });
  });

  it("accepts sensible settings and refuses a reminder that is not before release", async () => {
    expect(parsePayDirectlyHoldSettings({ remindAfterDays: 1, releaseAfterDays: 3 }, settings)).toEqual({ ok: true, value: { remindAfterDays: 1, releaseAfterDays: 3 } });
    for (const bad of [{ remindAfterDays: 5 }, { releaseAfterDays: 1 }, { remindAfterDays: 0 }, { releaseAfterDays: 31 }, { remindAfterDays: 1.5 }, { remindAfterDays: "2" }]) {
      expect(parsePayDirectlyHoldSettings(bad, settings).ok).toBe(false);
    }
    expect(await getPayDirectlyHoldSettings(env, "owner")).toEqual(settings);
    expect(await updatePayDirectlyHoldSettings(env, "owner", { remindAfterDays: 3, releaseAfterDays: 7 })).toEqual({ remindAfterDays: 3, releaseAfterDays: 7 });
    expect(await getPayDirectlyHoldSettings(env, "owner")).toEqual({ remindAfterDays: 3, releaseAfterDays: 7 });
    await expect(updatePayDirectlyHoldSettings(env, "owner", { remindAfterDays: 9 })).rejects.toThrow("Remind buyers before the booking is released.");
  });
});

describe("an unpaid held booking", () => {
  it("gets one reminder, the owner is warned the day before, and at release the slot is free and both sides are told", async () => {
    const booking = await heldCall();
    expect((await listWaitingPayments(env, "owner", at(HOUR))).waiting[0]).toMatchObject({
      heldUntil: new Date(T0 + 5 * DAY).toISOString(), remindedAt: null, ownerWarnedAt: null, needsYou: false, needsDecision: false,
    });

    expect(await run(2 * DAY - HOUR)).toEqual({ reminded: 0, warned: 0, released: 0, nudged: 0 });
    expect(await run(2 * DAY + HOUR)).toMatchObject({ reminded: 1, warned: 0, released: 0 });
    expect(await run(3 * DAY)).toMatchObject({ reminded: 0 });
    expect(subjects("ada@example.invalid")).toEqual(["Reminder: Strategy call is waiting for your payment"]);
    const reminder = emailsTo("ada@example.invalid")[0];
    expect(reminder.textBody).toContain(`https://kieran.example/api/pay/${(database.raw.prepare("SELECT pay_token FROM commerce_direct_payments").get() as { pay_token: string }).pay_token}`);
    expect(reminder.textBody).toContain(reference(booking.id)!.reference);
    expect(reminder.textBody).toContain("€60.00");
    expect(reminder.textBody).toContain("It is held until Saturday, December 6, 2098");
    expect(emailsTo("kieran@example.invalid")).toHaveLength(0);

    expect(await run(4 * DAY + HOUR)).toMatchObject({ warned: 1, released: 0 });
    expect(await run(4 * DAY + 2 * HOUR)).toMatchObject({ warned: 0, released: 0 });
    const [warning] = emailsTo("kieran@example.invalid");
    expect(warning.subject).toContain("Unpaid: Ada · Strategy call is released Saturday, December 6, 2098");
    expect(warning.textBody).toContain("mark it paid in ME3 → Accounts → Waiting");
    expect(warning.textBody).toContain("Keep holding");
    expect((await listWaitingPayments(env, "owner", at(4 * DAY + 2 * HOUR))).waiting[0]).toMatchObject({ needsYou: true });
    expect(row(booking.id)).toMatchObject({ status: "confirmed", payment_status: "pending" });

    expect(await run(5 * DAY + HOUR)).toMatchObject({ released: 1 });
    expect(row(booking.id)).toMatchObject({ status: "cancelled", payment_status: "failed" });
    expect(subjects("ada@example.invalid").at(-1)).toBe("Booking released: Strategy call");
    expect(emailsTo("ada@example.invalid").at(-1)!.textBody).toContain("If you have already paid, reply to this email");
    expect(subjects("kieran@example.invalid").at(-1)).toBe("Released: Ada · Strategy call");
    expect(await run(6 * DAY)).toEqual({ reminded: 0, warned: 0, released: 0, nudged: 0 });

    const list = await listWaitingPayments(env, "owner", at(6 * DAY));
    expect(list.waiting).toEqual([]);
    expect(list.released).toMatchObject([{ kind: "booking", id: booking.id, customerName: "Ada", title: "Strategy call", amountCents: 6000 }]);
    // The time is open to someone else again.
    expect(await bookOneToOne("intro", "10:00", "eve@example.invalid")).toMatchObject({ ok: true });
  });

  it("is given longer by Keep holding, without reminding the buyer again", async () => {
    const booking = await heldCall();
    await run(2 * DAY + HOUR);
    await run(4 * DAY + HOUR);
    const kept = await keepHolding(env, "owner", reference(booking.id)!.reference, at(4 * DAY + 2 * HOUR));
    expect(kept.waiting).toMatchObject({ heldUntil: new Date(T0 + 9 * DAY + 2 * HOUR).toISOString(), ownerWarnedAt: null });
    expect(await run(6 * DAY)).toEqual({ reminded: 0, warned: 0, released: 0, nudged: 0 });
    expect(await run(8 * DAY + 3 * HOUR)).toMatchObject({ reminded: 0, warned: 1 });
    expect(await run(9 * DAY + 3 * HOUR)).toMatchObject({ released: 1 });
    expect(subjects("ada@example.invalid").filter((subject) => subject.startsWith("Reminder"))).toHaveLength(1);
  });

  it("can be restored while its time is free, and not once the time is taken", async () => {
    const booking = await heldCall();
    const ref = reference(booking.id)!.reference;
    await releaseWaiting(env, "owner", ref, at(DAY));
    expect(row(booking.id)).toMatchObject({ status: "cancelled", payment_status: "failed" });
    // The owner released it, so only the buyer is emailed.
    expect(subjects("ada@example.invalid")).toEqual(["Booking released: Strategy call"]);
    expect(emailsTo("kieran@example.invalid")).toHaveLength(0);

    const restored = await restoreReleasedBooking(env, "owner", ref, at(2 * DAY));
    expect(row(booking.id)).toMatchObject({ status: "confirmed", payment_status: "pending", cancelled_at: null });
    expect(restored.waiting).toMatchObject({ heldUntil: new Date(T0 + 7 * DAY).toISOString(), remindedAt: null });
    expect(subjects("ada@example.invalid").at(-1)).toBe("Held again: Strategy call");
    expect((await markBookingPaid(env, "owner", booking.id)).booking).toMatchObject({ paymentStatus: "succeeded" });

    const second = await heldCall("11:00", "bea@example.invalid");
    const secondRef = reference(second.id)!.reference;
    await releaseWaiting(env, "owner", secondRef, at(DAY));
    expect(await bookOneToOne("intro", "11:00", "eve@example.invalid")).toMatchObject({ ok: true });
    await expect(restoreReleasedBooking(env, "owner", secondRef, at(2 * DAY))).rejects.toMatchObject({ status: 409, message: "That time has been taken since." });
    await expect(restoreReleasedBooking(env, "other", ref, at(2 * DAY))).rejects.toMatchObject({ status: 404 });
  });

  it("is released before it starts when it starts sooner than the release setting", async () => {
    const booking = await heldCall();
    // The session is 30 hours after it was booked: release is due 15 hours in.
    database.raw.prepare("UPDATE bookings SET starts_at = ?, ends_at = ? WHERE id = ?")
      .run(new Date(T0 + 30 * HOUR).toISOString(), new Date(T0 + 31 * HOUR).toISOString(), booking.id);
    expect((await listWaitingPayments(env, "owner", at(HOUR))).waiting[0].heldUntil).toBe(new Date(T0 + 15 * HOUR).toISOString());
    expect(await run(7 * HOUR)).toMatchObject({ reminded: 1, warned: 0 });
    expect(await run(10 * HOUR + 60_000)).toMatchObject({ warned: 1, released: 0 });
    // Never sooner than the warning's notice, and still well before the session.
    expect(await run(15 * HOUR)).toMatchObject({ released: 0 });
    expect(await run(15 * HOUR + 5 * 60_000)).toMatchObject({ released: 1 });
    expect(row(booking.id)).toMatchObject({ status: "cancelled", payment_status: "failed" });
  });

  it("sends the reminder now when the owner asks, and still only once on its own", async () => {
    const booking = await heldCall();
    const ref = reference(booking.id)!.reference;
    expect(await remindWaitingBuyer(env, "owner", ref, at(HOUR))).toMatchObject({ ok: true });
    expect(subjects("ada@example.invalid")).toEqual(["Reminder: Strategy call is waiting for your payment"]);
    expect((await listWaitingPayments(env, "owner", at(2 * HOUR))).waiting[0].remindedAt).toBeTruthy();
    expect(await run(2 * DAY + HOUR)).toMatchObject({ reminded: 0 });
    await expect(remindWaitingBuyer(env, "other", ref, at(HOUR))).rejects.toMatchObject({ status: 404 });
  });
});

describe("a booking whose buyer says they have paid", () => {
  it("is never released automatically, tells the owner at once, and asks them to decide after the pause", async () => {
    const booking = await heldCall();
    const token = (database.raw.prepare("SELECT pay_token FROM commerce_direct_payments WHERE booking_id = ?").get(booking.id) as { pay_token: string }).pay_token;
    await recordSaysPaid(env, token);
    await recordSaysPaid(env, token);
    database.raw.prepare("UPDATE commerce_direct_payments SET says_paid_at = ? WHERE booking_id = ?").run(sqlite(T0 + DAY), booking.id);
    expect(subjects("kieran@example.invalid")).toEqual(["Ada says they’ve paid €60.00"]);
    expect(emailsTo("kieran@example.invalid")[0].textBody).toContain("Nothing is released while you check.");

    expect((await listWaitingPayments(env, "owner", at(2 * DAY))).waiting[0]).toMatchObject({ heldUntil: null, needsYou: true, needsDecision: false });
    expect(await run(3 * DAY)).toEqual({ reminded: 0, warned: 0, released: 0, nudged: 0 });
    expect(await run(4 * DAY + HOUR)).toMatchObject({ nudged: 1, released: 0 });
    expect(await run(12 * DAY)).toEqual({ reminded: 0, warned: 0, released: 0, nudged: 0 });
    expect(row(booking.id)).toMatchObject({ status: "confirmed", payment_status: "pending" });
    expect(subjects("kieran@example.invalid").at(-1)).toBe("Still waiting: Ada said they paid");
    expect(emailsTo("ada@example.invalid")).toHaveLength(0);
    expect((await listWaitingPayments(env, "owner", at(12 * DAY))).waiting[0]).toMatchObject({ needsDecision: true, needsYou: true });

    // Not yet: leave it waiting and ask again after another pause.
    const ref = reference(booking.id)!.reference;
    expect((await keepHolding(env, "owner", ref, at(12 * DAY))).waiting).toMatchObject({ needsDecision: false });
    expect(await run(14 * DAY)).toMatchObject({ nudged: 0 });
    expect(await run(15 * DAY + HOUR)).toMatchObject({ nudged: 1 });
    // The owner decides: release.
    await releaseWaiting(env, "owner", ref, at(16 * DAY));
    expect(row(booking.id)).toMatchObject({ status: "cancelled", payment_status: "failed" });
  });
});

describe("an unpaid product order", () => {
  it("keeps its copy until release, then closes, frees the stock and tells both sides, never without a warning", async () => {
    const product = { slug: "print", stock: 1, stockSetAt: "2098-11-01T00:00:00Z" } as never;
    database.raw.exec(`ALTER TABLE commerce_orders ADD COLUMN option_id TEXT;
      INSERT INTO commerce_orders (id, site_id, product_slug, product_title, buyer_name, buyer_email, amount_due, currency, status, payment_method, created_at)
      VALUES ('order-1', 'site-1', 'print', 'Signed print', 'Flo Reyes', 'flo@example.invalid', 2500, 'gbp', 'pending', 'manual', '${sqlite(T0)}');
      INSERT INTO commerce_direct_payments (reference, user_id, order_id, created_at) VALUES ('ME3-PRNT', 'owner', 'order-1', '${sqlite(T0)}');`);
    const stock = async (offset: number) => (await productAvailability(env.DB, "site-1", product, at(offset))).remaining;
    // Well past the old fixed 7 days, the copy is still held because nobody has been warned yet.
    expect(await stock(8 * DAY)).toBe(0);
    expect(await run(8 * DAY)).toMatchObject({ reminded: 1, warned: 1, released: 0 });
    expect(await run(8 * DAY + 12 * HOUR)).toMatchObject({ released: 0 });
    expect(await run(9 * DAY + HOUR)).toMatchObject({ released: 1 });
    expect(database.raw.prepare("SELECT status FROM commerce_orders WHERE id = 'order-1'").get()).toEqual({ status: "failed" });
    expect((database.raw.prepare("SELECT released_at FROM commerce_direct_payments WHERE reference = 'ME3-PRNT'").get() as { released_at: string }).released_at).toBeTruthy();
    expect(await stock(9 * DAY + HOUR)).toBe(1);
    expect(subjects("flo@example.invalid")).toEqual(["Reminder: Signed print is waiting for your payment", "Order closed: Signed print"]);
    expect(subjects("kieran@example.invalid").at(-1)).toBe("Released: Flo Reyes · Signed print");
    expect((await listWaitingPayments(env, "owner", at(10 * DAY))).waiting).toEqual([]);
  });
});

describe("bookings that are not waiting for a direct payment", () => {
  it("are left alone by the job", async () => {
    const free = ((await bookOneToOne("intro", "12:00")) as { booking: DbBooking }).booking;
    const paid = await heldCall("13:00", "paid@example.invalid");
    await markBookingPaid(env, "owner", paid.id);
    await flush();
    emails.length = 0;
    expect(await run(40 * DAY)).toEqual({ reminded: 0, warned: 0, released: 0, nudged: 0 });
    expect(row(free.id)).toMatchObject({ status: "confirmed", payment_status: "not_required" });
    expect(row(paid.id)).toMatchObject({ status: "confirmed", payment_status: "succeeded" });
    expect(emails).toHaveLength(0);
  });
});
