import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EmailProviderDeliveryUnknownError,
  sendEmailProviderTest,
  sendEmailWithProvider,
} from "./email-providers";
import {
  MANAGED_EMAIL_INBOUND_AUDIENCE,
  MANAGED_EMAIL_INBOUND_PATH,
  MANAGED_EMAIL_INBOUND_TOKEN_TYPE,
  receiveManagedEmailInbound,
} from "./managed-email";
import type { Env } from "./types";

const MANAGED_INSTALL_ID = "mi-managed-test";
const CORE_INSTALL_ID = "core_11111111-1111-4111-8111-111111111111";
const DELIVERY_ID = "delivery-11111111-1111-4111-8111-111111111111";
const RECIPIENT = "owner@me3.app";
const ISSUER = "https://api.me3.test";

let signingKey: CryptoKey;
let publicJwk: JsonWebKey & { kid?: string; alg?: string; use?: string };

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  signingKey = pair.privateKey;
  publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as typeof publicJwk;
  publicJwk.kid = "managed-email-test-key";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";
});

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("managed email inbound contract", () => {
  it("accepts signed raw MIME durably and returns a stable duplicate", async () => {
    const db = new ManagedEmailTestDb();
    const eventFetch = vi.fn(async () => new Response(null, { status: 204 }));
    const env = {
      ...managedEnv(db),
      ME3_USER_AGENT: {
        idFromName: vi.fn(() => ({ owner: "owner" })),
        get: vi.fn(() => ({ fetch: eventFetch })),
      } as unknown as DurableObjectNamespace,
    };
    stubJwks();
    const raw = rawEmail("Managed hello", "Stored once.");
    const first = await receiveManagedEmailInbound(
      await signedInboundRequest(raw),
      env,
    );
    const firstBody = (await first.json()) as Record<string, unknown>;

    expect(first.status).toBe(201);
    expect(firstBody).toMatchObject({
      status: "accepted",
      deliveryId: DELIVERY_ID,
    });
    expect(db.mailboxMessages).toHaveLength(1);
    expect(db.deliveries.get(DELIVERY_ID)).toMatchObject({
      managed_installation_id: MANAGED_INSTALL_ID,
      core_install_id: CORE_INSTALL_ID,
      recipient: RECIPIENT,
    });
    expect(db.mailboxMessages[0]).toMatchObject({
      provider_id: "managed_gateway",
      from_address: "client@example.com",
      to_address: RECIPIENT,
      subject: "Managed hello",
      text_body: "Stored once.",
    });
    expect(db.mailboxMessages[0]?.raw_headers_json).not.toContain("authorization");
    expect(db.mailboxMessages[0]?.raw_headers_json).not.toContain("bearer");

    const duplicate = await receiveManagedEmailInbound(
      await signedInboundRequest(raw),
      env,
    );
    const duplicateBody = (await duplicate.json()) as Record<string, unknown>;
    expect(duplicate.status).toBe(200);
    expect(duplicateBody).toEqual({
      status: "duplicate",
      deliveryId: DELIVERY_ID,
      messageId: firstBody.messageId,
    });
    expect(db.mailboxMessages).toHaveLength(1);
    expect(eventFetch).toHaveBeenCalledTimes(1);
  });

  it("rejects a request-bound delivery ID reused for different content", async () => {
    const db = new ManagedEmailTestDb();
    stubJwks();
    await receiveManagedEmailInbound(
      await signedInboundRequest(rawEmail("First", "Original.")),
      managedEnv(db),
    );

    const response = await receiveManagedEmailInbound(
      await signedInboundRequest(rawEmail("Second", "Changed.")),
      managedEnv(db),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ status: "conflict" });
    expect(db.mailboxMessages).toHaveLength(1);
  });

  it("requires the exact audience and request claims", async () => {
    const db = new ManagedEmailTestDb();
    stubJwks();
    const response = await receiveManagedEmailInbound(
      await signedInboundRequest(rawEmail("Wrong audience", "No."), {
        aud: "another-service",
      }),
      managedEnv(db),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      code: "token_claim_mismatch",
    });
    expect(db.mailboxMessages).toHaveLength(0);
  });

  it("rejects expired delivery tokens", async () => {
    const db = new ManagedEmailTestDb();
    stubJwks();
    const now = Math.floor(Date.now() / 1000);
    const response = await receiveManagedEmailInbound(
      await signedInboundRequest(rawEmail("Expired", "No."), {
        iat: now - 121,
        exp: now - 1,
      }),
      managedEnv(db),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_token" });
    expect(db.mailboxMessages).toHaveLength(0);
  });

  it("returns retryable 503 when ME3 Cloud signing keys are unavailable", async () => {
    const db = new ManagedEmailTestDb();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    const response = await receiveManagedEmailInbound(
      await signedInboundRequest(rawEmail("Retry", "Later.")),
      managedEnv(db),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "authentication_unavailable",
    });
    expect(db.mailboxMessages).toHaveLength(0);
  });

  it("returns retryable 503 for unexpected inbound runtime failures", async () => {
    const db = new ManagedEmailTestDb();
    stubJwks();
    const request = await signedInboundRequest(
      rawEmail("Persistence failure", "Retry me."),
    );
    vi.spyOn(crypto.subtle, "digest").mockImplementationOnce(async () => {
      throw new Error("Simulated runtime failure");
    });
    const response = await receiveManagedEmailInbound(
      request,
      managedEnv(db),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Managed email delivery is temporarily unavailable",
      code: "internal_unavailable",
    });
    expect(db.mailboxMessages).toHaveLength(0);
  });

  it("rejects oversized bearer tokens before JWT decoding", async () => {
    const db = new ManagedEmailTestDb();
    const request = await signedInboundRequest(rawEmail("Oversized token", "No."));
    request.headers.set("Authorization", `Bearer ${"a".repeat(16 * 1024 + 1)}`);
    const response = await receiveManagedEmailInbound(request, managedEnv(db));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "invalid_token" });
    expect(db.mailboxMessages).toHaveLength(0);
  });

  it("returns 413 for oversized authenticated mail and leaves the owner a stub", async () => {
    const db = new ManagedEmailTestDb();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubJwks();
    // No R2 bucket: the inline 1 MB limit applies.
    const raw = rawEmail("Too big inline", "x".repeat(1024 * 1024));
    const request = await signedInboundRequest(raw);
    request.headers.set("Content-Length", String(new TextEncoder().encode(raw).byteLength));
    const response = await receiveManagedEmailInbound(request, managedEnv(db));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: "too_large" });
    expect(db.mailboxMessages).toHaveLength(1);
    expect(db.mailboxMessages[0]).toMatchObject({
      status: "dropped",
      provider_id: "managed_gateway",
      provider_message_id: DELIVERY_ID,
      to_address: RECIPIENT,
      raw_message: null,
    });
    expect(db.mailboxMessages[0].text_body).toContain("returned to the sender");
    expect(db.deliveries.size).toBe(0);
  });

  it("does not record a stub for an oversized delivery that fails authentication", async () => {
    const db = new ManagedEmailTestDb();
    stubJwks();
    const request = await signedInboundRequest(
      rawEmail("Forged", "x".repeat(1024 * 1024)),
      { aud: "wrong-audience" },
    );
    const response = await receiveManagedEmailInbound(request, managedEnv(db));

    expect(response.status).toBe(401);
    expect(db.mailboxMessages).toHaveLength(0);
  });

  it("accepts multi-megabyte mail when R2 holds the raw MIME", async () => {
    const db = new ManagedEmailTestDb();
    const objects = new Map<string, Uint8Array>();
    stubJwks();
    const raw = rawEmail("Signed contract", "y".repeat(3 * 1024 * 1024));
    const response = await receiveManagedEmailInbound(await signedInboundRequest(raw), {
      ...managedEnv(db),
      SITE_ASSETS: {
        async put(key: string, content: Uint8Array) { objects.set(key, content); },
        async delete() {},
      } as unknown as R2Bucket,
    });

    expect(response.status).toBe(201);
    expect(db.mailboxMessages).toHaveLength(1);
    expect(db.mailboxMessages[0]).toMatchObject({ subject: "Signed contract", raw_message: null });
    const metadata = JSON.parse(db.mailboxMessages[0].metadata_json);
    expect(objects.get(metadata.rawStorageKey)?.byteLength).toBe(new TextEncoder().encode(raw).byteLength);
    expect(new TextEncoder().encode(db.mailboxMessages[0].text_body).byteLength).toBeLessThanOrEqual(256 * 1024);
  });

  it("does not expose the internal route on self-hosted installations", async () => {
    const db = new ManagedEmailTestDb();
    const response = await receiveManagedEmailInbound(
      new Request(`https://core.example${MANAGED_EMAIL_INBOUND_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "message/rfc822" },
        body: rawEmail("Self hosted", "No shared gateway."),
      }),
      { ...managedEnv(db), ME3_DEPLOYMENT_MODE: "self_hosted" },
    );

    expect(response.status).toBe(404);
    expect(db.mailboxMessages).toHaveLength(0);
  });
});

describe("managed email outbound provider", () => {
  it("uses managed capability without a provider row and overrides draft From", async () => {
    const db = new ManagedEmailTestDb("my_name");
    const fetchMock = vi.fn(async () =>
      Response.json(
        { status: "accepted", providerMessageId: "cf-managed-1" },
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendEmailWithProvider(managedEnv(db), "owner", {
      purpose: "reply",
      mailboxId: "mailbox-1",
      mailboxMessageId: "draft-1",
      fromAddress: "attacker@example.com",
      toAddress: "client@example.com",
      subject: "Approved reply",
      textBody: "The approved body.",
      attachments: [
        {
          filename: "details.txt",
          mimeType: "text/plain",
          content: new TextEncoder().encode("attachment"),
        },
      ],
      messageIdHeader: "<reply@me3.app>",
      inReplyTo: "<source@example.com>",
      referencesHeader: "<source@example.com>",
      approvedByUserId: "owner",
    });

    expect(result).toMatchObject({
      providerId: "managed_gateway",
      providerMessageId: "cf-managed-1",
      providerStatus: "accepted",
    });
    expect(db.providerRowsRead).toBe(true);
    expect(db.providerRows).toHaveLength(0);
    expect(db.sendAudits[0]).toMatchObject({
      provider_id: "managed_gateway",
      from_address: "my_name@me3.app",
      to_address: "client@example.com",
      status: "sent",
    });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe(
      `https://mail.me3.app/v1/installs/${encodeURIComponent(CORE_INSTALL_ID)}/email/send`,
    );
    const headers = new Headers(init.headers);
    expect(init.redirect).toBe("manual");
    expect(headers.get("X-ME3-Core-Install-ID")).toBe(CORE_INSTALL_ID);
    expect(headers.get("X-ME3-Core-Update-Token")).toBe("core-update-token");
    expect(headers.get("Idempotency-Key")).toBe(result.auditId);
    const body = JSON.parse(String(init.body)) as Record<string, any>;
    expect(body).toMatchObject({
      from: { address: "my_name@me3.app", name: "Tester" },
      to: "client@example.com",
      subject: "Approved reply",
      text: "The approved body.",
      purpose: "reply",
      approval: {
        auditId: result.auditId,
        ownerApproved: true,
        approvedByMe3OwnerId: "cloud-owner-id",
      },
      threading: {
        messageId: "<reply@me3.app>",
        inReplyTo: "<source@example.com>",
        references: "<source@example.com>",
      },
    });
    expect(body.from.address).not.toBe("attacker@example.com");
    expect(body.attachments).toEqual([
      {
        filename: "details.txt",
        contentType: "text/plain",
        contentBase64: "YXR0YWNobWVudA==",
      },
    ]);
  });

  it("rejects insecure gateway origins before exposing the Core update token", async () => {
    const db = new ManagedEmailTestDb();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const env = {
      ...managedEnv(db),
      ENVIRONMENT: "production",
      ME3_MANAGED_EMAIL_GATEWAY_ORIGIN: "http://mail.me3.app",
    };

    await expect(
      sendEmailWithProvider(env, "owner", {
        purpose: "reply",
        toAddress: "client@example.com",
        subject: "No token leak",
        textBody: "Blocked.",
        approvedByUserId: "owner",
      }),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects gateway redirects without following signed message content", async () => {
    const db = new ManagedEmailTestDb();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 302,
          headers: { Location: "https://redirect.example/send" },
        }),
      ),
    );

    await expect(
      sendEmailWithProvider(managedEnv(db), "owner", {
        purpose: "reply",
        mailboxId: "mailbox-1",
        mailboxMessageId: "draft-redirect",
        toAddress: "client@example.com",
        subject: "Do not redirect",
        textBody: "Keep this message on the configured origin.",
        approvedByUserId: "owner",
      }),
    ).rejects.toMatchObject({ status: 502 });

    expect(db.sendAudits).toHaveLength(1);
    expect(db.sendAudits[0]).toMatchObject({
      provider_id: "managed_gateway",
      provider_status: "gateway_redirect",
      status: "failed",
    });
  });

  it("reuses the durable pending audit id after a lost gateway response", async () => {
    const db = new ManagedEmailTestDb();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Gateway response was lost"))
      .mockResolvedValueOnce(
        Response.json(
          { status: "duplicate", providerMessageId: "cf-original-send" },
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const input = {
      purpose: "reply" as const,
      mailboxId: "mailbox-1",
      mailboxMessageId: "draft-lost-response",
      toAddress: "client@example.com",
      subject: "Stable retry",
      textBody: "Send this only once.",
      approvedByUserId: "owner",
    };

    await expect(
      sendEmailWithProvider(managedEnv(db), "owner", input),
    ).rejects.toBeInstanceOf(EmailProviderDeliveryUnknownError);
    expect(db.sendAudits).toHaveLength(1);
    expect(db.sendAudits[0]?.status).toBe("pending");
    const pendingAuditId = String(db.sendAudits[0]?.id);

    const retried = await sendEmailWithProvider(managedEnv(db), "owner", input);
    expect(retried.auditId).toBe(pendingAuditId);
    expect(retried.providerStatus).toBe("duplicate");
    expect(db.sendAudits).toHaveLength(1);
    expect(db.sendAudits[0]).toMatchObject({
      id: pendingAuditId,
      status: "sent",
      provider_message_id: "cf-original-send",
    });
    const firstHeaders = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    const retryHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(firstHeaders.get("Idempotency-Key")).toBe(pendingAuditId);
    expect(retryHeaders.get("Idempotency-Key")).toBe(pendingAuditId);
  });

  it.each(["delivery_unknown", "delivery_processing"])(
    "keeps a managed audit pending when the gateway reports %s",
    async (code) => {
      const db = new ManagedEmailTestDb();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json(
            { code, error: "Delivery state is not yet known" },
            { status: 409 },
          ),
        ),
      );

      await expect(
        sendEmailWithProvider(managedEnv(db), "owner", {
          purpose: "reply",
          mailboxId: "mailbox-1",
          mailboxMessageId: `draft-${code}`,
          toAddress: "client@example.com",
          subject: "Ambiguous delivery",
          textBody: "Do not mark this failed.",
          approvedByUserId: "owner",
        }),
      ).rejects.toBeInstanceOf(EmailProviderDeliveryUnknownError);

      expect(db.sendAudits).toHaveLength(1);
      expect(db.sendAudits[0]).toMatchObject({
        provider_id: "managed_gateway",
        status: "pending",
      });
    },
  );

  it("allows system workflow sends and keeps manual sends owner-approved", async () => {
    const db = new ManagedEmailTestDb();
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        { status: "accepted", providerMessageId: "cf-workflow-message" },
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendEmailWithProvider(managedEnv(db), "owner", {
        purpose: "workflow",
        operationId: "workflow-test-1",
        replyToAddress: "private-owner@example.com",
        toAddress: "client@example.com",
        subject: "Automated send",
        textBody: "System workflow send.",
      }),
    ).resolves.toMatchObject({
      providerId: "managed_gateway",
      providerMessageId: "cf-workflow-message",
    });
    const workflowBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(workflowBody).toMatchObject({
      from: { address: "owner@me3.app" },
      replyTo: "owner@me3.app",
    });
    await expect(
      sendEmailWithProvider(managedEnv(db), "owner", {
        purpose: "reply",
        toAddress: "client@example.com",
        subject: "Unapproved send",
        textBody: "Must not send.",
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.sendAudits).toHaveLength(1);
  });

  it("translates an owner-approved provider test to the Cloud owner identity", async () => {
    const db = new ManagedEmailTestDb();
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json(
        { status: "accepted", providerMessageId: "cf-test-message" },
        { status: 201 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendEmailProviderTest(
        managedEnv(db),
        "owner",
        "owner@example.com",
        { providerId: "managed_gateway", operationId: "provider-test-1" },
      ),
    ).resolves.toMatchObject({ ok: true, providerId: "managed_gateway" });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.approval).toEqual({
      auditId: db.sendAudits[0]?.id,
      ownerApproved: true,
      approvedByMe3OwnerId: "cloud-owner-id",
    });
  });
});

