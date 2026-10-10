import assert from "node:assert/strict";
import { test } from "node:test";
import { createSeededAgentEvalInstallation } from "./agent-eval-seed.mjs";
import { createSeededEvalServices } from "./agent-eval-services.mjs";

test("reply drafts persist native source linkage, thread headers and idempotency after a fresh connection", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-10");
  try {
    seed.raw.prepare("UPDATE mailbox_messages SET thread_key = 'synthetic-thread', raw_headers_json = ? WHERE id = 'eval-email-ada'").run(JSON.stringify({ "message-id": "<ada-source@example.invalid>", references: "<earlier@example.invalid>" }));
    const input = { to: "ada@example.invalid", subject: "Re: QA launch review", body: "Thursday afternoon works.", replyToMessageId: "eval-email-ada" };
    const service = createSeededEvalServices(seed).mailbox;
    const { draft } = await service.createDraft(input, "threaded-reply");
    const row = seed.raw.prepare("SELECT * FROM mailbox_messages WHERE id = ?").get(draft.id);
    assert.equal(row.source_id, "eval-email-ada"); assert.equal(row.thread_key, "synthetic-thread");
    const headers = JSON.parse(row.metadata_json).outbound_headers;
    assert.equal(headers.in_reply_to, "<ada-source@example.invalid>");
    assert.equal(headers.references, "<earlier@example.invalid> <ada-source@example.invalid>");
    assert.match(headers.message_id, /^<.+@.+>$/);
    const originalConnection = seed.raw;
    seed.reopen();
    assert.notEqual(seed.raw, originalConnection);
    assert.throws(() => originalConnection.prepare("SELECT 1"));
    const fresh = createSeededEvalServices(seed).mailbox;
    assert.equal((await fresh.read(draft.id)).message.bodyText, input.body);
    assert.equal((await fresh.createDraft(input, "threaded-reply")).draft.id, draft.id);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM mailbox_messages WHERE message_kind = 'draft'").get().n, 1);
    assert.equal(row.status, "pending_approval"); assert.equal(row.sent_at, null);
  } finally { seed.close(); }
});

test("native synthetic mailbox searches honor all terms, owner, direction, folder and unread constraints", async () => {
  const seed = createSeededAgentEvalInstallation("2026-10-10");
  try {
    const service = createSeededEvalServices(seed).mailbox;
    seed.raw.prepare("UPDATE mailbox_messages SET read_at = '2026-10-10T10:00:00Z' WHERE id = 'eval-email-news'").run();
    await service.createDraft({ to: "ada@example.invalid", subject: "QA launch", body: "Unsent synthetic draft." }, "filter-control");
    assert.deepEqual((await service.search({ query: "Ada QA launch", direction: "inbound", folder: "inbox", unread: true })).messages.map(x => x.id), ["eval-email-ada"]);
    assert.equal((await service.search({ query: "Ada QA absent" })).total, 0);
    assert.equal((await service.search({ direction: "outbound", folder: "drafts" })).messages.length, 1);
    assert.deepEqual((await service.search({ unread: true })).messages.map(x => x.id), ["eval-email-ada"]);
    assert.equal((await service.createDraft({ to: "ada@example.invalid", subject: "Reply", body: "No cross-owner linkage.", replyToMessageId: "other-email" }, "wrong-owner")).status, 404);
    assert.equal(seed.raw.prepare("SELECT COUNT(*) AS n FROM mailbox_messages WHERE message_kind = 'draft'").get().n, 1);
  } finally { seed.close(); }
});
