import { defineStore } from "pinia";
import { computed, ref, shallowRef } from "vue";
import type { Channel, Event, StreamChat } from "stream-chat";
import { api } from "../api";
import {
  cardsFromChannels,
  draftKey,
  waitingCount,
  type MessagingChannelSnapshot,
  type MessagingPerson,
  type PersonMessageCard,
} from "../utils/messagingCards";

/**
 * ME3 messaging on the web: a client of Soulink's one-to-one chat, as on the phones. Core trades the owner's Soulink
 * connection for a short-lived Soulink session and Stream token (`POST /api/messaging/session`); after that this
 * browser talks to Stream directly. Soulink's own chat calls (requests, block, report, people, start a chat) go
 * through Core's `/api/messaging/soulink/*` pass-through, because Soulink's API only answers its own site. No message
 * text is ever stored by Core.
 */

type MessagingSession = {
  soulinkApiOrigin: string;
  soulinkSessionToken: string;
  expiresAt: string;
  ownerNodeId: string;
  stream: { apiKey: string; userId: string; token: string };
};

export type SoulinkNode = { id: string; displayName: string; handle: string; avatarUrl: string | null; linked?: boolean | null };

export type ReportReason = "spam" | "harassment" | "hate_speech" | "sexual_content" | "violence" | "other";

export const REPORT_REASONS: Array<{ value: ReportReason; label: string }> = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate_speech", label: "Hate speech" },
  { value: "sexual_content", label: "Sexual content" },
  { value: "violence", label: "Violence or threats" },
  { value: "other", label: "Something else" },
];

const SENT_DRAFTS_KEY = "me3:messaging:sent-drafts";
const REFRESH_MARGIN_MS = 60_000;
let streamModule: Promise<typeof import("stream-chat")> | null = null;

