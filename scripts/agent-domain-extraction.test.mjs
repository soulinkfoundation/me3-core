import assert from "node:assert/strict";
import { test } from "node:test";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";

// Retiring the chat dispatcher must preserve the owner-scoped domain APIs and
// their durable failure/idempotency semantics through fresh SQLite connections.
test("retained contacts preserve CRUD, duplicate refusal and foreign-owner boundaries", async () => {
  const contacts = await import("../packages/agent-chat/src/contacts.ts");
  const seed = createSeededAgentEvalInstallation("2026-10-14");
  try {
    const env = { DB: seed.db };
    const created = await contacts.createAgentContact(env, seed.ownerId, { name: "Retained contact", email: "retained@example.invalid", metadata: { sourceProof: "retained" } });
    assert.equal(created.name, "Retained contact");
    assert.equal((await contacts.createAgentContact(env, seed.ownerId, { name: "Duplicate", email: "RETAINED@example.invalid" })).status, 409);
    assert.equal((await contacts.updateAgentContact(env, "other-owner", created.id, { name: "Foreign overwrite" })).status, 404);
    const updated = await contacts.updateAgentContact(env, seed.ownerId, created.id, { name: "Retained renamed", metadata: { sourceProof: "updated" } });
    assert.equal(updated.metadata.sourceProof, "updated");
    await contacts.markAgentContactInTouch(env, seed.ownerId, created.id);
    seed.reopen();
    const saved = (await contacts.listAgentContacts(env, seed.ownerId)).contacts.find(row => row.id === created.id);
    assert.equal(saved.name, "Retained renamed");
    assert.ok(saved.lastInTouchAt);
    assert.equal((await contacts.deleteAgentContact(env, "other-owner", created.id)).status, 404);
    assert.deepEqual(await contacts.deleteAgentContact(env, seed.ownerId, created.id), { ok: true });
    assert.equal(seed.raw.prepare("SELECT name FROM contacts WHERE id='other-contact'").get().name, "Private other-owner contact");
  } finally { seed.close(); }
});

test("retained mailbox keeps reply headers, idempotent drafts and claim-before-send transitions", async () => {
  const mailbox = await import("../packages/agent-chat/src/mailbox.ts");
  const seed = createSeededAgentEvalInstallation("2026-10-14");
  try {
    const env = { DB: seed.db };
    const input = { to: "ada@example.invalid", subject: "Re: QA launch review", textBody: "The independently authored reply.", source: "agent", replyToMessageId: "eval-email-ada" };
    const first = await mailbox.createAgentMailboxDraft(env, seed.ownerId, input, { idempotencyKey: "retained-reply" });
    assert.ok(first.draft.id);
    const repeated = await mailbox.createAgentMailboxDraft(env, seed.ownerId, input, { idempotencyKey: "retained-reply" });
    assert.equal(repeated.draft.id, first.draft.id);
    const headers = mailbox.getAgentMailboxOutboundHeaders(first.draft);
    assert.equal(headers.inReplyTo, "<eval-email-ada@example.invalid>");
    assert.equal(headers.referencesHeader, "<eval-thread-origin@example.invalid> <eval-email-ada@example.invalid>");
    assert.equal((await mailbox.getAgentMailboxMessage(env, "other-owner", first.draft.id)).status, 404);
    const sentInput = { providerId: "simulated", providerMessageId: "retained-send", sentAt: "2026-10-14T12:00:00.000Z", approvedByUserId: seed.ownerId };
    assert.equal((await mailbox.markAgentMailboxDraftSent(env, seed.ownerId, first.draft.id, sentInput)).status, 409);
    const claimed = await mailbox.getAgentMailboxDraftForApproval(env, seed.ownerId, first.draft.id);
    assert.equal(claimed.alreadySent, false);
    assert.equal((await mailbox.getAgentMailboxDraftForApproval(env, seed.ownerId, first.draft.id)).status, 409);
    assert.equal((await mailbox.updateAgentMailboxDraft(env, seed.ownerId, first.draft.id, { textBody: "Late change" })).status, 409);
    assert.equal((await mailbox.rejectAgentMailboxDraft(env, seed.ownerId, first.draft.id)).status, 409);
    assert.equal((await mailbox.markAgentMailboxDraftSent(env, seed.ownerId, first.draft.id, sentInput)).draft.status, "sent");
    seed.reopen();
    assert.equal((await mailbox.getAgentMailboxDraftForApproval(env, seed.ownerId, first.draft.id)).alreadySent, true);
    assert.equal((await mailbox.listAgentMailboxThreadMessages(env, seed.ownerId, "eval-ada-thread")).messages.length, 2);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM mailbox_messages WHERE agent_idempotency_key='retained-reply'").get().n, 1);
    assert.equal((await mailbox.deleteAgentMailboxMessage(env, "other-owner", first.draft.id)).status, 404);
    assert.equal(seed.raw.prepare("SELECT text_body FROM mailbox_messages WHERE id='other-email'").get().text_body, "Do not expose this private fixture.");
  } finally { seed.close(); }
});

test("retained sandbox audit gives the same canonical identity after reopen without dispatch", async () => {
  const { createAgentSandboxTurnRecord } = await import("../packages/agent-chat/src/sandbox-audit.ts");
  const seed = createSeededAgentEvalInstallation("2026-10-14");
  try {
    const env = { DB: seed.db }, input = { userId: seed.ownerId, requestId: "retained-audit", messageText: "  A canonical owner message  ", metadata: { runtime: "agent" } };
    const first = await createAgentSandboxTurnRecord(env, input);
    seed.reopen();
    assert.deepEqual(JSON.parse(JSON.stringify(await createAgentSandboxTurnRecord(env, input))), JSON.parse(JSON.stringify(first)));
    const other = await createAgentSandboxTurnRecord(env, { ...input, userId: "other-owner" });
    assert.notEqual(other.connection.id, first.connection.id);
    assert.notEqual(other.turnId, first.turnId);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM agent_channel_events").get().n, 2);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM me3_agent_turns").get().n, 0);
  } finally { seed.close(); }
});

test("retained barrel exposes domain APIs without old dispatch or router entry points", async () => {
  const api = await import("../packages/agent-chat/src/index.ts");
  for (const key of ["createAgentContact", "upsertAgentContact", "createAgentMailboxDraft", "getAgentMailboxDraftForApproval", "createAgentSandboxTurnRecord", "buildReminderActionCard", "estimateManagedAiUsage"]) assert.equal(typeof api[key], "function", key);
  for (const key of ["dispatchAgentSandboxTurn", "runCoreAgentToolTurn", "runJevToolRouter", "resolveJevRouterMode", "runAgentToolLoop"]) assert.equal(Object.hasOwn(api, key), false, key);
});
