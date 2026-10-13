import type { Contact } from "../stores/contacts";

const DAY_MS = 24 * 60 * 60 * 1000;
// Close people seen within this window are "caught up" on the Home card.
export const RECENTLY_IN_TOUCH_DAYS = 7;

export function isSoulinkPerson(contact: Contact): boolean {
  return (
    contact.source === "soulink" ||
    Boolean(contact.metadata?.soulinkNodeId || contact.metadata?.soulinkLinkId)
  );
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] || "")
    .join("")
    .toUpperCase();
}

// The letter a row files under in the A–Z index (accents fold to A–Z).
export function indexLetter(name: string): string {
  const letter = name
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .charAt(0)
    .toUpperCase();
  return /[A-Z]/.test(letter) ? letter : "#";
}

export function comparePeopleByName(a: Contact, b: Contact): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

function timeOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

// "6d ago", "3w ago", "4mo ago", "1y ago"; null when never in touch.
export function formatSinceShort(value: string | null, now = Date.now()): string | null {
  const time = timeOf(value);
  if (time === null) return null;
  const days = Math.max(0, Math.floor((now - time) / DAY_MS));
  if (days < 1) return "Today";
  if (days < 14) return `${days}d ago`;
  if (days < 60) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

export function formatSinceLong(value: string | null, now = Date.now()): string | null {
  const time = timeOf(value);
  if (time === null) return null;
  const days = Math.max(0, Math.floor((now - time) / DAY_MS));
  if (days < 1) return "In touch today";
  const [count, unit] =
    days < 14 ? [days, "day"]
    : days < 60 ? [Math.floor(days / 7), "week"]
    : days < 365 ? [Math.floor(days / 30), "month"]
    : [Math.floor(days / 365), "year"];
  return `In touch ${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

export function soulinkProfileUrl(contact: Contact): string | null {
  const origin = contact.metadata?.soulinkOrigin;
  const handle = contact.socialHandles.soulink;
  if (typeof origin === "string" && origin && handle) {
    return `${origin.replace(/\/$/, "")}/@${encodeURIComponent(handle)}`;
  }
  return soulinkChatUrl(contact);
}

export function soulinkChatUrl(contact: Contact): string | null {
  const url = contact.metadata?.soulinkChatUrl;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

export function avatarUrl(contact: Contact): string | null {
  const url = contact.metadata?.avatarUrl;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

// One line under the name: what ME3 knows that tells people apart.
export function personDetail(contact: Contact): string {
  if (isSoulinkPerson(contact)) {
    const label = contact.metadata?.soulinkSourceChatTitle;
    if (typeof label === "string" && label.trim() && label !== contact.name) return label.trim();
  }
  if (contact.isClient) return "Client";
  return contact.email || contact.phone || "";
}

export type HomePeopleCard =
  | { state: "hidden" }
  | { state: "caught-up" }
  | { state: "people"; people: Contact[] };

// Home card ranking (People v1):
// 1. Close people only. 2. Reminders that are due go first. 3. Then the
// longest since last in touch. 4. Skip anyone in touch in the last ~7 days.
// 5. Never in touch ranks as the longest gap. 6. Ties: starred earlier first.
export function rankHomePeople(
  contacts: Contact[],
  reminderDueAt: (contact: Contact) => string | null,
  now = Date.now(),
  limit = 3,
): HomePeopleCard {
  const close = contacts.filter((contact) => contact.isClose && contact.status !== "archived");
  if (close.length === 0) return { state: "hidden" };

  const scored = close.map((contact) => {
    const due = timeOf(reminderDueAt(contact));
    const last = timeOf(contact.lastInTouchAt);
    return {
      contact,
      reminderDue: due !== null && due <= now,
      gap: last === null ? Number.POSITIVE_INFINITY : now - last,
      starred: timeOf(contact.closeSince) ?? Number.POSITIVE_INFINITY,
    };
  });
  const candidates = scored.filter(
    (entry) => entry.reminderDue || entry.gap >= RECENTLY_IN_TOUCH_DAYS * DAY_MS,
  );
  if (candidates.length === 0) return { state: "caught-up" };

  candidates.sort(
    (a, b) =>
      Number(b.reminderDue) - Number(a.reminderDue) ||
      (a.gap === b.gap ? 0 : b.gap > a.gap ? 1 : -1) ||
      a.starred - b.starred ||
      comparePeopleByName(a.contact, b.contact),
  );
  return { state: "people", people: candidates.slice(0, limit).map((entry) => entry.contact) };
}
