import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateProfile, type Me3Profile } from "me3-protocol";
import type { Me3SiteProfile } from "@me3-core/site-renderer";
import type { Env } from "./types";

// Failure modes: a changed price slipping through, a held slot staying blocked
// after 15 minutes (or freed while the buyer is paying), a retry creating a second
// Stripe session, a status read without the secret, checkout continuing after the
// owner turned it off, and agents flooding one IP or one buyer installation.

const stripeState = vi.hoisted(() => ({
  sessions: new Map<string, Record<string, any>>(),
  created: [] as Array<Record<string, any>>,
  failNextCreate: false,
}));

vi.mock("stripe", () => {
  class FakeStripe {
    checkout = {
      sessions: {
        create: async (params: Record<string, any>) => {
          if (stripeState.failNextCreate) {
            stripeState.failNextCreate = false;
            throw new Error("Stripe is unavailable");
          }
          const id = `cs_test_${stripeState.sessions.size + 1}`;
          const line = params.line_items[0];
          const session = {
            id,
            object: "checkout.session",
            url: `https://checkout.stripe.test/c/${id}`,
            status: "open",
            payment_status: "unpaid",
            payment_intent: null,
            amount_total: line.price_data.unit_amount * line.quantity,
            amount_subtotal: line.price_data.unit_amount * line.quantity,
            currency: line.price_data.currency,
            metadata: params.metadata,
            expires_at: params.expires_at,
          };
          stripeState.sessions.set(id, session);
          stripeState.created.push(params);
          return session;
        },
        retrieve: async (id: string) => stripeState.sessions.get(id),
      },
    };
  }
  return { default: FakeStripe };
});

vi.mock("./transactional-emails", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./transactional-emails")>()),
  getOwnerContact: vi.fn(async () => ({ name: "Aoife", email: "aoife@example.com" })),
  sendBookingConfirmationEmails: vi.fn(async () => ({ guest: { status: "sent" }, host: { status: "sent" } })),
  sendProductPurchaseConfirmationEmail: vi.fn(async () => ({ status: "sent" })),
}));
vi.mock("./booking-reminders", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./booking-reminders")>()),
  scheduleBookingRemindersForBooking: vi.fn(async () => undefined),
}));
vi.mock("./payment-notifications", () => ({
  dispatchWebsitePaymentNotification: vi.fn(async () => undefined),
}));

const { default: app } = await import("./app");
const { setAgentCheckoutEnabled } = await import("./agent-commerce-store");
const { getCommerceSettings, updateCommerceSettings } = await import("./commerce-settings");
const { buildPublicMe3Profile } = await import("./public-me-profile");
const {
  AGENT_COMMERCE_RATE_LIMITS,
  expireStaleAgentCheckouts,
  listAgentOfferings,
  resolveAgentCheckoutPublication,
} = await import("./agent-commerce");
const { getMe3CloudApiOrigin, serveMeJsonResponse } = await import("./sites");

const ORIGIN = "https://core.example";
const BASE = `${ORIGIN}/api/agent-commerce/v1/sites/aoife`;
const databases: DatabaseSync[] = [];

afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
  stripeState.sessions.clear();
  stripeState.created.length = 0;
  stripeState.failNextCreate = false;
  vi.unstubAllGlobals();
});

function dateInDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
const TARGET_DATE = dateInDays(3);
const RETREAT_START = dateInDays(20);
const RETREAT_END = dateInDays(22);
const ALL_DAYS = Object.fromEntries(
  ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((day) => [day, ["09:00-12:00"]]),
);
function weekdayOf(date: string) {
  return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][
    new Date(`${date}T12:00:00Z`).getUTCDay()
  ];
}

// Europe/Dublin; the UTC instant for a local time on TARGET_DATE.
function dublinInstant(date: string, time: string): string {
  for (const offset of ["+01:00", "Z"]) {
    const instant = new Date(`${date}T${time}:00${offset}`);
    const local = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(instant);
    if (local === time) return instant.toISOString();
  }
  throw new Error("unreachable");
}

