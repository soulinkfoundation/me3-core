-- ME3 initial public D1 schema baseline.
-- Squashed from the private pre-release migration chain plus launch-ready Core migrations.
-- After the first public release, published migration files are immutable; append new numbered migrations only.

CREATE TABLE "agent_channel_connections" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  channel TEXT NOT NULL DEFAULT 'soulink'
    CHECK (channel IN ('telegram', 'sandbox', 'soulink')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'disconnected')),
  setup_token TEXT NOT NULL UNIQUE,
  provider_connection_id TEXT,
  provider_user_id TEXT,
  provider_thread_id TEXT,
  provider_username TEXT,
  provider_metadata_json TEXT,
  telegram_user_id TEXT,
  telegram_chat_id TEXT,
  telegram_username TEXT,
  telegram_first_name TEXT,
  telegram_last_name TEXT,
  connected_at TEXT,
  disconnected_at TEXT,
  last_inbound_at TEXT,
  last_outbound_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE,
  UNIQUE (user_id, channel)
);
CREATE TABLE "agent_channel_events" (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'soulink'
    CHECK (channel IN ('telegram', 'sandbox', 'soulink')),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'system')),
  event_type TEXT NOT NULL CHECK (event_type IN ('start', 'message', 'link', 'send', 'error')),
  status TEXT NOT NULL CHECK (status IN ('received', 'pending', 'sent', 'failed', 'linked', 'skipped')),
  provider_event_id TEXT,
  provider_message_id TEXT,
  telegram_message_id TEXT,
  reply_to_message_id TEXT,
  telegram_user_id TEXT,
  telegram_chat_id TEXT,
  telegram_username TEXT,
  text_body TEXT,
  raw_json TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (connection_id) REFERENCES agent_channel_connections(id) ON DELETE CASCADE,
  UNIQUE (connection_id, provider_event_id)
);
CREATE TABLE ai_gateway_settings (
  user_id TEXT PRIMARY KEY DEFAULT 'owner',
  account_id TEXT,
  gateway_id TEXT,
  encrypted_api_token TEXT,
  api_token_hint TEXT,
  api_token_updated_at TEXT,
  route_workers_ai INTEGER NOT NULL DEFAULT 1,
  route_external_providers INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE TABLE ai_usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  source TEXT NOT NULL DEFAULT 'local' CHECK (source IN ('local', 'gateway')),
  kind TEXT NOT NULL CHECK (kind IN ('text', 'image')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  successful_request_count INTEGER NOT NULL DEFAULT 1,
  failed_request_count INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE TABLE ai_model_defaults (
  user_id TEXT NOT NULL,
  use_case TEXT NOT NULL CHECK (use_case IN ('default', 'chat', 'reasoning', 'extraction', 'image_generation')),
  provider_id TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, use_case),
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE TABLE ai_provider_credentials (
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  encrypted_api_key TEXT,
  api_key_hint TEXT,
  api_key_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, provider_id),
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE TABLE assistant_attachments (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  thread_id TEXT REFERENCES assistant_threads(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL CHECK (kind IN ('text', 'image')),
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'error', 'deleted')),
  storage_key TEXT,
  extracted_text TEXT,
  text_truncated INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES owner_profile(id)
);
CREATE TABLE assistant_message_assets (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  thread_id TEXT REFERENCES assistant_threads(id) ON DELETE SET NULL,
  message_id TEXT REFERENCES assistant_messages(id) ON DELETE CASCADE,
  attachment_id TEXT REFERENCES assistant_attachments(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('generated_output', 'input_reference')),
  display_order INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES owner_profile(id)
);
CREATE TABLE assistant_job_action_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  capability_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('skipped', 'blocked', 'pending_approval', 'succeeded', 'failed')),
  approval_id TEXT,
  artifact_id TEXT,
  external_ref TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(run_id, action_id, idempotency_key),
  FOREIGN KEY (run_id) REFERENCES assistant_job_runs(id) ON DELETE CASCADE
);
CREATE TABLE assistant_job_artifacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  job_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  kind TEXT NOT NULL
    CHECK (kind IN ('review_packet', 'draft', 'summary', 'extraction', 'file_ref', 'provider_ref')),
  title TEXT NOT NULL,
  preview TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  mission_control_ref TEXT,
  provider_ref TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES assistant_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (run_id) REFERENCES assistant_job_runs(id) ON DELETE CASCADE
);
CREATE TABLE assistant_job_ingress_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('core', 'mission_control', 'plugin', 'webhook')),
  source_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  raw_payload_ref TEXT,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'matched', 'queued', 'processed', 'ignored', 'failed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, idempotency_key)
);
CREATE TABLE assistant_job_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES assistant_job_runs(id) ON DELETE CASCADE
);
CREATE TABLE assistant_job_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  job_id TEXT NOT NULL,
  job_version_id TEXT NOT NULL,
  trigger_kind TEXT NOT NULL
    CHECK (trigger_kind IN ('manual', 'schedule', 'event', 'heartbeat_retry')),
  trigger_ref TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'waiting_for_approval', 'succeeded', 'failed', 'cancelled', 'blocked')),
  started_at TEXT,
  finished_at TEXT,
  output_preview TEXT,
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (job_id) REFERENCES assistant_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (job_version_id) REFERENCES assistant_job_versions(id) ON DELETE CASCADE
);
CREATE TABLE assistant_job_versions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'owner',
  version_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  trigger_json TEXT NOT NULL,
  scope_json TEXT NOT NULL DEFAULT '{}',
  rules_json TEXT NOT NULL DEFAULT '[]',
  actions_json TEXT NOT NULL DEFAULT '[]',
  approval_policy_json TEXT NOT NULL DEFAULT '{}',
  destination_json TEXT NOT NULL DEFAULT '{}',
  capability_ids_json TEXT NOT NULL DEFAULT '[]',
  permission_summary_json TEXT NOT NULL DEFAULT '{}',
  recommended_skill_ids_json TEXT NOT NULL DEFAULT '[]',
  required_skill_ids_json TEXT NOT NULL DEFAULT '[]',
  validation_status TEXT NOT NULL DEFAULT 'valid'
    CHECK (validation_status IN ('valid', 'invalid', 'needs_setup')),
  validation_errors_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(job_id, version_number),
  FOREIGN KEY (job_id) REFERENCES assistant_jobs(id) ON DELETE CASCADE
);
CREATE TABLE assistant_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  recipe_id TEXT,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'needs_setup', 'failing', 'archived')),
  current_version_id TEXT,
  project_id TEXT,
  destination_json TEXT NOT NULL DEFAULT '{}',
  trigger_summary TEXT NOT NULL DEFAULT 'Manual',
  next_run_at TEXT,
  last_run_at TEXT,
  last_run_status TEXT CHECK (last_run_status IN ('queued', 'running', 'waiting_for_approval', 'succeeded', 'failed', 'cancelled', 'blocked')),
  failure_count INTEGER NOT NULL DEFAULT 0,
  setup_state_json TEXT NOT NULL DEFAULT '{}',
  created_by TEXT NOT NULL DEFAULT 'owner'
    CHECK (created_by IN ('owner', 'assistant')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT
);
CREATE TABLE assistant_messages (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, thread_id TEXT REFERENCES assistant_threads(id) ON DELETE SET NULL,
  FOREIGN KEY (owner_id) REFERENCES owner_profile(id)
);
CREATE TABLE assistant_skills (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  name TEXT NOT NULL,
  description TEXT,
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('url', 'repo', 'upload', 'core', 'plugin')),
  source_ref TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'invalid', 'archived')),
  trust_level TEXT NOT NULL DEFAULT 'user'
    CHECK (trust_level IN ('core', 'plugin', 'user')),
  trigger_hints_json TEXT NOT NULL DEFAULT '[]',
  skill_md TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  validation_errors_json TEXT NOT NULL DEFAULT '[]',
  scripts_available INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE assistant_threads (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  origin_surface TEXT NOT NULL DEFAULT 'assistant'
    CHECK (origin_surface IN ('assistant', 'launcher', 'soulink', 'job', 'system')),
  project_id TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'deleted')),
  pinned_at TEXT,
  archived_at TEXT,
  deleted_at TEXT,
  last_message_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES owner_profile(id),
  FOREIGN KEY (project_id) REFERENCES mission_projects(id) ON DELETE SET NULL
);
CREATE TABLE auth_rate_limits (
  key TEXT PRIMARY KEY,
  route TEXT NOT NULL,
  subject_hash TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  window_started_at TEXT NOT NULL,
  locked_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE booking_holds (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  booking_id TEXT,
  offer_id TEXT,
  booking_type TEXT NOT NULL DEFAULT 'one_to_one'
    CHECK (booking_type IN ('one_to_one', 'class', 'retreat')),
  hold_token TEXT NOT NULL UNIQUE,
  slot_start TEXT NOT NULL,
  slot_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'confirmed', 'released', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
);
CREATE TABLE booking_reminders (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'owner',
  reminder_type TEXT NOT NULL
    CHECK (reminder_type IN ('booking_reminder_24h', 'booking_reminder_2h')),
  channel TEXT NOT NULL
    CHECK (channel IN ('email', 'telegram', 'soulink')),
  status TEXT NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'queued', 'processing', 'sent', 'cancelled', 'failed', 'skipped')),
  scheduled_for TEXT NOT NULL,
  queued_at TEXT,
  sent_at TEXT,
  cancelled_at TEXT,
  failed_at TEXT,
  dead_lettered_at TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  provider_message_id TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  offer_id TEXT,
  booking_type TEXT CHECK (booking_type IN ('one_to_one', 'class', 'retreat')),
  guest_name TEXT NOT NULL,
  guest_email TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  calendar_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'cancelled')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at TEXT,
  payment_intent_id TEXT,
  amount_paid INTEGER,
  suggested_amount INTEGER,
  currency TEXT CHECK (currency IN ('usd', 'gbp', 'eur', 'cad', 'aud', 'chf', 'sgd', 'inr', 'pkr')),
  payment_status TEXT DEFAULT 'not_required'
    CHECK (payment_status IN ('pending', 'succeeded', 'failed', 'not_required')),
  is_free_booking INTEGER NOT NULL DEFAULT 0,
  paid_at TEXT,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
