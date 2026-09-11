export interface Env {
  DB: D1Database;
  ME3_USER_AGENT?: DurableObjectNamespace;
  AI?: Ai;
  IMAGES?: ImageTransformationsBinding;
  ASSETS?: Fetcher;
  SITE_ASSETS?: R2Bucket;
  ASSISTANT_JOB_EVENTS?: Queue<AssistantJobEventQueueMessage>;
  BOOKING_REMINDER_QUEUE?: Queue<BookingReminderQueueMessage>;
  SOCIAL_PUBLISH_QUEUE?: Queue<SocialPublishQueueMessage>;

  ENVIRONMENT?: string;
  ME3_DEPLOYMENT_MODE?: string;
  CORE_WEB_ORIGIN?: string;
  CORE_API_ORIGIN?: string;
  ME3_CUSTOM_DOMAIN?: string;
  ME3_ADMIN_HOST?: string;
  ME3_API_HOST?: string;
  ME3_SITE_HOST?: string;
  ME3_SITE_USERNAME?: string;
  ME3_WORKER_NAME?: string;
  ME3_CLOUD_ORIGIN?: string;
  ME3_CLOUD_API_ORIGIN?: string;
  ME3_MANAGED_INSTALLATION_ID?: string;
  ME3_MANAGED_EMAIL_GATEWAY_ORIGIN?: string;
  ME3_SOCIAL_OAUTH_ORIGIN?: string;
  ME3_LOCATION_SEARCH_ORIGIN?: string;

  JWT_SECRET?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  SETUP_PASSWORD?: string;

  ME3_ASSISTANT_DEBUG_TRACE?: string;
  ME3_ASSISTANT_TRACE?: string;
  ME3_ASSISTANT_SITE_TOOLS_ENABLED?: string;
  ME3_AI_RAW_MODEL_SELECTION_ENABLED?: string;
  ME3_AI_MODEL?: string;
  ME3_AI_DEFAULT_PROVIDER?: string;
  ME3_AI_DEFAULT_MODEL?: string;
  ME3_WEB_SEARCH_MODEL?: string;
  ME3_AI_CHAT_PROVIDER?: string;
  ME3_AI_CHAT_MODEL?: string;
  ME3_AI_CHAT_BACKUP_MODEL?: string;
  ME3_AI_REASONING_PROVIDER?: string;
  ME3_AI_REASONING_MODEL?: string;
  ME3_AI_EXTRACTION_PROVIDER?: string;
  ME3_AI_EXTRACTION_MODEL?: string;
  ME3_AI_IMAGE_GENERATION_PROVIDER?: string;
  ME3_AI_IMAGE_GENERATION_MODEL?: string;
  ME3_VOICE_TRANSCRIPTION_PROVIDER?: string;
  ME3_VOICE_TRANSCRIPTION_MODEL?: string;
  ME3_EMAIL_DEFAULT_PROVIDER?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  SOULINK_API_ORIGIN?: string;

  EMAIL?: {
    send(message: Record<string, unknown>): Promise<{ messageId?: string | null }>;
  };
  SMTP_CONNECT?: (
    address: SocketAddress,
    options?: SocketOptions,
  ) => Socket;

  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  PEXELS_API_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_GATEWAY_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  ME3_COMMERCE_BRIDGE_ORIGIN?: string;
  ME3_COMMERCE_BRIDGE_TOKEN?: string;
}

export interface ImageTransformationsBinding {
  input(
    image: ReadableStream | ArrayBuffer | Uint8Array,
  ): ImageTransformationsPipeline;
}

export interface ImageTransformationsPipeline {
  transform(options: {
    width?: number;
    fit?: "scale-down";
    background?: string;
  }): ImageTransformationsPipeline;
  output(options: {
    format: "image/jpeg";
    quality?: number;
  }): Promise<{ response(): Response }>;
}

export type AssistantJobIngressEventQueueMessage = {
  kind?: "event";
  eventId: string;
  userId: string;
};

export type AssistantJobScheduledRunQueueMessage = {
  kind: "scheduled_run";
  runId: string;
  userId: string;
};

export type AssistantJobEventQueueMessage =
  | AssistantJobIngressEventQueueMessage
  | AssistantJobScheduledRunQueueMessage;

export type BookingReminderQueueMessage = {
  reminderId: string;
};

export type SocialPublishQueueMessage = {
  publicationId: string;
};

export interface OwnerProfile {
  id: string;
  email: string | null;
  name: string | null;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
  timezone: string | null;
  locale?: string | null;
  assistant_name?: string | null;
}

export type SiteRole = "profile" | "organization";

