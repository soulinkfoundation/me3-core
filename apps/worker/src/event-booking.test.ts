import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { registerEventBookingRoutes } from "./routes/event-booking";
import type { AppBindings } from "./http/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./booking-reminders", () => ({
  scheduleBookingRemindersForBooking: vi.fn(async () => undefined),
}));
vi.mock("./transactional-emails", () => ({
  bookingDetailsFromBooking: vi.fn((value) => value),
  getOwnerContact: vi.fn(async () => ({ name: "Host", email: "host@example.com" })),
  sendBookingConfirmationEmails: vi.fn(async () => ({
    guest: { status: "sent" },
    host: { status: "sent" },
  })),
}));

import {
  createConfirmedEventBooking,
  createEventBookingHold,
  finalizePaidEventBookingCheckout,
  normalizeAttendeeQuantity,
  resolveEventBookingOffer,
  resolveEventOccurrence,
  type ResolvedEventBookingOffer,
} from "./event-booking";
import type { CoreBookIntent } from "./booking";
import type { DbSite, Env } from "./types";

const site: DbSite = {
  id: "site-1",
  user_id: "owner",
  username: "owner",
  site_type: "profile",
  site_role: "profile",
  template_id: null,
  custom_domain: null,
  custom_domain_status: null,
  custom_domain_cf_id: null,
  created_at: "2026-08-20T10:00:00Z",
  updated_at: "2026-08-20T10:00:00Z",
  published_at: "2026-08-20T10:00:00Z",
};

describe("event booking offers", () => {
  it("resolves recurring class sessions in their configured timezone", () => {
    const book = eventBookIntent();
    const offer = resolveEventBookingOffer(book, "class", "movement-class");
    expect(offer?.bookingType).toBe("class");
    expect(resolveEventOccurrence(offer!, "2026-09-07")).toMatchObject({
      startsAt: "2026-09-07T17:00:00.000Z",
      endsAt: "2026-09-07T18:00:00.000Z",
      durationMinutes: 60,
    });
    expect(resolveEventOccurrence(offer!, "2026-09-14")).toBeNull();
  });

  it("resolves fixed retreat wall times across daylight-saving changes", () => {
    const offer = resolveEventBookingOffer(eventBookIntent(), "retreat", "autumn-retreat");
    const occurrence = resolveEventOccurrence(offer!);
    expect(occurrence).toMatchObject({
      startsAt: "2026-10-24T09:00:00.000Z",
      endsAt: "2026-10-25T10:00:00.000Z",
      durationMinutes: 25 * 60,
    });
  });

  it("validates attendee quantities against bounded and unlimited offers", () => {
    expect(normalizeAttendeeQuantity(3, 4)).toBe(3);
    expect(normalizeAttendeeQuantity(5, 4)).toBeNull();
    expect(normalizeAttendeeQuantity(20, null)).toBe(20);
    expect(normalizeAttendeeQuantity(21, null)).toBeNull();
  });
});