CREATE TABLE calendar_source_events (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  external_key TEXT NOT NULL,
  external_uid TEXT,
  title TEXT NOT NULL,
  notes TEXT,
  location TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  timezone TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  is_busy INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (source_id) REFERENCES calendar_sources(id) ON DELETE CASCADE
);
CREATE TABLE calendar_sources (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  kind TEXT NOT NULL DEFAULT 'ics_upload' CHECK (kind IN ('ics_upload', 'ics_url')),
  name TEXT NOT NULL,
  original_filename TEXT,
  encrypted_source_url TEXT,
  source_url_hint TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  imported_event_count INTEGER NOT NULL DEFAULT 0,
  last_synced_at TEXT,
  last_sync_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE TABLE commerce_settings (
  user_id TEXT PRIMARY KEY,
  encrypted_stripe_secret_key TEXT,
  stripe_key_hint TEXT,
  stripe_key_updated_at TEXT,
  preferred_stripe_provider TEXT NOT NULL DEFAULT 'auto'
    CHECK (preferred_stripe_provider IN ('auto', 'direct', 'managed')),
  default_currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('booking', 'manual', 'agent', 'import', 'outreach', 'soulink')),
  source_ref TEXT,
  relationship TEXT NOT NULL DEFAULT 'contact'
    CHECK (relationship IN ('client', 'prospect', 'contact')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'dormant')),
  notes TEXT,
  tags TEXT,
  last_interaction_at TEXT,
  next_followup_at TEXT,
  outreach_status TEXT CHECK (
    outreach_status IN (
      'new',
      'drafted',
      'sent',
      'replied',
      'booked',
      'converted',
      'not_interested',
      'no_response'
    )
  ),
  social_handles TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE TABLE content_bank_items (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  media_manifest_json TEXT NOT NULL DEFAULT '[]',
  platforms_json TEXT NOT NULL DEFAULT '[]',
  source_type TEXT NOT NULL DEFAULT 'original'
    CHECK (source_type IN ('original', 'blog_extract', 'imported', 'reworked')),
  source_ref TEXT,
  status TEXT NOT NULL DEFAULT 'bank'
    CHECK (status IN ('bank', 'queued', 'scheduled', 'publishing', 'posted', 'failed', 'archived')),
  queue_position INTEGER,
  scheduled_for TEXT,
  timezone TEXT,
  created_by TEXT NOT NULL DEFAULT 'human'
    CHECK (created_by IN ('human', 'agent_suggested')),
  approved_by_human INTEGER NOT NULL DEFAULT 0,
  evergreen INTEGER NOT NULL DEFAULT 0,
  times_posted INTEGER NOT NULL DEFAULT 0,
  last_posted_at TEXT,
  cooldown_days INTEGER NOT NULL DEFAULT 30,
  tags_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE core_install (
  id TEXT PRIMARY KEY,
  installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  schema_version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE email_provider_settings (
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  encrypted_secret TEXT,
  secret_hint TEXT,
  secret_updated_at TEXT,
  config_json TEXT,
  last_status TEXT CHECK (last_status IN ('not_configured', 'ready', 'failed')),
  last_status_checked_at TEXT,
  last_test_sent_at TEXT,
  last_test_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, provider_id),
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE TABLE email_send_audit (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  mailbox_id TEXT,
  mailbox_message_id TEXT,
  provider_id TEXT NOT NULL,
  provider_message_id TEXT,
  provider_status TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  purpose TEXT NOT NULL DEFAULT 'test'
    CHECK (purpose IN ('test', 'draft', 'reply', 'workflow')),
  from_address TEXT,
  to_address TEXT,
  subject TEXT,
  thread_key TEXT,
  message_id_header TEXT,
  in_reply_to TEXT,
  references_header TEXT,
  metadata_json TEXT,
  error_message TEXT,
  created_by TEXT NOT NULL DEFAULT 'owner',
  approved_by_user_id TEXT,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE,
  FOREIGN KEY (mailbox_id) REFERENCES mailbox_aliases(id) ON DELETE SET NULL,
  FOREIGN KEY (mailbox_message_id) REFERENCES mailbox_messages(id) ON DELETE SET NULL
);
CREATE TABLE financial_categories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL COLLATE NOCASE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('income', 'expense')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, entry_type, name),
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE TABLE financial_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('income', 'expense')),
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  category_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'overdue', 'cancelled', 'needs_review')),
  source TEXT NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'email_triage', 'stripe', 'csv_import')),
  notes TEXT,
  source_ref TEXT,
  source_email_id TEXT,
  stripe_charge_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES financial_categories(id) ON DELETE SET NULL
);
CREATE TABLE install_secrets (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE journal_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  entry_date TEXT NOT NULL,
  title TEXT,
  body TEXT NOT NULL DEFAULT '',
  body_format TEXT NOT NULL DEFAULT 'plain_text'
    CHECK (body_format IN ('plain_text', 'markdown', 'html')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  UNIQUE(user_id, entry_date)
);
CREATE TABLE local_executor_audit_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  pairing_id TEXT,
  project_policy_id TEXT,
  run_id TEXT,
  approval_id TEXT,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'owner',
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pairing_id) REFERENCES local_executor_pairings(id) ON DELETE SET NULL,
  FOREIGN KEY (project_policy_id) REFERENCES local_executor_project_policies(id) ON DELETE SET NULL,
  FOREIGN KEY (run_id) REFERENCES local_executor_runs(id) ON DELETE SET NULL
);
CREATE TABLE local_executor_pairings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  runner_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  public_key TEXT,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'paused', 'revoked', 'unhealthy')),
  version TEXT,
  platform TEXT,
  last_seen_at TEXT,
  health_json TEXT NOT NULL DEFAULT '{}',
  paired_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, runner_id)
);
CREATE TABLE local_executor_project_policies (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  project_label TEXT NOT NULL,
  path_hint TEXT NOT NULL,
  resource_kind TEXT NOT NULL DEFAULT 'repo'
    CHECK (resource_kind IN ('repo', 'directory')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'revoked', 'missing')),
  provider_preset TEXT NOT NULL DEFAULT 'opencode'
    CHECK (provider_preset IN ('opencode', 'codex', 'claude')),
  model_hint TEXT,
  default_branch TEXT NOT NULL DEFAULT 'main',
  allowed_git_target TEXT NOT NULL DEFAULT 'none'
    CHECK (allowed_git_target IN ('none', 'branch', 'main')),
  landing_policy TEXT NOT NULL DEFAULT 'report_only'
    CHECK (landing_policy IN ('report_only', 'commit', 'push')),
  direct_main INTEGER NOT NULL DEFAULT 0,
  command_policy_json TEXT NOT NULL DEFAULT '{}',
  quality_gates_json TEXT NOT NULL DEFAULT '[]',
  caps_json TEXT NOT NULL DEFAULT '{}',
  dirty_repo TEXT NOT NULL DEFAULT 'block'
    CHECK (dirty_repo IN ('block', 'allow')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE local_executor_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'core',
  message TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES local_executor_runs(id) ON DELETE CASCADE
);
CREATE TABLE local_executor_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  assistant_job_id TEXT,
  assistant_job_run_id TEXT,
  project_policy_id TEXT NOT NULL,
  prompt_summary TEXT NOT NULL,
  prompt_text TEXT NOT NULL,
  source_kind TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual', 'schedule', 'event', 'assistant_job')),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'waiting_for_approval', 'running', 'succeeded', 'failed', 'cancelled', 'denied')),
  provider TEXT NOT NULL DEFAULT 'opencode'
    CHECK (provider IN ('opencode', 'codex', 'claude')),
  runner_id TEXT,
  approval_id TEXT,
  mission_agent_run_id TEXT,
  started_at TEXT,
  finished_at TEXT,
  result_summary TEXT,
  output_preview TEXT,
  artifact_manifest_json TEXT NOT NULL DEFAULT '[]',
  changed_files_json TEXT NOT NULL DEFAULT '[]',
  quality_gates_json TEXT NOT NULL DEFAULT '[]',
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_policy_id) REFERENCES local_executor_project_policies(id) ON DELETE RESTRICT
);
CREATE TABLE mailbox_aliases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE DEFAULT 'owner',
  alias_local_part TEXT NOT NULL UNIQUE,
  forwarding_email TEXT NOT NULL,
  forwarding_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (forwarding_status IN ('pending', 'verified')),
  forwarding_enabled INTEGER NOT NULL DEFAULT 0,
  forwarding_mode TEXT NOT NULL DEFAULT 'me3_only'
    CHECK (forwarding_mode IN ('me3_only', 'forward')),
  status TEXT NOT NULL DEFAULT 'pending_setup'
    CHECK (status IN ('pending_setup', 'active', 'paused')),
  approval_policy TEXT NOT NULL DEFAULT 'all'
    CHECK (approval_policy IN ('all')),
  daily_inbound_limit INTEGER NOT NULL DEFAULT 200,
  daily_outbound_limit INTEGER NOT NULL DEFAULT 200,
  activated_at TEXT,
  cf_destination_id TEXT,
  cf_destination_verified_at TEXT,
  cf_rule_id TEXT,
  cf_last_synced_at TEXT,
  cf_last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE TABLE mailbox_messages (
  id TEXT PRIMARY KEY,
  mailbox_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_kind TEXT NOT NULL CHECK (message_kind IN ('email', 'draft', 'system')),
  status TEXT NOT NULL CHECK (
    status IN (
      'received',
      'forwarded',
      'pending_approval',
      'approved',
      'rejected',
      'sent',
      'failed',
      'dropped'
    )
  ),
  thread_key TEXT,
  provider_message_id TEXT,
  from_address TEXT,
  to_address TEXT,
  subject TEXT,
  text_body TEXT,
  html_body TEXT,
  raw_headers_json TEXT,
  raw_message TEXT,
  metadata_json TEXT,
  source_id TEXT,
  folder TEXT NOT NULL DEFAULT 'inbox'
    CHECK (folder IN ('inbox', 'drafts', 'sent', 'archive', 'trash')),
  read_at TEXT,
  agent_summary TEXT,
  agent_labels_json TEXT,
  forwarded_to TEXT,
  error_message TEXT,
  created_by TEXT NOT NULL DEFAULT 'system',
  approved_by_user_id TEXT,
  received_at TEXT,
  approved_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, provider_id TEXT,
  FOREIGN KEY (mailbox_id) REFERENCES mailbox_aliases(id) ON DELETE CASCADE
);
CREATE TABLE me3_install_claim_states (
  state TEXT PRIMARY KEY,
  redirect_path TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, install_id TEXT);
