export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value.trim() }).format(
      new Date(),
    );
    return true;
  } catch {
    return false;
  }
}

export function detectBrowserTimeZone(): string | null {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidTimeZone(detected) ? detected : null;
}

export function listSupportedTimeZones(): string[] {
  const detected = detectBrowserTimeZone();
  const supported = (Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  }).supportedValuesOf?.("timeZone");

  const common = [
    detected,
    "UTC",
    "Europe/Dublin",
    "Europe/London",
    "Europe/Madrid",
    "Atlantic/Canary",
    "America/New_York",
    "America/Los_Angeles",
    "Asia/Kolkata",
    "Asia/Tokyo",
    "Australia/Sydney",
  ];
  return Array.from(
    new Set([...(Array.isArray(supported) ? supported : []), ...common].filter(Boolean)),
  ) as string[];
}

export function getTimeZoneCityLabel(timeZone: string): string {
  const city = timeZone.split("/").at(-1)?.replace(/_/g, " ") || timeZone;
  if (timeZone === "Atlantic/Canary") return "Canary Islands";
  return city;
}

export function getTimeZoneSearchAliases(timeZone: string): string[] {
  if (timeZone === "Europe/Madrid") {
    return ["Spain", "Barcelona", "Valencia", "Seville", "Bilbao"];
  }
  if (timeZone === "Atlantic/Canary") {
    return ["Spain", "Canary Islands", "Tenerife", "Las Palmas"];
  }
  return [];
}

function getTimeZoneNamePart(
  timeZone: string,
  mode: "short" | "longOffset",
  date = new Date(),
): string | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: mode,
    }).formatToParts(date);
    return parts.find((part) => part.type === "timeZoneName")?.value ?? null;
  } catch {
    return null;
  }
}

export function getTimeZoneOffsetLabel(
  timeZone: string,
  date = new Date(),
): string {
  const label = getTimeZoneNamePart(timeZone, "longOffset", date);
  if (!label) return "UTC";
  return label.replace(/^GMT/, "UTC");
}

export function getTimeZoneShortName(
  timeZone: string,
  date = new Date(),
): string {
  return getTimeZoneNamePart(timeZone, "short", date) || getTimeZoneOffsetLabel(timeZone, date);
}

export function getTimeZoneDisplayLabel(
  timeZone: string,
  date = new Date(),
): string {
  return `${timeZone} (${getTimeZoneOffsetLabel(timeZone, date)})`;
}

export type LocalDateTimeParts = {
  date: string;
  time: string;
};

export type LocalDateTimeResolution =
  | { ok: true; value: string }
  | { ok: false; reason: "invalid" | "nonexistent" | "ambiguous" };

export function resolveLocalDateTimeToUtc(
  date: string,
  time: string,
  timeZone: string,
): LocalDateTimeResolution {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dateMatch || !timeMatch || !isValidTimeZone(timeZone)) {
    return { ok: false, reason: "invalid" };
  }

  const desired = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
  };
  if (
    desired.month < 1 ||
    desired.month > 12 ||
    desired.day < 1 ||
    desired.day > 31 ||
    desired.hour > 23 ||
    desired.minute > 59
  ) {
    return { ok: false, reason: "invalid" };
  }

  const desiredUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
  );
  const calendarDate = new Date(desiredUtc);
  if (
    calendarDate.getUTCFullYear() !== desired.year ||
    calendarDate.getUTCMonth() + 1 !== desired.month ||
    calendarDate.getUTCDate() !== desired.day
  ) {
    return { ok: false, reason: "invalid" };
  }

  let instant = desiredUtc;
  for (let pass = 0; pass < 3; pass += 1) {
    const actual = instantLocalParts(new Date(instant), timeZone);
    if (!actual) return { ok: false, reason: "invalid" };
    const actualUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
    );
    const delta = actualUtc - desiredUtc;
    if (delta === 0) break;
    instant -= delta;
  }

  const verified = instantLocalParts(new Date(instant), timeZone);
  if (!verified || !localPartsMatch(verified, desired)) {
    return { ok: false, reason: "nonexistent" };
  }

  // A fall-back transition maps two different instants to the same wall time.
  // Search the modern IANA transition range so Calendar never guesses an offset.
  for (let minutes = 15; minutes <= 180; minutes += 15) {
    for (const direction of [-1, 1]) {
      const alternative = instantLocalParts(
        new Date(instant + direction * minutes * 60_000),
        timeZone,
      );
      if (alternative && localPartsMatch(alternative, desired)) {
        return { ok: false, reason: "ambiguous" };
      }
    }
  }

  return { ok: true, value: new Date(instant).toISOString() };
}

export function localDateTimeToUtcIso(
  date: string,
  time: string,
  timeZone: string,
): string | null {
  const resolution = resolveLocalDateTimeToUtc(date, time, timeZone);
  return resolution.ok ? resolution.value : null;
}

export function instantToLocalDateTimeParts(
  value: string,
  timeZone: string,
): LocalDateTimeParts | null {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime()) || !isValidTimeZone(timeZone)) return null;
  const parts = instantLocalParts(instant, timeZone);
  if (!parts) return null;
  return {
    date: `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    time: `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`,
  };
}

function instantLocalParts(
  instant: Date,
  timeZone: string,
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} | null {
  try {
    const values = new Map(
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(instant)
        .map((part) => [part.type, part.value]),
    );
    const result = {
      year: Number(values.get("year")),
      month: Number(values.get("month")),
      day: Number(values.get("day")),
      hour: Number(values.get("hour")),
      minute: Number(values.get("minute")),
    };
    return Object.values(result).every(Number.isFinite) ? result : null;
  } catch {
    return null;
  }
}

function localPartsMatch(
  actual: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  },
  desired: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
  },
): boolean {
  return actual.year === desired.year &&
    actual.month === desired.month &&
    actual.day === desired.day &&
    actual.hour === desired.hour &&
    actual.minute === desired.minute;
}
