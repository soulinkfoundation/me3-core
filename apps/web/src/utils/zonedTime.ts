/**
 * "2026-10-25T09:00" in `timeZone` as a UTC ISO string, so a scheduled send goes out at the
 * owner's wall-clock time even when their browser is somewhere else.
 */
export function zonedLocalToUtc(localDateTime: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localDateTime);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const wallClock = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  // Guess, then correct by the zone's offset at that moment; twice handles DST edges.
  let utc = wallClock;
  for (let pass = 0; pass < 2; pass++) utc = wallClock - offsetMs(new Date(utc), timeZone);
  return new Date(utc).toISOString();
}

function offsetMs(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}