function sellerProfile(): Me3SiteProfile {
  return {
    version: "0.1",
    handle: "aoife",
    name: "Aoife",
    intents: {
      book: {
        enabled: true,
        title: "Sessions",
        offers: [
          { id: "intro-call", title: "Intro call", duration: 30, pricing: { enabled: false } },
          {
            id: "coaching",
            title: "Coaching session",
            duration: 60,
            pricing: { enabled: true, suggestedAmount: 60, currency: "EUR", allowFlexiblePricing: false },
          },
          {
            id: "pay-later",
            title: "Pay later session",
            duration: 60,
            pricing: {
              enabled: true, suggestedAmount: 40, currency: "EUR",
              paymentMethod: "manual", paymentInstructions: "Bank transfer",
            },
          },
        ],
        availability: { timezone: "Europe/Dublin", windows: ALL_DAYS },
        bookingTypes: [
          {
            type: "class",
            classes: [{
              id: "yoga",
              title: "Morning yoga",
              duration: 60,
              timezone: "Europe/Dublin",
              capacity: 3,
              pricing: { enabled: true, suggestedAmount: 12, currency: "EUR" },
              recurrence: { frequency: "weekly", weekday: weekdayOf(TARGET_DATE), startTime: "07:00" },
            }],
          },
          {
            type: "retreat",
            retreats: [{
              id: "silent-weekend",
              title: "Silent weekend",
              timezone: "Europe/Dublin",
              capacity: 10,
              pricing: { enabled: false },
              startDate: RETREAT_START,
              startTime: "17:00",
              endDate: RETREAT_END,
              endTime: "14:00",
            }],
          },
        ],
      },
    },
    products: [
      { slug: "clarity-kit", title: "Clarity Kit", file: "shop/clarity-kit.md", price: 4900, currency: "EUR", available: true },
      {
        slug: "printed-journal", title: "Printed journal", file: "shop/printed-journal.md", price: 3000, currency: "EUR", available: true,
        delivery: { kind: "physical", instructions: "Ships in 3 days", returns: "30 days", shippingCost: 500, countries: ["IE"] },
      },
      {
        slug: "pdf-by-email", title: "PDF by email", file: "shop/pdf-by-email.md", price: 900, currency: "EUR", available: true,
        paymentMethod: "manual", paymentInstructions: "Revolut",
      },
    ],
  } as Me3SiteProfile;
}

function fixture(options: { stripe?: boolean; published?: boolean } = {}) {
  const raw = new DatabaseSync(":memory:");
  databases.push(raw);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(new URL(name, migrations), "utf8"));
  }
  raw.prepare("INSERT INTO owner_profile (id, username, timezone) VALUES ('owner', 'aoife', 'Europe/Dublin')").run();
  raw.prepare(
    `INSERT INTO sites (id, user_id, username, site_type, site_role, created_at, updated_at, published_at)
     VALUES ('site-1', 'owner', 'aoife', 'profile', 'profile', datetime('now'), datetime('now'), ?)`,
  ).run(options.published === false ? null : "2026-10-01 10:00:00");
  const executions = new WeakMap<object, () => unknown>();
  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...args: unknown[]) { values = args; return statement; },
        async first<T>() { return (raw.prepare(sql).get(...values as never[]) ?? null) as T | null; },
        async all<T>() { return { results: raw.prepare(sql).all(...values as never[]) as T[] }; },
        async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }; },
      };
      executions.set(statement, () => ({ meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }));
      return statement;
    },
    async batch(statements: object[]) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => executions.get(statement)!());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
  const env = {
    DB: db,
    ENVIRONMENT: "test",
    ME3_DEPLOYMENT_MODE: "self_hosted",
    TOKEN_ENCRYPTION_KEY: "agent-commerce-test-key",
    ...(options.stripe === false ? {} : { STRIPE_SECRET_KEY: "sk_test_agent_commerce" }),
  } as unknown as Env;
  const setProfile = (profile: Me3SiteProfile) => {
    raw.prepare("DELETE FROM site_files WHERE site_id = 'site-1' AND path = 'src/me.json'").run();
    const bytes = new TextEncoder().encode(JSON.stringify(profile));
    raw.prepare(
      `INSERT INTO site_files (site_id, path, content, content_type, size, updated_at)
       VALUES ('site-1', 'src/me.json', ?, 'application/json', ?, datetime('now'))`,
    ).run(bytes, bytes.byteLength);
  };
  setProfile(sellerProfile());
  return { raw, env, setProfile };
}

type Json = Record<string, any>;

