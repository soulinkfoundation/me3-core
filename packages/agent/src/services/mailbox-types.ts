import type { AgentDb } from "../types";

export type MailboxEnv = { DB: AgentDb };

export type DbMailboxAliasRow = {
  id: string;
  user_id: string;
  alias_local_part: string;
  forwarding_email: string;
  forwarding_status: "pending" | "verified";
  forwarding_enabled: number;
  forwarding_mode: "me3_only" | "forward";
  status: "pending_setup" | "active" | "paused";
  approval_policy: "all";
  daily_inbound_limit: number;
  daily_outbound_limit: number;
  activated_at: string | null;
  cf_destination_id: string | null;
  cf_destination_verified_at: string | null;
  cf_rule_id: string | null;
  cf_last_synced_at: string | null;
  cf_last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type DbMailboxMessageRow = {
  id: string;
  direction: "inbound" | "outbound";
  message_kind: "email" | "draft" | "system";
  status:
    | "received"
    | "forwarded"
    | "pending_approval"
    | "approved"
    | "rejected"
    | "sent"
    | "failed"
    | "dropped";
  thread_key: string | null;
  provider_id: string | null;
  provider_message_id: string | null;
  from_address: string | null;
  to_address: string | null;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  raw_headers_json: string | null;
  raw_message: string | null;
  metadata_json: string | null;
  agent_idempotency_key?: string | null;
  source_id: string | null;
  folder: "inbox" | "drafts" | "sent" | "archive" | "trash";
  read_at: string | null;
  agent_summary: string | null;
  agent_labels_json: string | null;
  forwarded_to: string | null;
  error_message: string | null;
  created_by: string;
  approved_by_user_id: string | null;
  received_at: string | null;
  approved_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MailboxUnsubscribeAction = {
  available: true;
  mode: "one_click" | "link" | "mailto";
};

export type NormalizedMailboxDraftInput = {
  fromAddress: string;
  toAddress: string;
  subject: string;
  textBody: string;
  htmlBody: string | null;
  sourceId: string | null;
  threadKey: string;
  messageIdHeader: string;
  inReplyTo: string | null;
  referencesHeader: string | null;
  createdBy: string;
  preservedAttachments: AgentMailboxAttachmentMetadata[];
};

export type AgentMailboxAttachmentMetadata = {
  filename?: string | null;
  mimeType?: string | null;
  disposition?: string | null;
  size?: number | null;
  storageKey?: string | null;
  sourceMessageId?: string | null;
};

export type AgentMailboxDraftInput = {
  fromAddress?: unknown;
  to?: unknown;
  toAddress?: unknown;
  subject?: unknown;
  textBody?: unknown;
  htmlBody?: unknown;
  source?: unknown;
  replyToMessageId?: unknown;
  preservedAttachmentKeys?: unknown;
  uploadedAttachments?: unknown;
};

export type AgentMailboxMessageListOptions = {
  limit?: unknown;
  offset?: unknown;
  status?: unknown;
  createdBy?: unknown;
  direction?: unknown;
  folder?: unknown;
  query?: unknown;
  queryMode?: "phrase" | "terms";
  unread?: unknown;
};
