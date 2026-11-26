import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Channel } from "stream-chat";
import { emailHash, snapshotChannel } from "./messaging";

// Failure modes: a contact hash that doesn't match Soulink's (so nobody is found, or a raw email is sent instead); a
// channel snapshot that takes the owner for the other person, loses "Seen", counts system messages or keeps oldest first.
describe("messaging store helpers", () => {
  it("hashes an email the way Soulink's contact starter does", async () => {
    const expected = createHash("sha256").update("erum@example.com").digest("base64url").slice(0, 43);
    expect(await emailHash("  Erum@Example.com ")).toBe(expected);
    expect(await emailHash("not-an-email")).toBeNull();
  });

  it("snapshots a Stream channel from the owner's side", () => {
    const channel = {
      cid: "messaging:dm-1",
      id: "dm-1",
      type: "messaging",
      data: { member_count: 2, soulinkRequest: "pending", soulinkRequestRecipient: "node_me", frozen: false, image: { nested: true } },
      countUnread: () => 2,
      state: {
        members: {
          node_me: { user_id: "node_me", user: { id: "node_me", name: "Kieran" } },
          node_erum: { user_id: "node_erum", user: { id: "node_erum", name: "Erum Khan", handle: "erum", image: "https://img/erum.png" } },
        },
        membership: {},
        read: { node_erum: { last_read: "2027-01-15T08:05:00Z" } },
        latestMessages: [
          { id: "m1", type: "regular", text: "Hello", created_at: "2027-01-15T08:00:00Z", user: { id: "node_erum" } },
          { id: "m2", type: "system", text: "Erum joined", created_at: "2027-01-15T08:01:00Z", user: { id: "node_erum" } },
          { id: "m3", type: "regular", text: "", attachments: [{ type: "image" }], created_at: "2027-01-15T08:02:00Z", user: { id: "node_me" } },
        ],
      },
    } as unknown as Channel;
    const snapshot = snapshotChannel(channel, "node_me");
    expect(snapshot.other).toEqual({ nodeId: "node_erum", name: "Erum Khan", imageUrl: "https://img/erum.png", handle: "erum" });
    expect(snapshot.latestMessages.map((message) => [message.id, message.text, message.fromMe])).toEqual([
      ["m3", "Sent an attachment", true],
      ["m1", "Hello", false],
    ]);
    expect(snapshot.extra).toEqual({ soulinkRequest: "pending", soulinkRequestRecipient: "node_me", frozen: "false", member_count: "2" });
    expect(snapshot.memberCount).toBe(2);
    expect(snapshot.unreadCount).toBe(2);
    expect(snapshot.otherReadAt).toBe(Date.parse("2027-01-15T08:05:00Z"));
  });
});
