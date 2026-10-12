import { afterEach, describe, expect, it, vi } from "vitest";
import { mailboxFixture } from "./test-utils/agent-mailbox-fixture";
import { createAgentMailboxServices } from "./agent-mailbox-services";
import { appendAgentStreamEvent, createD1TurnStore, decideAgentApproval, persistAgentInput, runAgentTurn } from "../../../packages/agent/src";
import { createDomainTools } from "../../../packages/agent/src/tools";
import type { AgentModel, AgentToolContext } from "../../../packages/agent/src/types";
import type { MailboxRecord } from "../../../packages/agent/src/tools/services";
import type { Env } from "./types";
import * as providers from "./email-providers";
import { getAgentMailboxMessageById, serializeAgentMailboxMessage } from "../../../packages/agent/src/services/mailbox-records";

// Migrated SQLite, native draft/send services and durable loop approval are real.
// Model steps, EMAIL and managed gateway fetch are simulated; no email leaves this test.
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const f = mailboxFixture();
  const config = { transport: "binding", fromAddress: "alice@example.test", fromName: "Alice", replyToAddress: "replies@example.test" };
  f.raw.prepare("INSERT INTO email_provider_settings(user_id,provider_id,is_active,config_json,secret_hint) VALUES('alice','cloudflare-email',1,?,'PRIVATE_KEY_HINT')").run(JSON.stringify(config));
  const send = vi.fn(async () => ({ messageId: "simulated-approved-email" }));
  const env = { ...f.env, EMAIL: { send } } as unknown as Env;
  const services = createAgentMailboxServices(env, "alice");
  const change = (values: Record<string, unknown>) => f.raw.prepare("UPDATE email_provider_settings SET config_json=? WHERE user_id='alice'").run(JSON.stringify({ ...config, ...values }));
  return { ...f, env, services, send, config, change };
}
async function draft(f: ReturnType<typeof fixture>) {
  const result = await f.services.createDraft({ to: "client@example.test", subject: "Reviewed subject", body: "Reviewed body" }, "create-sender-draft");
  if ("error" in result) throw new Error(result.error);
  return result.draft;
}
async function read(f: ReturnType<typeof fixture>, id: string) {
  const result = await f.services.read(id);
  if ("error" in result) throw new Error(result.error);
  return result.message;
}
async function approval(f: ReturnType<typeof fixture>, expected: MailboxRecord) {
  f.raw.exec("INSERT INTO assistant_threads(id,owner_id,title) VALUES('sender-thread','alice','Synthetic sender review')");
  const scope = { ownerId: "alice", threadId: "sender-thread", turnId: "sender-turn", requestId: "sender-request" };
  const messageText = "Send the Reviewed subject draft to client@example.test with exactly Reviewed body.";
  await persistAgentInput(f.env.DB, scope, { userId: "alice", ...scope, messageText });
  f.raw.prepare("INSERT INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES(?,'alice','sender-thread','user',?,?)").run(scope.turnId + ":user", messageText, JSON.stringify({ requestId: scope.requestId, runtime: "agent" }));
  const call = { name: "core_mailbox_send", arguments: { draftId: expected.id } };
  let step = 0;
  const model: AgentModel = { id: "simulated-model", async step() {
    const next = [{ name: "core_mailbox_read", arguments: { messageId: expected.id } }, call][step++];
    return next ? { text: "", toolCalls: [{ id: `call-${step}`, ...next }] } : { text: "Finished.", toolCalls: [] };
  } };
  const context: Omit<AgentToolContext, "toolCallId" | "idempotencyKey" | "signal" | "messages"> = {
    ...scope, db: f.env.DB, ownerTimezone: "Europe/Dublin", enabledPluginIds: new Set(), messageText, services: { mailbox: f.services },
    intentOwnerInputs: [{ turnId: scope.turnId, requestId: scope.requestId, messageText }],
    verifyTargetIntent: async () => ({ decision: "allow", selectedCandidateId: expected.id, authorizedCall: call, inference: { modelId: "simulated-verifier", usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, estimatedCostUsd: 0 } } }),
  };
  const run = () => runAgentTurn({ model, tools: createDomainTools(), messages: [{ role: "user", content: messageText }], context, store: createD1TurnStore(f.env.DB, scope), onEvent: event => appendAgentStreamEvent(f.env.DB, scope.ownerId, scope.turnId, event.event, event.data).then(() => {}) });
  const paused = await run();
  expect(paused.status, JSON.stringify(f.raw.prepare("SELECT tool_name,result_json FROM me3_agent_tool_receipts").all())).toBe("needs_approval");
  expect(f.send).not.toHaveBeenCalled();
  const card = JSON.parse(String(f.raw.prepare("SELECT card_json FROM me3_agent_approvals WHERE id=?").get(paused.approvalId!)!.card_json));
  expect(await decideAgentApproval(f.env.DB, "alice", paused.approvalId!, "approved")).toBe(true);
  return { run, paused, card };
}

