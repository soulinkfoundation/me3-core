import { describe, expect, it, vi } from "vitest";
import { mailboxFixture } from "./test-utils/agent-mailbox-fixture";
import { sendEmailWithProvider } from "./email-providers";
import { parseMailRecipients } from "../../../shared/mail-recipients";
import type { Env } from "./types";

// Owner mail to several people: To list, Cc and Bcc through the real provider routing.
function fixture() {
  const f = mailboxFixture();
  f.raw.prepare("INSERT INTO email_provider_settings(user_id,provider_id,is_active,config_json) VALUES('alice','cloudflare-email',1,?)")
    .run(JSON.stringify({ transport: "binding", fromAddress: "hello@studio.test", fromName: "Studio" }));
  const send = vi.fn(async (_message: Record<string, unknown>) => ({ messageId: "simulated" }));
  const env = { ...f.env, EMAIL: { send } } as unknown as Env;
  return { ...f, env, send };
}

describe("owner mail recipients", () => {
  it("parses header-style lists and drops duplicates", () => {
    expect(parseMailRecipients('Aoife <AOIFE@x.ie>; b@y.ie,\n"Byrne, Seán" <sean@z.ie>, b@y.ie')).toEqual([
      "aoife@x.ie",
      "b@y.ie",
      "sean@z.ie",
    ]);
    expect(parseMailRecipients(["a@x.ie, c@x.ie", 3, "a@x.ie"])).toEqual(["a@x.ie", "c@x.ie"]);
  });

  it("sends one message to every To, Cc and Bcc address", async () => {
    const f = fixture();
    await sendEmailWithProvider(f.env, "alice", {
      purpose: "draft",
      toAddress: "one@example.test, Two <two@example.test>",
      ccAddresses: ["cc@example.test", "one@example.test"],
      bccAddresses: ["hidden@example.test"],
      subject: "Hello",
      textBody: "Hi",
      approvedByUserId: "alice",
    });
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.send.mock.calls[0][0]).toMatchObject({
      to: ["one@example.test", "two@example.test"],
      cc: ["cc@example.test"],
      bcc: ["hidden@example.test"],
    });
  });

  it("keeps a single recipient as a plain address with no Cc or Bcc", async () => {
    const f = fixture();
    await sendEmailWithProvider(f.env, "alice", {
      purpose: "draft", toAddress: "one@example.test", subject: "Hello", textBody: "Hi", approvedByUserId: "alice",
    });
    const sent = f.send.mock.calls[0][0];
    expect(sent.to).toBe("one@example.test");
    expect(sent).not.toHaveProperty("cc");
    expect(sent).not.toHaveProperty("bcc");
  });

  it("names invalid addresses and caps the recipient count", async () => {
    const f = fixture();
    await expect(sendEmailWithProvider(f.env, "alice", {
      purpose: "draft", toAddress: "one@example.test", ccAddresses: ["not-an-email"], subject: "Hi", textBody: "Hi", approvedByUserId: "alice",
    })).rejects.toThrow("not-an-email");
    const many = Array.from({ length: 21 }, (_value, index) => `p${index}@example.test`).join(", ");
    await expect(sendEmailWithProvider(f.env, "alice", {
      purpose: "draft", toAddress: many, subject: "Hi", textBody: "Hi", approvedByUserId: "alice",
    })).rejects.toThrow("at most 20");
    expect(f.send).not.toHaveBeenCalled();
  });
});