export interface DbSite {
  id: string;
  user_id: string;
  username: string;
  site_type: "profile" | "landing_page";
  site_role: SiteRole | null;
  /** The ME3 Profile represented by an organization/Business Site. */
  profile_site_id?: string | null;
  template_id: string | null;
  /** One canonical public hostname for this site. Domain aliases are intentionally deferred. */
  custom_domain: string | null;
  custom_domain_status: "pending" | "active" | "failed" | null;
  custom_domain_cf_id: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface DbSitePage {
  id: string;
  site_id: string;
  slug: string;
  kind: "landing_page" | "standard";
  title: string;
  template_id: string | null;
  draft_json: string;
  published_revision_id: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface DbSitePageRevision {
  id: string;
  page_id: string;
  document_json: string;
  rendered_html: string;
  created_at: string;
}

export interface DbSubscriber {
  id: number;
  site_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  source: string;
  subscribed_at: string;
  unsubscribed_at: string | null;
  ip_hash: string | null;
  confirmation_token_hash: string | null;
  confirmation_expires_at: string | null;
  confirmation_requested_at: string | null;
  page_id?: string | null;
  action_id?: string | null;
  campaign?: string | null;
  marketing_status: "pending" | "marketable";
  marketing_permission_method: "single_opt_in" | "double_opt_in" | "import_attested" | null;
  marketing_permission_granted_at: string | null;
  marketing_permission_evidence_json: string | null;
  delivery_status: "deliverable" | "bounced" | "complained" | "suppressed";
  delivery_status_changed_at: string | null;
}

export interface DbBooking {
  id: string;
  site_id: string;
  offer_id: string | null;
  booking_type: "one_to_one" | "class" | "retreat" | null;
  guest_name: string;
  guest_email: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  calendar_event_id: string | null;
  status: "confirmed" | "cancelled";
  notes: string | null;
  created_at: string;
  cancelled_at: string | null;
  payment_intent_id: string | null;
  amount_paid: number | null;
  suggested_amount: number | null;
  currency: "usd" | "gbp" | "eur" | "cad" | "aud" | "chf" | "sgd" | "inr" | "pkr" | null;
  payment_status: "pending" | "succeeded" | "failed" | "not_required" | null;
  is_free_booking: number;
  quantity?: number | null;
  paid_at: string | null;
  page_id?: string | null;
  action_id?: string | null;
  campaign?: string | null;
}

export interface DbCommerceOrder {
  delivery_json?: string | null;
  fulfilled_at?: string | null;
  confirmation_sent_at?: string | null;
  payment_checked_at?: string | null;
  id: string;
  site_id: string;
  page_id: string | null;
  action_id: string | null;
  campaign: string | null;
  product_slug: string;
  product_title: string;
  buyer_name: string;
  buyer_email: string;
  buyer_note: string | null;
  amount_paid: number | null;
  amount_due: number | null;
  currency: string | null;
  status: "pending" | "paid" | "failed" | "refunded";
  provider: "stripe_direct" | "me3_cloud";
  payment_method: "stripe" | "manual";
  checkout_session_id: string | null;
  payment_intent_id: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbBookingReminder {
  id: string;
  booking_id: string;
  site_id: string;
  user_id: string;
  reminder_type: "booking_reminder_24h" | "booking_reminder_2h";
  channel: "email" | "telegram" | "soulink";
  status: "scheduled" | "queued" | "processing" | "sent" | "cancelled" | "failed" | "skipped";
  scheduled_for: string;
  queued_at: string | null;
  sent_at: string | null;
  cancelled_at: string | null;
  failed_at: string | null;
  dead_lettered_at: string | null;
  attempt_count: number;
  payload_json: string;
  provider_message_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbUserReminder {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  remind_at: string;
  timezone: string | null;
  recurrence_rule: string | null;
  source_dispatch_id?: string | null;
  context_type: "contact" | "booking" | null;
  context_id: string | null;
  context_label: string | null;
  status: "pending" | "delivered" | "dismissed" | "cancelled" | "failed";
  delivered_at: string | null;
  dismissed_at: string | null;
  created_at: string;
}

export interface DbUserCalendarEvent {
  id: string;
  user_id: string;
  title: string;
  notes: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string | null;
  all_day: number;
  kind: "event" | "birthday";
  recurrence_rule: string | null;
  created_at: string;
}

export interface DbSchedulingTimeType {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  timezone: string;
  windows_json: string;
  allowed_tiers_json: string;
  payment_mode: "free" | "paid_checkout" | "owner_review";
  public_booking_offer_id: string | null;
  owner_pre_review: "always" | "unless_close_contact";
  allow_close_contact_candidate_sharing: number;
  final_approval: "both_owners";
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface DbCalendarSource {
  id: string;
  user_id: string;
  kind: "ics_upload" | "ics_url";
  name: string;
  original_filename: string | null;
  encrypted_source_url?: string | null;
  source_url_hint?: string | null;
  imported_event_count: number;
  last_synced_at?: string | null;
  last_sync_error?: string | null;
  created_at: string;
}

export interface DbCalendarSourceEvent {
  id: string;
  source_id: string;
  external_key: string;
  external_uid: string | null;
  title: string;
  notes: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string | null;
  all_day: number;
  is_busy?: number;
  created_at: string;
}

export interface DbContact {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: "booking" | "manual" | "agent" | "import" | "outreach" | "soulink";
  source_ref: string | null;
  relationship: "client" | "prospect" | "contact";
  status: "active" | "archived" | "dormant";
  notes: string | null;
  tags: string | null;
  last_interaction_at: string | null;
  next_followup_at: string | null;
  outreach_status:
    | "new"
    | "drafted"
    | "sent"
    | "replied"
    | "booked"
    | "converted"
    | "not_interested"
    | "no_response"
    | null;
  social_handles: string | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  booking_count?: number | null;
  last_booking_at?: string | null;
}

export interface DbMailboxAlias {
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
}

export interface DbMailboxMessage {
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
}

export interface DbEmailProviderSetting {
  user_id: string;
  provider_id: string;
  is_active: number;
  encrypted_secret: string | null;
  secret_hint: string | null;
  secret_updated_at: string | null;
  config_json: string | null;
  last_status: "not_configured" | "ready" | "failed" | null;
  last_status_checked_at: string | null;
  last_test_sent_at: string | null;
  last_test_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbEmailSendAudit {
  id: string;
  user_id: string;
  mailbox_id: string | null;
  mailbox_message_id: string | null;
  provider_id: string;
  provider_message_id: string | null;
  provider_status: string | null;
  status: "pending" | "sent" | "failed";
  purpose: "test" | "draft" | "reply" | "workflow";
  from_address: string | null;
  to_address: string | null;
  subject: string | null;
  thread_key: string | null;
  message_id_header: string | null;
  in_reply_to: string | null;
  references_header: string | null;
  metadata_json: string | null;
  error_message: string | null;
  created_by: string;
  approved_by_user_id: string | null;
  requested_at: string;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbAiProviderCredential {
  user_id: string;
  provider_id: string;
  encrypted_api_key: string | null;
  api_key_hint: string | null;
  api_key_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbAiModelDefault {
  user_id: string;
  use_case: string;
  provider_id: string;
  model: string;
  created_at: string;
  updated_at: string;
}

export interface DbAgentChannelConnection {
  id: string;
  user_id: string;
  channel: "telegram" | "sandbox" | "soulink";
  status: "pending" | "active" | "disconnected";
  setup_token: string;
  provider_connection_id: string | null;
  provider_user_id: string | null;
  provider_thread_id: string | null;
  provider_username: string | null;
  provider_metadata_json: string | null;
  telegram_user_id: string | null;
  telegram_chat_id: string | null;
  telegram_username: string | null;
  telegram_first_name: string | null;
  telegram_last_name: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbAgentChannelEvent {
  id: string;
  connection_id: string;
  channel: "telegram" | "sandbox" | "soulink";
  direction: "inbound" | "outbound" | "system";
  event_type: "start" | "message" | "link" | "send" | "error";
  status: "received" | "pending" | "sent" | "failed" | "linked" | "skipped";
  provider_event_id: string | null;
  provider_message_id: string | null;
  telegram_message_id: string | null;
  reply_to_message_id: string | null;
  telegram_user_id: string | null;
  telegram_chat_id: string | null;
  telegram_username: string | null;
  text_body: string | null;
  raw_json: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbSchedulingRequest {
  id: string;
  user_id: string;
  contact_id: string | null;
  time_type_id: string;
  status:
    | "draft"
    | "candidates_shared"
    | "review_required"
    | "not_allowed"
    | "voting"
    | "pending_approval"
    | "approved"
    | "checkout_required"
    | "finalized"
    | "cancelled";
  requester_name: string | null;
  target_name: string | null;
  reason: string | null;
  date_range_start: string;
  date_range_end: string;
  candidate_slots_json: string;
  selected_slot_json: string | null;
  policy_json: string | null;
  stream_payload_json: string | null;
  checkout_url: string | null;
  requester_approved_at: string | null;
  target_approved_at: string | null;
  finalized_calendar_event_id: string | null;
  finalized_booking_id: string | null;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbSchedulingRequestVote {
  id: string;
  request_id: string;
  participant_role: "requester" | "target";
  voter_label: string | null;
  slot_starts_at: string;
  slot_ends_at: string;
  preference: "yes" | "maybe" | "no";
  raw_json: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbSchedulingRequestAudit {
  id: string;
  request_id: string;
  user_id: string;
  event_type:
    | "request_created"
    | "candidates_shared"
    | "vote_recorded"
    | "approval_recorded"
    | "finalization_blocked"
    | "checkout_handoff"
    | "finalized";
  actor_role: "system" | "assistant" | "requester" | "target" | "owner" | null;
  summary: string | null;
  metadata_json: string | null;
  created_at: string;
}
