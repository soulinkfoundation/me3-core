import { createAgentSchedulingToolServices } from "../apps/worker/src/agent-scheduling.ts";

// Synthetic provider adapters retain real D1 rows, but never send mail, relay a
// Soulink message, or query the public web. Tool safety remains in the runtime.
export function createSeededEvalServices(seed) {
  const scheduling = createAgentSchedulingToolServices({ DB: seed.db }, seed.ownerId);
  const mailboxId = seed.raw.prepare("SELECT id FROM mailbox_aliases WHERE user_id = ?").get(seed.ownerId)?.id;
  const message = (row) => row && ({ ...row, from: row.from_address, to: row.to_address, fromAddress: row.from_address, toAddress: row.to_address, bodyText: row.text_body, bodyHtml: row.html_body, receivedAt: row.received_at, sentAt: row.sent_at, messageKind: row.message_kind });
  return {
    scheduling: { ...scheduling, async searchContacts({ query = "", limit = 5 }) {
      const rows = seed.raw.prepare("SELECT id, name, relationship FROM contacts WHERE user_id = ? AND status = 'active' AND name LIKE ? ORDER BY name LIMIT ?").all(seed.ownerId, `%${query}%`, Math.min(10, Math.max(1, limit)));
      const total = seed.raw.prepare("SELECT COUNT(*) AS n FROM contacts WHERE user_id = ? AND status = 'active' AND name LIKE ?").get(seed.ownerId, `%${query}%`).n;
      return { contacts: rows.map((row) => ({ ...row, me3AssistantAvailable: false })), total };
    } },
    mailbox: {
      async search({ query = "", direction, folder, unread, limit = 20 } = {}) {
        const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
        const rows = seed.raw.prepare("SELECT * FROM mailbox_messages WHERE mailbox_id = ? ORDER BY created_at DESC, id").all(mailboxId)
          .filter((row) => (!direction || row.direction === direction) && (!folder || row.folder === folder) && (!unread || (row.direction === "inbound" && row.read_at === null)) && terms.every((term) => [row.subject, row.from_address, row.to_address, row.text_body].some((value) => String(value || "").toLocaleLowerCase().includes(term))));
        return { messages: rows.slice(0, Math.min(20, limit)).map(message), total: rows.length };
      },
      async read(id) {
        const row = seed.raw.prepare("SELECT * FROM mailbox_messages WHERE id = ? AND mailbox_id = ?").get(id, mailboxId);
        return row ? { message: message(row) } : { error: "Message not found", status: 404 };
      },
      async createDraft(input, key) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to) || !input.subject?.trim() || !input.body?.trim()) return { error: "Invalid email draft", status: 400 };
        if (input.replyToMessageId && !seed.raw.prepare("SELECT id FROM mailbox_messages WHERE mailbox_id = ? AND id = ?").get(mailboxId, input.replyToMessageId)) return { error: "Reply target not found", status: 404 };
        const existing = seed.raw.prepare("SELECT * FROM mailbox_messages WHERE mailbox_id = ? AND agent_idempotency_key = ?").get(mailboxId, key);
        if (existing) return { draft: message(existing) };
        const id = crypto.randomUUID();
        seed.raw.prepare("INSERT INTO mailbox_messages (id, mailbox_id, direction, message_kind, status, from_address, to_address, subject, text_body, folder, created_by, agent_idempotency_key) VALUES (?, ?, 'outbound', 'draft', 'pending_approval', 'eval-owner@example.invalid', ?, ?, ?, 'drafts', 'agent', ?)").run(id, mailboxId, input.to, input.subject, input.body, key);
        return { draft: message(seed.raw.prepare("SELECT * FROM mailbox_messages WHERE id = ?").get(id)) };
      },
    },
    people: { async search() { return { results: [], total: 0, bounded: true }; } },
    web: { async search({ query }) {
      const now = new Date().toISOString();
      return { status: "success", query, answer: "Cloudflare AI Gateway provides observability and rate limiting for AI model requests.",
        sources: [{ id: "eval-source", url: "https://developers.cloudflare.com/ai-gateway/", canonicalUrl: "https://developers.cloudflare.com/ai-gateway/", title: "Cloudflare AI Gateway documentation", publisher: "Cloudflare", publishedAt: null, retrievedAt: now }],
        evidence: [{ id: "eval-evidence", sourceId: "eval-source", text: "AI Gateway provides analytics, logging, caching, rate limiting and request retries for model requests.", relevanceScore: 1 }],
        citations: [{ id: "eval-citation", sourceId: "eval-source", evidenceIds: ["eval-evidence"], label: "Cloudflare documentation", answerSpan: null }], searchedAt: now,
        usage: { requests: 1, searchQueries: 1, pagesOpened: 0, inputTokens: 0, outputTokens: 0, bytesReceived: 0, cost: null }, trace: { providerId: "synthetic-web-fixture", adapterId: "agent-eval-v1", operation: "search", providerRequestId: null, model: null, startedAt: now, durationMs: 0, attempts: 1 } };
    }, async open() { return { status: "error", error: { code: "not_found", message: "No selected page in synthetic web fixture", retryable: false, retryAfterMs: null }, usage: { requests: 0, searchQueries: 0, pagesOpened: 0, inputTokens: null, outputTokens: null, bytesReceived: null, cost: null }, trace: null }; } },
  };
}