describe("new-agent immutable effective email sender", () => {
  it("reviews the actual provider From and freezes it through durable approval, native delivery and replay", async () => {
    const f = fixture(), expected = await draft(f);
    expect(f.raw.prepare("SELECT from_address FROM mailbox_messages WHERE id=?").get(expected.id)).toMatchObject({ from_address: "alice@me3.local" });
    const approved = await approval(f, expected);
    expect(approved.card.target).toMatchObject({ fromAddress: "alice@example.test", storedFromAddress: "alice@me3.local", deliveryIdentity: { providerId: "cloudflare-email", fromAddress: "alice@example.test", fromName: "Alice", replyToAddress: "replies@example.test", routeRevision: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(JSON.stringify(approved.card)).not.toContain("PRIVATE_KEY_HINT");
    expect(await approved.run()).toMatchObject({ status: "complete" });
    expect(f.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ from: { email: "alice@example.test", name: "Alice" }, replyTo: "replies@example.test", to: "client@example.test", subject: "Reviewed subject", text: "Reviewed body" }));
    expect(await read(f, expected.id)).toMatchObject({ status: "sent", fromAddress: "alice@example.test" });
    expect(f.raw.prepare("SELECT DISTINCT from_address FROM email_send_audit WHERE mailbox_message_id=?").all(expected.id)).toEqual([{ from_address: "alice@example.test" }]);
    f.change({ fromAddress: "changed@example.test" });
    expect(await approved.run()).toMatchObject({ status: "complete" });
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it.each(["fromAddress", "fromName", "replyToAddress", "transport", "provider"])("rejects changed %s after approval before any provider admission", async field => {
    const f = fixture(), approved = await approval(f, await draft(f));
    if (field === "provider") f.raw.exec("UPDATE email_provider_settings SET is_active=0 WHERE user_id='alice'; INSERT INTO email_provider_settings(user_id,provider_id,is_active,encrypted_secret,config_json) VALUES('alice','postmark',1,'not-decrypted','{\"fromAddress\":\"alice@example.test\"}')");
    else f.change({ [field]: field === "transport" ? "rest" : field === "fromName" ? "Changed name" : "changed@example.test" });
    await approved.run();
    expect(f.send).not.toHaveBeenCalled();
    expect(f.raw.prepare("SELECT COUNT(*) AS n FROM email_send_audit WHERE mailbox_message_id=?").get(approved.card.target.id)).toMatchObject({ n: 0 });
  });

  it("checks the same resolved route again after attachment IO and before the provider adapter", async () => {
    const f = fixture(), expected = await draft(f);
    f.raw.prepare("UPDATE mailbox_messages SET metadata_json=? WHERE id=?").run(JSON.stringify({ attachments: [{ storageKey: "mailbox/alice-mailbox/attachment", filename: "reviewed.pdf" }] }), expected.id);
    const reviewed = await read(f, expected.id);
    Object.assign(f.env, { SITE_ASSETS: { get: vi.fn(async () => { f.change({ fromAddress: "raced@example.test" }); return { arrayBuffer: async () => new Uint8Array([1]).buffer }; }) } });
    expect(await f.services.sendDraft!(expected.id, "send-with-attachment", reviewed)).toMatchObject({ status: 409 });
    expect(f.send).not.toHaveBeenCalled();
  });

  it("rejects a route changed after resolution before the adapter uses the resolved send object", async () => {
    const f = fixture(), reviewed = await draft(f);
    const prepare = f.env.DB.prepare.bind(f.env.DB);
    let changed = false;
    f.env.DB.prepare = ((sql: string) => {
      const statement = prepare(sql);
      if (!sql.includes("FROM email_provider_settings")) return statement;
      return { ...statement, bind(...values: unknown[]) {
        const bound = statement.bind(...values);
        return { ...bound, async all<T>() {
          const rows = await bound.all<T>();
          if (!changed && f.raw.prepare("SELECT status FROM mailbox_messages WHERE id=?").get(reviewed.id)?.status === "approved") {
            changed = true; f.change({ fromName: "Raced sender name" });
          }
          return rows;
        } };
      } };
    }) as typeof prepare;
    expect(await f.services.sendDraft!(reviewed.id, "resolved-race", reviewed)).toMatchObject({ status: 409 });
    expect(changed).toBe(true); expect(f.send).not.toHaveBeenCalled();
  });

  it("keeps unconfigured draft content readable but refuses approval without an effective sender", async () => {
    const f = fixture(); f.raw.exec("DELETE FROM email_provider_settings");
    const expected = await draft(f);
    expect(await read(f, expected.id)).toMatchObject({ bodyText: "Reviewed body", fromAddress: null, deliveryIdentity: null });
    f.raw.exec("INSERT INTO assistant_threads(id,owner_id,title) VALUES('sender-thread','alice','Synthetic')");
    const scope = { ownerId: "alice", threadId: "sender-thread", turnId: "unconfigured", requestId: "unconfigured-request" }, messageText = "Send the reviewed email.";
    await persistAgentInput(f.env.DB, scope, { userId: "alice", ...scope, messageText });
  f.raw.prepare("INSERT INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES(?,'alice','sender-thread','user',?,?)").run(scope.turnId + ":user", messageText, JSON.stringify({ requestId: scope.requestId, runtime: "agent" }));
    let step = 0;
    const model: AgentModel = { id: "simulated", async step() { const call = [{ name: "core_mailbox_read", arguments: { messageId: expected.id } }, { name: "core_mailbox_send", arguments: { draftId: expected.id } }][step++]; return call ? { text: "", toolCalls: [{ id: String(step), ...call }] } : { text: "Unable to send.", toolCalls: [] }; } };
    await runAgentTurn({ model, tools: createDomainTools(), messages: [{ role: "user", content: messageText }], context: { ...scope, db: f.env.DB, ownerTimezone: "UTC", enabledPluginIds: new Set(), messageText, services: { mailbox: f.services }, intentOwnerInputs: [{ turnId: scope.turnId, requestId: scope.requestId, messageText }], verifyTargetIntent: async () => ({ decision: "allow", selectedCandidateId: expected.id, authorizedCall: { name: "core_mailbox_send", arguments: { draftId: expected.id } }, inference: { modelId: "simulated-verifier", usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, estimatedCostUsd: 0 } } }) }, store: createD1TurnStore(f.env.DB, scope), onEvent: event => appendAgentStreamEvent(f.env.DB, scope.ownerId, scope.turnId, event.event, event.data).then(() => {}) });
    expect(f.raw.prepare("SELECT COUNT(*) AS n FROM me3_agent_approvals").get()).toMatchObject({ n: 0 });
    expect(f.send).not.toHaveBeenCalled();
  });

  it("never presents a configured internal mailbox placeholder as a deliverable sender", async () => {
    const f = fixture(); f.change({ fromAddress: "alice@me3.local" });
    const reviewed = await draft(f);
    expect(await read(f, reviewed.id)).toMatchObject({ fromAddress: null, deliveryIdentity: null, bodyText: "Reviewed body" });
    expect(await f.services.sendDraft!(reviewed.id, "internal-from", reviewed)).toMatchObject({ status: 409 });
    expect(f.send).not.toHaveBeenCalled();
    expect(f.raw.prepare("SELECT COUNT(*) AS n FROM email_send_audit").get()).toMatchObject({ n: 0 });
  });

  it("preserves an explicit external stored sender according to existing delivery precedence", async () => {
    const f = fixture(), expected = await draft(f);
    f.raw.prepare("UPDATE mailbox_messages SET from_address='explicit@example.test' WHERE id=?").run(expected.id);
    const reviewed = await read(f, expected.id);
    expect(reviewed).toMatchObject({ fromAddress: "explicit@example.test", deliveryIdentity: { fromAddress: "explicit@example.test" } });
    expect(await f.services.sendDraft!(expected.id, "explicit-send", reviewed)).toMatchObject({ draft: { status: "sent", fromAddress: "explicit@example.test" } });
    expect(f.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ from: { email: "explicit@example.test", name: "Alice" } }));
  });

  it.each(["stored@example.test", "alice@me3.local"])("uses authoritative stored outbound From %s rather than a display-only MIME From header", async storedFromAddress => {
    const f = fixture(), created = await draft(f);
    const fromAddress = storedFromAddress === "alice@me3.local" ? "alice@example.test" : storedFromAddress;
    f.raw.prepare("UPDATE mailbox_messages SET from_address=?,raw_headers_json=? WHERE id=?").run(storedFromAddress, JSON.stringify({ From: "Display <untrusted-header@example.test>" }), created.id);
    const reviewed = await read(f, created.id);
    expect(reviewed).toMatchObject({ storedFromAddress, fromAddress, deliveryIdentity: { fromAddress } });
    expect(await f.services.sendDraft!(created.id, "stored-from-send", reviewed)).toMatchObject({ draft: { status: "sent", fromAddress } });
    expect(f.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ from: { email: fromAddress, name: "Alice" } }));
  });

  it.each(["pending", "sent"] as const)("reconciles a %s frozen claim without reading current provider configuration or resending", async status => {
    const f = fixture(), expected = await draft(f);
    if (status === "pending") f.send.mockRejectedValueOnce(new Error("simulated uncertain acceptance"));
    await f.services.sendDraft!(expected.id, "frozen-send", expected);
    f.raw.exec("DELETE FROM email_provider_settings");
    const prepare = f.env.DB.prepare.bind(f.env.DB);
    f.env.DB.prepare = ((sql: string) => { if (sql.includes("FROM email_provider_settings")) throw new Error("Historical replay must not inspect current provider settings"); return prepare(sql); }) as typeof prepare;
    const result = await f.services.sendDraft!(expected.id, "frozen-send", expected);
    if (status === "sent") expect(result).toMatchObject({ draft: { status: "sent", fromAddress: "alice@example.test" } });
    else expect(result).toMatchObject({ status: 409, error: expect.stringMatching(/unconfirmed/) });
    expect(f.send).toHaveBeenCalledTimes(1);
  });

  it.each(["pending", "sent"] as const)("preserves a restored legacy raw fingerprint and %s outcome independent of current settings", async status => {
    const f = fixture(), created = await draft(f), row = await getAgentMailboxMessageById(f.env, "alice-mailbox", created.id);
    const message = serializeAgentMailboxMessage(row!), expected = { ...message, toAddress: message.toAddress || "", bodyText: message.body };
    const key = "legacy-sender-key", hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const operationId = "agent-mailbox-" + await hash(JSON.stringify(["alice", key]));
    const fingerprint = await hash(JSON.stringify({ id: expected.id, to: expected.toAddress, subject: expected.subject, body: expected.bodyText, from: expected.fromAddress, htmlBody: expected.htmlBody, sourceId: expected.sourceId, threadKey: expected.threadKey, metadata: expected.metadata, updatedAt: expected.updatedAt }));
    const metadata = JSON.stringify({ ...expected.metadata, agent_send: { operationId, fingerprint, reviewedUpdatedAt: expected.updatedAt } });
    f.raw.prepare("UPDATE mailbox_messages SET status='approved',approved_by_user_id='alice',metadata_json=? WHERE id=?").run(metadata, expected.id);
    f.raw.prepare("INSERT INTO email_send_audit(id,user_id,mailbox_id,mailbox_message_id,provider_id,status,purpose,to_address,metadata_json,provider_message_id,sent_at) VALUES(?,'alice','alice-mailbox',?,'cloudflare-email',?,'draft','client@example.test',?,?,?)")
      .run(operationId, expected.id, status, JSON.stringify({ agent_send_operation_id: operationId, agent_send_fingerprint: fingerprint }), status === "sent" ? "historical-message" : null, status === "sent" ? "2026-10-10T09:00:00Z" : null);
    f.raw.exec("DELETE FROM email_provider_settings");
    const result = await f.services.sendDraft!(expected.id, key, expected);
    expect(result).toMatchObject(status === "sent" ? { draft: { status: "sent" } } : { error: expect.stringContaining("unconfirmed") });
    expect(f.send).not.toHaveBeenCalled();
    expect(JSON.parse(String(f.raw.prepare("SELECT metadata_json FROM mailbox_messages WHERE id=?").get(expected.id)!.metadata_json)).agent_send.fingerprint).toBe(fingerprint);
  });

  it("resolves managed sender precedence read-only and excludes secret/config fields from the public proof", async () => {
    const f = fixture(); f.raw.exec("DELETE FROM email_provider_settings; UPDATE mailbox_aliases SET status='active' WHERE user_id='alice'");
    const env = { ...f.env, ME3_DEPLOYMENT_MODE: "managed", ME3_MANAGED_INSTALLATION_ID: "mi-synthetic-sender", ME3_MANAGED_EMAIL_GATEWAY_ORIGIN: "https://api.me3.test" } as Env;
    const helper = (providers as unknown as { getEmailDeliveryIdentity?: (env: Env, ownerId: string, input: { fromAddress: string }) => Promise<Record<string, unknown>> }).getEmailDeliveryIdentity;
    expect(typeof helper).toBe("function");
    const identity = await helper!(env, "alice", { fromAddress: "explicit@example.test" });
    expect(identity).toMatchObject({ providerId: "managed_gateway", fromAddress: "alice@me3.app", fromName: "alice", replyToAddress: "alice@me3.app" });
    expect(Object.keys(identity).sort()).toEqual(["fromAddress", "fromName", "providerId", "replyToAddress", "routeRevision"]);
    expect(f.raw.prepare("SELECT COUNT(*) AS n FROM install_secrets").get()).toMatchObject({ n: 0 });
  });

  it("settles only its new managed pending audit when the sender changes before any gateway admission", async () => {
    const f = fixture(); f.raw.exec("DELETE FROM email_provider_settings; UPDATE mailbox_aliases SET status='active' WHERE user_id='alice'");
    Object.assign(f.env, { ME3_DEPLOYMENT_MODE: "managed", ME3_MANAGED_INSTALLATION_ID: "mi-synthetic-sender", ME3_MANAGED_EMAIL_GATEWAY_ORIGIN: "https://api.me3.test" });
    const reviewed = await draft(f), prepare = f.env.DB.prepare.bind(f.env.DB);
    let raced = false;
    f.env.DB.prepare = ((sql: string) => {
      const statement = prepare(sql);
      if (!sql.includes("INTO email_send_audit")) return statement;
      return { ...statement, bind(...values: unknown[]) {
        const bound = statement.bind(...values);
        return { ...bound, async run() {
          const result = await bound.run();
          if (!raced && f.raw.prepare("SELECT id FROM email_send_audit WHERE provider_id='managed_gateway' AND status='pending'").get()) {
            raced = true; f.raw.exec("UPDATE mailbox_aliases SET alias_local_part='changed' WHERE user_id='alice'");
          }
          return result;
        } };
      } };
    }) as typeof prepare;
    expect(await f.services.sendDraft!(reviewed.id, "managed-admission-race", reviewed)).toMatchObject({ status: 409 });
    expect(raced).toBe(true); expect(f.send).not.toHaveBeenCalled();
    expect(f.raw.prepare("SELECT provider_id,status,error_message FROM email_send_audit WHERE mailbox_message_id=? ORDER BY provider_id").all(reviewed.id))
      .toMatchObject([{ provider_id: "agent-operation", status: "failed", error_message: expect.stringMatching(/changed/) }, { provider_id: "managed_gateway", status: "failed", error_message: expect.stringMatching(/changed/) }]);
  });

  it("never refreshes or retries a previously pending guarded managed delivery audit", async () => {
    const f = fixture(); f.raw.exec("DELETE FROM email_provider_settings; UPDATE mailbox_aliases SET status='active' WHERE user_id='alice'");
    Object.assign(f.env, { ME3_DEPLOYMENT_MODE: "managed", ME3_MANAGED_INSTALLATION_ID: "mi-synthetic-sender", ME3_MANAGED_EMAIL_GATEWAY_ORIGIN: "https://api.me3.test" });
    f.raw.exec("INSERT INTO install_secrets(name,value) VALUES('ME3_CORE_INSTALL_ID','core_synthetic-sender'),('ME3_CLOUD_CORE_TOKEN','synthetic-test-token'),('ME3_CLOUD_OWNER_ID','synthetic-cloud-owner')");
    const reviewed = await draft(f), identity = await providers.getEmailDeliveryIdentity(f.env, "alice");
    const request = { purpose: "draft" as const, mailboxId: "alice-mailbox", mailboxMessageId: reviewed.id, operationId: "previous-native-pending", approvedByUserId: "alice", approvedDeliveryIdentity: identity, toAddress: "client@example.test", subject: "Reviewed subject", textBody: "Reviewed body" };
    const gateway = vi.fn(async () => { throw new Error("Simulated accepted gateway delivery with lost response"); }); vi.stubGlobal("fetch", gateway);
    await expect(providers.sendEmailWithProvider(f.env, "alice", request)).rejects.toBeInstanceOf(providers.EmailProviderDeliveryUnknownError);
    expect(gateway).toHaveBeenCalledTimes(1);
    const pending = f.raw.prepare("SELECT * FROM email_send_audit WHERE provider_id='managed_gateway'").all();
    expect(pending).toMatchObject([{ status: "pending" }]);
    await expect(providers.sendEmailWithProvider(f.env, "alice", request)).rejects.toBeInstanceOf(providers.EmailProviderDeliveryUnknownError);
    expect(gateway).toHaveBeenCalledTimes(1);
    expect(f.raw.prepare("SELECT * FROM email_send_audit WHERE provider_id='managed_gateway'").all()).toEqual(pending);
  });
});
