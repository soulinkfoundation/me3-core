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

// An ME3 Cloud managed install: no provider row, sends through the gateway.
function managedFixture() {
  const f = mailboxFixture();
  const now = new Date().toISOString();
  f.raw.prepare("UPDATE mailbox_aliases SET status='active' WHERE user_id='alice'").run();
  for (const [name, value] of [
    ["ME3_CORE_INSTALL_ID", "core_11111111-1111-4111-8111-111111111111"],
    ["ME3_CLOUD_CORE_TOKEN", "core-update-token"],
    ["ME3_CLOUD_OWNER_ID", "cloud-owner-id"],
  ]) {
    f.raw.prepare("INSERT INTO install_secrets(name,value,created_at,updated_at) VALUES(?,?,?,?)").run(name, value, now, now);
  }
  const env = {
    ...f.env,
    ENVIRONMENT: "production",
    ME3_DEPLOYMENT_MODE: "managed",
    ME3_MANAGED_INSTALLATION_ID: "mi-managed-test",
    ME3_MANAGED_EMAIL_GATEWAY_ORIGIN: "https://mail.me3.app",
  } as unknown as Env;
  return { ...f, env };
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

  it("sends 2 To, 1 Cc and 1 Bcc through the ME3 managed gateway", async () => {
    const f = managedFixture();
    const fetchMock = vi.fn(async (_url: URL, _init: RequestInit) =>
      Response.json({ status: "accepted", providerMessageId: "cf-1" }, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await sendEmailWithProvider(f.env, "alice", {
        purpose: "draft",
        toAddress: "one@example.test, two@example.test",
        ccAddresses: ["cc@example.test"],
        bccAddresses: ["hidden@example.test"],
        subject: "Hello",
        textBody: "Hi",
        approvedByUserId: "alice",
        operationId: "multi-recipient-test",
      });
      expect(result).toMatchObject({ providerId: "managed_gateway", providerMessageId: "cf-1" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
      expect(body).toMatchObject({
        to: ["one@example.test", "two@example.test"],
        cc: ["cc@example.test"],
        bcc: ["hidden@example.test"],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("puts a lone To in an array when Cc is present so older gateways refuse rather than drop", async () => {
    const f = managedFixture();
    const fetchMock = vi.fn(async (_url: URL, _init: RequestInit) =>
      Response.json({ status: "accepted", providerMessageId: "cf-2" }, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await sendEmailWithProvider(f.env, "alice", {
        purpose: "draft", toAddress: "one@example.test", ccAddresses: ["cc@example.test"],
        subject: "Hello", textBody: "Hi", approvedByUserId: "alice", operationId: "lone-to-test",
      });
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
      expect(body.to).toEqual(["one@example.test"]);
      expect(body.cc).toEqual(["cc@example.test"]);
      expect(body).not.toHaveProperty("bcc");
    } finally {
      vi.unstubAllGlobals();
    }
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
