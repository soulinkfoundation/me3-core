// Books a free one-to-one call on another ME3 site for the owner, exactly as a visitor books it from
// that site's booking form (GET /api/book/:username/slots, POST /api/book/:username/confirm). No
// Soulink connection or Cloud authorization is needed, so it works on any public ME3 site, including
// the stand-in in `pnpm dev:fresh`. The plan pins the site, offer and slot that the owner approved.
import type { FreeCallBooking, FreeCallPlan, PeopleRecord } from "../../../packages/agent/src/tools/services";
import type { Env } from "./types";

const REQUEST_TIMEOUT_MS = 8_000;
const LOOKAHEAD_DAYS = 7;
const EARLIEST_NOTICE_MS = 60 * 60_000;

type Offering = { type?: unknown; id?: unknown; title?: unknown; durationMinutes?: unknown; price?: unknown; kind?: unknown };

export async function planFreeCall(
  env: Env,
  ownerId: string,
  input: { profile: PeopleRecord; offeringId?: string; date?: string; time?: string; notes?: string },
): Promise<FreeCallPlan> {
  const person = input.profile;
  const name = text(person.name, 160) || "this person";
  const origin = siteOrigin(env, person);
  if (!origin) throw new Error(`${name}'s listing has no public ME3 site link, so ME3 can't book it. Give the owner their profile link instead.`);
  const handle = text(person.handle, 120) || usernameFrom(person.profileUrl);
  if (!handle) throw new Error(`${name}'s site has no booking handle, so ME3 can't book it. Give the owner the link ${origin}/ to book there.`);
  const offering = pickFreeOffering(person.offerings, input.offeringId);
  if (!offering) throw new Error(`${name} has no free call to book. Give the owner the link ${origin}/ instead.`);
  const offerId = offering.id.replace(/^service:/, "");
  const timezone = (await ownerContact(env, ownerId)).timezone || "UTC";
  const wantedDate = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : null;
  if (input.date && !wantedDate) throw new Error("date must be YYYY-MM-DD.");
  const wantedTime = input.time && /^\d{1,2}:\d{2}$/.test(input.time) ? input.time.padStart(5, "0") : null;
  if (input.time && !wantedTime) throw new Error("time must be HH:MM.");
  const dates = wantedDate ? [wantedDate] : upcomingDates(timezone, LOOKAHEAD_DAYS);
  const bookingUrl = `${origin}/api/book/${encodeURIComponent(handle)}`;
  const earliest = Date.now() + EARLIEST_NOTICE_MS;

  for (const date of dates) {
    const response = await fetchWithTimeout(`${bookingUrl}/slots?date=${date}&offerId=${encodeURIComponent(offerId)}`, { method: "GET" });
    const body = await readJson(response);
    if (response.status === 404) throw new Error(`${name}'s site no longer offers ${offering.title}. Give the owner the link ${origin}/ instead.`);
    if (!response.ok) throw new Error(text(body.error, 300) || `${name}'s site did not return available times.`);
    const slots = Array.isArray(body.slots) ? body.slots : [];
    for (const raw of slots) {
      const slot = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
      const start = instant(slot.slotStart ?? slot.startsAt), end = instant(slot.slotEnd ?? slot.endsAt);
      if (!start || !end || Date.parse(start) < earliest) continue;
      if (wantedTime && localTime(start, timezone) < wantedTime) continue;
      const durationMinutes = Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 60_000));
      return {
        with: name, handle, publicUrl: `${origin}/`, bookingUrl,
        offering: { id: offering.id, offerId, title: offering.title, durationMinutes: offering.durationMinutes ?? durationMinutes },
        slot: { start, end, timezone, label: ownerDateTime(start, timezone) },
        notes: text(input.notes, 500) || null,
      };
    }
  }
  throw new Error(wantedDate
    ? `${name} has no free time${wantedTime ? ` from ${wantedTime}` : ""} on ${wantedDate}. Offer another day.`
    : `${name} has no free time in the next ${LOOKAHEAD_DAYS} days. Give the owner the link ${origin}/ to pick a later date.`);
}