describe("event booking capacity", () => {
  let database: SqliteD1;
  let env: Env;

  beforeEach(() => {
    database = new SqliteD1();
    env = { DB: database as unknown as D1Database } as Env;
  });

  it.each([
    ["class", "PK", 800000, "pkr"], ["class", "US", 5000, "usd"],
    ["retreat", "PK", 800000, "pkr"], ["retreat", null, 5000, "usd"],
  ] as const)("registers a %s for %s using the trusted country price", async (kind, country, amount, currency) => {
    database.raw.exec(`CREATE TABLE sites (id TEXT, user_id TEXT, username TEXT, site_type TEXT, site_role TEXT, template_id TEXT, custom_domain TEXT, custom_domain_status TEXT, custom_domain_cf_id TEXT, created_at TEXT, updated_at TEXT, published_at TEXT);
      INSERT INTO sites (id, user_id, username, published_at) VALUES ('site-1','owner','owner','2026-10-07');`);
    const book = eventBookIntent();
    const pricing = { enabled: true, suggestedAmount: 50, currency: "USD", paymentMethod: "manual" as const, paymentInstructions: "Transfer the amount in your confirmation", regionalPrices: [{ country: "PK", currency: "PKR", amount: 800000 }] };
    const lesson = book.bookingTypes![0].classes![0];
    lesson.pricing = pricing;
    lesson.recurrence = { frequency: "weekly", weekday: "monday", startTime: "18:00", startDate: "2099-01-05" };
    const retreat = book.bookingTypes![1].retreats![0];
    retreat.pricing = pricing;
    retreat.startDate = "2099-01-05";
    retreat.endDate = "2099-01-06";
    database.raw.prepare("INSERT INTO site_files (site_id, path, content) VALUES (?, 'src/me.json', ?)").run(site.id, Buffer.from(JSON.stringify({ intents: { book } })));
    const app = new Hono<AppBindings>();
    registerEventBookingRoutes(app);
    const id = kind === "class" ? lesson.id : retreat.id;
    const request = new Request(`https://owner.example/api/book/owner/events/${kind}/${id}/register`, {
      method: "POST", headers: { "Content-Type": "application/json", "CF-IPCountry": "PK" },
      body: JSON.stringify({ localDate: "2099-01-05", quantity: 2, guestName: "Buyer", guestEmail: "buyer@example.com", amount: amount / 100, currency: currency.toUpperCase(), country: "PK" }),
    });
    if (country) Object.defineProperty(request, "cf", { value: { country } });
    const response = await app.fetch(request, env);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(database.raw.prepare("SELECT suggested_amount, currency, quantity FROM bookings").get()).toMatchObject({ suggested_amount: amount * 2, currency, quantity: 2 });
  });

  it("atomically gives the final class spaces to only one concurrent registration", async () => {
    const bookIntent = eventBookIntent();
    const offer = resolveEventBookingOffer(bookIntent, "class", "movement-class")!;
    const occurrence = resolveEventOccurrence(offer, "2026-09-07")!;

    const results = await Promise.all([
      createConfirmedEventBooking(env, {
        site,
        bookIntent,
        offer,
        occurrence,
        quantity: 2,
        guestName: "First group",
        guestEmail: "first@example.com",
        notes: "",
      }),
      createConfirmedEventBooking(env, {
        site,
        bookIntent,
        offer,
        occurrence,
        quantity: 2,
        guestName: "Second group",
        guestEmail: "second@example.com",
        notes: "",
      }),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(database.raw.prepare("SELECT booking_type, quantity FROM bookings").get()).toEqual({
      booking_type: "class",
      quantity: 2,
    });
  });

  it("counts active checkout holds so a sold-out occurrence cannot be oversubscribed", async () => {
    const offer = resolveEventBookingOffer(eventBookIntent(), "class", "movement-class")!;
    const occurrence = resolveEventOccurrence(offer, "2026-09-07")!;
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const results = await Promise.all([
      createEventBookingHold(env, {
        siteId: site.id,
        offer,
        occurrence,
        quantity: 2,
        holdToken: "hold-a",
        expiresAt,
      }),
      createEventBookingHold(env, {
        siteId: site.id,
        offer,
        occurrence,
        quantity: 1,
        holdToken: "hold-b",
        expiresAt,
      }),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(database.raw.prepare("SELECT COUNT(*) AS count FROM booking_holds").get()).toEqual({
      count: 1,
    });
  });

  it("converts a paid retreat hold into a correctly typed multi-attendee booking", async () => {
    const bookIntent = eventBookIntent();
    const offer = resolveEventBookingOffer(bookIntent, "retreat", "autumn-retreat")!;
    const occurrence = resolveEventOccurrence(offer)!;
    const held = await createEventBookingHold(env, {
      siteId: site.id,
      offer,
      occurrence,
      quantity: 3,
      holdToken: "paid-retreat-hold",
      expiresAt: "2026-10-24T08:30:00.000Z",
    });
    expect(held).toBe(true);
    database.raw
      .prepare(
        `INSERT INTO site_files
         (site_id, path, content, content_type, size, sha256, updated_at)
         VALUES (?, 'src/me.json', ?, 'application/json', 1, NULL, datetime('now'))`,
      )
      .run(site.id, Buffer.from(JSON.stringify({ intents: { book: bookIntent } })));

    const result = await finalizePaidEventBookingCheckout(env, site, {
      payment_status: "paid",
      payment_intent: "pi_retreat",
      amount_total: 90000,
      amount_subtotal: 90000,
      currency: "eur",
      metadata: {
        purchase_kind: "booking",
        site_id: site.id,
        offer_id: offer.id,
        booking_type: "retreat",
        hold_token: "paid-retreat-hold",
        guest_name: "Retreat group",
        guest_email: "group@example.com",
        starts_at: occurrence.startsAt,
        ends_at: occurrence.endsAt,
        duration_minutes: String(occurrence.durationMinutes),
        quantity: "3",
      },
    } as any);

    expect(result).toMatchObject({
      ok: true,
      booking: {
        bookingType: "retreat",
        quantity: 3,
        paymentStatus: "succeeded",
      },
    });
    expect(database.raw.prepare("SELECT status FROM booking_holds").get()).toEqual({
      status: "confirmed",
    });
  });
});

function eventBookIntent(): CoreBookIntent {
  return {
    enabled: true,
    reminders: { enabled: false },
    bookingTypes: [
      {
        type: "class",
        classes: [
          {
            id: "movement-class",
            title: "Movement class",
            duration: 60,
            timezone: "Europe/Dublin",
            recurrence: {
              frequency: "biweekly",
              weekday: "monday",
              startTime: "18:00",
              startDate: "2026-09-07",
            },
            capacity: 2,
          },
        ],
      },
      {
        type: "retreat",
        retreats: [
          {
            id: "autumn-retreat",
            title: "Autumn retreat",
            timezone: "Europe/Dublin",
            startDate: "2026-10-24",
            startTime: "10:00",
            endDate: "2026-10-25",
            endTime: "10:00",
            capacity: 6,
            pricing: {
              enabled: true,
              suggestedAmount: 300,
              currency: "EUR",
              paymentMethod: "stripe",
            },
          },
        ],
      },
    ],
  } as CoreBookIntent;
}

class SqliteD1 {
  raw = new DatabaseSync(":memory:");

  constructor() {
    this.raw.exec(`
      CREATE TABLE bookings (
        id TEXT PRIMARY KEY, site_id TEXT NOT NULL, offer_id TEXT, booking_type TEXT,
        guest_name TEXT NOT NULL, guest_email TEXT NOT NULL, starts_at TEXT NOT NULL,
        ends_at TEXT NOT NULL, duration_minutes INTEGER NOT NULL, calendar_event_id TEXT,
        status TEXT NOT NULL, notes TEXT, created_at TEXT, cancelled_at TEXT,
        payment_intent_id TEXT, amount_paid INTEGER, suggested_amount INTEGER, currency TEXT,
        payment_status TEXT, is_free_booking INTEGER, paid_at TEXT, page_id TEXT,
        action_id TEXT, campaign TEXT, quantity INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE booking_holds (
        id TEXT PRIMARY KEY, site_id TEXT NOT NULL, booking_id TEXT, offer_id TEXT,
        booking_type TEXT NOT NULL, hold_token TEXT UNIQUE, slot_start TEXT NOT NULL,
        slot_end TEXT NOT NULL, status TEXT NOT NULL, expires_at TEXT NOT NULL,
        created_at TEXT, updated_at TEXT, quantity INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE site_files (
        site_id TEXT, path TEXT, content BLOB, content_type TEXT, size INTEGER,
        sha256 TEXT, updated_at TEXT
      );
    `);
  }

  prepare(sql: string) {
    const statement = this.raw.prepare(sql);
    let values: unknown[] = [];
    const wrapper = {
      bind: (...next: unknown[]) => {
        values = next;
        return wrapper;
      },
      run: async () => {
        const result = statement.run(...(values as any[]));
        return { meta: { changes: Number(result.changes) } };
      },
      first: async <T>() => (statement.get(...(values as any[])) || null) as T | null,
      all: async <T>() => ({ results: statement.all(...(values as any[])) as T[] }),
    };
    return wrapper;
  }

  async batch(statements: Array<{ run(): Promise<{ meta: { changes: number } }> }>) {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.raw.exec("COMMIT");
      return results;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }
}
