import ICAL from "ical.js";
import { getOrCreateInstallEncryptionKey } from "./install-secrets";
import type { DbCalendarSource, Env } from "./types";

type IcalComponent = InstanceType<typeof ICAL.Component>;
type IcalEvent = InstanceType<typeof ICAL.Event>;
type IcalTime = InstanceType<typeof ICAL.Time>;

type FetchLike = typeof fetch;

type ParsedCalendarEvent = {
  externalKey: string;
  externalUid: string | null;
  title: string;
  notes: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string | null;
  allDay: boolean;
  isBusy: boolean;
};

type CalendarSourceRow = DbCalendarSource & {
  encrypted_source_url: string | null;
  source_url_hint: string | null;
  status: "active" | "archived";
  last_synced_at: string | null;
  last_sync_error: string | null;
};

export type CalendarSourceMutationResult = {
  ok: true;
  importedCount: number;
  source: {
    id: string;
    name: string;
    kind: "ics_upload" | "ics_url";
    importedEventCount: number;
    sourceUrlHint: string | null;
    lastSyncedAt: string | null;
    lastSyncError: string | null;
  };
};

const ICS_URL_SYNC_PAST_DAYS = 90;
const ICS_URL_SYNC_FUTURE_DAYS = 730;
const ICS_UPLOAD_SYNC_PAST_DAYS = 3650;
const ICS_UPLOAD_SYNC_FUTURE_DAYS = 3650;
const MAX_ICS_BYTES = 2_000_000;
const MAX_SOURCE_EVENTS = 2500;
const MAX_RECURRING_OCCURRENCES_PER_EVENT = 1000;
const MAX_RECURRING_SCAN_PER_EVENT = 10_000;
const URL_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000;

export class CalendarSourceInputError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "CalendarSourceInputError";
  }
}

export async function importIcsUpload(
  env: Env,
  ownerId: string,
  formData: FormData,
): Promise<CalendarSourceMutationResult> {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    throw new CalendarSourceInputError("Choose an .ics file to import.");
  }

  if (file.size > MAX_ICS_BYTES) {
    throw new CalendarSourceInputError("Calendar files must be 2 MB or smaller.");
  }

  const originalFilename = normalizeShortText(file.name, 160) || "calendar.ics";
  if (!/\.ics$/i.test(originalFilename) && file.type && file.type !== "text/calendar") {
    throw new CalendarSourceInputError("Use a valid .ics calendar file.");
  }

  const sourceName =
    normalizeShortText(formData.get("name"), 100) ||
    originalFilename.replace(/\.ics$/i, "").trim() ||
    "Imported calendar";
  const parsedEvents = parseIcsEvents(await file.text(), {
    pastDays: ICS_UPLOAD_SYNC_PAST_DAYS,
    futureDays: ICS_UPLOAD_SYNC_FUTURE_DAYS,
  });

  const sourceId = crypto.randomUUID();
  const now = new Date().toISOString();
  await replaceSourceWithEvents(env, {
    source: {
      id: sourceId,
      ownerId,
      kind: "ics_upload",
      name: sourceName,
      originalFilename,
      encryptedSourceUrl: null,
      sourceUrlHint: null,
      importedEventCount: parsedEvents.length,
      lastSyncedAt: now,
      lastSyncError: null,
    },
    events: parsedEvents,
    mode: "insert",
  });

  return {
    ok: true,
    importedCount: parsedEvents.length,
    source: {
      id: sourceId,
      name: sourceName,
      kind: "ics_upload",
      importedEventCount: parsedEvents.length,
      sourceUrlHint: null,
      lastSyncedAt: now,
      lastSyncError: null,
    },
  };
}