describe("managed operations and active senders", () => {
  const operation = {
    operationId: "booking:one:guest", purpose: "workflow" as const,
    toAddress: "guest@example.com", subject: "Confirmed", textBody: "Your booking is confirmed.",
  };
  it.each(["network", "delivery_unknown", "delivery_processing"])("reconciles %s with the same operation and never resends a completed operation", async (failure) => {
    const db = new ManagedEmailTestDb();
    const fetchMock = vi.fn();
    if (failure === "network") fetchMock.mockRejectedValueOnce(new Error("response lost"));
    else fetchMock.mockResolvedValueOnce(Response.json({ code: failure, error: "Still pending" }, { status: 409 }));
    fetchMock.mockResolvedValueOnce(Response.json({ status: "duplicate", providerMessageId: "message-one" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendEmailWithProvider(managedEnv(db), "owner", operation)).rejects.toBeInstanceOf(EmailProviderDeliveryUnknownError);
    expect(db.sendAudits[0].status).toBe("pending");
    const resolved = await sendEmailWithProvider(managedEnv(db), "owner", operation);
    expect(await sendEmailWithProvider(managedEnv(db), "owner", operation)).toEqual(resolved);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const requests = fetchMock.mock.calls.map((call) => call[1]);
    expect(requests[0].headers["Idempotency-Key"]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(requests[0].headers["Idempotency-Key"]).toBe(requests[1].headers["Idempotency-Key"]);
    expect(requests[0].body).toBe(requests[1].body);
    expect(db.sendAudits).toHaveLength(1);
    expect(db.sendAudits[0].status).toBe("sent");
  });
  it("reconciles acceptance when the local completion write fails", async () => {
    const db = new ManagedEmailTestDb(); db.failNextAuditCompletion = true;
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ status: "duplicate", providerMessageId: "accepted-one" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendEmailWithProvider(managedEnv(db), "owner", operation)).rejects.toBeInstanceOf(EmailProviderDeliveryUnknownError);
    expect(db.sendAudits[0].status).toBe("pending");
    await expect(sendEmailWithProvider(managedEnv(db), "owner", operation)).resolves.toMatchObject({ providerMessageId: "accepted-one" });
    expect(new Set(fetchMock.mock.calls.map((call) => call[1].headers["Idempotency-Key"])).size).toBe(1);
  });
  it("keeps definitive rejections terminal so the client can explicitly start a new test", async () => {
    const db = new ManagedEmailTestDb();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: "Sender rejected" }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(sendEmailWithProvider(managedEnv(db), "owner", operation)).rejects.toMatchObject({ status: 422 });
    await expect(sendEmailWithProvider(managedEnv(db), "owner", operation)).rejects.toMatchObject({ status: 422 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.sendAudits[0].status).toBe("failed");
  });
  it("does not turn a pending provider test into a failed operation", async () => {
    const db = new ManagedEmailTestDb();
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(Response.json({ status: "duplicate", providerMessageId: "test-one" }));
    vi.stubGlobal("fetch", fetchMock);
    const input = { providerId: "managed_gateway", operationId: "test-stable" };
    await expect(sendEmailProviderTest(managedEnv(db), "owner", "owner@example.com", input)).rejects.toBeInstanceOf(EmailProviderDeliveryUnknownError);
    expect(db.sendAudits[0].status).toBe("pending");
    await sendEmailProviderTest(managedEnv(db), "owner", "owner@example.com", input);
    expect(fetchMock.mock.calls[0][1].headers["Idempotency-Key"]).toBe(fetchMock.mock.calls[1][1].headers["Idempotency-Key"]);
  });
  it("rejects changed content under the same operation", async () => {
    const db = new ManagedEmailTestDb();
    const fetchMock = vi.fn().mockRejectedValue(new Error("response lost")); vi.stubGlobal("fetch", fetchMock);
    await expect(sendEmailWithProvider(managedEnv(db), "owner", operation)).rejects.toBeInstanceOf(EmailProviderDeliveryUnknownError);
    await expect(sendEmailWithProvider(managedEnv(db), "owner", { ...operation, textBody: "Changed" })).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("uses one gateway key for concurrent retries", async () => {
    const db = new ManagedEmailTestDb();
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ status: "accepted", providerMessageId: "one" }));
    vi.stubGlobal("fetch", fetchMock);
    await Promise.allSettled([sendEmailWithProvider(managedEnv(db), "owner", operation), sendEmailWithProvider(managedEnv(db), "owner", operation)]);
    expect(db.sendAudits).toHaveLength(1);
    expect(new Set(fetchMock.mock.calls.map((call) => call[1].headers["Idempotency-Key"])).size).toBe(1);
    await expect(sendEmailWithProvider(managedEnv(db), "owner", operation)).resolves.toMatchObject({ providerMessageId: "one" });
  });
  it.each(["paused", "pending_setup"])("rejects %s managed senders before gateway dispatch", async (status) => {
    const db = new ManagedEmailTestDb(); db.mailboxStatus = status;
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(sendEmailWithProvider(managedEnv(db), "owner", operation)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled(); expect(db.sendAudits).toHaveLength(0);
  });
  it("gates non-mailbox workflows without durable operation identity", async () => {
    const db = new ManagedEmailTestDb(); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(sendEmailWithProvider(managedEnv(db), "owner", { ...operation, operationId: undefined })).rejects.toMatchObject({ status: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function managedEnv(db: ManagedEmailTestDb): Env {
  return {
    DB: db as unknown as D1Database,
    ENVIRONMENT: "production",
    ME3_DEPLOYMENT_MODE: "managed",
    ME3_CLOUD_API_ORIGIN: ISSUER,
    ME3_MANAGED_INSTALLATION_ID: MANAGED_INSTALL_ID,
    ME3_MANAGED_EMAIL_GATEWAY_ORIGIN: "https://mail.me3.app",
  } as Env;
}

async function signedInboundRequest(
  raw: string,
  claimOverrides: Record<string, unknown> = {},
): Promise<Request> {
  const bytes = new TextEncoder().encode(raw);
  const bodySha256 = await sha256Hex(bytes);
  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt({
    iss: ISSUER,
    aud: MANAGED_EMAIL_INBOUND_AUDIENCE,
    typ: MANAGED_EMAIL_INBOUND_TOKEN_TYPE,
    sub: MANAGED_INSTALL_ID,
    managed_installation_id: MANAGED_INSTALL_ID,
    core_install_id: CORE_INSTALL_ID,
    jti: DELIVERY_ID,
    delivery_id: DELIVERY_ID,
    body_sha256: bodySha256,
    recipient: RECIPIENT,
    iat: now,
    exp: now + 120,
    ...claimOverrides,
  });
  return new Request(`https://core.example${MANAGED_EMAIL_INBOUND_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "message/rfc822",
      "X-ME3-Install-ID": MANAGED_INSTALL_ID,
      "X-ME3-Delivery-ID": DELIVERY_ID,
      "X-ME3-Recipient": RECIPIENT,
      "X-ME3-Body-SHA256": bodySha256,
    },
    body: bytes,
  });
}

async function signJwt(payload: Record<string, unknown>): Promise<string> {
  const header = { alg: "RS256", typ: "JWT", kid: publicJwk.kid };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signingKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`;
}

function stubJwks() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === `${ISSUER}/.well-known/jwks.json`) {
        return Response.json({ keys: [publicJwk] });
      }
      return Response.json({}, { status: 404 });
    }),
  );
}

function rawEmail(subject: string, body: string): string {
  return [
    "From: Client <client@example.com>",
    `To: ${RECIPIENT}`,
    `Subject: ${subject}`,
    "Message-ID: <managed-inbound@example.com>",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\r\n");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = bytes.slice();
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function base64UrlJson(value: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type DeliveryRecord = {
  managed_installation_id: string;
  core_install_id: string;
  mailbox_id: string;
  mailbox_message_id: string;
  recipient: string;
  body_sha256: string;
};

class ManagedEmailTestDb {
  readonly secrets = new Map<string, string>([
    ["ME3_CORE_INSTALL_ID", CORE_INSTALL_ID],
    ["ME3_CLOUD_CORE_TOKEN", "core-update-token"],
    ["ME3_CLOUD_OWNER_ID", "cloud-owner-id"],
  ]);
  readonly deliveries = new Map<string, DeliveryRecord>();
  readonly mailboxMessages: Array<Record<string, any>> = [];
  readonly providerRows: Array<Record<string, unknown>> = [];
  readonly sendAudits: Array<Record<string, any>> = [];
  providerRowsRead = false;
  mailboxStatus = "active";
  failNextAuditCompletion = false;

  constructor(
    readonly mailboxAlias = "owner",
    readonly ownerName = "Tester",
    readonly ownerUsername = "tester",
  ) {}

  prepare(sql: string) {
    return new ManagedEmailTestStatement(this, sql);
  }

  async batch(statements: D1PreparedStatement[]) {
    const results = [];
    for (const statement of statements) {
      results.push(await (statement as unknown as ManagedEmailTestStatement).run());
    }
    return results;
  }
}

class ManagedEmailTestStatement {
  private values: unknown[] = [];

  constructor(
    private readonly db: ManagedEmailTestDb,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    if (this.sql.includes("FROM owner_profile")) {
      return {
        name: this.db.ownerName,
        username: this.db.ownerUsername,
      } as T;
    }
    if (this.sql.includes("FROM install_secrets")) {
      const value = this.db.secrets.get(String(this.values[0]));
      return (value ? { value } : null) as T | null;
    }
    if (this.sql.includes("FROM managed_email_inbound_deliveries")) {
      return (this.db.deliveries.get(String(this.values[0])) || null) as T | null;
    }
    if (this.sql.includes("FROM email_send_audit") && this.sql.includes("WHERE id = ?")) {
      return (this.db.sendAudits.find((audit) => audit.id === this.values[0] && audit.user_id === this.values[1]) || null) as T | null;
    }
    if (this.sql.includes("FROM email_send_audit")) {
      const row = this.db.sendAudits.find(
        (audit) =>
          audit.user_id === this.values[0] &&
          audit.mailbox_message_id === this.values[1] &&
          audit.provider_id === this.values[2] &&
          audit.status === "pending",
      );
      return (row
        ? { id: row.id, metadata_json: row.metadata_json }
        : null) as T | null;
    }
    if (this.sql.includes("FROM mailbox_aliases")) {
      if (this.sql.includes("SELECT alias_local_part")) {
        return (this.sql.includes("status = 'active'") && this.db.mailboxStatus !== "active" ? null : { alias_local_part: this.db.mailboxAlias }) as T | null;
      }
      return {
        id: "mailbox-1",
        user_id: "owner",
        alias_local_part: this.db.mailboxAlias,
        forwarding_email: "",
        forwarding_status: "pending",
        forwarding_enabled: 0,
        forwarding_mode: "me3_only",
        status: "active",
        approval_policy: "all",
        daily_inbound_limit: 200,
        daily_outbound_limit: 50,
        activated_at: "2026-07-18T00:00:00.000Z",
        cf_destination_id: null,
        cf_destination_verified_at: null,
        cf_rule_id: null,
        cf_last_synced_at: null,
        cf_last_error: null,
        created_at: "2026-07-18T00:00:00.000Z",
        updated_at: "2026-07-18T00:00:00.000Z",
      } as T;
    }
    return null as T | null;
  }

  async all<T>() {
    if (this.sql.includes("FROM email_provider_settings")) {
      this.db.providerRowsRead = true;
      return { results: this.db.providerRows as T[] };
    }
    return { results: [] as T[] };
  }

  async run() {
    if (this.sql.includes("INSERT INTO mailbox_messages")) {
      const values = this.values;
      this.db.mailboxMessages.push({
        id: values[0],
        mailbox_id: values[1],
        status: values[2],
        thread_key: values[3],
        provider_id: values[4],
        provider_message_id: values[5],
        from_address: values[6],
        to_address: values[7],
        subject: values[8],
        text_body: values[9],
        html_body: values[10],
        raw_headers_json: values[11],
        raw_message: values[12],
        metadata_json: values[13],
        created_by: values[14],
      });
    } else if (this.sql.includes("INSERT INTO managed_email_inbound_deliveries")) {
      this.db.deliveries.set(String(this.values[0]), {
        managed_installation_id: String(this.values[1]),
        core_install_id: String(this.values[2]),
        mailbox_id: String(this.values[3]),
        mailbox_message_id: String(this.values[4]),
        recipient: String(this.values[5]),
        body_sha256: String(this.values[6]),
      });
    } else if (this.sql.includes("INSERT INTO email_send_audit")) {
      if (this.db.sendAudits.some((audit) => audit.id === this.values[0])) {
        if (this.sql.includes("ON CONFLICT(id) DO NOTHING")) return { success: true, meta: { changes: 0 } };
        throw new Error("UNIQUE constraint failed");
      }
      this.db.sendAudits.push({
        id: this.values[0],
        user_id: this.values[1],
        mailbox_id: this.values[2],
        mailbox_message_id: this.values[3],
        provider_id: this.values[4],
        provider_message_id: this.values[5],
        provider_status: this.values[6],
        status: this.values[7],
        purpose: this.values[8],
        from_address: this.values[9],
        to_address: this.values[10],
        metadata_json: this.values[16],
        approved_by_user_id: this.values[19],
        requested_at: this.values[20],
        sent_at: this.values[21],
      });
    } else if (
      this.sql.includes("UPDATE email_send_audit") &&
      this.sql.includes("provider_message_id = ?")
    ) {
      if (this.db.failNextAuditCompletion) {
        this.db.failNextAuditCompletion = false;
        throw new Error("D1 completion response lost");
      }
      const audit = this.db.sendAudits.find((row) => row.id === this.values[9]);
      if (!audit || audit.status !== "pending") {
        return { success: true, meta: { changes: 0 } };
      }
      audit.provider_message_id = this.values[0];
      audit.provider_status = this.values[1];
      audit.status = this.values[2];
      audit.metadata_json = this.values[3];
      audit.approved_by_user_id = this.values[5];
      audit.requested_at = this.values[6];
      audit.sent_at = this.values[7];
    } else if (this.sql.includes("UPDATE email_send_audit")) {
      const audit = this.db.sendAudits.find((row) => row.id === this.values[3]);
      if (!audit || audit.status !== "pending") {
        return { success: true, meta: { changes: 0 } };
      }
      audit.requested_at = this.values[0];
      audit.approved_by_user_id = this.values[1];
    }
    return { success: true, meta: { changes: 1 } };
  }
}