async function call(env: Env, path: string, init: RequestInit & { ip?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", init.ip || "203.0.113.10");
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await app.fetch(new Request(`${BASE}${path}`, { ...init, headers }), env);
  const text = await response.text();
  let body: Json = {};
  try { body = JSON.parse(text); } catch { body = { text }; }
  return { status: response.status, body, headers: response.headers };
}

function checkoutBody(overrides: Json = {}): Json {
  return {
    offeringId: "service:coaching",
    slot: { start: dublinInstant(TARGET_DATE, "10:00") },
    buyer: { name: "Sam Buyer", email: "sam@example.com" },
    expectedAmount: 6000,
    expectedCurrency: "EUR",
    idempotencyKey: "approval-0001",
    ...overrides,
  };
}

async function createCheckout(env: Env, overrides: Json = {}, init: { ip?: string; headers?: HeadersInit } = {}) {
  return call(env, "/checkouts", { method: "POST", body: JSON.stringify(checkoutBody(overrides)), ...init });
}

function paySession(sessionId: string, paymentIntent = `pi_${sessionId}`) {
  const session = stripeState.sessions.get(sessionId)!;
  Object.assign(session, { status: "complete", payment_status: "paid", payment_intent: paymentIntent });
}

describe("agent commerce offerings", () => {
  it("publishes an OpenAPI document whose server is this site's API", async () => {
    const { env } = fixture();
    const { status, body } = await call(env, "/openapi.json");
    expect(status).toBe(200);
    expect(body.openapi).toBe("3.1.0");
    expect(body.servers).toEqual([{ url: BASE }]);
    expect(Object.values(body.paths).flatMap((path: any) => Object.values(path).map((operation: any) => operation.operationId)))
      .toEqual(["listOfferings", "getOfferingAvailability", "createCheckout", "getCheckout"]);
  });

  it("lists only agent-ready offerings, with the ids me.json publishes", async () => {
    const { env } = fixture();
    const { status, body } = await call(env, "/offerings");
    expect(status).toBe(200);
    const byId = Object.fromEntries(body.offerings.map((offering: Json) => [offering.id, offering]));
    expect(Object.keys(byId)).toEqual([
      "service:intro-call",
      "service:coaching",
      "service:yoga",
      "service:silent-weekend",
      "product:clarity-kit",
    ]);
    expect(byId["service:coaching"]).toMatchObject({
      kind: "booking", amount: 6000, currency: "EUR", free: false, durationMinutes: 60,
      timezone: "Europe/Dublin", requiresSlot: true, maxQuantity: 1, buyerFields: ["name", "email"],
    });
    expect(byId["service:intro-call"]).toMatchObject({ amount: 0, free: true, currency: "EUR" });
    expect(byId["service:yoga"]).toMatchObject({ kind: "event", eventType: "class", amount: 1200, capacity: 3, maxQuantity: 3 });
    expect(byId["service:silent-weekend"]).toMatchObject({ kind: "event", eventType: "retreat", requiresSlot: false });
    expect(byId["product:clarity-kit"]).toMatchObject({ kind: "product", amount: 4900, requiresSlot: false });

    const publicProfile = buildPublicMe3Profile(sellerProfile(), "https://aoife.example") as Me3Profile & Json;
    const publicIds = [...publicProfile.services, ...publicProfile.products].map((offering: Json) => offering.id);
    for (const id of Object.keys(byId)) expect(publicIds).toContain(id);
  });

  it("returns live slots for a range and hides held and booked times", async () => {
    const { env, raw } = fixture();
    raw.prepare(
      `INSERT INTO booking_holds (id, site_id, offer_id, booking_type, hold_token, slot_start, slot_end, status, expires_at, created_at, updated_at)
       VALUES ('h1', 'site-1', 'coaching', 'one_to_one', 'tok-1', ?, ?, 'active', ?, datetime('now'), datetime('now'))`,
    ).run(dublinInstant(TARGET_DATE, "10:00"), dublinInstant(TARGET_DATE, "11:00"), new Date(Date.now() + 10 * 60_000).toISOString());
    const { status, body } = await call(env, `/offerings/service%3Acoaching/availability?from=${TARGET_DATE}&to=${TARGET_DATE}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ offeringId: "service:coaching", kind: "booking", timezone: "Europe/Dublin", available: true });
    expect(body.slots.map((slot: Json) => slot.localTime)).toEqual(["09:00", "11:00"]);
    expect(body.slots[0]).toEqual({
      start: dublinInstant(TARGET_DATE, "09:00"),
      end: dublinInstant(TARGET_DATE, "10:00"),
      localDate: TARGET_DATE,
      localTime: "09:00",
    });

    const week = await call(env, "/offerings/service:intro-call/availability");
    expect(week.status).toBe(200);
    expect(new Set(week.body.slots.map((slot: Json) => slot.localDate)).size).toBeGreaterThanOrEqual(6);

    const tooLong = await call(env, `/offerings/service:coaching/availability?from=${TARGET_DATE}&to=${dateInDays(60)}`);
    expect(tooLong).toMatchObject({ status: 400, body: { code: "invalid_range" } });
    expect((await call(env, "/offerings/service:nope/availability")).body.code).toBe("offering_not_found");
  });

  it("reports class sessions with the spaces left", async () => {
    const { env } = fixture();
    const { body } = await call(env, `/offerings/service:yoga/availability?from=${TARGET_DATE}&to=${TARGET_DATE}`);
    expect(body.slots).toEqual([
      expect.objectContaining({ start: dublinInstant(TARGET_DATE, "07:00"), localTime: "07:00", remaining: 3 }),
    ]);
  });
});

describe("agent checkouts", () => {
  it("creates a paid booking checkout with a 15-minute hold on the seller's Stripe", async () => {
    const { env, raw } = fixture();
    const before = Date.now();
    const { status, body } = await createCheckout(env);
    expect(status).toBe(201);
    expect(body).toMatchObject({
      status: "pending",
      offeringId: "service:coaching",
      kind: "booking",
      amount: 6000,
      currency: "EUR",
      quantity: 1,
      slot: { start: dublinInstant(TARGET_DATE, "10:00"), end: dublinInstant(TARGET_DATE, "11:00") },
      payUrl: `${BASE}/checkouts/${body.checkoutId}/pay`,
      reference: null,
      statusUrl: `${BASE}/checkouts/${body.checkoutId}`,
    });
    expect(body.statusSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const expiresIn = Date.parse(body.expiresAt) - before;
    expect(expiresIn).toBeGreaterThanOrEqual(15 * 60_000 - 1000);
    expect(expiresIn).toBeLessThanOrEqual(15 * 60_000 + 5000);

    const hold = raw.prepare("SELECT * FROM booking_holds").get() as Json;
    expect(hold).toMatchObject({ offer_id: "coaching", status: "active", slot_start: dublinInstant(TARGET_DATE, "10:00") });
    expect(Date.parse(hold.expires_at)).toBe(Date.parse(body.expiresAt));

    expect(stripeState.created).toHaveLength(1);
    const session = stripeState.created[0];
    expect(session.line_items[0].price_data).toMatchObject({ currency: "eur", unit_amount: 6000 });
    expect(session.metadata).toMatchObject({ purchase_kind: "booking", offer_id: "coaching", hold_token: hold.hold_token, guest_email: "sam@example.com", campaign: "agent-commerce" });
    // Stripe keeps a session open at least 30 minutes.
    expect(session.expires_at * 1000 - before).toBeGreaterThanOrEqual(30 * 60_000);

    const slots = await call(env, `/offerings/service:coaching/availability?from=${TARGET_DATE}&to=${TARGET_DATE}`);
    expect(slots.body.slots.map((slot: Json) => slot.localTime)).not.toContain("10:00");
  });

  it("refuses a changed price and returns the live one", async () => {
    const { env, raw } = fixture();
    const stale = await createCheckout(env, { expectedAmount: 5000 });
    expect(stale).toMatchObject({ status: 409, body: { code: "price_changed", amount: 6000, currency: "EUR", unitAmount: 6000 } });
    expect((await createCheckout(env, { expectedCurrency: "GBP" })).body.code).toBe("price_changed");
    const product = await createCheckout(env, { offeringId: "product:clarity-kit", slot: undefined, expectedAmount: 3900 });
    expect(product).toMatchObject({ status: 409, body: { code: "price_changed", amount: 4900 } });
    expect(stripeState.created).toHaveLength(0);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM agent_commerce_checkouts").get()).toEqual({ n: 0 });
    expect(raw.prepare("SELECT COUNT(*) AS n FROM commerce_orders").get()).toEqual({ n: 0 });
  });

  it("returns the same checkout and secret for a retried request", async () => {
    const { env, raw } = fixture();
    const first = await createCheckout(env);
    const retry = await createCheckout(env);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.checkoutId).toBe(first.body.checkoutId);
    expect(retry.body.statusSecret).toBe(first.body.statusSecret);
    expect(stripeState.created).toHaveLength(1);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM booking_holds").get()).toEqual({ n: 1 });

    const reused = await createCheckout(env, { buyer: { name: "Someone Else", email: "other@example.com" } });
    expect(reused).toMatchObject({ status: 409, body: { code: "idempotency_conflict" } });
  });

  it("never creates two sessions for concurrent retries", async () => {
    const { env } = fixture();
    const results = await Promise.all([createCheckout(env), createCheckout(env), createCheckout(env)]);
    const ids = new Set(results.filter((result) => result.status < 300).map((result) => result.body.checkoutId));
    expect(ids.size).toBe(1);
    for (const result of results) {
      expect([200, 201, 409]).toContain(result.status);
      if (result.status === 409) expect(result.body.code).toBe("checkout_in_progress");
    }
    expect(stripeState.created).toHaveLength(1);
  });

  it("lets a retry with the same key try again after a failed checkout", async () => {
    const { env, raw } = fixture();
    stripeState.failNextCreate = true;
    const failed = await createCheckout(env);
    expect(failed).toMatchObject({ status: 503, body: { code: "commerce_unavailable" } });
    expect(raw.prepare("SELECT status FROM booking_holds").get()).toEqual({ status: "released" });
    const retried = await createCheckout(env);
    expect(retried.status).toBe(201);
  });

  it("only reads a checkout with its status secret", async () => {
    const { env } = fixture();
    const { body } = await createCheckout(env);
    const path = `/checkouts/${body.checkoutId}`;
    expect((await call(env, path)).status).toBe(404);
    expect((await call(env, path, { headers: { Authorization: "Bearer not-the-secret" } })).status).toBe(404);
    const other = await createCheckout(env, { idempotencyKey: "approval-0002", slot: { start: dublinInstant(TARGET_DATE, "09:00") } });
    expect((await call(env, path, { headers: { Authorization: `Bearer ${other.body.statusSecret}` } })).status).toBe(404);
    const read = await call(env, path, { headers: { Authorization: `Bearer ${body.statusSecret}` } });
    expect(read).toMatchObject({ status: 200, body: { checkoutId: body.checkoutId, status: "pending", amount: 6000 } });
    expect(read.body).not.toHaveProperty("statusSecret");
  });

  it("hands over Stripe once opened and reports the paid booking", async () => {
    const { env, raw } = fixture();
    const { body } = await createCheckout(env);
    const auth = { Authorization: `Bearer ${body.statusSecret}` };

    const pay = await app.fetch(new Request(body.payUrl), env);
    expect(pay.status).toBe(303);
    const sessionId = stripeState.created.length === 1 ? [...stripeState.sessions.keys()][0] : "";
    expect(pay.headers.get("Location")).toBe(`https://checkout.stripe.test/c/${sessionId}`);
    // An opened checkout keeps its slot until the Stripe session closes.
    const row = raw.prepare("SELECT created_at, expires_at, opened_at FROM agent_commerce_checkouts").get() as Json;
    expect(Date.parse(row.expires_at) - Date.parse(row.created_at)).toBe(32 * 60_000);
    const hold = raw.prepare("SELECT expires_at FROM booking_holds").get() as Json;
    expect(Date.parse(hold.expires_at) - Date.parse(row.created_at)).toBe(37 * 60_000);

    expect((await call(env, `/checkouts/${body.checkoutId}`, { headers: auth })).body.status).toBe("pending");
    paySession(sessionId);
    const paid = await call(env, `/checkouts/${body.checkoutId}`, { headers: auth });
    expect(paid.body).toMatchObject({ status: "paid", paidAmount: 6000, paidCurrency: "EUR", payUrl: null, reference: { type: "booking" } });
    const booking = raw.prepare("SELECT * FROM bookings").get() as Json;
    expect(booking).toMatchObject({
      id: paid.body.reference.id, status: "confirmed", guest_email: "sam@example.com",
      payment_status: "succeeded", amount_paid: 6000, campaign: "agent-commerce",
    });
    expect(raw.prepare("SELECT status FROM booking_holds").get()).toEqual({ status: "confirmed" });

    const again = await app.fetch(new Request(body.payUrl), env);
    expect(again.status).toBe(409);
    expect(await again.text()).toContain("already paid");

    raw.prepare("UPDATE bookings SET status = 'cancelled'").run();
    expect((await call(env, `/checkouts/${body.checkoutId}`, { headers: auth })).body.status).toBe("cancelled");
  });

  it("releases an unpaid hold after 15 minutes", async () => {
    const { env, raw } = fixture();
    const { body } = await createCheckout(env);
    const auth = { Authorization: `Bearer ${body.statusSecret}` };
    // Fifteen minutes pass: the hold expired earlier today, not at midnight.
    const expired = new Date(Date.now() - 60_000).toISOString();
    raw.prepare("UPDATE booking_holds SET expires_at = ?").run(expired);
    raw.prepare("UPDATE agent_commerce_checkouts SET expires_at = ?").run(expired);

    const slots = await call(env, `/offerings/service:coaching/availability?from=${TARGET_DATE}&to=${TARGET_DATE}`);
    expect(slots.body.slots.map((slot: Json) => slot.localTime)).toContain("10:00");

    expect((await call(env, `/checkouts/${body.checkoutId}`, { headers: auth })).body).toMatchObject({ status: "expired", payUrl: null });
    expect(raw.prepare("SELECT status FROM booking_holds").get()).toEqual({ status: "expired" });
    const pay = await app.fetch(new Request(body.payUrl), env);
    expect(pay.status).toBe(410);

    const nextBuyer = await createCheckout(env, { idempotencyKey: "approval-0003", buyer: { name: "Next", email: "next@example.com" } });
    expect(nextBuyer.status).toBe(201);
  });

  it("keeps an opened checkout's slot through the payment window and its grace", async () => {
    const { env, raw } = fixture();
    const { body } = await createCheckout(env);
    const auth = { Authorization: `Bearer ${body.statusSecret}` };
    expect((await app.fetch(new Request(body.payUrl), env)).status).toBe(303);
    // The Stripe window has just closed; the hold's confirmation grace has not.
    raw.prepare("UPDATE agent_commerce_checkouts SET expires_at = ?").run(new Date(Date.now() - 60_000).toISOString());
    raw.prepare("UPDATE booking_holds SET expires_at = ?").run(new Date(Date.now() + 4 * 60_000).toISOString());
    expect((await call(env, `/checkouts/${body.checkoutId}`, { headers: auth })).body.status).toBe("pending");

    paySession([...stripeState.sessions.keys()][0]);
    const paid = await call(env, `/checkouts/${body.checkoutId}`, { headers: auth });
    expect(paid.body).toMatchObject({ status: "paid", reference: { type: "booking" } });
  });

  it("expires an opened checkout nobody paid once the grace ends", async () => {
    const { env, raw } = fixture();
    const { body } = await createCheckout(env);
    expect((await app.fetch(new Request(body.payUrl), env)).status).toBe(303);
    raw.prepare("UPDATE agent_commerce_checkouts SET expires_at = ?").run(new Date(Date.now() - 6 * 60_000).toISOString());
    raw.prepare("UPDATE booking_holds SET expires_at = ?").run(new Date(Date.now() - 60_000).toISOString());
    const read = await call(env, `/checkouts/${body.checkoutId}`, { headers: { Authorization: `Bearer ${body.statusSecret}` } });
    expect(read.body.status).toBe("expired");
    expect(raw.prepare("SELECT status FROM booking_holds").get()).toEqual({ status: "expired" });
  });

  it("does not let an interrupted request block its idempotency key", async () => {
    const { env, raw } = fixture();
    expect((await createCheckout(env)).status).toBe(201);
    raw.prepare("UPDATE agent_commerce_checkouts SET status = 'creating', created_at = ?").run(
      new Date(Date.now() - 3 * 60_000).toISOString(),
    );
    raw.prepare("UPDATE booking_holds SET status = 'released'").run();
    const retried = await createCheckout(env);
    expect(retried.status).toBe(201);
    expect(raw.prepare("SELECT COUNT(*) AS n FROM agent_commerce_checkouts").get()).toEqual({ n: 1 });
  });

  it("expires unpolled checkouts in the scheduled sweep", async () => {
    const { env, raw } = fixture();
    await createCheckout(env);
    raw.prepare("UPDATE agent_commerce_checkouts SET expires_at = ?").run(new Date(Date.now() - 60_000).toISOString());
    await expireStaleAgentCheckouts(env);
    expect(raw.prepare("SELECT status FROM agent_commerce_checkouts").get()).toEqual({ status: "expired" });
  });

  it("refuses a slot that another checkout is holding", async () => {
    const { env } = fixture();
    expect((await createCheckout(env)).status).toBe(201);
    const second = await createCheckout(env, { idempotencyKey: "approval-0004", buyer: { name: "Late", email: "late@example.com" } });
    expect(second).toMatchObject({ status: 409, body: { code: "slot_unavailable" } });
    const offGrid = await createCheckout(env, { idempotencyKey: "approval-0005", slot: { start: dublinInstant(TARGET_DATE, "14:00") } });
    expect(offGrid).toMatchObject({ status: 400, body: { code: "invalid_slot" } });
    const missing = await createCheckout(env, { idempotencyKey: "approval-0006", slot: undefined });
    expect(missing.body.code).toBe("slot_required");
  });

  it("confirms a free booking at once", async () => {
    const { env, raw } = fixture();
    const { status, body } = await createCheckout(env, {
      offeringId: "service:intro-call",
      slot: { start: dublinInstant(TARGET_DATE, "09:30") },
      expectedAmount: 0,
    });
    expect(status).toBe(201);
    expect(body).toMatchObject({ status: "paid", amount: 0, payUrl: null, paidAmount: 0, reference: { type: "booking" } });
    expect(raw.prepare("SELECT offer_id, status, is_free_booking, campaign FROM bookings").get())
      .toEqual({ offer_id: "intro-call", status: "confirmed", is_free_booking: 1, campaign: "agent-commerce" });
    expect(stripeState.created).toHaveLength(0);
  });

  it("holds class spaces for several attendees and respects capacity", async () => {
    const { env } = fixture();
    const start = dublinInstant(TARGET_DATE, "07:00");
    const pair = await createCheckout(env, { offeringId: "service:yoga", slot: { start }, quantity: 2, expectedAmount: 2400 });
    expect(pair.status).toBe(201);
    expect(pair.body).toMatchObject({ kind: "event", quantity: 2, amount: 2400 });
    expect(stripeState.created[0].line_items[0]).toMatchObject({ quantity: 2, price_data: { unit_amount: 1200 } });
    const remaining = await call(env, `/offerings/service:yoga/availability?from=${TARGET_DATE}&to=${TARGET_DATE}`);
    expect(remaining.body.slots[0].remaining).toBe(1);
    const tooMany = await createCheckout(env, {
      offeringId: "service:yoga", slot: { start }, quantity: 2, expectedAmount: 2400, idempotencyKey: "approval-0007",
    });
    expect(tooMany).toMatchObject({ status: 409, body: { code: "slot_unavailable" } });

    const free = await createCheckout(env, { offeringId: "service:silent-weekend", slot: undefined, quantity: 2, expectedAmount: 0, idempotencyKey: "approval-0008" });
    expect(free.body).toMatchObject({ status: "paid", quantity: 2, reference: { type: "booking" } });
  });

  it("checks out a product and reports the paid order", async () => {
    const { env, raw } = fixture();
    const { status, body } = await createCheckout(env, { offeringId: "product:clarity-kit", slot: undefined, expectedAmount: 4900 });
    expect(status).toBe(201);
    expect(body).toMatchObject({ kind: "product", amount: 4900, reference: { type: "order" } });
    const order = raw.prepare("SELECT * FROM commerce_orders").get() as Json;
    expect(order).toMatchObject({ id: body.reference.id, status: "pending", amount_due: 4900, campaign: "agent-commerce", provider: "stripe_direct" });
    expect(stripeState.created[0].expires_at).toBeGreaterThan(Date.now() / 1000 + 30 * 60);

    const pay = await app.fetch(new Request(body.payUrl), env);
    expect(pay.status).toBe(303);
    paySession(order.checkout_session_id);
    const paid = await call(env, `/checkouts/${body.checkoutId}`, { headers: { Authorization: `Bearer ${body.statusSecret}` } });
    expect(paid.body).toMatchObject({ status: "paid", paidAmount: 4900, paidCurrency: "EUR" });
    expect(raw.prepare("SELECT status FROM commerce_orders").get()).toEqual({ status: "paid" });

    expect((await createCheckout(env, { offeringId: "product:printed-journal", slot: undefined, expectedAmount: 3000, idempotencyKey: "approval-0009" })).status).toBe(404);
  });

  it("validates the request body", async () => {
    const { env } = fixture();
    for (const overrides of [
      { idempotencyKey: "short" },
      { buyer: { name: "Sam" } },
      { expectedAmount: 60.5 },
      { expectedCurrency: "euro" },
      { quantity: 0 },
      { slot: { start: "tomorrow" } },
    ]) {
      expect((await createCheckout(env, overrides)).body.code).toBe("invalid_request");
    }
    expect((await createCheckout(env, { quantity: 2, expectedAmount: 12000 })).body.code).toBe("invalid_quantity");
  });
});

describe("seller controls", () => {
  it("turns agent checkout off without breaking existing checkouts", async () => {
    const { env } = fixture();
    const existing = await createCheckout(env);
    await setAgentCheckoutEnabled(env, "owner", false);
    expect(await call(env, "/offerings")).toMatchObject({ status: 403, body: { code: "agent_checkout_disabled" } });
    expect((await createCheckout(env, { idempotencyKey: "approval-0010" })).body.code).toBe("agent_checkout_disabled");
    expect((await call(env, `/offerings/service:coaching/availability`)).status).toBe(403);
    const read = await call(env, `/checkouts/${existing.body.checkoutId}`, { headers: { Authorization: `Bearer ${existing.body.statusSecret}` } });
    expect(read.status).toBe(200);
    await setAgentCheckoutEnabled(env, "owner", true);
    expect((await call(env, "/offerings")).status).toBe(200);
  });

  it("is on by default and saved through commerce settings", async () => {
    const { env } = fixture();
    expect((await getCommerceSettings(env, "owner")).agentCheckout).toEqual({ enabled: true });
    expect((await updateCommerceSettings(env, "owner", { agentCheckoutEnabled: false })).agentCheckout).toEqual({ enabled: false });
    await expect(updateCommerceSettings(env, "owner", { agentCheckoutEnabled: "no" })).rejects.toThrow("Turn agent checkout on or off.");
  });

  it("needs commerce and a published site", async () => {
    expect((await call(fixture({ stripe: false }).env, "/offerings")).body.code).toBe("commerce_unavailable");
    expect((await call(fixture({ published: false }).env, "/offerings")).body.code).toBe("site_not_found");
  });
});

describe("rate limits and buyer identity", () => {
  it("limits anonymous checkouts per IP", async () => {
    const { env } = fixture();
    const limit = AGENT_COMMERCE_RATE_LIMITS.checkout.anonymous;
    for (let index = 0; index < limit; index++) {
      await createCheckout(env, { expectedAmount: 1 }, { ip: "198.51.100.7" });
    }
    const blocked = await createCheckout(env, { expectedAmount: 1 }, { ip: "198.51.100.7" });
    expect(blocked).toMatchObject({ status: 429, body: { code: "rate_limited" } });
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await createCheckout(env, { expectedAmount: 1 }, { ip: "198.51.100.8" })).status).toBe(409);
  });

  it("limits a verified buyer installation by its identity, not its IP", async () => {
    const { env } = fixture();
    const keys = await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    );
    const jwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "test-key" };
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      String(url).endsWith("/.well-known/jwks.json")
        ? new Response(JSON.stringify({ keys: [jwk] }))
        : new Response("not found", { status: 404 })));
    const now = Math.floor(Date.now() / 1000);
    const sign = async (claims: Json) => {
      const encode = (value: Json) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const unsigned = `${encode({ alg: "RS256", kid: "test-key" })}.${encode(claims)}`;
      const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.privateKey, new TextEncoder().encode(unsigned));
      return `${unsigned}.${Buffer.from(signature).toString("base64url")}`;
    };
    const claims = {
      iss: getMe3CloudApiOrigin(env), aud: "me3-agent-commerce", iat: now, exp: now + 300,
      install_id: "core_0b7c6f7e-1d2a-4c3b-9a8e-123456789abc",
    };
    const token = await sign(claims);

    const ok = await createCheckout(env, {}, { ip: "198.51.100.9", headers: { "ME3-Buyer-Install": token } });
    expect(ok.status).toBe(201);
    expect(databases[databases.length - 1].prepare("SELECT buyer_install_id, idempotency_scope FROM agent_commerce_checkouts").get())
      .toEqual({ buyer_install_id: claims.install_id, idempotency_scope: `install:${claims.install_id}` });
    // The same key from an anonymous caller is a different checkout scope.
    expect((await createCheckout(env, {}, { ip: "198.51.100.9" })).body.code).toBe("slot_unavailable");

    const limit = AGENT_COMMERCE_RATE_LIMITS.checkout.anonymous;
    for (let index = 0; index < limit; index++) {
      await createCheckout(env, { expectedAmount: 1 }, { ip: "198.51.100.10" });
    }
    expect((await createCheckout(env, { expectedAmount: 1 }, { ip: "198.51.100.10" })).status).toBe(429);
    expect((await createCheckout(env, { expectedAmount: 1 }, { ip: "198.51.100.10", headers: { "ME3-Buyer-Install": token } })).status).toBe(409);

    const forged = `${token.slice(0, -4)}AAAA`;
    expect((await createCheckout(env, {}, { headers: { "ME3-Buyer-Install": forged } })).body.code).toBe("invalid_buyer_install");
    const wrongAudience = await sign({ ...claims, aud: "something-else" });
    expect((await call(env, "/offerings", { headers: { "ME3-Buyer-Install": wrongAudience } })).status).toBe(401);
    const longLived = await sign({ ...claims, exp: now + 24 * 3600 });
    expect((await call(env, "/offerings", { headers: { "ME3-Buyer-Install": longLived } })).status).toBe(401);
  });

  it("answers CORS preflight for browser agents", async () => {
    const { env } = fixture();
    const response = await app.fetch(new Request(`${BASE}/checkouts`, {
      method: "OPTIONS",
      headers: { Origin: "https://agent.example", "Access-Control-Request-Method": "POST" },
    }), env);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("ME3-Buyer-Install");
    const offerings = await app.fetch(new Request(`${BASE}/offerings`, { headers: { Origin: "https://agent.example" } }), env);
    expect(offerings.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("me.json agent checkout projection", () => {
  const agentCheckout = {
    specUrl: "https://aoife.example/api/agent-commerce/v1/sites/aoife/openapi.json",
    offeringIds: listAgentOfferings(sellerProfile()).map((entry) => entry.offering.id),
    holdMinutes: 15,
  };

  it("turns book and purchase into openapi actions and keeps the human links", () => {
    const profile = buildPublicMe3Profile(sellerProfile(), "https://aoife.example", { agentCheckout }) as Json;
    expect(validateProfile(profile).valid).toBe(true);
    expect(profile.actions.book).toEqual({
      type: "openapi",
      spec: agentCheckout.specUrl,
      operationId: "createCheckout",
      description: expect.stringContaining("agent commerce API"),
    });
    expect(profile.actions["book-link"]).toEqual({ type: "link", url: "https://aoife.example/#booking" });
    expect(profile.actions.purchase).toMatchObject({ type: "openapi", operationId: "createCheckout" });
    expect(profile.actions["purchase-link"]).toMatchObject({ type: "link", url: "https://aoife.example/shop/" });
    expect(profile.capabilities.book.action).toBe("book");
    expect(profile.extensions["me3.app/agent-checkout"]).toEqual({
      version: "1",
      spec: agentCheckout.specUrl,
      offeringIds: ["service:intro-call", "service:coaching", "service:yoga", "service:silent-weekend", "product:clarity-kit"],
      holdMinutes: 15,
    });
  });

  it("stays link-only without agent checkout, for external booking pages, and without https", () => {
    const plain = buildPublicMe3Profile(sellerProfile(), "https://aoife.example") as Json;
    expect(plain.actions.book.type).toBe("link");
    expect(plain.actions["book-link"]).toBeUndefined();
    expect(plain.extensions).toBeUndefined();

    const external = sellerProfile();
    external.intents!.book!.url = "https://cal.example/aoife";
    const externalProfile = buildPublicMe3Profile(external, "https://aoife.example", {
      agentCheckout: { ...agentCheckout, offeringIds: listAgentOfferings(external).map((entry) => entry.offering.id) },
    }) as Json;
    expect(externalProfile.actions.book).toMatchObject({ type: "link", url: "https://cal.example/aoife" });
    expect(externalProfile.actions.purchase.type).toBe("openapi");

    const insecure = buildPublicMe3Profile(sellerProfile(), "https://aoife.example", {
      agentCheckout: { ...agentCheckout, specUrl: "http://aoife.example/openapi.json" },
    }) as Json;
    expect(insecure.actions.book.type).toBe("link");
  });

  it("withdraws agent checkout from served me.json when the owner turns it off", async () => {
    const { env, raw } = fixture();
    raw.prepare("UPDATE sites SET custom_domain = 'aoife.example', custom_domain_status = 'active'").run();
    const stored = buildPublicMe3Profile(sellerProfile(), "https://aoife.example", { agentCheckout });
    const bytes = new TextEncoder().encode(JSON.stringify(stored));
    raw.prepare(
      `INSERT INTO site_files (site_id, path, content, content_type, size, updated_at)
       VALUES ('site-1', 'public/me.json', ?, 'application/json', ?, datetime('now'))`,
    ).run(bytes, bytes.byteLength);
    const served = async () =>
      (await (await serveMeJsonResponse(env, new Request("https://aoife.example/me.json"))).json()) as Json;
    expect((await served()).actions.book.type).toBe("openapi");
    await setAgentCheckoutEnabled(env, "owner", false);
    const off = await served();
    expect(validateProfile(off).valid).toBe(true);
    expect(off.actions.book).toEqual({ type: "link", url: "https://aoife.example/#booking" });
    expect(off.actions["book-link"]).toBeUndefined();
    expect(off.actions.purchase.type).toBe("link");
    expect(off.extensions).toBeUndefined();
  });

  it("publishes agent checkout only when commerce is ready", async () => {
    const ready = fixture();
    const site = ready.raw.prepare("SELECT * FROM sites").get() as never;
    expect(await resolveAgentCheckoutPublication(ready.env, site, sellerProfile(), "https://aoife.example")).toEqual({
      specUrl: "https://aoife.example/api/agent-commerce/v1/sites/aoife/openapi.json",
      offeringIds: agentCheckout.offeringIds,
      holdMinutes: 15,
    });
    expect(await resolveAgentCheckoutPublication(ready.env, site, sellerProfile(), "http://localhost:8787")).toBeNull();
    const notReady = fixture({ stripe: false });
    expect(await resolveAgentCheckoutPublication(notReady.env, site, sellerProfile(), "https://aoife.example")).toBeNull();
  });
});
