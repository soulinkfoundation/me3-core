import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

const emails: Array<{ change: string; startsAt: string; previousStartsAt?: string | null; meetingUrl?: string | null }> = [];
const scheduled: Array<{ startsAt: string }> = [];
vi.mock("./booking-checkout", () => ({ getSiteById: async () => ({ id: "site", user_id: "owner", username: "kieran" }) }));
vi.mock("./booking", () => ({
  loadSiteProfileForCommerce: async () => ({ name: "Kieran", intents: { book: {} } }),
  resolveOneToOneBookingOffer: () => ({ title: "Intro call", availability: { timezone: "Europe/Dublin" } }),
  serializeBooking: (booking: { id: string; starts_at: string; ends_at: string; status: string }) =>
    ({ id: booking.id, startsAt: booking.starts_at, endsAt: booking.ends_at, status: booking.status }),
}));
vi.mock("./booking-reminders", () => ({
  cancelPendingBookingReminders: async () => {},
  scheduleBookingRemindersForBooking: async (_env: unknown, input: { booking: { starts_at: string } }) => { scheduled.push({ startsAt: input.booking.starts_at }); return 1; },
}));
vi.mock("./transactional-emails", () => ({
  getOwnerContact: async () => ({ name: "Kieran", email: "host@example.invalid" }),
  bookingDetailsFromBooking: (input: { booking: { starts_at: string; meeting_url: string | null } }) => ({ startsAt: input.booking.starts_at, meetingUrl: input.booking.meeting_url }),
  sendGuestBookingChangeEmail: async (_env: unknown, details: { change: string; startsAt: string; previousStartsAt?: string | null; meetingUrl?: string | null }) => {
    emails.push(details); return { status: "sent" };
  },
}));
const { BookingChangeError, cancelOwnerBooking, rescheduleOwnerBooking } = await import("./booking-changes");

const hour = 3_600_000;
const base = Math.floor(Date.now() / hour) * hour + hour;
const at = (offset: number) => new Date(base + offset).toISOString();

function fixture() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE sites (id TEXT, user_id TEXT, username TEXT);
    CREATE TABLE bookings (id TEXT, site_id TEXT, offer_id TEXT, booking_type TEXT, guest_name TEXT, guest_email TEXT, starts_at TEXT, ends_at TEXT,
      duration_minutes INTEGER, calendar_event_id TEXT, status TEXT, notes TEXT, created_at TEXT, cancelled_at TEXT, payment_intent_id TEXT,
      amount_paid INTEGER, suggested_amount INTEGER, currency TEXT, payment_status TEXT, is_free_booking INTEGER, paid_at TEXT,
      meeting_provider TEXT, meeting_url TEXT, meeting_host_url TEXT, meeting_guest_token_hash TEXT, meeting_title TEXT);
    CREATE TABLE booking_reminders (id TEXT, booking_id TEXT, status TEXT);
    INSERT INTO sites VALUES ('site','owner','kieran'), ('other-site','other','someone');`);
  const add = (id: string, startsAt: string, endsAt: string, site = "site", status = "confirmed") => raw.prepare(`INSERT INTO bookings
    (id,site_id,offer_id,booking_type,guest_name,guest_email,starts_at,ends_at,duration_minutes,status,meeting_provider,meeting_url,meeting_guest_token_hash,meeting_title)
    VALUES (?,?,'intro','one_to_one','Guest','guest@example.invalid',?,?,60,?,'soulink','https://soulinkfoundation.org/booking-calls/token','token-hash','Intro call')`)
    .run(id, site, startsAt, endsAt, status);
  add("booking", at(24 * hour), at(25 * hour));
  add("later", at(48 * hour), at(49 * hour));
  add("elsewhere", at(30 * hour), at(31 * hour), "other-site");
  add("old", at(72 * hour), at(73 * hour), "site", "cancelled");
  raw.exec("INSERT INTO booking_reminders VALUES ('sent-24h','booking','sent'),('due-2h','booking','scheduled'),('running','booking','processing')");
  const statement = (sql: string, values: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => raw.prepare(sql).get(...values as never[]) ?? null,
    run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }),
  });
  return { raw, env: { DB: { prepare: (sql: string) => statement(sql) } } as never };
}

// Failure modes: a moved booking gets a new id or token (breaking the guest's Soulink link), keeps its old end
// time, double-books, moves into the past, keeps reminders for the old time, or the guest is never told.
describe("owner booking changes", () => {
  beforeEach(() => { emails.length = 0; scheduled.length = 0; });

  it("moves a booking in place, keeping its id and guest link, and re-plans reminders", async () => {
    const { raw, env } = fixture();
    const before = raw.prepare("SELECT starts_at FROM bookings WHERE id='booking'").get() as { starts_at: string };
    const startsAt = at(26 * hour);
    const result = await rescheduleOwnerBooking(env, "owner", "booking", startsAt);
    expect(result.booking).toMatchObject({ id: "booking", startsAt, endsAt: new Date(Date.parse(startsAt) + hour).toISOString() });
    expect(raw.prepare("SELECT starts_at, meeting_guest_token_hash, meeting_url FROM bookings WHERE id='booking'").get())
      .toEqual({ starts_at: startsAt, meeting_guest_token_hash: "token-hash", meeting_url: "https://soulinkfoundation.org/booking-calls/token" });
    expect(raw.prepare("SELECT id FROM booking_reminders ORDER BY id").all()).toEqual([{ id: "running" }]);
    expect(scheduled).toEqual([{ startsAt }]);
    expect(emails).toEqual([expect.objectContaining({ change: "rescheduled", startsAt, previousStartsAt: before.starts_at,
      meetingUrl: "https://soulinkfoundation.org/booking-calls/token" })]);
  });

  it("refuses overlaps, past times, cancelled bookings and other owners' bookings", async () => {
    const { env } = fixture();
    const refused = async (promise: Promise<unknown>, status: number) => {
      const error = await promise.catch((cause: unknown) => cause) as InstanceType<typeof BookingChangeError>;
      expect(error).toBeInstanceOf(BookingChangeError);
      expect(error.status).toBe(status);
    };
    await refused(rescheduleOwnerBooking(env, "owner", "booking", at(48.5 * hour)), 409);
    await refused(rescheduleOwnerBooking(env, "owner", "booking", at(-hour)), 400);
    await refused(rescheduleOwnerBooking(env, "owner", "booking", "tomorrow-ish"), 400);
    await refused(rescheduleOwnerBooking(env, "owner", "old", at(80 * hour)), 409);
    await refused(rescheduleOwnerBooking(env, "owner", "elsewhere", at(80 * hour)), 404);
    // Another site's booking at the same time is not a conflict.
    await expect(rescheduleOwnerBooking(env, "owner", "booking", at(30 * hour))).resolves.toBeTruthy();
    expect(emails).toHaveLength(1);
  });

  it("cancels a booking once and tells the guest", async () => {
    const { raw, env } = fixture();
    const result = await cancelOwnerBooking(env, "owner", "booking");
    expect(result.booking).toMatchObject({ id: "booking", status: "cancelled" });
    expect(raw.prepare("SELECT status, cancelled_at IS NOT NULL AS cancelled FROM bookings WHERE id='booking'").get()).toEqual({ status: "cancelled", cancelled: 1 });
    expect(emails).toEqual([expect.objectContaining({ change: "cancelled" })]);
    await expect(cancelOwnerBooking(env, "owner", "booking")).rejects.toMatchObject({ status: 409 });
    await expect(cancelOwnerBooking(env, "owner", "elsewhere")).rejects.toMatchObject({ status: 404 });
    expect(emails).toHaveLength(1);
  });
});
