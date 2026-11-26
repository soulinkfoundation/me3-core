import { describe, expect, it } from "vitest";
import {
  cardsFromChannels,
  draftKey,
  draftWasSent,
  isPersonChannel,
  placePersonCards,
  readMessageDraft,
  visibleInThread,
  waitingCards,
  waitingCount,
  type MessagingChannelSnapshot,
} from "./messagingCards";

// Same failure modes as the phones (me3-ios MessagingTests, me3-android MessagingCardsTest): the owner's assistant
// channel, a circle, a community or a group chat shows up as a person; one person gets two cards; a declined request
// comes back; a burst loses its "N more"; a card that waits on nobody lands at the top of every new chat; a card sits
// in the wrong place in the thread; a sent draft offers Send again; five people writing push the starters away.
const me = "node_me";
const t0 = Date.parse("2027-01-15T08:00:00Z");

function channel(
  id: string,
  options: {
    type?: string;
    members?: number;
    extra?: Record<string, string>;
    other?: string;
    handle?: string | null;
    messages?: Array<[string, number, boolean]>;
    unread?: number;
    otherReadAt?: number | null;
  } = {},
): MessagingChannelSnapshot {
  const type = options.type ?? "messaging";
  return {
    cid: `${type}:${id}`,
    channelId: id,
    type,
    memberCount: options.members ?? 2,
    extra: options.extra ?? {},
    archived: false,
    other: { nodeId: options.other ?? "node_erum", name: "Erum Khan", imageUrl: null, handle: options.handle === undefined ? "erum" : options.handle },
    latestMessages: (options.messages ?? [["hi", 0, false]]).map(([text, offset, fromMe], index) => ({
      id: `${id}-${index}`,
      text,
      createdAt: t0 + offset * 1000,
      fromMe,
    })),
    unreadCount: options.unread ?? 0,
    otherReadAt: options.otherReadAt ?? null,
  };
}

