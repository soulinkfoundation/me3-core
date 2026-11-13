import type { Contact, OutreachStatus } from "../stores/contacts";
import { comparePeopleByName } from "./people";

const DAY_MS = 24 * 60 * 60 * 1000;

// The statuses the owner sees and sets. "new", "drafted" and "no_response"
// are set by ME3 and only ever shown, never offered as a step.
export const OUTREACH_STEPS: Array<{ value: OutreachStatus; label: string }> = [
  { value: "sent", label: "Sent" },
  { value: "replied", label: "Replied" },
  { value: "booked", label: "Call booked" },
  { value: "converted", label: "Agreed" },
  { value: "not_interested", label: "No" },
];

export type OutreachTab = "open" | "due" | "agreed" | "no";
export const OUTREACH_TABS: Array<{ id: OutreachTab; label: string }> = [
  { id: "open", label: "Open" },
  { id: "due", label: "Due" },
  { id: "agreed", label: "Agreed" },
  { id: "no", label: "No" },
];

export function isProspect(contact: Contact): boolean {
  return contact.relationship === "prospect";
}

export function outreachStatusLabel(status: OutreachStatus | null): string {
  if (status === "no_response") return "No response";
  return OUTREACH_STEPS.find((step) => step.value === status)?.label || "Not sent";
}

export function outreachStage(contact: Contact): "open" | "agreed" | "no" {
  if (contact.outreachStatus === "converted") return "agreed";
  if (contact.outreachStatus === "not_interested" || contact.outreachStatus === "no_response") return "no";
  return "open";
}

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

// Whole calendar days until the follow-up date; 0 is today, negative is overdue.
export function followUpInDays(contact: Contact, now = Date.now()): number | null {
  const time = contact.nextFollowupAt ? Date.parse(contact.nextFollowupAt) : Number.NaN;
  if (!Number.isFinite(time)) return null;
  return Math.round((startOfDay(time) - startOfDay(now)) / DAY_MS);
}

export function isFollowUpDue(contact: Contact, now = Date.now()): boolean {
  const days = followUpInDays(contact, now);
  return outreachStage(contact) === "open" && days !== null && days <= 0;
}

export function followUpLabel(contact: Contact, now = Date.now()): string {
  const days = followUpInDays(contact, now);
  if (days === null || outreachStage(contact) !== "open") return "";
  if (days === 0) return "Follow up today";
  if (days < 0) return `Overdue ${-days} day${days === -1 ? "" : "s"}`;
  const date = new Date(contact.nextFollowupAt as string);
  return `Follow up ${date.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}

// The follow-up date `days` from today, at 9am local time.
export function followUpDateIn(days: number, now = Date.now()): string {
  const date = new Date(now);
  date.setHours(9, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export function prospectTitle(contact: Contact): string {
  const organisation = contact.organisation?.trim();
  return organisation && organisation.toLowerCase() !== contact.name.trim().toLowerCase()
    ? `${organisation} · ${contact.name}`
    : contact.name;
}

export type ProspectGroup = { label: string; people: Contact[] };

export function groupProspects(prospects: Contact[], tab: OutreachTab, now = Date.now()): ProspectGroup[] {
  const when = (contact: Contact) => followUpInDays(contact, now) ?? Number.POSITIVE_INFINITY;
  const byDate = (a: Contact, b: Contact) => {
    const [left, right] = [when(a), when(b)];
    return (left === right ? 0 : left < right ? -1 : 1) || comparePeopleByName(a, b);
  };
  const open = prospects.filter((contact) => outreachStage(contact) === "open");
  const groups: ProspectGroup[] =
    tab === "open" || tab === "due"
      ? [
          { label: "Follow up due", people: open.filter((contact) => isFollowUpDue(contact, now)).sort(byDate) },
          ...(tab === "open"
            ? [{ label: "Waiting", people: open.filter((contact) => !isFollowUpDue(contact, now)).sort(byDate) }]
            : []),
        ]
      : [
          {
            label: "Done",
            people: prospects
              .filter((contact) => outreachStage(contact) === tab)
              .sort(comparePeopleByName),
          },
        ];
  return groups.filter((group) => group.people.length > 0);
}
