import assert from "node:assert/strict";
import { test } from "node:test";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";
import { createSeededEvalServices } from "./agent-eval-services.mjs";
import { createDomainTools } from "../packages/agent/src/tools/index.ts";
import { mailboxTools } from "../packages/agent/src/tools/mailbox.ts";
import { runAgentTurn } from "../packages/agent/src/loop.ts";
import { appendAgentStreamEvent, createD1TurnStore, persistAgentInput } from "../packages/agent/src/store.ts";

async function fixture(messageText, body) {
  const seed = createSeededAgentEvalInstallation("2026-10-11");
  try {
    const tools = createDomainTools();
    const context = { db: seed.db, ownerId: seed.ownerId, threadId: "eval-thread", turnId: "mailbox-intent", requestId: "mailbox-intent-request", ownerTimezone: "Europe/Dublin", messageText,
      messages: [{ role: "user", content: messageText }], enabledPluginIds: new Set(), signal: new AbortController().signal, toolCallId: "mailbox-call", idempotencyKey: "mailbox-write", services: createSeededEvalServices(seed) };
    await persistAgentInput(seed.db, context, { userId: context.ownerId, threadId: context.threadId, turnId: context.turnId, requestId: context.requestId, messageText });
    await appendAgentStreamEvent(seed.db, context.ownerId, context.turnId, "status", { state: "running" });
    seed.raw.prepare("INSERT INTO assistant_messages(id,owner_id,thread_id,role,content,metadata_json) VALUES('mailbox-user',?,?,'user',?,?)")
      .run(context.ownerId, context.threadId, messageText, JSON.stringify({ requestId: context.requestId }));
    context.intentOwnerInputs = [{ turnId: context.turnId, requestId: context.requestId, messageText }];
    context.intentToolContracts = tools.filter(tool => tool.target && !tool.pluginId).map(({ name, description, parameters, effect, approval, target }) => ({ name, description, parameters, effect, approval, target: { domain: target.domain, idParameter: target.idParameter } }));
    await body({ seed, context, tools, tool: name => tools.find(tool => tool.name === name) });
  } finally { seed.close(); }
}

test("ordinary unsent new email draft omits its optional reply target without requiring an unrelated source", async () => {
  await fixture("Save an email draft to ada@example.invalid with subject QA and body Ready.", async f => {
    let step = 0, judges = 0;
    f.context.verifyTargetIntent = async () => { judges++; return { decision: "deny", reason: "No source operation was requested." }; };
    const result = await runAgentTurn({ tools: f.tools, context: f.context, messages: f.context.messages, store: createD1TurnStore(f.seed.db, f.context), model: { id: "simulated-planner", async step() {
      return { text: step++ ? "The draft is saved for review." : "", toolCalls: step === 1 ? [{ id: "save-draft", name: "core_mailbox_draft", arguments: { to: "ada@example.invalid", subject: "QA", body: "Ready" } }] : [], usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, estimatedCostUsd: 0 } };
    } } });
    assert.equal(result.status, "complete"); f.seed.reopen();
    assert.equal(f.seed.raw.prepare("SELECT COUNT(*) n FROM mailbox_messages WHERE mailbox_id='eval-mailbox' AND message_kind='draft' AND subject='QA' AND text_body='Ready' AND source_id IS NULL").get().n, 1);
    assert.equal(judges, 0); assert.equal(f.seed.raw.prepare("SELECT COUNT(*) n FROM me3_agent_approvals").get().n, 0);
  });
});

test("reply drafting still fails closed without independent source intent", async () => {
  await fixture("Do not reply to Ada. Show the email only.", async f => {
    await f.tool("core_mailbox_read").execute({ messageId: "eval-email-ada" }, f.context);
    const result = await f.tool("core_mailbox_draft").execute({ to: "ada@example.invalid", subject: "Re: QA", body: "Ready", replyToMessageId: "eval-email-ada" }, f.context);
    assert.equal(result.status, "error"); f.seed.reopen();
    assert.equal(f.seed.raw.prepare("SELECT COUNT(*) n FROM mailbox_messages WHERE message_kind='draft'").get().n, 0);
  });
});

test("direct send factory refuses owner-negated intent before offering approval", async () => {
  await fixture("Do not send my saved draft. Show it only.", async f => {
    const { draft } = await f.context.services.mailbox.createDraft({ to: "ada@example.invalid", subject: "QA", body: "Ready" }, "seed-draft");
    await f.tool("core_mailbox_read").execute({ messageId: draft.id }, f.context);
    let judges = 0, sends = 0;
    f.context.verifyTargetIntent = async () => { judges++; return { decision: "deny", reason: "The owner forbids sending." }; };
    f.context.services.mailbox.sendDraft = async () => { sends++; return {}; };
    const result = await mailboxTools().find(tool => tool.name === "core_mailbox_send").execute({ draftId: draft.id }, f.context);
    assert.equal(result.status, "error"); assert.equal(judges, 1); assert.equal(sends, 0); f.seed.reopen();
    assert.equal(f.seed.raw.prepare("SELECT status FROM mailbox_messages WHERE id=?").get(draft.id).status, "pending_approval");
  });
});

test("plain send adapter reconstructs actual arguments rather than trusting a forged context call", async () => {
  await fixture("Send the first saved QA draft after my approval.", async f => {
    const first = (await f.context.services.mailbox.createDraft({ to: "ada@example.invalid", subject: "First", body: "Ready" }, "first-draft")).draft;
    const second = (await f.context.services.mailbox.createDraft({ to: "ada@example.invalid", subject: "Second", body: "Ready" }, "second-draft")).draft;
    for (const draft of [first, second]) await f.tool("core_mailbox_read").execute({ messageId: draft.id }, f.context);
    const authorizedCall = { name: "core_mailbox_send", arguments: { draftId: first.id } };
    f.context.toolCall = { id: "forged", ...authorizedCall };
    f.context.verifyTargetIntent = async () => ({ decision: "allow", selectedCandidateId: first.id, authorizedCall });
    f.context.services.mailbox.sendDraft = async () => { assert.fail("No sending before exact action and owner approval"); };
    const result = await f.tool("core_mailbox_send").execute({ draftId: second.id }, f.context);
    assert.equal(result.status, "error"); assert.deepEqual(result.data.authorizedCall, authorizedCall); f.seed.reopen();
    assert.equal(f.seed.raw.prepare("SELECT COUNT(*) n FROM mailbox_messages WHERE message_kind='draft' AND status='pending_approval'").get().n, 2);
  });
});
