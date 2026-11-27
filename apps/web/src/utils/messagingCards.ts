/**
 * Person cards for Chat: the owner's one-to-one Soulink conversations, built from Stream channel snapshots. The same
 * rules as the phones (me3-ios MessagingStore.swift `MessagingCards`, me3-android MessagingModels.kt), kept as pure
 * functions so they are tested without Stream.
 */

export type MessagingPerson = {
  nodeId: string;
  name: string;
  imageUrl: string | null;
  handle: string | null;
};

export type MessagingMessageSnapshot = {
  id: string;
  text: string;
  /** Epoch milliseconds. */
  createdAt: number;
  fromMe: boolean;
};

export type MessagingChannelSnapshot = {
  cid: string;
  channelId: string;
  type: string;
  memberCount: number;
  /** The channel's custom data, reduced to strings (Soulink only sets strings and bools). */
  extra: Record<string, string>;
  archived: boolean;
  other: MessagingPerson | null;
  /** Newest first. */
  latestMessages: MessagingMessageSnapshot[];
  unreadCount: number;
  /** When the other person last read the conversation, for "Seen". */
  otherReadAt: number | null;
};

export type PersonCardKind =
  /** Someone you aren't linked with yet: Accept / Decline. */
  | { type: "request" }
  /** Their message is the latest: shows it, with "N more" for an unread burst and an inline reply. */
  | { type: "incoming"; more: number }
  /** You wrote last: one quiet line with your message and whether they've seen it. */
  | { type: "replied"; seen: boolean };

export type PersonMessageCard = {
  cid: string;
  channelId: string;
  person: MessagingPerson;
  kind: PersonCardKind;
  latest: MessagingMessageSnapshot;
  unreadCount: number;
};

export type AgentMessageDraft = {
  contactId: string;
  recipientName: string;
  soulinkNodeId: string;
  soulinkHandle: string | null;
  text: string;
};

/** Channel custom data that marks anything other than a person-to-person conversation. */
const NON_PERSON_KEYS = ["soulinkKind", "soulink_kind", "soulinkCircleId", "soulink_circle_id", "soulinkAssistant"];

export function firstName(person: Pick<MessagingPerson, "name">): string {
  return person.name.trim().split(/\s+/)[0] || person.name;
}

export const cardTime = (card: PersonMessageCard) => card.latest.createdAt;
export const isRequest = (card: PersonMessageCard) => card.kind.type === "request";

/** Only 1:1 conversations between two people: never the assistant channel, circles, communities or group chats. */
export function isPersonChannel(channel: MessagingChannelSnapshot): boolean {
  if (channel.type !== "messaging" || channel.memberCount !== 2 || channel.archived) return false;
  if (["assistant-", "circle-", "group-", "community-"].some((prefix) => channel.channelId.startsWith(prefix))) return false;
  const entity = channel.extra.soulinkEntity ?? channel.extra.soulink_entity;
  if (entity === "circle") return false;
  if (NON_PERSON_KEYS.some((key) => channel.extra[key] !== undefined)) return false;
  const other = channel.other;
  if (!other) return false;
  if (other.nodeId.startsWith("assistant_") || other.handle?.startsWith("assistant-")) return false;
  return true;
}

/** The cards for Chat, oldest first: one per person with at least one message. */
export function cardsFromChannels(channels: MessagingChannelSnapshot[], me: string): PersonMessageCard[] {
  const seenPeople = new Set<string>();
  const cards: PersonMessageCard[] = [];
  const ordered = [...channels].sort((a, b) => (b.latestMessages[0]?.createdAt ?? 0) - (a.latestMessages[0]?.createdAt ?? 0));
  for (const channel of ordered) {
    if (!isPersonChannel(channel)) continue;
    const other = channel.other!;
    const latest = channel.latestMessages[0];
    if (!latest) continue;
    // One card per person, even if Soulink has an older duplicate conversation.
    if (seenPeople.has(other.nodeId)) continue;
    seenPeople.add(other.nodeId);
    const request = channel.extra.soulinkRequest;
    const toMe = channel.extra.soulinkRequestRecipient === me;
    // A request you declined stays out of sight, as in Soulink.
    if (request === "declined" && toMe) continue;
    let kind: PersonCardKind;
    if (request === "pending" && toMe) kind = { type: "request" };
    else if (latest.fromMe) kind = { type: "replied", seen: channel.otherReadAt !== null && channel.otherReadAt >= latest.createdAt };
    else kind = { type: "incoming", more: Math.max(0, channel.unreadCount - 1) };
    cards.push({ cid: channel.cid, channelId: channel.channelId, person: other, kind, latest, unreadCount: channel.unreadCount });
  }
  return cards.sort((a, b) => cardTime(a) - cardTime(b));
}

