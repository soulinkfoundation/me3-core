import { createAgentSchedulingToolServices } from "../apps/worker/src/agent-scheduling.ts";
import { createAgentMailboxDraft, getAgentMailboxMessage, listAgentMailboxMessages } from "../packages/agent/src/services/mailbox.ts";
import { createSeededImageServices } from "./agent-eval-images.mjs";

// Synthetic provider adapters retain real D1 rows, but never send mail, relay a
// Soulink message, or query the public web. Tool safety remains in the runtime.
export function createSeededEvalServices(seed, options = {}) {
  const scheduling = createAgentSchedulingToolServices({ DB: seed.db }, seed.ownerId);
  const env = { DB: seed.db };
  const message = (record) => ({ ...record, toAddress: record.toAddress || "", bodyText: record.body });
  return {
    images: createSeededImageServices(seed, options),
    scheduling: { ...scheduling, async searchContacts({ query = "", limit = 5 }) {
      const rows = seed.raw.prepare("SELECT id, name, relationship FROM contacts WHERE user_id = ? AND status = 'active' AND name LIKE ? ORDER BY name LIMIT ?").all(seed.ownerId, `%${query}%`, Math.min(10, Math.max(1, limit)));
      const total = seed.raw.prepare("SELECT COUNT(*) AS n FROM contacts WHERE user_id = ? AND status = 'active' AND name LIKE ?").get(seed.ownerId, `%${query}%`).n;
      return { contacts: rows.map((row) => ({ ...row, me3AssistantAvailable: false })), total };
    } },
    mailbox: {
      async search(options = {}) {
        const result = await listAgentMailboxMessages(env, seed.ownerId, {
          ...options, direction: options.direction ?? "all", queryMode: "terms",
          unread: typeof options.unread === "boolean" ? String(options.unread) : options.unread,
          limit: Math.min(20, options.limit ?? 20),
        });
        return { ...result, messages: result.messages.map(message) };
      },
      async read(id) {
        const result = await getAgentMailboxMessage(env, seed.ownerId, id);
        return "error" in result ? result : { message: message(result.message) };
      },
      async createDraft(input, key) {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.to) || !input.subject?.trim() || !input.body?.trim()) return { error: "Invalid email draft", status: 400 };
        if (input.replyToMessageId && "error" in await getAgentMailboxMessage(env, seed.ownerId, input.replyToMessageId)) return { error: "Reply target not found", status: 404 };
        const result = await createAgentMailboxDraft(env, seed.ownerId, { ...input, textBody: input.body, source: "agent" }, { idempotencyKey: key });
        return "error" in result ? result : { draft: message(result.draft) };
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