export async function bookFreeCall(env: Env, ownerId: string, plan: FreeCallPlan, idempotencyKey: string): Promise<FreeCallBooking> {
  const calendarEventId = `free-call-${idempotencyKey}`;
  const existing = await env.DB.prepare("SELECT id FROM user_calendar_events WHERE id = ? AND user_id = ?").bind(calendarEventId, ownerId).first<{ id: string }>();
  if (existing) return { ...plan, status: "booked", bookingId: null, calendarEventId };
  const owner = await ownerContact(env, ownerId);
  if (!owner.name || !owner.email) throw new Error("Add your name and email in Settings first: the booking needs them, like any booking form.");
  const response = await fetchWithTimeout(`${plan.bookingUrl}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      offerId: plan.offering.offerId, slotStart: plan.slot.start, slotEnd: plan.slot.end,
      guestName: owner.name, guestEmail: owner.email,
      notes: [plan.notes, "Booked through ME3."].filter(Boolean).join(" "),
    }),
  });
  const body = await readJson(response);
  if (!response.ok) {
    const error = text(body.error, 300) || "";
    if (response.status === 409 || /available|taken|booked/i.test(error)) throw new Error("That time was just taken, so nothing was booked. Check the times again and offer another.");
    throw new Error(error ? `${plan.with}'s site refused the booking: ${error}` : `${plan.with}'s site could not take the booking. Nothing was booked.`);
  }
  const booking = body.booking && typeof body.booking === "object" ? body.booking as Record<string, unknown> : {};
  await env.DB.prepare(
    "INSERT OR IGNORE INTO user_calendar_events(id,user_id,title,notes,location,starts_at,ends_at,timezone,all_day,kind,recurrence_rule) VALUES(?,?,?,?,NULL,?,?,?,0,'event',NULL)",
  ).bind(calendarEventId, ownerId, `${plan.offering.title} with ${plan.with}`.slice(0, 300), `Booked through ME3 on ${plan.with}'s site: ${plan.publicUrl}`, plan.slot.start, plan.slot.end, plan.slot.timezone).run();
  return { ...plan, status: "booked", bookingId: text(booking.id, 100) || null, calendarEventId };
}

/** The site's origin from the listing; plain http only on a local install (pnpm dev:fresh). */
function siteOrigin(env: Env, person: PeopleRecord): string | null {
  for (const candidate of [person.publicUrl, person.profileUrl]) {
    const value = text(candidate, 2_000);
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || (url.protocol === "http:" && env.ENVIRONMENT === "local")) return url.origin;
    } catch { /* not a URL */ }
  }
  return null;
}

function usernameFrom(profileUrl: unknown): string | null {
  const match = /\/sites?\/([a-z0-9][a-z0-9-]{0,62})\//i.exec(text(profileUrl, 2_000) || "");
  return match ? match[1].toLowerCase() : null;
}

function pickFreeOffering(value: unknown, wantedId: string | undefined): { id: string; title: string; durationMinutes: number | null } | null {
  const offerings = (Array.isArray(value) ? value : []) as Offering[];
  // A bookable call has a length and no price; an unpriced offer without a length is "ask about it", not free.
  const free = offerings.filter((offering) => offering.type === "service" && !offering.price && (offering.kind === undefined || offering.kind === "booking")
    && typeof offering.durationMinutes === "number" && offering.durationMinutes > 0 && text(offering.id, 200) && text(offering.title, 200));
  // A mistyped offering id falls back to the person's first free call; the owner approves the exact offer anyway.
  const chosen = (wantedId && free.find((offering) => offering.id === wantedId)) || free[0];
  if (!chosen) return null;
  const duration = typeof chosen.durationMinutes === "number" && Number.isFinite(chosen.durationMinutes) ? Math.max(1, Math.floor(chosen.durationMinutes)) : null;
  return { id: text(chosen.id, 200)!, title: text(chosen.title, 200)!, durationMinutes: duration };
}

async function ownerContact(env: Env, ownerId: string) {
  const owner = await env.DB.prepare("SELECT name, email, timezone FROM owner_profile WHERE id = ?").bind(ownerId).first<{ name: string | null; email: string | null; timezone: string | null }>();
  return { name: text(owner?.name, 120), email: text(owner?.email, 254), timezone: text(owner?.timezone, 80) };
}

function upcomingDates(timezone: string, days: number): string[] {
  const dates: string[] = [];
  for (let offset = 0; offset < days; offset++) dates.push(localDate(new Date(Date.now() + offset * 86_400_000), timezone));
  return [...new Set(dates)];
}

function localDate(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: safeZone(timezone), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function localTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: safeZone(timezone), hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

/** Owner-facing time for the approval, e.g. "Thu 23 Oct, 10:00". */
function ownerDateTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: safeZone(timezone), weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

function safeZone(timezone: string): string {
  try { new Intl.DateTimeFormat("en-GB", { timeZone: timezone }); return timezone; } catch { return "UTC"; }
}

function instant(value: unknown): string | null {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("The other site took too long to answer. Try again in a moment.");
    throw new Error("The other site could not be reached. Nothing was booked.");
  } finally {
    clearTimeout(timeout);
  }
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return response.json().then(
    (value) => value && typeof value === "object" ? value as Record<string, unknown> : {},
    () => ({}),
  );
}

function text(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}
