import type { Env } from "./types";

/**
 * The email ME3 wrote in a turn, shown in Chat as an editable card. `draftId`
 * is null when no recipient address was known, so nothing was saved yet.
 */
export type AgentEmailDraft = {
  draftId: string | null;
  to: string;
  recipientName: string | null;
  contactId: string | null;
  subject: string;
  body: string;
  replyToMessageId: string | null;
};

type Row = { result_json: string | null; arguments_json: string | null };

/** The turn's latest successful core_mailbox_draft result, if any. */
export async function loadAgentEmailDraft(env: Env, scope: { ownerId: string; turnId: string }): Promise<AgentEmailDraft | null> {
  const row = await env.DB.prepare(
    `SELECT result_json, arguments_json FROM me3_agent_tool_receipts
     WHERE owner_id = ? AND turn_id = ? AND tool_name = 'core_mailbox_draft' AND status = 'finished'
     ORDER BY updated_at DESC, rowid DESC LIMIT 1`,
  ).bind(scope.ownerId, scope.turnId).first<Row>().catch(() => null);
  if (!row?.result_json) return null;
  let result: Record<string, unknown>, args: Record<string, unknown>;
  try { result = JSON.parse(row.result_json); args = JSON.parse(row.arguments_json || "{}"); } catch { return null; }
  if (result?.status !== "ok") return null;
  const draft = (result.data as Record<string, unknown> | undefined)?.draft as Record<string, unknown> | undefined;
  if (!draft) return null;
  return readAgentEmailDraft({
    draftId: typeof draft.id === "string" ? draft.id : null,
    to: text(draft.toAddress) ?? text(args.to) ?? "",
    recipientName: text(draft.recipientName) ?? text(args.recipientName),
    contactId: text(draft.contactId) ?? text(args.contactId),
    subject: text(draft.subject) ?? text(args.subject) ?? "",
    body: text(draft.body) ?? text(args.body) ?? "",
    replyToMessageId: text(draft.replyToMessageId) ?? text(args.replyToMessageId),
  });
}

/** Accepts only a complete draft shape (used for live payloads and saved history). */
export function readAgentEmailDraft(value: unknown): AgentEmailDraft | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const draft = value as Record<string, unknown>;
  const nullable = (key: string) => draft[key] === null || draft[key] === undefined ? null : typeof draft[key] === "string" ? draft[key] as string : undefined;
  const draftId = nullable("draftId"), recipientName = nullable("recipientName"), contactId = nullable("contactId"), replyToMessageId = nullable("replyToMessageId");
  if ([draftId, recipientName, contactId, replyToMessageId].includes(undefined)) return null;
  if (typeof draft.to !== "string" || typeof draft.subject !== "string" || typeof draft.body !== "string" || !draft.body.trim()) return null;
  return { draftId: draftId!, to: draft.to, recipientName: recipientName!, contactId: contactId!, subject: draft.subject, body: draft.body, replyToMessageId: replyToMessageId! };
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
