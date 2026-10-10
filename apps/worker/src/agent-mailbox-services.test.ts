import { describe, expect, it, vi } from "vitest";
import { mailboxFixture } from "./test-utils/agent-mailbox-fixture";
import { createAgentMailboxServices } from "./agent-mailbox-services";
import type { Env } from "./types";
import { EmailProviderInputError } from "./email-providers";
import { mailboxTools } from "../../../packages/agent/src/tools/mailbox";

function fixture() {
  const f = mailboxFixture();
  f.raw.prepare(`INSERT INTO email_provider_settings (user_id,provider_id,is_active,config_json)
    VALUES ('alice','cloudflare-email',1,?)`).run(JSON.stringify({ transport: "binding", fromAddress: "alice@example.test" }));
  const send = vi.fn(async () => ({ messageId: "synthetic-provider-message" }));
  const env = { ...f.env, EMAIL: { send } } as unknown as Env;
  return { ...f, send, env, services: createAgentMailboxServices(env, "alice") };
}

async function draft(f: ReturnType<typeof fixture>) {
  const result = await f.services.createDraft({ to: "client@example.test", subject: "Reviewed subject", body: "Reviewed body" }, "create-draft-key");
  if ("error" in result) throw new Error(result.error);
  return result.draft;
}

describe("new agent mailbox delivery bridge", () => {
  it("uses native search and persists an approved send claim and stable audit before one real provider call", async () => {
    const f = fixture(); const expected = await draft(f);
    expect((await f.services.search({ query: "TruHealth appointment" })).messages.map(message => message.id)).toEqual(["alice-message"]);
    f.send.mockImplementationOnce(async () => {
      expect(f.raw.prepare("SELECT status,approved_by_user_id FROM mailbox_messages WHERE id=?").get(expected.id)).toMatchObject({ status: "approved", approved_by_user_id: "alice" });
      expect(f.raw.prepare("SELECT status,metadata_json FROM email_send_audit WHERE mailbox_message_id=?").get(expected.id)).toMatchObject({ status: "pending" });
      return { messageId: "synthetic-provider-message" };
    });
    expect(await f.services.sendDraft!(expected.id, "send-key", expected)).toMatchObject({ draft: { status: "sent", providerMessageId: "synthetic-provider-message" } });
    expect(f.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ to: "client@example.test", subject: "Reviewed subject", text: "Reviewed body" }));
    expect(await f.services.sendDraft!(expected.id, "send-key", expected)).toMatchObject({ draft: { status: "sent" } });
    const tool = mailboxTools().find(tool => tool.name === "core_mailbox_send")!;
    expect(await tool.execute({ draftId: expected.id }, {
      db: f.env.DB, ownerId: "alice", threadId: "thread", turnId: "turn", requestId: "request", toolCallId: "call",
      idempotencyKey: "send-key", ownerTimezone: "Europe/Dublin", messageText: "", messages: [], enabledPluginIds: new Set(),
      services: { mailbox: f.services }, approved: true, approvalData: { target: expected, targetDomain: "mailbox message" }, signal: new AbortController().signal,
    })).toMatchObject({ status: "ok", data: { draft: { status: "sent" } } });
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("rejects changed approved content, foreign owner IDs, and a competing edit before the atomic claim", async () => {
    const f = fixture(); const expected = await draft(f);
    f.raw.prepare("UPDATE mailbox_messages SET text_body='Changed body' WHERE id=?").run(expected.id);
    expect(await f.services.sendDraft!(expected.id, "send-key", expected)).toMatchObject({ status: 409 });
    expect(await f.services.sendDraft!("bob-message", "other-key", { ...expected, id: "bob-message" })).toMatchObject({ status: 404 });
    f.raw.prepare("UPDATE mailbox_messages SET text_body='Reviewed body' WHERE id=?").run(expected.id);
    const prepare = f.env.DB.prepare.bind(f.env.DB);
    f.env.DB.prepare = ((sql: string) => {
      if (sql.startsWith("UPDATE mailbox_messages") && sql.includes("status = 'approved'")) {
        f.raw.prepare("UPDATE mailbox_messages SET updated_at='2026-10-10T19:00:00Z' WHERE id=?").run(expected.id);
      }
      return prepare(sql);
    }) as typeof prepare;
    expect(await f.services.sendDraft!(expected.id, "send-key", expected)).toMatchObject({ status: 409 });
    expect(f.send).not.toHaveBeenCalled();
  });

  it("keeps an uncertain provider result claimed and refuses to send again during recovery", async () => {
    const f = fixture(); const expected = await draft(f);
    f.send.mockRejectedValueOnce(new Error("simulated connection lost after acceptance"));
    expect(await f.services.sendDraft!(expected.id, "send-key", expected)).toMatchObject({ error: expect.stringMatching(/unconfirmed|uncertain|unknown/i) });
    expect(f.raw.prepare("SELECT status FROM mailbox_messages WHERE id=?").get(expected.id)?.status).toBe("approved");
    expect(await f.services.sendDraft!(expected.id, "send-key", expected)).toMatchObject({ status: 409 });
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("records a definitive provider failure as failed and never retries the old approved operation", async () => {
    const f = fixture(); const expected = await draft(f);
    f.send.mockRejectedValueOnce(new EmailProviderInputError("synthetic recipient rejected", 422));
    expect(await f.services.sendDraft!(expected.id, "send-key", expected)).toMatchObject({ error: "synthetic recipient rejected" });
    expect(f.raw.prepare("SELECT status FROM mailbox_messages WHERE id=?").get(expected.id)?.status).toBe("failed");
    expect(await f.services.sendDraft!(expected.id, "send-key", expected)).toMatchObject({ status: 409 });
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("reconciles a durable native sent audit after local completion failed without a second provider call", async () => {
    const f = fixture(); const expected = await draft(f);
    const prepare = f.env.DB.prepare.bind(f.env.DB); let failOnce = true;
    f.env.DB.prepare = ((sql: string) => {
      if (failOnce && sql.startsWith("UPDATE mailbox_messages") && sql.includes("message_kind = 'email'")) {
        failOnce = false; throw new Error("simulated persistence interruption");
      }
      return prepare(sql);
    }) as typeof prepare;
    expect(await f.services.sendDraft!(expected.id, "send-key", expected)).toMatchObject({ error: expect.any(String) });
    expect(f.raw.prepare("SELECT status FROM mailbox_messages WHERE id=?").get(expected.id)?.status).toBe("approved");
    expect(await f.services.sendDraft!(expected.id, "send-key", expected)).toMatchObject({ draft: { status: "sent" } });
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it("does not label edited content sent when an edit races provider completion", async () => {
    const f = fixture(); const expected = await draft(f);
    f.send.mockImplementationOnce(async () => {
      f.raw.prepare("UPDATE mailbox_messages SET text_body='Unreviewed replacement' WHERE id=?").run(expected.id);
      return { messageId: "synthetic-provider-message" };
    });
    expect(await f.services.sendDraft!(expected.id, "send-key", expected)).toMatchObject({ error: expect.any(String) });
    expect(f.raw.prepare("SELECT status FROM mailbox_messages WHERE id=?").get(expected.id)?.status).toBe("approved");
    expect(await f.services.sendDraft!(expected.id, "send-key", expected)).toMatchObject({ status: 409 });
    expect(f.send).toHaveBeenCalledTimes(1);
  });
});