/** What waits on the owner, for the Messages badge: unread messages, and a request counts as one. */
export function waitingCount(cards: PersonMessageCard[]): number {
  return cards.reduce((total, card) => total + (isRequest(card) ? 1 : card.unreadCount), 0);
}

/** The cards a thread shows: those since its first message, plus anything still waiting on the owner. */
export function visibleInThread(cards: PersonMessageCard[], threadStart: number): PersonMessageCard[] {
  return cards.filter((card) => isRequest(card) || card.unreadCount > 0 || cardTime(card) >= threadStart);
}

/**
 * Person cards placed in the thread: before the first message sent after them, or after everything when they are the
 * newest. A message still being written (no time yet) counts as now.
 */
export function placePersonCards(
  cards: PersonMessageCard[],
  messages: Array<{ id: string; createdAt: number | null }>,
  now: number = Date.now(),
): { before: Map<string, PersonMessageCard[]>; trailing: PersonMessageCard[] } {
  const before = new Map<string, PersonMessageCard[]>();
  const trailing: PersonMessageCard[] = [];
  const first = messages[0]?.createdAt;
  if (first === undefined) return { before, trailing };
  for (const card of visibleInThread(cards, first ?? now)) {
    const slot = messages.reduce((count, message) => ((message.createdAt ?? now) <= cardTime(card) ? count + 1 : count), 0);
    const message = messages[slot];
    if (message) before.set(message.id, [...(before.get(message.id) ?? []), card]);
    else trailing.push(card);
  }
  return { before, trailing };
}

/**
 * The cards an empty chat shows: only what's waiting on the owner (unread or a request), newest first, at most `limit`,
 * with how many more there are for "See all". `dismissed` maps a conversation to the latest message it was dismissed
 * at, so it comes back only when something newer arrives. `keep` holds cards already on screen this visit, so one you
 * just replied to settles to its line instead of vanishing.
 */
export function waitingCards(
  cards: PersonMessageCard[],
  options: { dismissed?: Record<string, string>; keep?: Set<string>; limit?: number } = {},
): { shown: PersonMessageCard[]; more: number } {
  const { dismissed = {}, keep = new Set<string>(), limit = 3 } = options;
  const all = cards
    .filter((card) => dismissed[card.cid] !== card.latest.id && (isRequest(card) || card.unreadCount > 0 || keep.has(card.cid)))
    .sort((a, b) => cardTime(b) - cardTime(a));
  return { shown: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}

/** Accepts only a complete draft, from a live turn or saved history (as Core's readAgentMessageDraft). */
export function readMessageDraft(value: unknown): AgentMessageDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  const filled = (key: string) => (typeof draft[key] === "string" && (draft[key] as string).trim() ? (draft[key] as string) : null);
  const contactId = filled("contactId"), recipientName = filled("recipientName"), soulinkNodeId = filled("soulinkNodeId"), text = filled("text");
  if (!contactId || !recipientName || !soulinkNodeId || !text) return null;
  if (draft.soulinkHandle !== null && draft.soulinkHandle !== undefined && typeof draft.soulinkHandle !== "string") return null;
  return { contactId, recipientName, soulinkNodeId, soulinkHandle: filled("soulinkHandle"), text };
}

export function draftKey(nodeId: string, text: string): string {
  return `${nodeId}\n${text.trim()}`;
}

/** Sent from its card in this browser, or the person's latest message is this text from the owner. */
export function draftWasSent(draft: AgentMessageDraft, cards: PersonMessageCard[], sentDrafts: Set<string>): boolean {
  if (sentDrafts.has(draftKey(draft.soulinkNodeId, draft.text))) return true;
  const card = cards.find((candidate) => candidate.person.nodeId === draft.soulinkNodeId);
  return Boolean(card && card.latest.fromMe && card.latest.text.trim() === draft.text.trim());
}

/** "now", "14:05", "Tue" or "3 Nov", like the phones' message times. */
export function messagingTimeLabel(time: number, now: number = Date.now()): string {
  const elapsed = now - time;
  if (elapsed < 60_000) return "now";
  const date = new Date(time);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  if (elapsed < 6 * 24 * 60 * 60 * 1000) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
