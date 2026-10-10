import { mailboxFixture } from "./test-utils/agent-mailbox-fixture";
import { describe, expect, it } from "vitest";
import {
  createAgentMailboxDraft,
  getAgentMailboxMessage,
  listAgentMailboxMessages,
} from "../../../packages/agent/src/services/mailbox";
import { listAgentContacts } from "../../../packages/agent/src/services/contacts";
import { createAgentMailboxServices } from "./agent-mailbox-services";
import type { Env } from "./types";


describe("independent new agent mailbox services", () => {
  it("honors direction and the boolean unread filter through the Worker bridge", async () => {
    const f = mailboxFixture();
    f.raw.exec(`INSERT INTO mailbox_messages(id,mailbox_id,direction,message_kind,status,subject,text_body,folder,read_at)
      VALUES ('alice-read','alice-mailbox','inbound','email','received','Read','Read body','inbox','2026-10-10T12:00:00Z'),
      ('alice-outbound','alice-mailbox','outbound','draft','pending_approval','Draft','Draft body','drafts',NULL);`);
    const services = createAgentMailboxServices(f.env as Env, "alice");
    expect((await services.search({ direction: "inbound", unread: true })).messages.map(row => row.id)).toEqual(["alice-message"]);
    expect((await services.search({ direction: "inbound", unread: false })).messages.map(row => row.id).sort()).toEqual(["alice-message", "alice-read"]);
    expect((await services.search({ direction: "outbound" })).messages.map(row => row.id)).toEqual(["alice-outbound"]);
  });
  it("lists only owner contacts and counts bookings only on that owner's sites", async () => {
    const f = mailboxFixture();
    f.raw.exec(`INSERT INTO contacts (id,user_id,name,email) VALUES
      ('alice-contact','alice','Client','shared@example.test'), ('bob-contact','bob','Private contact','shared@example.test');
      INSERT INTO sites(id,user_id,username,site_role) VALUES ('alice-site','alice','alice','profile'), ('bob-site','bob','bob','profile');
      INSERT INTO bookings(id,site_id,guest_name,guest_email,starts_at,ends_at,duration_minutes) VALUES
      ('alice-booking','alice-site','Client','shared@example.test','2026-10-10T10:00:00Z','2026-10-10T11:00:00Z',60),
      ('bob-booking','bob-site','Private','shared@example.test','2026-10-11T10:00:00Z','2026-10-11T11:00:00Z',60);`);
    const result = await listAgentContacts(f.env, "alice");
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]).toMatchObject({ id: "alice-contact", bookingCount: 1, lastBookingAt: "2026-10-10T10:00:00Z" });
  });

  it("searches real owner mailbox rows and never reads a different owner's ID", async () => {
    const f = mailboxFixture();
    const found = await listAgentMailboxMessages(f.env, "alice", { query: "TruHealth appointment", queryMode: "terms", direction: "all" });
    expect(found.messages.map(message => message.id)).toEqual(["alice-message"]);
    expect(found.total).toBe(1);
    expect(await getAgentMailboxMessage(f.env, "alice", "bob-message")).toMatchObject({ error: "Message not found", status: 404 });
    expect(await getAgentMailboxMessage(f.env, "alice", "alice-message")).toMatchObject({ message: { body: "A new appointment is available.", fromName: "Client" } });
  });

  it("persists one pending draft with reply headers and owner-scoped attachments across an idempotent retry", async () => {
    const f = mailboxFixture();
    const input = {
      to: "client@example.test", subject: "Re: TruHealth next slot", textBody: "Thank you. Please confirm Tuesday.",
      source: "agent", replyToMessageId: "alice-message",
      preservedAttachmentKeys: ["mailbox/alice-mailbox/attachment-1", "mailbox/bob-mailbox/private"],
      uploadedAttachments: [{ storageKey: "mailbox/bob-mailbox/uploads/private" }],
    };
    const first = await createAgentMailboxDraft(f.env, "alice", input, { idempotencyKey: "synthetic-draft-key" });
    expect(first).toMatchObject({ draft: { status: "pending_approval", body: input.textBody, sourceId: "alice-message", createdBy: "agent" } });
    expect(await createAgentMailboxDraft(f.env, "alice", input, { idempotencyKey: "synthetic-draft-key" })).toEqual(first);
    const row = f.raw.prepare("SELECT status, metadata_json FROM mailbox_messages WHERE agent_idempotency_key = ?").get("synthetic-draft-key")!;
    const metadata = JSON.parse(String(row.metadata_json));
    expect(row.status).toBe("pending_approval");
    expect(metadata.outbound_headers).toMatchObject({ in_reply_to: "<source@example.test>", references: "<earlier@example.test> <source@example.test>" });
    expect(metadata.attachments).toHaveLength(1);
    expect(metadata.attachments[0].storageKey).toBe("mailbox/alice-mailbox/attachment-1");
    expect(f.raw.prepare("SELECT COUNT(*) AS n FROM mailbox_messages WHERE message_kind = 'draft'").get()?.n).toBe(1);
    expect(f.raw.prepare("SELECT text_body FROM mailbox_messages WHERE id = 'bob-message'").get()?.text_body).toBe("Other owner private message.");
  });
});