export async function subscribeIcsUrl(
  env: Env,
  ownerId: string,
  input: unknown,
  fetcher: FetchLike = fetch,
): Promise<CalendarSourceMutationResult> {
  const body = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const url = normalizeCalendarUrl(body.url);
  const name = normalizeShortText(body.name, 100);

  const { text } = await fetchIcsUrl(url, fetcher);
  const parsedEvents = parseIcsEvents(text, {
    pastDays: ICS_URL_SYNC_PAST_DAYS,
    futureDays: ICS_URL_SYNC_FUTURE_DAYS,
  }, Boolean(soulinkFeedParts(url)));

  const sourceId = crypto.randomUUID();
  const now = new Date().toISOString();
  const installKey = await getOrCreateInstallEncryptionKey(env);
  const encryptedSourceUrl = await encryptSecret(url.toString(), installKey);
  const sourceUrlHint = buildSourceUrlHint(url);
  const sourceName = name || calendarNameFromIcs(text) || url.hostname;

  await replaceSourceWithEvents(env, {
    source: {
      id: sourceId,
      ownerId,
      kind: "ics_url",
      name: sourceName,
      originalFilename: null,
      encryptedSourceUrl,
      sourceUrlHint,
      importedEventCount: parsedEvents.length,
      lastSyncedAt: now,
      lastSyncError: null,
    },
    events: parsedEvents,
    mode: "insert",
  });

  return {
    ok: true,
    importedCount: parsedEvents.length,
    source: {
      id: sourceId,
      name: sourceName,
      kind: "ics_url",
      importedEventCount: parsedEvents.length,
      sourceUrlHint,
      lastSyncedAt: now,
      lastSyncError: null,
    },
  };
}

export async function refreshCalendarSource(
  env: Env,
  ownerId: string,
  sourceId: string,
  fetcher: FetchLike = fetch,
): Promise<CalendarSourceMutationResult> {
  const source = await getCalendarSource(env, ownerId, sourceId);
  if (!source) {
    throw new CalendarSourceInputError("Calendar source not found.", 404);
  }
  if (source.kind !== "ics_url") {
    throw new CalendarSourceInputError("Only subscribed calendar URLs can be refreshed.");
  }

  return refreshCalendarSourceRow(env, source, fetcher);
}

export async function removeCalendarSource(
  env: Env,
  ownerId: string,
  sourceId: string,
): Promise<{ ok: true; sourceId: string }> {
  const source = await getCalendarSource(env, ownerId, sourceId);
  if (!source) {
    throw new CalendarSourceInputError("Calendar source not found.", 404);
  }

  await env.DB.batch([
    env.DB.prepare("DELETE FROM calendar_source_events WHERE source_id = ?")
      .bind(source.id),
    env.DB.prepare(
      `UPDATE calendar_sources
       SET status = 'archived',
           encrypted_source_url = NULL,
           imported_event_count = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
    )
      .bind(source.id, ownerId),
  ]);

  return { ok: true, sourceId: source.id };
}

function soulinkFeedParts(url: URL): { id: string; token: string } | null {
  if (url.protocol !== "https:" || ![
    "soulinkfoundation.org",
    "soulink-staging.soulink.workers.dev",
    "soulink-sandbox.kieranbutler22.workers.dev",
  ].includes(url.hostname)) return null;
  const match = /^\/api\/me3\/calendar\/feeds\/([0-9a-f-]{36})\/([A-Za-z0-9._-]+)$/.exec(url.pathname);
  return match ? { id: match[1], token: match[2] } : null;
}

export async function acknowledgeSoulinkCalendarSource(sourceUrl: string, sourceId: string): Promise<void> {
  const url = new URL(sourceUrl);
  const parts = soulinkFeedParts(url);
  if (!parts) return;
  const callback = new URL(`/api/me3/calendar/connections/${parts.id}/complete`, url.origin);
  const response = await fetch(callback, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: parts.token, sourceId }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!response?.ok) throw new CalendarSourceInputError("Soulink could not complete the calendar connection. Try again.", 502);
}

export async function handleSoulinkCalendarSourceAction(
  env: Env, sourceId: string, token: string, action: "refresh" | "disconnect",
): Promise<CalendarSourceMutationResult | { ok: true; sourceId: string }> {
  const source = await env.DB.prepare(
    `SELECT id, user_id, kind, name, original_filename, encrypted_source_url,
            source_url_hint, status, imported_event_count, last_synced_at,
            last_sync_error, created_at, updated_at
       FROM calendar_sources WHERE id = ? AND kind = 'ics_url' AND status = 'active'`,
  ).bind(sourceId).first<CalendarSourceRow>();
  if (!source?.encrypted_source_url) throw new CalendarSourceInputError("Calendar source not found.", 404);
  const installKey = await getOrCreateInstallEncryptionKey(env);
  const parts = soulinkFeedParts(new URL(await decryptSecret(source.encrypted_source_url, installKey)));
  if (!parts || parts.token !== token) throw new CalendarSourceInputError("Calendar source not found.", 404);
  return action === "refresh"
    ? refreshCalendarSourceRow(env, source, fetch)
    : removeCalendarSource(env, source.user_id, source.id);
}

export async function removeImportedCalendarEvent(
  env: Env,
  ownerId: string,
  eventId: string,
): Promise<{ ok: true; eventId: string }> {
  const event = await env.DB.prepare(
    `SELECT cse.source_id, cse.external_key
     FROM calendar_source_events cse
     JOIN calendar_sources cs ON cs.id = cse.source_id
     WHERE cse.id = ? AND cs.user_id = ? AND cs.status = 'active'`,
  )
    .bind(eventId, ownerId)
    .first<{ source_id: string; external_key: string }>();

  if (!event) {
    throw new CalendarSourceInputError("Imported event not found.", 404);
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO calendar_source_event_dismissals
         (source_id, external_key)
       VALUES (?, ?)`,
    ).bind(event.source_id, event.external_key),
    env.DB.prepare("DELETE FROM calendar_source_events WHERE id = ?").bind(eventId),
  ]);

  return { ok: true, eventId };
}

