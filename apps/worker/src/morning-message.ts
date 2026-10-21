// The morning push, written as ME3 would say it: a greeting, the day's schedule with
// times, reminders, and a closing line when there is room. Core composes it so iOS
// and Android show the same words; the Cloud relay only bounds and forwards it.

export const MORNING_MESSAGE_TITLE_LIMIT = 120;
// Android drops a notification whose body is longer than this, and the iOS lock
// screen shows about 180 characters before the long press, so shorter wins.
export const MORNING_MESSAGE_BODY_LIMIT = 240;
const ITEM_TITLE_LIMIT = 40;
const CLOSING = "I'll keep an eye on the day from here.";

export type MorningMessageItem = {
  title: string;
  /** ISO instant. Null means all day. */
  startsAt: string | null;
  timezone?: string | null;
};

export type MorningMessageInput = {
  ownerName: string | null;
  timezone: string;
  birthdayNames: string[];
  /** Events, subscribed events and bookings for the day. */
  schedule: MorningMessageItem[];
  reminders: MorningMessageItem[];
};

export type MorningMessage = { title: string; body: string };

export function composeMorningMessage(input: MorningMessageInput): MorningMessage {
  const firstName = cleanText(input.ownerName, 40)?.split(" ")[0] ?? null;
  const title = bound(firstName ? `☀️ Good morning, ${firstName}` : "☀️ Good morning", MORNING_MESSAGE_TITLE_LIMIT);

  const schedule = [...input.schedule]
    .map(item => phrase(item, input.timezone))
    .filter((item): item is Phrase => item !== null)
    .sort((a, b) => Number(a.allDay) * -1 + Number(b.allDay) || a.sortKey.localeCompare(b.sortKey));
  const reminders = input.reminders
    .map(item => phrase(item, input.timezone))
    .filter((item): item is Phrase => item !== null)
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  const birthdays = cleanNames(input.birthdayNames);

  // Shorten from the least important end until the body fits: the closing goes first,
  // then reminders, then the schedule. Something always remains.
  const attempts: Array<[number, number, boolean]> = [[3, 2, true], [3, 2, false], [3, 1, false], [2, 1, false], [1, 1, false]];
  let body = "";
  for (const [shownSchedule, shownReminders, closing] of attempts) {
    body = sentences(birthdays, schedule, reminders, shownSchedule, shownReminders, closing);
    if (body.length <= MORNING_MESSAGE_BODY_LIMIT) return { title, body };
  }
  return { title, body: bound(body, MORNING_MESSAGE_BODY_LIMIT) };
}

type Phrase = { text: string; allDay: boolean; sortKey: string };

function phrase(item: MorningMessageItem, fallbackTimezone: string): Phrase | null {
  const name = cleanText(item.title, ITEM_TITLE_LIMIT);
  if (!name) return null;
  if (item.startsAt === null) return { text: `${name} (all day)`, allDay: true, sortKey: "" };
  const time = formatTime(item.startsAt, item.timezone || fallbackTimezone);
  if (!time) return { text: `${name} (all day)`, allDay: true, sortKey: "" };
  return { text: `${name} at ${time}`, allDay: false, sortKey: item.startsAt };
}

function sentences(
  birthdays: string[],
  schedule: Phrase[],
  reminders: Phrase[],
  shownSchedule: number,
  shownReminders: number,
  closing: boolean,
) {
  const parts: string[] = [];
  if (birthdays.length === 1) parts.push(`🎂 It's ${birthdays[0]}'s birthday today.`);
  else if (birthdays.length === 2) parts.push(`🎂 It's ${birthdays[0]}'s and ${birthdays[1]}'s birthday today.`);
  else if (birthdays.length > 2) parts.push(`🎂 It's ${birthdays[0]}'s birthday and ${birthdays.length - 1} more today.`);

  if (schedule.length > 0) {
    const shown = schedule.slice(0, shownSchedule).map(item => item.text);
    const rest = schedule.length - shown.length;
    if (rest > 0) shown.push(`${rest} more`);
    parts.push(`You have ${listWithThen(shown)}.`);
  }
  if (reminders.length > 0) {
    const shown = reminders.slice(0, shownReminders).map(item => item.text);
    const rest = reminders.length - shown.length;
    if (rest > 0) shown.push(`${rest} more`);
    parts.push(`${reminders.length === 1 ? "Reminder" : "Reminders"}: ${list(shown)}.`);
  }
  if (parts.length === 0) parts.push("Nothing on your calendar today, so the day is yours.");
  if (closing) parts.push(CLOSING);
  return parts.join(" ");
}

/** "A, then B, C and D": the first item leads, the rest follow in order. */
function listWithThen(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items[0]}, then ${list(items.slice(1))}`;
}

function list(items: string[]) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function cleanNames(names: string[]) {
  return names.map(name => cleanText(name, ITEM_TITLE_LIMIT)).filter((name): name is string => name !== null);
}

function cleanText(value: string | null | undefined, limit: number) {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return bound(text, limit);
}

function bound(text: string, limit: number) {
  const characters = Array.from(text);
  return characters.length <= limit ? text : `${characters.slice(0, limit - 1).join("").trimEnd()}…`;
}

function formatTime(value: string, timezone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  }
}
