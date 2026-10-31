import { describe, expect, it, vi } from "vitest";
import { mailboxFixture } from "./test-utils/agent-mailbox-fixture";
import {
  createEmailSendIdentity,
  deleteEmailSendIdentity,
  listVerifiedSendAddresses,
  sendEmailSendIdentityCode,
  verifyEmailSendIdentity,
} from "./email-send-identities";
import { getEmailDeliveryIdentity, sendEmailWithProvider } from "./email-providers";
import type { Env } from "./types";

// Migrated SQLite and the real provider routing; the EMAIL binding is simulated.
function fixture() {
  const f = mailboxFixture();
  // The owner's main sender is SMTP; Cloudflare Email is connected but not active.
  f.raw.prepare("INSERT INTO email_provider_settings(user_id,provider_id,is_active,config_json) VALUES('alice','smtp',1,?)")
    .run(JSON.stringify({ transport: "smtp", fromAddress: "alice@example.test" }));
  f.raw.prepare("INSERT INTO email_provider_settings(user_id,provider_id,is_active,config_json) VALUES('alice','cloudflare-email',0,?)")
    .run(JSON.stringify({ transport: "binding", fromAddress: "hello@studio.test", fromName: "Studio", replyToAddress: "desk@studio.test" }));
  const send = vi.fn(async (_message: Record<string, unknown>) => ({ messageId: "simulated" }));
  const env = { ...f.env, EMAIL: { send } } as unknown as Env;
  const lastCode = () => String(send.mock.calls.at(-1)![0].subject).match(/(\d{6})$/)![1];
  return { ...f, env, send, lastCode };
}

describe("send-as addresses", () => {
  it("proves an address with a code sent from it through its own provider", async () => {
    const f = fixture();
    const pending = await createEmailSendIdentity(f.env, "alice", {
      address: " Alice@Work.test ", displayName: "Alice at Work", providerId: "cloudflare-email",
    });
    expect(pending).toMatchObject({ address: "alice@work.test", status: "pending", providerId: "cloudflare-email" });
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.send.mock.calls[0][0]).toMatchObject({
      from: { email: "alice@work.test", name: "Alice at Work" },
      to: "alice@work.test",
    });

    await expect(verifyEmailSendIdentity(f.env, "alice", pending.id, { code: "000000" === f.lastCode() ? "111111" : "000000" }))
      .rejects.toThrow("That code is not right");
    await expect(verifyEmailSendIdentity(f.env, "bob", pending.id, { code: f.lastCode() })).rejects.toThrow("not found");
    expect(await listVerifiedSendAddresses(f.env, "alice")).toEqual([]);

    const verified = await verifyEmailSendIdentity(f.env, "alice", pending.id, { code: f.lastCode() });
    expect(verified.status).toBe("verified");
    expect((await listVerifiedSendAddresses(f.env, "alice")).map((identity) => identity.address)).toEqual(["alice@work.test"]);
  });

  it("routes mail from a verified address through that address's provider", async () => {
    const f = fixture();
    const identity = await createEmailSendIdentity(f.env, "alice", {
      address: "alice@work.test", displayName: "Alice at Work", providerId: "cloudflare-email",
    });

    // Unverified: the address gets no special route, so the active (unready) SMTP sender is used.
    await expect(getEmailDeliveryIdentity(f.env, "alice", { fromAddress: "alice@work.test" })).rejects.toThrow("SMTP");

    await verifyEmailSendIdentity(f.env, "alice", identity.id, { code: f.lastCode() });
    expect(await getEmailDeliveryIdentity(f.env, "alice", { fromAddress: "alice@work.test" })).toMatchObject({
      providerId: "cloudflare-email", fromAddress: "alice@work.test", fromName: "Alice at Work", replyToAddress: "",
    });

    f.send.mockClear();
    const result = await sendEmailWithProvider(f.env, "alice", {
      purpose: "draft", fromAddress: "alice@work.test", toAddress: "client@example.test",
      subject: "Hello", textBody: "Hi", approvedByUserId: "alice",
    });
    expect(result.providerId).toBe("cloudflare-email");
    expect(f.send.mock.calls[0][0]).toMatchObject({ from: { email: "alice@work.test", name: "Alice at Work" }, to: "client@example.test" });
    expect(f.send.mock.calls[0][0].replyTo).toBeUndefined();

    expect(await deleteEmailSendIdentity(f.env, "alice", identity.id)).toBe(true);
    await expect(getEmailDeliveryIdentity(f.env, "alice", { fromAddress: "alice@work.test" })).rejects.toThrow("SMTP");
  });

  it("rejects the managed sender, ME3 addresses and quick resends", async () => {
    const f = fixture();
    await expect(createEmailSendIdentity(f.env, "alice", { address: "alice@work.test", providerId: "managed_gateway" }))
      .rejects.toThrow("Choose the email service");
    await expect(createEmailSendIdentity(f.env, "alice", { address: "alice@me3.app", providerId: "cloudflare-email" }))
      .rejects.toThrow("already a sender");
    const identity = await createEmailSendIdentity(f.env, "alice", { address: "alice@work.test", providerId: "cloudflare-email" });
    await expect(sendEmailSendIdentityCode(f.env, "alice", identity.id)).rejects.toThrow("Wait a minute");
  });

  it("stores no code when the provider cannot send as the address", async () => {
    const f = fixture();
    f.raw.prepare("UPDATE email_provider_settings SET config_json=? WHERE provider_id='cloudflare-email'")
      .run(JSON.stringify({ transport: "binding", fromAddress: "" }));
    await expect(createEmailSendIdentity(f.env, "alice", { address: "alice@work.test", providerId: "cloudflare-email" }))
      .rejects.toThrow("not ready");
    expect(f.raw.prepare("SELECT code_hash FROM email_send_identities").get()).toMatchObject({ code_hash: null });
  });
});