CREATE TABLE mission_agent_run_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES mission_agent_runs(id) ON DELETE CASCADE
);
CREATE TABLE mission_agent_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  source TEXT NOT NULL DEFAULT 'core'
    CHECK (source IN ('core', 'daemon', 'hosted_cloud', 'import')),
  project_id TEXT,
  task_id TEXT,
  approval_id TEXT,
  title TEXT NOT NULL,
  prompt_summary TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  model TEXT,
  runner_id TEXT,
  started_at TEXT,
  finished_at TEXT,
  cost_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  artifact_manifest_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE mission_approvals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  plugin_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  risk_level TEXT NOT NULL DEFAULT 'low'
    CHECK (risk_level IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled')),
  requested_by TEXT NOT NULL DEFAULT 'agent',
  resolved_by TEXT,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  expires_at TEXT
);
CREATE TABLE "mission_context_sources" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('public_me_json', 'mission_statement', 'wheel_of_life', 'private_memory', 'core_table', 'plugin_table', 'daemon_directory', 'daemon_repo', 'provider', 'upload', 'url')),
  label TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('public', 'private')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'setup_required', 'paused', 'failed', 'archived')),
  source_ref TEXT,
  last_indexed_at TEXT,
  grants_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE mission_daemon_allowlist_entries (
  id TEXT PRIMARY KEY,
  pairing_id TEXT NOT NULL,
  label TEXT NOT NULL,
  path_hint TEXT NOT NULL,
  resource_kind TEXT NOT NULL CHECK (resource_kind IN ('directory', 'repo')),
  permission_tier TEXT NOT NULL DEFAULT 'metadata'
    CHECK (permission_tier IN ('metadata', 'read', 'write', 'shell')),
  shell_policy_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'revoked', 'missing')),
  last_checked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pairing_id) REFERENCES mission_daemon_pairings(id) ON DELETE CASCADE
);
CREATE TABLE mission_daemon_audit_events (
  id TEXT PRIMARY KEY,
  pairing_id TEXT,
  allowlist_entry_id TEXT,
  run_id TEXT,
  approval_id TEXT,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('pair_requested', 'paired', 'grant_added', 'grant_changed', 'grant_revoked', 'health_check', 'metadata_read', 'file_read', 'file_write', 'shell_run', 'denied', 'error')),
  actor TEXT NOT NULL DEFAULT 'owner',
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pairing_id) REFERENCES mission_daemon_pairings(id) ON DELETE SET NULL,
  FOREIGN KEY (allowlist_entry_id) REFERENCES mission_daemon_allowlist_entries(id) ON DELETE SET NULL
);
CREATE TABLE mission_daemon_pairings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  runner_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  public_key TEXT,
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'paused', 'revoked', 'unhealthy')),
  version TEXT,
  platform TEXT,
  last_seen_at TEXT,
  health_json TEXT NOT NULL DEFAULT '{}',
  paired_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, runner_id)
);
CREATE TABLE mission_dashboard_settings (
  user_id TEXT PRIMARY KEY DEFAULT 'owner',
  cards_json TEXT NOT NULL DEFAULT '[]',
  quick_links_json TEXT NOT NULL DEFAULT '[]',
  settings_json TEXT NOT NULL DEFAULT '{}',
  mission_statement TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE mission_plugin_activity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  plugin_id TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  status TEXT,
  related_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE mission_private_memory (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  memory_kind TEXT NOT NULL
    CHECK (memory_kind IN ('owner_note', 'project_context', 'preference', 'relationship_note', 'correction', 'learning')),
  scope_kind TEXT NOT NULL DEFAULT 'owner'
    CHECK (scope_kind IN ('owner', 'project', 'contact', 'plugin')),
  scope_id TEXT,
  title TEXT,
  body TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1,
  source_kind TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual', 'agent', 'import', 'daemon')),
  source_ref TEXT,
  review_status TEXT NOT NULL DEFAULT 'active'
    CHECK (review_status IN ('active', 'needs_review', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE mission_projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'archived')),
  color TEXT,
  icon TEXT,
  source_kind TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual', 'daemon_repo', 'beads', 'import')),
  source_ref TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, slug)
);
CREATE TABLE mission_tasks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  project_id TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'backlog'
    CHECK (status IN ('backlog', 'in_progress', 'done', 'cancelled')),
  priority INTEGER NOT NULL DEFAULT 3,
  pinned_at TEXT,
  due_at TEXT,
  scheduled_for TEXT,
  source_kind TEXT NOT NULL DEFAULT 'manual'
    CHECK (source_kind IN ('manual', 'capture', 'agent', 'beads', 'daemon')),
  source_ref TEXT,
  approval_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES mission_projects(id) ON DELETE SET NULL
);
CREATE TABLE mission_wheel_settings (
  user_id TEXT PRIMARY KEY DEFAULT 'owner',
  segments_json TEXT NOT NULL DEFAULT '[]',
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE mission_wheel_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  segments_json TEXT NOT NULL DEFAULT '[]',
  notes_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE owner_profile (
  id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  username TEXT UNIQUE,
  bio TEXT,
  avatar_url TEXT,
  timezone TEXT,
  password_hash TEXT,
  locale TEXT,
  assistant_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE mobile_pairings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'ios',
  app_version TEXT,
  code_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'claimed', 'expired', 'revoked')),
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE TABLE mobile_refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'ios',
  app_version TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'rotated', 'revoked')),
  scope_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE TABLE plugin_installations (
  plugin_id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'installed'
    CHECK (status IN ('installed', 'setup_required', 'disabled')),
  granted_permissions_json TEXT NOT NULL DEFAULT '[]',
  setup_state_json TEXT NOT NULL DEFAULT '{}',
  installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE owner_navigation_features (
  user_id TEXT NOT NULL,
  feature_id TEXT NOT NULL,
  visible INTEGER NOT NULL CHECK (visible IN (0, 1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, feature_id),
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE TABLE owner_feature_discovery (
  user_id TEXT PRIMARY KEY,
  dismissed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE TABLE scheduling_request_audit (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  user_id TEXT NOT NULL DEFAULT 'owner',
  event_type TEXT NOT NULL CHECK (event_type IN (
    'request_created',
    'candidates_shared',
    'vote_recorded',
    'approval_recorded',
    'finalization_blocked',
    'checkout_handoff',
    'finalized'
  )),
  actor_role TEXT CHECK (actor_role IN ('system', 'assistant', 'requester', 'target', 'owner')),
  summary TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES scheduling_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE TABLE scheduling_request_votes (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  participant_role TEXT NOT NULL CHECK (participant_role IN ('requester', 'target')),
  voter_label TEXT,
  slot_starts_at TEXT NOT NULL,
  slot_ends_at TEXT NOT NULL,
  preference TEXT NOT NULL DEFAULT 'yes' CHECK (preference IN ('yes', 'maybe', 'no')),
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES scheduling_requests(id) ON DELETE CASCADE,
  UNIQUE (request_id, participant_role, slot_starts_at, slot_ends_at)
);
CREATE TABLE scheduling_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  contact_id TEXT,
  time_type_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',
      'candidates_shared',
      'review_required',
      'not_allowed',
      'voting',
      'pending_approval',
      'approved',
      'checkout_required',
      'finalized',
      'cancelled'
    )),
  requester_name TEXT,
  target_name TEXT,
  reason TEXT,
  date_range_start TEXT NOT NULL,
  date_range_end TEXT NOT NULL,
  candidate_slots_json TEXT NOT NULL DEFAULT '[]',
  selected_slot_json TEXT,
  policy_json TEXT,
  stream_payload_json TEXT,
  checkout_url TEXT,
  requester_approved_at TEXT,
  target_approved_at TEXT,
  finalized_calendar_event_id TEXT,
  finalized_booking_id TEXT,
  finalized_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
);
CREATE TABLE scheduling_time_types (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  title TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL,
  buffer_minutes INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  windows_json TEXT NOT NULL DEFAULT '{}',
  allowed_tiers_json TEXT NOT NULL DEFAULT '["close_contact"]',
  payment_mode TEXT NOT NULL DEFAULT 'free'
    CHECK (payment_mode IN ('free', 'paid_checkout', 'owner_review')),
  public_booking_offer_id TEXT,
  owner_pre_review TEXT NOT NULL DEFAULT 'unless_close_contact'
    CHECK (owner_pre_review IN ('always', 'unless_close_contact')),
  allow_close_contact_candidate_sharing INTEGER NOT NULL DEFAULT 1,
  final_approval TEXT NOT NULL DEFAULT 'both_owners'
    CHECK (final_approval IN ('both_owners')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE TABLE site_files (
  site_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content BLOB NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (site_id, path),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  username TEXT NOT NULL UNIQUE,
  site_type TEXT NOT NULL DEFAULT 'profile'
    CHECK (site_type IN ('profile', 'landing_page')),
  template_id TEXT,
  custom_domain TEXT,
  custom_domain_status TEXT CHECK (custom_domain_status IN ('pending', 'active', 'failed')),
  custom_domain_cf_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TEXT,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE TABLE social_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('x', 'linkedin', 'instagram', 'instagram_business', 'youtube', 'tiktok')),
  platform_account_id TEXT NOT NULL,
  platform_handle TEXT,
  display_name TEXT,
  access_token_ciphertext TEXT NOT NULL,
  refresh_token_ciphertext TEXT,
  token_expires_at TEXT,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked', 'error')),
  metadata_json TEXT,
  last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(site_id, platform, platform_account_id)
);
CREATE TABLE social_oauth_states (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('x', 'linkedin', 'instagram', 'instagram_business', 'youtube', 'tiktok')),
  return_path TEXT NOT NULL DEFAULT '/social',
  code_verifier TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE social_packages (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  post_slug TEXT NOT NULL,
  post_title_snapshot TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  goal TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready', 'partially_published', 'published', 'failed', 'archived')),
  created_by TEXT NOT NULL DEFAULT 'user' CHECK (created_by IN ('user', 'agent')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(site_id, post_slug)
);
CREATE TABLE social_provider_settings (
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL CHECK (provider_id IN ('x', 'linkedin', 'instagram', 'instagram_business', 'youtube', 'tiktok')),
  client_id TEXT NOT NULL DEFAULT '',
  encrypted_client_secret TEXT,
  secret_hint TEXT,
  secret_updated_at TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, provider_id)
);
CREATE TABLE social_publication_events (
  id TEXT PRIMARY KEY,
  publication_id TEXT,
  variant_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('generated', 'approved', 'queued', 'publishing', 'published', 'failed', 'retried')),
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE social_publications (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('x', 'linkedin', 'instagram', 'instagram_business', 'youtube', 'tiktok')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'publishing', 'published', 'failed', 'cancelled')),
  platform_post_id TEXT,
  platform_post_url TEXT,
  error_code TEXT,
  error_message TEXT,
  provider_response_json TEXT,
  queued_at TEXT,
  published_at TEXT,
  last_polled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE social_variants (
  id TEXT PRIMARY KEY,
  package_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('x', 'linkedin', 'instagram', 'instagram_business', 'youtube', 'tiktok')),
  format TEXT NOT NULL DEFAULT 'post',
  title TEXT,
  body_text TEXT NOT NULL,
  first_comment TEXT,
  hashtags_json TEXT NOT NULL DEFAULT '[]',
  asset_manifest_json TEXT NOT NULL DEFAULT '[]',
  source_excerpt TEXT,
  approval_status TEXT NOT NULL DEFAULT 'draft' CHECK (approval_status IN ('draft', 'approved', 'rejected')),
  scheduled_for TEXT,
  timezone TEXT,
  published_variant_id TEXT,
  agent_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(package_id, platform)
);
CREATE TABLE subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id TEXT NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  source TEXT NOT NULL DEFAULT 'me3',
  subscribed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  unsubscribed_at TEXT,
  ip_hash TEXT,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
CREATE TABLE telegram_settings (
  user_id TEXT PRIMARY KEY,
  bot_username TEXT,
  encrypted_bot_token TEXT,
  bot_token_hint TEXT,
  bot_token_updated_at TEXT,
  encrypted_webhook_secret TEXT,
  webhook_secret_hint TEXT,
  webhook_secret_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE TABLE "user_calendar_events" (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  title TEXT NOT NULL,
  notes TEXT,
  location TEXT,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  timezone TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'event' CHECK (kind IN ('event', 'birthday')),
  recurrence_rule TEXT CHECK (
    recurrence_rule IS NULL OR
    recurrence_rule = 'daily' OR
    recurrence_rule = 'yearly' OR
    recurrence_rule LIKE 'weekly:%' OR
    recurrence_rule LIKE 'monthly:%' OR
    recurrence_rule LIKE 'custom:%'
  ),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE TABLE user_reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'owner',
  title TEXT NOT NULL,
  notes TEXT,
  remind_at TEXT NOT NULL,
  timezone TEXT,
  recurrence_rule TEXT,
  context_type TEXT CHECK (context_type IN ('contact', 'booking')),
  context_id TEXT,
  context_label TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'dismissed', 'cancelled', 'failed')),
  delivered_at TEXT,
  dismissed_at TEXT,
  cancelled_at TEXT,
  error_message TEXT,
  source_dispatch_id TEXT,
  created_via TEXT NOT NULL DEFAULT 'agent',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
CREATE INDEX idx_agent_channel_connections_provider_thread
  ON agent_channel_connections(channel, provider_thread_id);
CREATE INDEX idx_agent_channel_connections_user_channel
  ON agent_channel_connections(user_id, channel);
CREATE INDEX idx_agent_channel_events_connection_created
  ON agent_channel_events(connection_id, created_at DESC);
CREATE INDEX idx_agent_channel_events_provider_event
  ON agent_channel_events(connection_id, provider_event_id);
CREATE INDEX idx_ai_usage_events_user_created
  ON ai_usage_events(user_id, created_at DESC);
CREATE INDEX idx_ai_usage_events_user_kind_created
  ON ai_usage_events(user_id, kind, created_at DESC);
CREATE INDEX idx_assistant_attachments_owner_created
  ON assistant_attachments(owner_id, created_at DESC);
CREATE INDEX idx_assistant_attachments_thread_created
  ON assistant_attachments(thread_id, created_at DESC);
CREATE INDEX idx_assistant_job_action_results_run_status
  ON assistant_job_action_results(run_id, status);
CREATE INDEX idx_assistant_job_artifacts_run_kind
  ON assistant_job_artifacts(run_id, kind);
CREATE INDEX idx_assistant_job_ingress_events_user_status
  ON assistant_job_ingress_events(user_id, status, created_at);
CREATE INDEX idx_assistant_job_run_events_run_created
  ON assistant_job_run_events(run_id, created_at);
CREATE INDEX idx_assistant_job_runs_job_created
  ON assistant_job_runs(job_id, created_at);
CREATE INDEX idx_assistant_job_runs_user_status
  ON assistant_job_runs(user_id, status, created_at);
CREATE INDEX idx_assistant_job_versions_job_created
  ON assistant_job_versions(job_id, created_at);
CREATE INDEX idx_assistant_jobs_user_next_run
  ON assistant_jobs(user_id, status, next_run_at);
CREATE INDEX idx_assistant_jobs_user_status
  ON assistant_jobs(user_id, status, updated_at);
CREATE INDEX idx_assistant_messages_thread_created
  ON assistant_messages(thread_id, created_at ASC);
CREATE UNIQUE INDEX idx_assistant_skills_user_source_ref
  ON assistant_skills(user_id, source_ref)
  WHERE source_ref IS NOT NULL AND status != 'archived';
CREATE INDEX idx_assistant_skills_user_status
  ON assistant_skills(user_id, status, updated_at DESC);
CREATE INDEX idx_assistant_threads_owner_last_message
  ON assistant_threads(owner_id, last_message_at DESC);
CREATE INDEX idx_assistant_threads_owner_status_updated
  ON assistant_threads(owner_id, status, updated_at DESC);
CREATE INDEX idx_auth_rate_limits_locked_until
  ON auth_rate_limits(locked_until);
CREATE INDEX idx_auth_rate_limits_route_subject
  ON auth_rate_limits(route, subject_hash);
CREATE INDEX idx_booking_holds_expires_at
  ON booking_holds(expires_at);
CREATE INDEX idx_booking_holds_site_id
  ON booking_holds(site_id);
CREATE INDEX idx_booking_holds_slot_start
  ON booking_holds(slot_start);
CREATE INDEX idx_booking_holds_status
  ON booking_holds(status);
CREATE INDEX idx_booking_reminders_booking_id
  ON booking_reminders(booking_id);
CREATE INDEX idx_booking_reminders_due
  ON booking_reminders(status, scheduled_for);
CREATE INDEX idx_booking_reminders_site_status
  ON booking_reminders(site_id, status);
CREATE UNIQUE INDEX idx_booking_reminders_unique_delivery
  ON booking_reminders(booking_id, reminder_type, channel);
CREATE INDEX idx_bookings_payment_intent
  ON bookings(payment_intent_id);
CREATE INDEX idx_bookings_payment_status
  ON bookings(payment_status);
CREATE INDEX idx_bookings_site_id ON bookings(site_id);
CREATE INDEX idx_bookings_starts_at ON bookings(starts_at);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_calendar_source_events_window
  ON calendar_source_events(source_id, starts_at, ends_at);
CREATE INDEX idx_calendar_sources_url_refresh
  ON calendar_sources(kind, status, last_synced_at);
CREATE INDEX idx_contacts_next_followup ON contacts(user_id, next_followup_at)
  WHERE next_followup_at IS NOT NULL;
CREATE INDEX idx_contacts_status ON contacts(user_id, status);
CREATE UNIQUE INDEX idx_contacts_user_email ON contacts(user_id, email)
  WHERE email IS NOT NULL;
CREATE INDEX idx_contacts_user_id ON contacts(user_id);
CREATE INDEX idx_content_bank_evergreen
  ON content_bank_items(site_id, evergreen, last_posted_at)
  WHERE evergreen = 1;
CREATE INDEX idx_content_bank_queue
  ON content_bank_items(site_id, status, queue_position)
  WHERE status IN ('queued', 'scheduled');
CREATE INDEX idx_content_bank_site_status
  ON content_bank_items(site_id, status);
CREATE INDEX idx_content_bank_source
  ON content_bank_items(site_id, source_type);
CREATE INDEX idx_email_provider_settings_active
  ON email_provider_settings(user_id, is_active);
CREATE INDEX idx_email_send_audit_message
  ON email_send_audit(mailbox_message_id);
CREATE INDEX idx_email_send_audit_user_created
  ON email_send_audit(user_id, created_at DESC);
CREATE INDEX idx_financial_categories_user_entry_type
  ON financial_categories(user_id, entry_type, sort_order);
CREATE INDEX idx_financial_entries_category
  ON financial_entries(category_id);
CREATE INDEX idx_financial_entries_source
  ON financial_entries(user_id, source);
CREATE INDEX idx_financial_entries_source_email
  ON financial_entries(source_email_id);
CREATE INDEX idx_financial_entries_status
  ON financial_entries(user_id, status);
CREATE INDEX idx_financial_entries_stripe_charge
  ON financial_entries(stripe_charge_id);
CREATE INDEX idx_financial_entries_user_entry_type_date
  ON financial_entries(user_id, entry_type, date DESC);
CREATE UNIQUE INDEX idx_financial_entries_user_source_ref
  ON financial_entries(user_id, source_ref)
  WHERE source_ref IS NOT NULL;
CREATE INDEX idx_journal_entries_user_date
  ON journal_entries(user_id, entry_date);
CREATE INDEX idx_journal_entries_user_updated
  ON journal_entries(user_id, updated_at);
CREATE INDEX idx_local_executor_audit_user_created
  ON local_executor_audit_events(user_id, created_at);
CREATE INDEX idx_local_executor_pairings_user_last_seen
  ON local_executor_pairings(user_id, last_seen_at);
CREATE INDEX idx_local_executor_policies_user_status
  ON local_executor_project_policies(user_id, status, updated_at);
CREATE INDEX idx_local_executor_run_events_run_created
  ON local_executor_run_events(run_id, created_at);
CREATE INDEX idx_local_executor_runs_policy_status
  ON local_executor_runs(project_policy_id, status, created_at);
CREATE INDEX idx_local_executor_runs_user_status
  ON local_executor_runs(user_id, status, created_at);
CREATE INDEX idx_mobile_pairings_expires
  ON mobile_pairings(expires_at);
CREATE INDEX idx_mobile_pairings_user_status
  ON mobile_pairings(user_id, status, created_at DESC);
CREATE INDEX idx_mobile_refresh_tokens_expires
  ON mobile_refresh_tokens(expires_at);
CREATE INDEX idx_mobile_refresh_tokens_user_device
  ON mobile_refresh_tokens(user_id, device_id, status);
CREATE INDEX idx_mailbox_messages_folder_created
  ON mailbox_messages(mailbox_id, folder, created_at DESC);
CREATE INDEX idx_mailbox_messages_mailbox_created
  ON mailbox_messages(mailbox_id, created_at DESC);
CREATE INDEX idx_mailbox_messages_provider_message
  ON mailbox_messages(provider_id, provider_message_id);
CREATE INDEX idx_mailbox_messages_status ON mailbox_messages(status);
CREATE INDEX idx_me3_install_claim_states_expires_at
  ON me3_install_claim_states(expires_at);
CREATE INDEX idx_mission_agent_run_events_run_created
  ON mission_agent_run_events(run_id, created_at);
CREATE INDEX idx_mission_agent_runs_user_status
  ON mission_agent_runs(user_id, status, created_at);
CREATE INDEX idx_mission_approvals_user_status
  ON mission_approvals(user_id, status, requested_at);
CREATE INDEX idx_mission_context_sources_user_status
  ON mission_context_sources(user_id, status, source_kind);
CREATE INDEX idx_mission_daemon_allowlist_pairing_status
  ON mission_daemon_allowlist_entries(pairing_id, status);
CREATE INDEX idx_mission_daemon_audit_events_created
  ON mission_daemon_audit_events(created_at);
CREATE INDEX idx_mission_daemon_pairings_user_last_seen
  ON mission_daemon_pairings(user_id, last_seen_at);
CREATE INDEX idx_mission_plugin_activity_user_created
  ON mission_plugin_activity(user_id, created_at);
CREATE INDEX idx_mission_private_memory_scope_status
  ON mission_private_memory(user_id, scope_kind, review_status);
CREATE INDEX idx_mission_projects_user_status
  ON mission_projects(user_id, status);
CREATE INDEX idx_mission_tasks_project_status
  ON mission_tasks(project_id, status);
CREATE INDEX idx_mission_tasks_user_status
  ON mission_tasks(user_id, status, due_at);
CREATE INDEX idx_mission_wheel_snapshots_user_created
  ON mission_wheel_snapshots(user_id, created_at DESC);
CREATE INDEX idx_scheduling_request_audit_request
  ON scheduling_request_audit(request_id, created_at DESC);
CREATE INDEX idx_scheduling_request_votes_request
  ON scheduling_request_votes(request_id, created_at DESC);
CREATE INDEX idx_scheduling_requests_user_status
  ON scheduling_requests(user_id, status, created_at DESC);
CREATE INDEX idx_scheduling_time_types_public_offer
  ON scheduling_time_types(user_id, public_booking_offer_id)
  WHERE public_booking_offer_id IS NOT NULL;
CREATE INDEX idx_scheduling_time_types_user_id
  ON scheduling_time_types(user_id, status);
CREATE INDEX idx_site_files_site_path
  ON site_files(site_id, path);
CREATE INDEX idx_sites_user_id ON sites(user_id);
CREATE INDEX idx_sites_username ON sites(username);
CREATE INDEX idx_social_accounts_site_platform
  ON social_accounts(site_id, platform);
CREATE INDEX idx_social_accounts_user_site
  ON social_accounts(user_id, site_id);
CREATE INDEX idx_social_oauth_states_state_platform
  ON social_oauth_states(state, platform);
CREATE INDEX idx_social_packages_site_created
  ON social_packages(site_id, created_at DESC);
CREATE INDEX idx_social_publication_events_publication
  ON social_publication_events(publication_id, created_at ASC);
CREATE INDEX idx_social_publication_events_variant
  ON social_publication_events(variant_id, created_at ASC);
CREATE INDEX idx_social_publications_status
  ON social_publications(status, created_at DESC);
CREATE INDEX idx_social_publications_variant
  ON social_publications(variant_id, created_at DESC);
CREATE INDEX idx_social_variants_package
  ON social_variants(package_id);
CREATE INDEX idx_social_variants_schedule
  ON social_variants(approval_status, scheduled_for);
CREATE INDEX idx_subscribers_email
  ON subscribers(email);
CREATE UNIQUE INDEX idx_subscribers_site_email
  ON subscribers(site_id, email);
CREATE INDEX idx_subscribers_site_id
  ON subscribers(site_id);
CREATE INDEX idx_user_calendar_events_user_window
  ON user_calendar_events(user_id, starts_at, ends_at);
CREATE INDEX idx_user_reminders_user_remind_at
  ON user_reminders(user_id, remind_at);