export async function dispatchDueCalendarSourceRefreshes(
  env: Env,
  fetcher: FetchLike = fetch,
): Promise<{ refreshed: number; failed: number }> {
  const cutoff = new Date(Date.now() - URL_REFRESH_INTERVAL_MS).toISOString();
  const rows = await env.DB.prepare(
    `SELECT id, user_id, kind, name, original_filename, encrypted_source_url,
            source_url_hint, status, imported_event_count, last_synced_at,
            last_sync_error, created_at, updated_at
     FROM calendar_sources
     WHERE kind = 'ics_url'
       AND status = 'active'
       AND encrypted_source_url IS NOT NULL
       AND (last_synced_at IS NULL OR last_synced_at < ?)
     ORDER BY COALESCE(last_synced_at, '') ASC
     LIMIT 10`,
  )
    .bind(cutoff)
    .all<CalendarSourceRow>();

  let refreshed = 0;
  let failed = 0;
  for (const source of rows.results || []) {
    try {
      await refreshCalendarSourceRow(env, source, fetcher);
      refreshed += 1;
    } catch {
      failed += 1;
    }
  }

  return { refreshed, failed };
}

async function refreshCalendarSourceRow(
  env: Env,
  source: CalendarSourceRow,
  fetcher: FetchLike,
): Promise<CalendarSourceMutationResult> {
  if (!source.encrypted_source_url) {
    throw new CalendarSourceInputError("Calendar source URL is missing.", 500);
  }

  try {
    const installKey = await getOrCreateInstallEncryptionKey(env);
    const url = new URL(await decryptSecret(source.encrypted_source_url, installKey));
    validateSubscriptionUrl(url);
    const { text } = await fetchIcsUrl(url, fetcher);
    const parsedEvents = parseIcsEvents(text, {
      pastDays: ICS_URL_SYNC_PAST_DAYS,
      futureDays: ICS_URL_SYNC_FUTURE_DAYS,
    }, Boolean(soulinkFeedParts(url)));
    const now = new Date().toISOString();

    await replaceSourceWithEvents(env, {
      source: {
        id: source.id,
        ownerId: source.user_id,
        kind: "ics_url",
        name: source.name,
        originalFilename: source.original_filename,
        encryptedSourceUrl: source.encrypted_source_url,
        sourceUrlHint: source.source_url_hint,
        importedEventCount: parsedEvents.length,
        lastSyncedAt: now,
        lastSyncError: null,
      },
      events: parsedEvents,
      mode: "update",
    });

    return {
      ok: true,
      importedCount: parsedEvents.length,
      source: {
        id: source.id,
        name: source.name,
        kind: "ics_url",
        importedEventCount: parsedEvents.length,
        sourceUrlHint: source.source_url_hint,
        lastSyncedAt: now,
        lastSyncError: null,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Calendar sync failed.";
    await env.DB.prepare(
      `UPDATE calendar_sources
       SET last_sync_error = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(message.slice(0, 300), source.id)
      .run();
    throw error;
  }
}

async function getCalendarSource(
  env: Env,
  ownerId: string,
  sourceId: string,
): Promise<CalendarSourceRow | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, user_id, kind, name, original_filename, encrypted_source_url,
              source_url_hint, status, imported_event_count, last_synced_at,
              last_sync_error, created_at, updated_at
       FROM calendar_sources
       WHERE id = ? AND user_id = ? AND status = 'active'`,
    )
      .bind(sourceId, ownerId)
      .first<CalendarSourceRow>()) || null
  );
}

function parseIcsEvents(
  icsText: string,
  window: { pastDays: number; futureDays: number },
  allowEmpty = false,
): ParsedCalendarEvent[] {
  if (!/\bBEGIN:VCALENDAR\b/i.test(icsText) || (!allowEmpty && !/\bBEGIN:VEVENT\b/i.test(icsText))) {
    throw new CalendarSourceInputError("That calendar feed did not contain any events.");
  }

  let calendar: IcalComponent;
  try {
    calendar = new ICAL.Component(ICAL.parse(icsText));
  } catch {
    throw new CalendarSourceInputError("Could not read that iCalendar feed.");
  }

  const now = Date.now();
  const startsAfter = now - window.pastDays * 24 * 60 * 60 * 1000;
  const startsBefore = now + window.futureDays * 24 * 60 * 60 * 1000;
  const parsedEvents: ParsedCalendarEvent[] = [];
  const components = calendar.getAllSubcomponents("vevent");

  for (const component of components) {
    const event = new ICAL.Event(component);
    if (event.isRecurrenceException()) continue;
    if (eventStatus(event) === "CANCELLED") continue;

    if (event.isRecurring()) {
      appendRecurringEventOccurrences(parsedEvents, event, startsAfter, startsBefore);
    } else {
      const item = parsedEventFromTimes(event, event.startDate, event.endDate);
      if (item && eventOverlapsWindow(item, startsAfter, startsBefore)) {
        parsedEvents.push(item);
      }
    }

  }

  if (parsedEvents.length === 0 && !allowEmpty) {
    throw new CalendarSourceInputError("No upcoming events were found in that calendar.");
  }

  return parsedEvents
    .sort((a, b) => compareCalendarSourceEventRelevance(a, b, now))
    .slice(0, MAX_SOURCE_EVENTS);
}

function appendRecurringEventOccurrences(
  output: ParsedCalendarEvent[],
  event: IcalEvent,
  startsAfter: number,
  startsBefore: number,
) {
  const iterator = event.iterator();
  let scanGuard = 0;
  let addedCount = 0;
  let occurrence: IcalTime | null = null;

  while (
    scanGuard < MAX_RECURRING_SCAN_PER_EVENT &&
    addedCount < MAX_RECURRING_OCCURRENCES_PER_EVENT &&
    (occurrence = iterator.next())
  ) {
    scanGuard += 1;
    const details = event.getOccurrenceDetails(occurrence);
    const detailEvent = details.item as IcalEvent;
    if (eventStatus(detailEvent) === "CANCELLED") continue;

    const item = parsedEventFromTimes(detailEvent, details.startDate, details.endDate);
    if (!item) continue;

    const startsAt = Date.parse(item.startsAt);
    if (Number.isFinite(startsAt) && startsAt > startsBefore) break;
    if (eventOverlapsWindow(item, startsAfter, startsBefore)) {
      output.push(item);
      addedCount += 1;
    }
  }
}

function compareCalendarSourceEventRelevance(
  a: ParsedCalendarEvent,
  b: ParsedCalendarEvent,
  now: number,
): number {
  const aStartsAt = Date.parse(a.startsAt);
  const bStartsAt = Date.parse(b.startsAt);
  const aEndsAt = Date.parse(a.endsAt);
  const bEndsAt = Date.parse(b.endsAt);
  const aCurrentOrFuture = Number.isFinite(aEndsAt) && aEndsAt >= now;
  const bCurrentOrFuture = Number.isFinite(bEndsAt) && bEndsAt >= now;

  if (aCurrentOrFuture !== bCurrentOrFuture) {
    return aCurrentOrFuture ? -1 : 1;
  }

  if (aCurrentOrFuture && bCurrentOrFuture) {
    return aStartsAt - bStartsAt;
  }

  return bStartsAt - aStartsAt;
}

function parsedEventFromTimes(
  event: IcalEvent,
  startDate: IcalTime,
  endDate: IcalTime,
): ParsedCalendarEvent | null {
  const startsAt = icalTimeToIso(startDate);
  const endsAt = icalTimeToIso(endDate);
  if (!startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) return null;

  const uid = normalizeShortText(event.uid, 300) || null;
  const recurrenceId = event.component.getFirstPropertyValue("recurrence-id");
  const recurrenceKey = recurrenceId && typeof recurrenceId === "object"
    ? icalTimeToIso(recurrenceId as IcalTime)
    : startsAt;

  return {
    externalKey: `${uid || "event"}:${recurrenceKey}`,
    externalUid: uid,
    title: normalizeShortText(event.summary, 300) || "Untitled event",
    notes: normalizeLongText(event.description, 5000),
    location: normalizeShortText(event.location, 500) || null,
    startsAt,
    endsAt,
    timezone: icalTimeZone(startDate),
    allDay: startDate.isDate === true,
    isBusy: eventTransparency(event) !== "TRANSPARENT",
  };
}

function eventOverlapsWindow(
  event: ParsedCalendarEvent,
  startsAfter: number,
  startsBefore: number,
): boolean {
  const startsAt = Date.parse(event.startsAt);
  const endsAt = Date.parse(event.endsAt);
  return Number.isFinite(startsAt) && Number.isFinite(endsAt) &&
    endsAt >= startsAfter && startsAt <= startsBefore;
}

function icalTimeToIso(time: IcalTime): string | null {
  if (time.isDate) {
    return new Date(Date.UTC(time.year, time.month - 1, time.day)).toISOString();
  }
  const date = time.toJSDate();
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function icalTimeZone(time: IcalTime): string | null {
  const zone = time.zone as { tzid?: unknown } | undefined;
  const tzid = typeof zone?.tzid === "string" ? zone.tzid : "";
  if (!tzid || tzid === "floating") return null;
  return tzid;
}

function eventStatus(event: IcalEvent): string {
  return String(event.component.getFirstPropertyValue("status") || "").toUpperCase();
}

function eventTransparency(event: IcalEvent): string {
  return String(event.component.getFirstPropertyValue("transp") || "").toUpperCase();
}

async function fetchIcsUrl(
  url: URL,
  fetcher: FetchLike,
): Promise<{ text: string }> {
  const response = await fetcher(url.toString(), {
    method: "GET",
    redirect: "follow",
    headers: {
      Accept: "text/calendar, text/plain;q=0.9, */*;q=0.5",
      "User-Agent": "ME3 Calendar Sync",
    },
  });

  if (!response.ok) {
    throw new CalendarSourceInputError(
      `Calendar feed returned HTTP ${response.status}.`,
      400,
    );
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_ICS_BYTES) {
    throw new CalendarSourceInputError("Calendar feeds must be 2 MB or smaller.");
  }

  const text = await response.text();
  if (text.length > MAX_ICS_BYTES) {
    throw new CalendarSourceInputError("Calendar feeds must be 2 MB or smaller.");
  }

  return { text };
}

async function replaceSourceWithEvents(
  env: Env,
  input: {
    source: {
      id: string;
      ownerId: string;
      kind: "ics_upload" | "ics_url";
      name: string;
      originalFilename: string | null;
      encryptedSourceUrl: string | null;
      sourceUrlHint: string | null;
      importedEventCount: number;
      lastSyncedAt: string | null;
      lastSyncError: string | null;
    };
    events: ParsedCalendarEvent[];
    mode: "insert" | "update";
  },
) {
  const dismissedExternalKeys = new Set<string>();
  if (input.mode === "update") {
    const dismissed = await env.DB.prepare(
      `SELECT external_key
       FROM calendar_source_event_dismissals
       WHERE source_id = ?`,
    )
      .bind(input.source.id)
      .all<{ external_key: string }>();
    for (const row of dismissed.results || []) {
      dismissedExternalKeys.add(row.external_key);
    }
  }

  const visibleEvents = input.events.filter(
    (event) => !dismissedExternalKeys.has(event.externalKey),
  );
  const statements: D1PreparedStatement[] = [];
  if (input.mode === "insert") {
    statements.push(
      env.DB.prepare(
        `INSERT INTO calendar_sources (
           id, user_id, kind, name, original_filename, encrypted_source_url,
           source_url_hint, imported_event_count, last_synced_at, last_sync_error,
           created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      )
        .bind(
          input.source.id,
          input.source.ownerId,
          input.source.kind,
          input.source.name,
          input.source.originalFilename,
          input.source.encryptedSourceUrl,
          input.source.sourceUrlHint,
          input.source.importedEventCount,
          input.source.lastSyncedAt,
          input.source.lastSyncError,
        ),
    );
  } else {
    statements.push(
      env.DB.prepare("DELETE FROM calendar_source_events WHERE source_id = ?")
        .bind(input.source.id),
      env.DB.prepare(
        `UPDATE calendar_sources
         SET imported_event_count = ?, last_synced_at = ?, last_sync_error = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
      )
        .bind(
          input.source.importedEventCount,
          input.source.lastSyncedAt,
          input.source.lastSyncError,
          input.source.id,
        ),
    );
  }

  const eventStatement = env.DB.prepare(
    `INSERT INTO calendar_source_events (
       id, source_id, external_key, external_uid, title, notes, location,
       starts_at, ends_at, timezone, all_day, is_busy, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  );

  for (const event of visibleEvents) {
    statements.push(
      eventStatement.bind(
        crypto.randomUUID(),
        input.source.id,
        event.externalKey,
        event.externalUid,
        event.title,
        event.notes,
        event.location,
        event.startsAt,
        event.endsAt,
        event.timezone,
        event.allDay ? 1 : 0,
        event.isBusy ? 1 : 0,
      ),
    );
  }

  await env.DB.batch(statements);
}

function normalizeCalendarUrl(value: unknown): URL {
  if (typeof value !== "string" || !value.trim()) {
    throw new CalendarSourceInputError("Paste an iCalendar subscription URL.");
  }
  if (value.length > 2000) {
    throw new CalendarSourceInputError("Calendar subscription URLs must be shorter than 2000 characters.");
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new CalendarSourceInputError("Use a valid calendar subscription URL.");
  }

  validateSubscriptionUrl(url);
  return url;
}

function validateSubscriptionUrl(url: URL): void {
  if (url.protocol !== "https:") {
    throw new CalendarSourceInputError("Use an HTTPS calendar subscription URL.");
  }
  if (url.username || url.password) {
    throw new CalendarSourceInputError("Calendar URLs with embedded usernames or passwords are not supported.");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    isBlockedIpLiteral(host)
  ) {
    throw new CalendarSourceInputError("Use a public HTTPS calendar subscription URL.");
  }
}

function isBlockedIpLiteral(host: string): boolean {
  if (host === "0.0.0.0" || host === "::1" || host === "[::1]") return true;
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return false;
  const [a, b] = parts;
  return a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
}

function buildSourceUrlHint(url: URL): string {
  const tail = `${url.pathname}${url.search}`.replace(/\/+$/, "").slice(-4);
  return tail ? `${url.hostname} ...${tail}` : url.hostname;
}

function calendarNameFromIcs(icsText: string): string {
  const match = icsText.match(/^X-WR-CALNAME:(.+)$/im);
  return match ? normalizeShortText(unescapeIcsText(match[1]), 100) : "";
}

function normalizeShortText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function normalizeLongText(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function unescapeIcsText(value: string): string {
  return value
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

async function encryptSecret(secret: string, installKey: string): Promise<string> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const key = await importSecretCryptoKey(installKey, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(secret),
  );
  return `v1.${encodeBase64Url(iv)}.${encodeBase64Url(ciphertext)}`;
}

async function decryptSecret(encrypted: string, installKey: string): Promise<string> {
  const [version, ivBase64, ciphertextBase64] = encrypted.split(".");
  if (version !== "v1" || !ivBase64 || !ciphertextBase64) {
    throw new CalendarSourceInputError("Stored calendar URL is invalid.", 500);
  }
  const key = await importSecretCryptoKey(installKey, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64Url(ivBase64) },
    key,
    decodeBase64Url(ciphertextBase64),
  );
  return new TextDecoder().decode(plaintext);
}

async function importSecretCryptoKey(
  installKey: string,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(installKey),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, usages);
}

function encodeBase64Url(value: ArrayBuffer | Uint8Array): string {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