describe("messaging cards", () => {
  it("only one-to-one conversations between people become cards", () => {
    const cards = cardsFromChannels([
      channel("!members-abc"),
      channel("assistant-123", { extra: { soulinkKind: "assistant", soulinkAssistant: "true" }, other: "assistant_1" }),
      channel("dm-with-assistant-user", { other: "assistant_2", handle: "assistant-kieran" }),
      channel("circle-tuesday", { extra: { soulinkEntity: "circle", soulinkCircleId: "c1" }, other: "node_c" }),
      channel("community-ab-general", { type: "community_core", other: "node_d" }),
      channel("group-abc", { members: 3, other: "node_e" }),
      channel("plain-group", { members: 4, other: "node_f" }),
      channel("kinded", { extra: { soulinkKind: "managed-community" }, other: "node_g" }),
    ], me);
    expect(cards.map((card) => card.channelId)).toEqual(["!members-abc"]);
    expect(isPersonChannel(channel("x", { other: "assistant_9" }))).toBe(false);
  });

  it("one person gets one card from their newest conversation", () => {
    const cards = cardsFromChannels([
      channel("old-dm", { messages: [["old", 0, false]] }),
      channel("new-dm", { messages: [["new", 60, false]] }),
    ], me);
    expect(cards.map((card) => card.channelId)).toEqual(["new-dm"]);
  });

  it("knows requests, bursts and replies, and hides a declined request", () => {
    const request = cardsFromChannels([channel("dm", { extra: { soulinkRequest: "pending", soulinkRequestRecipient: me } })], me)[0];
    expect(request.kind).toEqual({ type: "request" });
    const outgoing = cardsFromChannels([channel("dm", { extra: { soulinkRequest: "pending", soulinkRequestRecipient: "node_erum" }, messages: [["hello", 0, true]] })], me)[0];
    expect(outgoing.kind).toEqual({ type: "replied", seen: false });
    expect(cardsFromChannels([channel("dm", { extra: { soulinkRequest: "declined", soulinkRequestRecipient: me } })], me)).toEqual([]);
    const burst = cardsFromChannels([channel("dm", { unread: 3 })], me)[0];
    expect(burst.kind).toEqual({ type: "incoming", more: 2 });
    const seen = cardsFromChannels([channel("dm", { messages: [["hi", 10, true]], otherReadAt: t0 + 20_000 })], me)[0];
    expect(seen.kind).toEqual({ type: "replied", seen: true });
  });

  it("a thread shows its own conversations plus anything still waiting", () => {
    const cards = cardsFromChannels([
      channel("read-old", { other: "node_a", messages: [["old", 0, false]] }),
      channel("unread-old", { other: "node_b", messages: [["waiting", 10, false]], unread: 1 }),
      channel("request", { extra: { soulinkRequest: "pending", soulinkRequestRecipient: me }, other: "node_c", messages: [["hi", 20, false]] }),
      channel("recent", { other: "node_d", messages: [["today", 500, false]] }),
    ], me);
    expect(visibleInThread(cards, t0 + 100_000).map((card) => card.channelId)).toEqual(["unread-old", "request", "recent"]);
  });

  it("a card sits after the last message sent before it", () => {
    const cards = cardsFromChannels([
      channel("early", { other: "node_a", messages: [["a", 30, false]], unread: 1 }),
      channel("late", { other: "node_b", messages: [["b", 500, false]], unread: 1 }),
    ], me);
    const placed = placePersonCards(cards, [{ id: "m1", createdAt: t0 }, { id: "m2", createdAt: t0 + 60_000 }]);
    expect(placed.before.get("m2")?.map((card) => card.channelId)).toEqual(["early"]);
    expect(placed.trailing.map((card) => card.channelId)).toEqual(["late"]);
    // A reply still streaming (no time yet) counts as now, so an earlier person message goes before it.
    const streaming = placePersonCards(cards, [{ id: "m1", createdAt: t0 }, { id: "live", createdAt: null }], t0 + 1_000_000);
    expect(streaming.before.get("live")?.map((card) => card.channelId)).toEqual(["early", "late"]);
  });

  it("the empty chat shows only what is waiting, newest first, three at a time", () => {
    const cards = cardsFromChannels([
      channel("sent", { other: "node_a", messages: [["you wrote", 500, true]] }),
      channel("read", { other: "node_b", messages: [["seen it", 510, false]] }),
      channel("u1", { other: "node_c", messages: [["one", 100, false]], unread: 1 }),
      channel("u2", { other: "node_d", messages: [["two", 200, false]], unread: 1 }),
      channel("u3", { other: "node_e", messages: [["three", 300, false]], unread: 2 }),
      channel("request", { extra: { soulinkRequest: "pending", soulinkRequestRecipient: me }, other: "node_f", messages: [["hi", 400, false]] }),
    ], me);
    const waiting = waitingCards(cards);
    expect(waiting.shown.map((card) => card.channelId)).toEqual(["request", "u3", "u2"]);
    expect(waiting.more).toBe(1);
    expect(waitingCount(cards)).toBe(5);

    // Dismissed stays gone until something newer arrives in that conversation.
    const u3 = cards.find((card) => card.channelId === "u3")!;
    expect(waitingCards(cards, { dismissed: { [u3.cid]: u3.latest.id } }).shown.map((card) => card.channelId)).toEqual(["request", "u2", "u1"]);
    expect(waitingCards(cards, { dismissed: { [u3.cid]: "older-message" } }).shown.some((card) => card.channelId === "u3")).toBe(true);

    // A card already on screen stays while you reply from it, settling to its one line.
    const kept = cards.find((card) => card.channelId === "sent")!;
    expect(waitingCards(cards, { keep: new Set([kept.cid]), limit: 10 }).shown.map((card) => card.channelId))
      .toEqual(["sent", "request", "u3", "u2", "u1"]);
  });

  it("a draft knows it was sent, and an earlier one stays sent after a later message to them", () => {
    const draft = { contactId: "c1", recipientName: "Erum", soulinkNodeId: "node_erum", soulinkHandle: "erum", text: "Running late " };
    const sentCards = cardsFromChannels([channel("dm", { messages: [["Running late", 10, true]] })], me);
    expect(draftWasSent(draft, sentCards, new Set())).toBe(true);
    expect(draftWasSent(draft, cardsFromChannels([channel("dm", { messages: [["Something else", 10, true]] })], me), new Set())).toBe(false);
    expect(draftWasSent(draft, cardsFromChannels([channel("dm", { messages: [["Running late", 10, false]] })], me), new Set())).toBe(false);

    const later = cardsFromChannels([channel("dm", { messages: [["Second one", 20, true], ["Running late", 10, true]] })], me);
    expect(draftWasSent(draft, later, new Set())).toBe(false);
    expect(draftWasSent(draft, later, new Set([draftKey("node_erum", "Running late")]))).toBe(true);
  });

  it("reads only a complete message draft", () => {
    const draft = { contactId: "c1", recipientName: "Erum", soulinkNodeId: "node_erum", soulinkHandle: "erum", text: "Hi" };
    expect(readMessageDraft(draft)).toEqual(draft);
    expect(readMessageDraft({ ...draft, soulinkHandle: undefined })).toEqual({ ...draft, soulinkHandle: null });
    expect(readMessageDraft({ ...draft, text: "  " })).toBeNull();
    expect(readMessageDraft({ ...draft, soulinkHandle: 4 })).toBeNull();
    expect(readMessageDraft(null)).toBeNull();
  });
});