function readSentDrafts(): Set<string> {
  try {
    const raw = localStorage.getItem(SENT_DRAFTS_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function snapshotChannel(channel: Channel, me: string): MessagingChannelSnapshot {
  const data = (channel.data ?? {}) as Record<string, unknown>;
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") extra[key] = value;
    else if (typeof value === "boolean") extra[key] = value ? "true" : "false";
    else if (typeof value === "number") extra[key] = String(value);
  }
  const members = Object.values(channel.state.members);
  const otherMember = members.find((member) => (member.user?.id ?? member.user_id) !== me);
  const otherUser = otherMember?.user;
  const otherId = otherUser?.id ?? otherMember?.user_id;
  // Soulink puts the handle in the Stream user's custom data.
  const rawHandle = (otherUser as Record<string, unknown> | undefined)?.handle;
  const handle = typeof rawHandle === "string" ? rawHandle : null;
  const other: MessagingPerson | null = otherId
    ? { nodeId: otherId, name: otherUser?.name?.trim() || handle || "Someone", imageUrl: otherUser?.image ? String(otherUser.image) : null, handle }
    : null;
  const latest = [...channel.state.latestMessages]
    .reverse()
    .filter((message) => message.type !== "system" && message.type !== "deleted" && (message.text?.trim() || message.attachments?.length))
    .map((message) => ({
      id: message.id,
      text: message.text?.trim() ? message.text : "Sent an attachment",
      createdAt: new Date(message.created_at ?? Date.now()).getTime(),
      fromMe: message.user?.id === me,
    }));
  const otherRead = otherId ? channel.state.read[otherId]?.last_read : undefined;
  return {
    cid: channel.cid,
    channelId: channel.id ?? "",
    type: channel.type,
    memberCount: typeof data.member_count === "number" ? data.member_count : members.length,
    extra,
    archived: Boolean(channel.state.membership?.archived_at),
    other,
    latestMessages: latest,
    unreadCount: channel.countUnread(),
    otherReadAt: otherRead ? new Date(otherRead).getTime() : null,
  };
}

export const useMessagingStore = defineStore("messaging", () => {
  const status = ref<"idle" | "connecting" | "ready" | "unavailable">("idle");
  const cards = ref<PersonMessageCard[]>([]);
  const me = ref<string | null>(null);
  const client = shallowRef<StreamChat | null>(null);
  const sentDrafts = ref<Set<string>>(readSentDrafts());
  /** People blocked here, hidden at once while Soulink and Stream catch up. */
  const hiddenPeople = ref<Set<string>>(new Set());
  /** Bumped whenever a channel changes, so an open conversation re-reads its messages. */
  const revision = ref(0);
  let session: MessagingSession | null = null;
  let channels: Channel[] = [];
  let unsubscribe: (() => void) | null = null;
  let startPromise: Promise<void> | null = null;
  let requeryTimer: ReturnType<typeof setTimeout> | null = null;

  const ready = computed(() => status.value === "ready");
  const waiting = computed(() => waitingCount(cards.value));

  async function fetchSession(): Promise<MessagingSession> {
    const next = await api.post<MessagingSession>("/messaging/session", { client: "web" });
    session = next;
    return next;
  }

  /** The Soulink session for pass-through calls, fetched again shortly before it expires. */
  async function soulinkSession(): Promise<string> {
    if (!session || Date.parse(session.expiresAt) - Date.now() < REFRESH_MARGIN_MS) await fetchSession();
    return session!.soulinkSessionToken;
  }

  async function soulink<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    const headers = { "X-Soulink-Session": await soulinkSession() };
    const endpoint = `/messaging/soulink${path}`;
    if (method === "GET") return api.get<T>(endpoint, { headers });
    if (method === "DELETE") return api.delete<T>(endpoint, { headers });
    return api.post<T>(endpoint, body, { headers });
  }

  /** Starts messaging for the signed-in owner. Fails quietly: Chat simply shows no cards. */
  function start(): Promise<void> {
    if (status.value === "ready") return Promise.resolve();
    if (startPromise) return startPromise;
    startPromise = connect().finally(() => { startPromise = null; });
    return startPromise;
  }

  async function connect() {
    status.value = "connecting";
    try {
      const [first, module] = await Promise.all([fetchSession(), (streamModule ??= import("stream-chat"))]);
      const chat = new module.StreamChat(first.stream.apiKey);
      let firstHandedOut = false;
      // Stream asks again when the token expires: fetch a new session from ME3 so the owner never notices.
      await chat.connectUser({ id: first.stream.userId }, async () => {
        if (!firstHandedOut) { firstHandedOut = true; return first.stream.token; }
        return (await fetchSession()).stream.token;
      });
      client.value = chat;
      me.value = first.stream.userId;
      unsubscribe = chat.on(handleEvent).unsubscribe;
      await queryChannels();
      status.value = "ready";
    } catch (error) {
      console.warn("ME3 messaging is unavailable", error instanceof Error ? error.message : error);
      await stop();
      status.value = "unavailable";
    }
  }

  async function queryChannels() {
    const chat = client.value;
    if (!chat || !me.value) return;
    channels = await chat.queryChannels(
      { type: "messaging", members: { $in: [me.value] } },
      [{ last_message_at: -1 }],
      { watch: true, state: true, presence: false, limit: 30, message_limit: 25 },
    );
    rebuild();
  }

  function rebuild() {
    if (!me.value) return;
    const owner = me.value;
    const next = cardsFromChannels(channels.map((channel) => snapshotChannel(channel, owner)), owner)
      .filter((card) => !hiddenPeople.value.has(card.person.nodeId));
    cards.value = next;
    revision.value += 1;
  }

  function scheduleRequery() {
    if (requeryTimer) clearTimeout(requeryTimer);
    requeryTimer = setTimeout(() => { requeryTimer = null; void queryChannels().catch(() => rebuild()); }, 150);
  }

  function handleEvent(event: Event) {
    const type = event.type;
    if (!type) return;
    // A conversation this browser isn't watching yet (a new chat, a request, one unarchived): list again.
    const known = event.cid ? channels.some((channel) => channel.cid === event.cid) : true;
    if (type.startsWith("notification.") || type === "channel.updated" || type === "channel.deleted" || type === "connection.recovered" || !known) {
      scheduleRequery();
      return;
    }
    if (type.startsWith("message.") || type.startsWith("member.") || type === "channel.truncated") rebuild();
  }

  async function stop() {
    unsubscribe?.();
    unsubscribe = null;
    const chat = client.value;
    client.value = null;
    channels = [];
    cards.value = [];
    me.value = null;
    session = null;
    status.value = "idle";
    if (chat) await chat.disconnectUser().catch(() => undefined);
  }

  function channel(cid: string): Channel | null {
    const chat = client.value;
    if (!chat) return null;
    const [type, id] = cid.split(":");
    return channels.find((candidate) => candidate.cid === cid) ?? (type && id ? chat.channel(type, id) : null);
  }

  async function watched(cid: string): Promise<Channel> {
    const found = channel(cid);
    if (!found) throw new Error("Messaging isn't connected. Please try again.");
    if (!found.initialized) await found.watch();
    return found;
  }

  async function send(cid: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const target = await watched(cid);
    await target.sendMessage({ text: trimmed });
    await target.markRead().catch(() => undefined);
    rebuild();
  }

  async function markRead(cid: string) {
    const target = channel(cid);
    if (!target) return;
    await target.markRead().catch(() => undefined);
    rebuild();
  }

  /** Opens (or finds) the one-to-one conversation with someone; Soulink decides whether it's a message or a request. */
  async function startConversation(nodeId: string): Promise<string> {
    const started = await soulink<{ streamChannelType: string; streamChannelId: string }>("POST", "/api/stream/chats", { memberIds: [nodeId] });
    const cid = `${started.streamChannelType}:${started.streamChannelId}`;
    const target = await watched(cid);
    if (target.state.membership?.archived_at) await target.unarchive().catch(() => undefined);
    if (!channels.some((candidate) => candidate.cid === cid)) channels = [target, ...channels];
    rebuild();
    return cid;
  }

  function markDraftSent(nodeId: string, text: string) {
    const next = new Set(sentDrafts.value);
    next.add(draftKey(nodeId, text));
    sentDrafts.value = next;
    // Only recent drafts matter; the list stays small.
    try { localStorage.setItem(SENT_DRAFTS_KEY, JSON.stringify([...next].slice(-200))); } catch { /* private mode */ }
  }

  async function accept(card: PersonMessageCard) {
    await soulink("POST", `/api/chat-requests/${encodeURIComponent(card.channelId)}/accept`, {});
    await channel(card.cid)?.watch().catch(() => undefined);
    rebuild();
  }

  async function decline(card: PersonMessageCard) {
    await soulink("POST", `/api/chat-requests/${encodeURIComponent(card.channelId)}/decline`, {});
    hide(card.person.nodeId);
  }

  async function block(person: MessagingPerson) {
    if (!person.handle) throw new Error("This person can't be blocked from here yet.");
    await soulink("POST", `/api/nodes/${encodeURIComponent(person.handle)}/block`);
    hide(person.nodeId);
  }

  async function unblock(person: MessagingPerson) {
    if (!person.handle) return;
    await soulink("DELETE", `/api/nodes/${encodeURIComponent(person.handle)}/block`);
    const next = new Set(hiddenPeople.value);
    next.delete(person.nodeId);
    hiddenPeople.value = next;
    await queryChannels().catch(() => undefined);
  }

  async function isBlocked(person: MessagingPerson): Promise<boolean> {
    if (!person.handle) return false;
    const result = await soulink<{ isBlocked: boolean }>("GET", `/api/nodes/${encodeURIComponent(person.handle)}/block/status`);
    return result.isBlocked;
  }

  /** A report about a person: their latest message when there is one, otherwise their profile. */
  async function report(card: PersonMessageCard, reason: ReportReason, details: string) {
    const theirs = !card.latest.fromMe ? card.latest : null;
    const trimmed = details.trim();
    await soulink("POST", "/api/content-reports", {
      data: {
        contentType: theirs ? "message" : "profile",
        contentId: (theirs?.id ?? card.person.nodeId).slice(0, 500),
        reason,
        details: trimmed ? trimmed.slice(0, 2000) : null,
        targetSnapshot: {
          title: `Message from ${card.person.name}`.slice(0, 300),
          body: (theirs?.text ?? "").slice(0, 2000),
          authorName: card.person.name.slice(0, 150),
          authorHandle: (card.person.handle ?? "").slice(0, 100),
        },
      },
    });
  }

  /** People you're linked with, or (with a search) anyone public whose name or handle matches. */
  async function people(search = ""): Promise<SoulinkNode[]> {
    const query = search.trim();
    const result = await soulink<{ nodes: SoulinkNode[] }>("GET", query ? `/api/people?q=${encodeURIComponent(query)}` : "/api/people");
    return result.nodes.filter((node) => node.id !== me.value && !hiddenPeople.value.has(node.id));
  }

  /** ME3 contacts already on Soulink, matched by hashed email. Raw emails never leave this browser. */
  async function contactMatches(emails: string[]): Promise<SoulinkNode[]> {
    const hashes = (await Promise.all(emails.map(emailHash))).filter((hash): hash is string => Boolean(hash));
    if (!hashes.length) return [];
    const found: SoulinkNode[] = [];
    for (let index = 0; index < hashes.length; index += 500) {
      const result = await soulink<{ matches: Array<{ hash: string; node: SoulinkNode }> }>("POST", "/api/contacts/matches", { hashes: hashes.slice(index, index + 500) });
      found.push(...result.matches.map((match) => match.node));
    }
    return found.filter((node) => node.id !== me.value);
  }

  function hide(nodeId: string) {
    const next = new Set(hiddenPeople.value);
    next.add(nodeId);
    hiddenPeople.value = next;
    cards.value = cards.value.filter((card) => card.person.nodeId !== nodeId);
  }

  return {
    status, ready, cards, me, client, sentDrafts, revision, waiting,
    start, stop, channel, watched, send, markRead, startConversation, markDraftSent,
    accept, decline, block, unblock, isBlocked, report, people, contactMatches,
  };
});

/** Soulink's contact starter hash: SHA-256 of the trimmed, lowercased email, base64url, 43 characters. */
export async function emailHash(email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes("@")) return null;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 43);
}
