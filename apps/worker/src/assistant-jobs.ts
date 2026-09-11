import {
  ASSISTANT_JOB_CAPABILITIES,
  ASSISTANT_JOB_STARTER_RECIPES,
  DEFAULT_DAILY_BRIEFING_MESSAGE_TEMPLATE,
  attachAssistantJobContextToRunResult,
  createAssistantJobContext,
  createAssistantJobDraftFromRecipe,
  getAssistantJobCapability,
  getAssistantJobStarterRecipe,
  matchInboxWatchMessage,
  normalizeInboxWatchRules,
  validateAssistantJobDraft,
  type AssistantJobAction,
  type AssistantJobApprovalMode,
  type AssistantCapability,
  type AssistantJobDraft,
  type AssistantJobRule,
  type AssistantJobDraftValidation,
  type AssistantJobStarterRecipe,
  type AssistantJobContextResult,
  type InboxWatchRuleConfig,
} from "@me3-core/assistant-jobs";
import type {
  Me3AgentContextCalendarEvent,
  Me3AgentContextPrivateMemory,
  Me3AgentContextProject,
  Me3AgentContextRecentMessage,
  Me3AgentContextSource,
  Me3AgentContextTask,
} from "@me3/knowledge";
import type {
  AssistantJobEventQueueMessage,
  AssistantJobIngressEventQueueMessage,
  AssistantJobScheduledRunQueueMessage,
  Env,
} from "./types";
import {
  LocalExecutorInputError,
  createLocalExecutorRunFromAssistantJobAction,
  isLocalExecutorSetupReady,
} from "./local-executor";
import { normalizeTimeZone } from "./calendar";
import { isCorePluginEnabled } from "./plugins";
import { decodeMimeHeaderValue } from "../../../shared/email-headers";
import { ensureDefaultCategories, getOrCreateCategoryByName } from "./accounts";
import { getDefaultCommerceCurrency } from "./commerce-settings";
import {
  notifyDailyBriefingReady,
  type DailyBriefingPushSummary,
} from "./push-notifications";

export class AssistantJobsInputError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

type AssistantJobStatus = "draft" | "active" | "paused" | "needs_setup" | "failing" | "archived";
type AssistantJobRunStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "blocked";
type AssistantJobIngressSourceKind = "core" | "mission_control" | "plugin" | "webhook";
type AssistantJobIngressStatus =
  | "received"
  | "matched"
  | "queued"
  | "processed"
  | "ignored"
  | "failed";

type AssistantJobRow = {
  id: string;
  user_id: string;
  recipe_id: string | null;
  name: string;
  purpose: string;
  status: AssistantJobStatus;
  current_version_id: string | null;
  project_id: string | null;
  destination_json: string;
  trigger_summary: string;
  next_run_at: string | null;
  last_run_at: string | null;
  last_run_status: AssistantJobRunStatus | null;
  failure_count: number;
  setup_state_json: string;
  created_by: "owner" | "assistant";
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type AssistantJobVersionRow = {
  id: string;
  job_id: string;
  user_id: string;
  version_number: number;
  name: string;
  purpose: string;
  trigger_json: string;
  scope_json: string;
  rules_json: string;
  actions_json: string;
  approval_policy_json: string;
  destination_json: string;
  capability_ids_json: string;
  permission_summary_json: string;
  recommended_skill_ids_json: string;
  required_skill_ids_json: string;
  validation_status: AssistantJobDraftValidation["status"];
  validation_errors_json: string;
  created_at: string;
};

type AssistantJobRunRow = {
  id: string;
  user_id: string;
  job_id: string;
  job_version_id: string;
  trigger_kind: "manual" | "schedule" | "event" | "heartbeat_retry";
  trigger_ref: string | null;
  status: AssistantJobRunStatus;
  started_at: string | null;
  finished_at: string | null;
  output_preview: string | null;
  error_code: string | null;
  error_message: string | null;
  retry_count: number;
  next_retry_at: string | null;
  created_at: string;
  updated_at: string;
};

const DEFAULT_SCHEDULE_DISPATCH_LIMIT = 50;
const HIDDEN_ASSISTANT_JOB_RECIPE_IDS = ["local-coding-task", "email-triage"] as const;
const HIDDEN_ASSISTANT_JOB_RECIPE_PLACEHOLDERS = HIDDEN_ASSISTANT_JOB_RECIPE_IDS.map(
  () => "?",
).join(", ");
const DEFAULT_ASSISTANT_JOB_RECIPE_IDS = [
  "daily-briefing",
  "invoice-receipt-triage",
  "booking-reminder",
] as const;

function visibleAssistantJobRecipeSql(column: string) {
  return `COALESCE(${column}, '') NOT IN (${HIDDEN_ASSISTANT_JOB_RECIPE_PLACEHOLDERS})`;
}

function isHiddenAssistantJobRecipeId(recipeId: string | null | undefined) {
  return HIDDEN_ASSISTANT_JOB_RECIPE_IDS.some((hiddenRecipeId) => hiddenRecipeId === recipeId);
}

function isDefaultAssistantJobRecipeId(recipeId: string | null | undefined) {
  return DEFAULT_ASSISTANT_JOB_RECIPE_IDS.some((defaultRecipeId) => defaultRecipeId === recipeId);
}

type AssistantJobActionResultStatus =
  | "skipped"
  | "blocked"
  | "pending_approval"
  | "succeeded"
  | "failed";

type AssistantJobActionResultRow = {
  id: string;
  run_id: string;
  action_id: string;
  capability_id: string;
  idempotency_key: string;
  status: AssistantJobActionResultStatus;
  approval_id: string | null;
  artifact_id: string | null;
  external_ref: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type SerializedActionResult = ReturnType<typeof serializeActionResult>;

type AgentChannelConnectionRow = {
  id: string;
  user_id: string;
  channel: "telegram" | "sandbox" | "soulink";
  status: "pending" | "active" | "disconnected";
  setup_token: string;
  provider_connection_id: string | null;
  provider_thread_id: string | null;
  last_outbound_at: string | null;
};

type AgentChannelEventRow = {
  id: string;
  connection_id: string;
  provider_event_id: string | null;
  status: string;
};

type MailboxSetupRow = {
  id: string;
};

type MailboxMessageRow = {
  id: string;
  mailbox_id: string;
  thread_key: string | null;
  provider_id: string | null;
  provider_message_id: string | null;
  from_address: string | null;
  to_address: string | null;
  subject: string | null;
  text_body: string | null;
  raw_headers_json?: string | null;
  metadata_json?: string | null;
  agent_summary: string | null;
  agent_labels_json: string | null;
  received_at: string | null;
  created_at: string;
};

type InboxWatchActionCounts = {
  drafted: number;
  tasks: number;
  notified: number;
  skippedNotifications: number;
  draftIds: string[];
  taskIds: string[];
  notificationIds: string[];
};

type EmailTriageItem = {
  id: string;
  threadKey: string | null;
  from: string;
  subject: string;
  summary: string;
  labels: string[];
  matchedRuleIds: string[];
  receivedAt: string | null;
};

type EmailTriageResult = {
  messageCount: number;
  threadCount: number;
  matchedCount: number;
  ruleMatchCounts: Record<string, number>;
  needsReplyCount: number;
  importantCount: number;
  items: EmailTriageItem[];
};

type InvoiceExtraction = {
  messageId: string;
  entryType: "income" | "expense";
  description: string;
  amountCents: number;
  currency: string;
  date: string;
  status: "paid" | "pending" | "overdue" | "cancelled" | "needs_review";
  categoryHint: string | null;
  confidence: "high" | "medium" | "low";
  sourceRef: string;
};

type InvoiceTriageResult = {
  scanned: number;
  candidates: number;
  filed: number;
  reviewed: number;
  skipped: number;
  entries: InvoiceExtraction[];
};

type PluginInstallationSetupRow = {
  plugin_id: string;
  enabled: number;
  status: "installed" | "setup_required" | "disabled";
};

type OwnerNotificationResult = {
  ok?: unknown;
  messageId?: unknown;
  eventId?: unknown;
  error?: unknown;
};

type DailyBriefingReminderRow = {
  id: string;
  title: string;
  notes: string | null;
  remind_at: string;
  timezone: string | null;
  status: string;
};

type WeeklyReviewReminderRow = {
  id: string;
  title: string;
  remind_at: string | null;
  status: string;
};

type WeeklyReviewMemoryRow = {
  id: string;
  title: string | null;
  body: string;
};

type DailyBriefingRenderContext = {
  ownerName: string;
  dateKey: string;
  dateLabel: string;
  calendarSummary: string;
  calendarEvents: string;
  calendarReminders: string;
  missionTasks: string;
  sections: DailyBriefingSection[];
  notification: DailyBriefingPushSummary;
};

type DailyBriefingTask = Me3AgentContextTask & {
  description: string;
};

type DailyBriefingSection = {
  kind: "calendar" | "reminders" | "tasks";
  title: string;
  summary: string;
  items: Array<{
    id: string;
    title: string;
    detail: string | null;
  }>;
};

type OwnerProfileContextRow = {
  id: string;
  name: string | null;
  username: string | null;
  bio: string | null;
  timezone: string | null;
};

type MissionProjectContextRow = {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  status: string;
  source_ref: string | null;
  updated_at: string;
};

type MissionTaskContextRow = {
  id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  status: string;
  due_at: string | null;
  scheduled_for: string | null;
  source_ref: string | null;
  updated_at: string;
};

type MissionMemoryContextRow = {
  id: string;
  memory_kind: string;
  scope_kind: string;
  scope_id: string | null;
  title: string | null;
  body: string;
  confidence: number | null;
  source_ref: string | null;
  updated_at: string;
};

type CalendarEventContextRow = {
  id: string;
  title: string;
  notes: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string | null;
  created_at: string;
  updated_at: string | null;
};

type DailyBriefingBookingRow = {
  id: string;
  guest_name: string;
  starts_at: string;
  ends_at: string;
  timezone: string | null;
  created_at: string;
  updated_at: string | null;
};

type AssistantMessageContextRow = {
  id?: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  created_at?: string | null;
};

type AssistantJobIngressEventRow = {
  id: string;
  user_id: string;
  source_kind: AssistantJobIngressSourceKind;
  source_id: string;
  source_event_id: string;
  event_type: string;
  idempotency_key: string;
  payload_json: string;
  raw_payload_ref: string | null;
  status: AssistantJobIngressStatus;
  created_at: string;
  updated_at: string;
};

type AssistantJobMatchCandidateRow = AssistantJobRow & {
  version_id: string;
  version_number: number;
  version_name: string;
  version_purpose: string;
  candidate_trigger_json: string;
  candidate_scope_json: string;
  candidate_rules_json: string;
  candidate_actions_json: string;
  candidate_approval_policy_json: string;
  candidate_destination_json: string;
  candidate_capability_ids_json: string;
  candidate_permission_summary_json: string;
  candidate_recommended_skill_ids_json: string;
  candidate_required_skill_ids_json: string;
  candidate_validation_status: AssistantJobDraftValidation["status"];
  candidate_validation_errors_json: string;
  version_created_at: string;
};

type CreateAssistantJobBody = {
  recipeId?: unknown;
  draft?: unknown;
  name?: unknown;
  purpose?: unknown;
  status?: unknown;
  projectId?: unknown;
};

type UpdateAssistantJobBody = {
  name?: unknown;
  purpose?: unknown;
  status?: unknown;
  projectId?: unknown;
  schedule?: unknown;
  dailyBriefingMessageTemplate?: unknown;
  inboxWatchRules?: unknown;
};

type AssistantJobSchedulePatch = {
  cadence?: unknown;
  localTime?: unknown;
  timezone?: unknown;
  dayOfWeek?: unknown;
  dayOfMonth?: unknown;
};

type CreateAssistantJobIngressEventBody = {
  sourceKind?: unknown;
  sourceId?: unknown;
  sourceEventId?: unknown;
  eventType?: unknown;
  idempotencyKey?: unknown;
  payload?: unknown;
  rawPayloadRef?: unknown;
};

type UpdateAssistantJobIngressEventBody = {
  status?: unknown;
  errorMessage?: unknown;
};

export type AssistantJobBuilderAction =
  | {
      kind: "job_draft";
      draftId: string;
      draft: AssistantJobDraft;
      explanation: {
        summary: string;
        reads: string[];
        writes: string[];
        approvalRequired: string[];
        setupWarnings: string[];
      };
      validation: AssistantJobDraftValidation;
      availableActions: Array<"save" | "save_and_activate">;
    }
  | {
      kind: "job_saved";
      jobId: string;
      summary: string;
      status: AssistantJobStatus;
      availableActions: Array<"activate" | "run_now" | "open_job">;
    }
  | {
      kind: "job_unsupported";
      summary: string;
      availableActions: [];
    };

export async function createAssistantJobBuilderAction(
  env: Env,
  userId: string,
  messageText: string,
): Promise<AssistantJobBuilderAction | null> {
  const request = parseAssistantJobBuilderRequest(messageText);
  if (request === null) return null;

  if (isBookingReminderBuilderRequest(request)) {
    return {
      kind: "job_unsupported",
      summary:
        "Booking Reminders are already on for confirmed site bookings. They send email reminders to you and your guest 24 hours and 2 hours before a booking; Telegram/Soulink owner reminders are added when connected. Use Jobs to pause or resume them.",
      availableActions: [],
    };
  }

  const recipe = selectAssistantJobBuilderRecipe(request);
  if (!recipe) {
    return {
      kind: "job_unsupported",
      summary:
        "I can set up starter jobs for Daily Briefing, Weekly Review, or Invoice and Receipt Triage. I cannot create that custom job yet.",
      availableActions: [],
    };
  }

  const draft = createAssistantJobDraftFromRecipe(recipe);
  const validation = await validateAssistantJobDraftForUser(env, userId, draft);
  return assistantJobDraftBuilderAction(
    draft,
    validation,
    `I matched this to the ${recipe.name} starter job.`,
  );
}

function assistantJobDraftBuilderAction(
  draft: AssistantJobDraft,
  validation: AssistantJobDraftValidation,
  summary: string,
): AssistantJobBuilderAction {
  return {
    kind: "job_draft",
    draftId: crypto.randomUUID(),
    draft,
    explanation: {
      summary,
      reads: validation.permissionSummary.reads,
      writes: validation.permissionSummary.writes,
      approvalRequired: validation.permissionSummary.approvalRequired,
      setupWarnings: createAssistantJobBuilderSetupWarnings(validation),
    },
    validation,
    availableActions: assistantJobBuilderAvailableActions(validation),
  };
}

function assistantJobBuilderAvailableActions(
  validation: AssistantJobDraftValidation,
): Array<"save" | "save_and_activate"> {
  if (validation.status === "invalid") return [];
  return validation.status === "valid" ? ["save", "save_and_activate"] : ["save"];
}

function parseAssistantJobBuilderRequest(messageText: string) {
  const trimmed = messageText.trim();
  if (!trimmed.toLowerCase().startsWith("/job")) return null;
  return trimmed.replace(/^\/job\b/i, "").trim();
}

function isBookingReminderBuilderRequest(request: string) {
  return /\b(bookings?|meeting reminders?|site bookings?)\b/i.test(request);
}

function selectAssistantJobBuilderRecipe(request: string) {
  const normalized = request.toLowerCase();
  const candidates = [
    {
      recipeId: "invoice-receipt-triage",
      keywords: ["invoice", "receipt", "receipts", "expense", "expenses", "accounts"],
    },
    {
      recipeId: "email-triage",
      keywords: ["inbox", "email", "emails", "message", "messages", "reply"],
    },
    {
      recipeId: "daily-briefing",
      keywords: ["daily", "morning", "briefing", "today", "every day"],
    },
    {
      recipeId: "weekly-review",
      keywords: ["weekly", "week", "friday", "review", "carry forward"],
    },
  ];

  const matched = candidates.find((candidate) =>
    !isHiddenAssistantJobRecipeId(candidate.recipeId) &&
    candidate.keywords.some((keyword) => normalized.includes(keyword)),
  );

  return matched ? getAssistantJobStarterRecipe(matched.recipeId) : null;
}

function createAssistantJobBuilderSetupWarnings(
  validation: AssistantJobDraftValidation,
) {
  const warnings = new Set<string>();
  for (const error of validation.errors) {
    if (error.code === "setup_missing") {
      warnings.add(
        formatAssistantJobSetupRequirement(setupRequirementFromValidationError(error)),
      );
      continue;
    }
    if (error.code === "skill_missing") {
      warnings.add("A recommended skill is not available yet.");
      continue;
    }
    if (error.blocking) warnings.add("This draft needs adjustment before it can run.");
  }
  return Array.from(warnings);
}

function setupRequirementFromValidationError(error: { message?: string }) {
  return (
    error.message?.match(/^Missing setup requirement:\s*([^.\s]+)\.?$/i)?.[1] ||
    ""
  );
}

function formatAssistantJobSetupRequirement(requirement: string) {
  const labels: Record<string, string> = {
    owner_notifications: "Connect an owner notification channel before activation.",
    email: "Connect email before activation.",
    calendar: "Enable calendar setup before activation.",
    local_executor: "Connect the local executor before activation.",
    accounts: "Enable Accounts before activation.",
  };
  return labels[requirement] || "Additional setup is required before activation.";
}

export async function listAssistantJobRecipes(env: Env, userId: string) {
  const readySetupRequirements = await getAssistantJobReadySetupRequirements(env, userId);
  return {
    recipes: ASSISTANT_JOB_STARTER_RECIPES.filter(
      (recipe) => !isHiddenAssistantJobRecipeId(recipe.id),
    ).map((recipe) => {
      const serialized = serializeRecipe(recipe);
      const validation = validateAssistantJobDraft(createAssistantJobDraftFromRecipe(recipe), {
        readySetupRequirements,
      });
      return {
        ...serialized,
        state:
          validation.status === "needs_setup"
            ? "needs_setup"
            : "ready",
      };
    }),
    capabilities: ASSISTANT_JOB_CAPABILITIES,
  };
}

export async function ensureDefaultAssistantJobs(env: Env, userId: string) {
  for (const recipeId of DEFAULT_ASSISTANT_JOB_RECIPE_IDS) {
    const recipe = getAssistantJobStarterRecipe(recipeId);
    if (!recipe || await findExistingAssistantJobForRecipe(env, userId, recipeId)) continue;
    await createDefaultAssistantJob(env, userId, recipe);
  }
}

async function createDefaultAssistantJob(
  env: Env,
  userId: string,
  recipe: AssistantJobStarterRecipe,
) {
  const draft = await withComputedScheduleNextRunAt(
    env,
    userId,
    createAssistantJobDraftFromRecipe(recipe),
  );
  const validation = await validateAssistantJobDraftForUser(env, userId, draft);
  const jobId = `default:${userId}:${recipe.id}`;
  const versionId = `${jobId}:v1`;
  const now = new Date().toISOString();
  const setupState = { validationStatus: validation.status, errors: validation.errors };

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO assistant_jobs
       (id, user_id, recipe_id, name, purpose, status, current_version_id, project_id,
        destination_json, trigger_summary, next_run_at, setup_state_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'assistant', ?, ?)`,
    ).bind(
      jobId,
      userId,
      draft.recipeId,
      draft.name,
      draft.purpose,
      resolveInitialStatus(validation, null),
      versionId,
      draft.projectId,
      stringifyJson(draft.destination),
      summarizeTrigger(draft.trigger),
      draft.trigger.kind === "schedule" ? draft.trigger.nextRunAt : null,
      stringifyJson(setupState),
      now,
      now,
    ),
    buildInsertVersionStatement(env, {
      versionId,
      jobId,
      userId,
      versionNumber: 1,
      draft,
      validation,
      createdAt: now,
    }),
  ]);
}

async function getAssistantJobReadySetupRequirements(env: Env, userId: string) {
  const ready = new Set<string>();
  const [ownerConnection, emailReady, calendarReady, localExecutorReady, accountsReady] = await Promise.all([
    getActiveOwnerNotificationConnection(env, userId),
    isEmailSetupReady(env, userId),
    isCalendarSetupReady(env),
    isLocalExecutorSetupReady(env, userId),
    isAccountsSetupReady(env),
  ]);
  if (ownerConnection) ready.add("owner_notifications");
  if (emailReady) ready.add("email");
  if (calendarReady) ready.add("calendar");
  if (localExecutorReady) ready.add("local_executor");
  if (accountsReady) ready.add("accounts");
  return Array.from(ready);
}

async function isEmailSetupReady(env: Env, userId: string) {
  try {
    const row = await env.DB.prepare(
      `SELECT id
       FROM mailbox_aliases
       WHERE user_id = ? AND status = 'active'
       LIMIT 1`,
    )
      .bind(userId)
      .first<MailboxSetupRow>();
    return Boolean(row);
  } catch {
    return false;
  }
}

async function isCalendarSetupReady(env: Env) {
  try {
    const row = await env.DB.prepare(
      `SELECT plugin_id, enabled, status
       FROM plugin_installations
       WHERE plugin_id = 'me3.calendar'
       LIMIT 1`,
    ).first<PluginInstallationSetupRow>();
    return Boolean(row && row.enabled !== 0 && row.status === "installed");
  } catch {
    return false;
  }
}

async function isAccountsSetupReady(env: Env) {
  return isCorePluginEnabled(env, "me3.accounts").catch(() => false);
}

async function validateAssistantJobDraftForUser(
  env: Env,
  userId: string,
  draft: AssistantJobDraft,
) {
  return validateAssistantJobDraft(draft, {
    readySetupRequirements: await getAssistantJobReadySetupRequirements(env, userId),
  });
}

export async function listAssistantJobs(env: Env, userId: string, status?: string | null) {
  const normalizedStatus = normalizeJobStatus(status);
  const query = normalizedStatus
    ? `SELECT * FROM assistant_jobs
       WHERE user_id = ? AND status = ? AND ${visibleAssistantJobRecipeSql("recipe_id")}
       ORDER BY updated_at DESC, created_at DESC`
    : `SELECT * FROM assistant_jobs
       WHERE user_id = ? AND status != 'archived' AND ${visibleAssistantJobRecipeSql("recipe_id")}
       ORDER BY updated_at DESC, created_at DESC`;
  const stmt = normalizedStatus
    ? env.DB.prepare(query).bind(userId, normalizedStatus, ...HIDDEN_ASSISTANT_JOB_RECIPE_IDS)
    : env.DB.prepare(query).bind(userId, ...HIDDEN_ASSISTANT_JOB_RECIPE_IDS);
  const rows = await stmt.all<AssistantJobRow>();
  const reconciledRows = await Promise.all(
    rows.results.map((row) => reconcileAssistantJobReadiness(env, userId, row)),
  );
  return { jobs: reconciledRows.map(serializeJob) };
}

export async function listAssistantJobIngressEvents(
  env: Env,
  userId: string,
  status?: string | null,
) {
  const normalizedStatus = normalizeIngressStatus(status);
  const query = normalizedStatus
    ? `SELECT * FROM assistant_job_ingress_events
       WHERE user_id = ? AND status = ?
       ORDER BY created_at DESC
       LIMIT 100`
    : `SELECT * FROM assistant_job_ingress_events
       WHERE user_id = ?
       ORDER BY created_at DESC
       LIMIT 100`;
  const stmt = normalizedStatus
    ? env.DB.prepare(query).bind(userId, normalizedStatus)
    : env.DB.prepare(query).bind(userId);
  const rows = await stmt.all<AssistantJobIngressEventRow>();
  return { events: rows.results.map(serializeIngressEvent) };
}

export async function recordAssistantJobIngressEvent(
  env: Env,
  userId: string,
  body: CreateAssistantJobIngressEventBody,
) {
  const event = normalizeIngressEventBody(body);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO assistant_job_ingress_events
     (id, user_id, source_kind, source_id, source_event_id, event_type,
      idempotency_key, payload_json, raw_payload_ref, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)`,
  )
    .bind(
      id,
      userId,
      event.sourceKind,
      event.sourceId,
      event.sourceEventId,
      event.eventType,
      event.idempotencyKey,
      stringifyJson(event.payload),
      event.rawPayloadRef,
      now,
      now,
    )
    .run();

  let row = await getAssistantJobIngressEventByIdempotencyKey(
    env,
    userId,
    event.idempotencyKey,
  );
  if (!row) throw new AssistantJobsInputError("Ingress event was not recorded", 409);
  const duplicate = row.id !== id;
  let queued = false;
  if (!duplicate) {
    queued = await enqueueAssistantJobIngressEvent(env, row);
    if (!queued) {
      const processed = await processAssistantJobIngressQueueMessage(env, {
        eventId: row.id,
        userId: row.user_id,
      });
      row = await requireAssistantJobIngressEvent(env, userId, processed.event.id);
    }
  }

  return {
    event: serializeIngressEvent(row),
    duplicate,
    queued,
  };
}

export async function processAssistantJobIngressQueueMessage(
  env: Env,
  message: AssistantJobIngressEventQueueMessage,
) {
  const eventId = normalizeOptionalText(message.eventId);
  const userId = normalizeOptionalText(message.userId);
  if (!eventId || !userId) {
    throw new AssistantJobsInputError("Assistant Job queue message is missing eventId or userId");
  }

  const event = await requireAssistantJobIngressEvent(env, userId, eventId);
  if (event.status === "matched" || event.status === "ignored" || event.status === "processed") {
    return { event: serializeIngressEvent(event), outcome: "already_processed", runCount: 0 };
  }

  const existingRuns = await listAssistantJobRunsForTrigger(env, userId, "event", event.id);
  if (existingRuns.length > 0) {
    const matched = await setAssistantJobIngressEventStatus(env, userId, eventId, "matched", {
      matchedAt: new Date().toISOString(),
      matchedRunCount: existingRuns.length,
      matchedJobIds: existingRuns.map((run) => run.job_id),
    });
    const executions = [];
    for (const run of existingRuns) {
      if (run.status === "queued") {
        executions.push(await executeAssistantJobRun(env, userId, run.id));
      }
    }
    return {
      event: serializeIngressEvent(matched),
      outcome: "already_matched",
      runCount: existingRuns.length,
      executions,
    };
  }

  const candidates = await listEventTriggerCandidates(env, userId);
  const matchedCandidates = candidates.filter((candidate) =>
    assistantJobCandidateMatchesEvent(candidate, event),
  );

  if (matchedCandidates.length === 0) {
    const ignored = await setAssistantJobIngressEventStatus(env, userId, eventId, "ignored", {
      ignoredAt: new Date().toISOString(),
      queueOutcome: "no_matching_jobs",
    });
    return { event: serializeIngressEvent(ignored), outcome: "ignored", runCount: 0 };
  }

  const runs = [];
  for (const candidate of matchedCandidates) {
    runs.push(await createAssistantJobRunForEvent(env, candidate, event));
  }

  const matched = await setAssistantJobIngressEventStatus(env, userId, eventId, "matched", {
    matchedAt: new Date().toISOString(),
    matchedRunCount: runs.length,
    matchedJobIds: runs.map((run) => run.jobId),
  });
  const executions = [];
  for (const run of runs) {
    if (run.status === "queued") {
      executions.push(await executeAssistantJobRun(env, userId, run.id));
    }
  }
  return {
    event: serializeIngressEvent(matched),
    outcome: "matched",
    runCount: runs.length,
    runs,
    executions,
  };
}

export async function markAssistantJobIngressQueueMessageFailed(
  env: Env,
  message: AssistantJobIngressEventQueueMessage,
  error: unknown,
) {
  const eventId = normalizeOptionalText(message.eventId);
  const userId = normalizeOptionalText(message.userId);
  if (!eventId || !userId) return { event: null, outcome: "invalid_message" };

  const failed = await setAssistantJobIngressEventStatus(env, userId, eventId, "failed", {
    queueFailedAt: new Date().toISOString(),
    errorMessage: getErrorMessage(error),
  });
  await appendAssistantJobMissionActivity(env, userId, {
    activityType: "assistant_job_event_dlq",
    title: "Assistant Job event needs review",
    summary: getErrorMessage(error),
    status: "failed",
    relatedId: eventId,
    metadata: {
      eventId,
      queueOutcome: "dead_lettered",
    },
  });
  return { event: serializeIngressEvent(failed), outcome: "failed" };
}

export async function processAssistantJobQueueMessage(
  env: Env,
  message: AssistantJobEventQueueMessage,
) {
  if (isAssistantJobScheduledRunQueueMessage(message)) {
    return processAssistantJobScheduledRunQueueMessage(env, message);
  }
  return processAssistantJobIngressQueueMessage(env, message);
}

export async function markAssistantJobQueueMessageFailed(
  env: Env,
  message: AssistantJobEventQueueMessage,
  error: unknown,
) {
  if (isAssistantJobScheduledRunQueueMessage(message)) {
    return markAssistantJobScheduledRunQueueMessageFailed(env, message, error);
  }
  return markAssistantJobIngressQueueMessageFailed(env, message, error);
}

export async function processAssistantJobScheduledRunQueueMessage(
  env: Env,
  message: AssistantJobScheduledRunQueueMessage,
) {
  const runId = normalizeOptionalText(message.runId);
  const userId = normalizeOptionalText(message.userId);
  if (!runId || !userId) {
    throw new AssistantJobsInputError("Assistant Job queue message is missing runId or userId");
  }
  return executeAssistantJobRun(env, userId, runId);
}

export async function markAssistantJobScheduledRunQueueMessageFailed(
  env: Env,
  message: AssistantJobScheduledRunQueueMessage,
  error: unknown,
) {
  const runId = normalizeOptionalText(message.runId);
  const userId = normalizeOptionalText(message.userId);
  if (!runId || !userId) return { run: null, outcome: "invalid_message" };

  await setAssistantJobRunStatus(env, userId, runId, {
    status: "failed",
    finishedAt: new Date().toISOString(),
    errorCode: "queue_dead_lettered",
    errorMessage: getErrorMessage(error),
    eventType: "failed",
    message: "Scheduled Assistant Job run reached the dead-letter queue",
    payload: {
      queueOutcome: "dead_lettered",
      errorMessage: getErrorMessage(error),
    },
  });

  const run = await requireAssistantJobRun(env, userId, runId);
  await appendAssistantJobMissionActivity(env, userId, {
    activityType: "assistant_job_schedule_dlq",
    title: "Scheduled Assistant Job needs review",
    summary: getErrorMessage(error),
    status: "failed",
    relatedId: runId,
    metadata: {
      runId,
      jobId: run.job_id,
      queueOutcome: "dead_lettered",
    },
  });
  return { run: serializeRun(run), outcome: "failed" };
}

export async function dispatchDueScheduledAssistantJobs(
  env: Env,
  now = new Date(),
  options: { limit?: number } = {},
) {
  const checkedAt = now.toISOString();
  const limit = Math.max(
    1,
    Math.min(options.limit ?? DEFAULT_SCHEDULE_DISPATCH_LIMIT, DEFAULT_SCHEDULE_DISPATCH_LIMIT),
  );
  const rows = await env.DB.prepare(
    `SELECT * FROM assistant_jobs
     WHERE status = 'active'
       AND ${visibleAssistantJobRecipeSql("recipe_id")}
       AND current_version_id IS NOT NULL
       AND next_run_at IS NOT NULL
       AND next_run_at <= ?
     ORDER BY next_run_at ASC
     LIMIT ?`,
  )
    .bind(...HIDDEN_ASSISTANT_JOB_RECIPE_IDS, checkedAt, limit)
    .all<AssistantJobRow>();

  const jobs = [];
  for (const job of rows.results) {
    jobs.push(await dispatchDueScheduledAssistantJob(env, job, now));
  }

  return {
    checkedAt,
    jobCount: jobs.length,
    jobs,
  };
}

export async function updateAssistantJobIngressEvent(
  env: Env,
  userId: string,
  eventId: string,
  body: UpdateAssistantJobIngressEventBody,
) {
  const existing = await requireAssistantJobIngressEvent(env, userId, eventId);
  const status = normalizeIngressStatus(body.status);
  if (!status) throw new AssistantJobsInputError("Valid ingress event status is required");
  const errorMessage = normalizeOptionalText(body.errorMessage);
  await setAssistantJobIngressEventStatus(
    env,
    userId,
    eventId,
    status,
    errorMessage ? { errorMessage } : undefined,
    existing,
  );

  return {
    event: serializeIngressEvent(await requireAssistantJobIngressEvent(env, userId, eventId)),
  };
}

export async function getAssistantJob(env: Env, userId: string, jobId: string) {
  const job = await reconcileAssistantJobReadiness(
    env,
    userId,
    await requireAssistantJob(env, userId, jobId),
  );
  const version = job.current_version_id
    ? await getAssistantJobVersion(env, userId, job.current_version_id)
    : null;
  const runs = await env.DB.prepare(
    `SELECT * FROM assistant_job_runs
     WHERE user_id = ? AND job_id = ?
     ORDER BY created_at DESC
     LIMIT 10`,
  )
    .bind(userId, jobId)
    .all<AssistantJobRunRow>();
  const serializedRuns = await Promise.all(
    runs.results.map(async (run) => ({
      ...serializeRun(run),
      actionResults: await listAssistantJobActionResults(env, run.id),
    })),
  );
  return {
    job: serializeJob(job),
    version,
    runs: serializedRuns,
    latestReviewTask:
      job.recipe_id === "weekly-review"
        ? await getLatestWeeklyReviewTaskSummary(env, userId, job.id)
        : null,
  };
}

async function getLatestWeeklyReviewTaskSummary(env: Env, userId: string, jobId: string) {
  const row = await env.DB.prepare(
    `SELECT id, project_id, title, status, source_ref, updated_at
     FROM mission_tasks
     WHERE user_id = ?
       AND archived_at IS NULL
       AND instr(COALESCE(source_ref, ''), 'weekly-review:') = 1
       AND instr(metadata_json, ?) > 0
     ORDER BY updated_at DESC
     LIMIT 1`,
  )
    .bind(userId, `"assistantJobId":"${jobId}"`)
    .first<{
      id: string;
      project_id: string | null;
      title: string;
      status: string;
      source_ref: string | null;
      updated_at: string;
    }>();
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    title: row.title,
    status: row.status,
    sourceRef: row.source_ref,
    updatedAt: row.updated_at,
  };
}

async function reconcileAssistantJobReadiness(
  env: Env,
  userId: string,
  row: AssistantJobRow,
): Promise<AssistantJobRow> {
  if ((row.status !== "active" && row.status !== "needs_setup") || !row.current_version_id) {
    return row;
  }

  const version = await getAssistantJobVersion(env, userId, row.current_version_id);
  if (!version) return row;

  const draft = normalizeAssistantJobDraft({
    draft: {
      name: version.name,
      purpose: version.purpose,
      recipeId: row.recipe_id,
      trigger: version.trigger,
      scope: version.scope,
      rules: version.rules,
      actions: version.actions,
      approvalPolicy: version.approvalPolicy,
      destination: version.destination,
      capabilityIds: version.capabilityIds,
      recommendedSkillIds: version.recommendedSkillIds,
      requiredSkillIds: version.requiredSkillIds,
      projectId: row.project_id,
    },
  });
  const validation = await validateAssistantJobDraftForUser(env, userId, draft);
  const nextStatus =
    validation.status === "valid"
      ? "active"
      : validation.status === "needs_setup"
        ? "needs_setup"
        : row.status;
  if (nextStatus === row.status) return row;

  const setupState = { validationStatus: validation.status, errors: validation.errors };
  await env.DB.prepare(
    `UPDATE assistant_jobs
     SET status = ?, setup_state_json = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND status = ?`,
  )
    .bind(nextStatus, stringifyJson(setupState), new Date().toISOString(), row.id, userId, row.status)
    .run();

  return (await getAssistantJobRow(env, userId, row.id)) || row;
}

export async function executeAssistantJobRun(env: Env, userId: string, runId: string) {
  const run = await requireAssistantJobRun(env, userId, runId);
  if (run.status === "succeeded" || run.status === "waiting_for_approval") {
    return {
      run: serializeRun(run),
      execution: "already_finished",
      actionResults: await listAssistantJobActionResults(env, run.id),
    };
  }
  if (run.status === "blocked" || run.status === "failed" || run.status === "cancelled") {
    return {
      run: serializeRun(run),
      execution: "not_runnable",
      actionResults: await listAssistantJobActionResults(env, run.id),
    };
  }

  const job = await requireAssistantJob(env, userId, run.job_id);
  const version = await requireAssistantJobVersion(env, userId, run.job_version_id);
  const draft = draftFromVersion(job, version);
  const validation = await validateAssistantJobDraftForUser(env, userId, draft);
  const now = new Date().toISOString();
  const context = await loadAssistantJobRunContext(env, userId, { job, run, draft });

  if (validation.status !== "valid") {
    await setAssistantJobRunStatus(env, userId, run.id, {
      status: "blocked",
      errorCode: "validation_blocked",
      errorMessage: validation.errors[0]?.message || "Job is not ready to run",
      finishedAt: now,
      eventType: "blocked",
      message: "Run blocked by validation",
      payload: { validation },
    });
    return {
      run: serializeRun(await requireAssistantJobRun(env, userId, run.id)),
      execution: "blocked",
      validation,
      actionResults: await listAssistantJobActionResults(env, run.id),
    };
  }

  await setAssistantJobRunStatus(env, userId, run.id, {
    status: "running",
    startedAt: run.started_at || now,
    eventType: "running",
    message: "Assistant Job runner started",
    payload: {
      triggerKind: run.trigger_kind,
      triggerRef: run.trigger_ref,
      actionCount: draft.actions.length,
    },
  });
  await upsertAssistantJobMissionAgentRun(env, userId, {
    job,
    run,
    draft,
    status: "running",
    startedAt: run.started_at || now,
    context,
  });

  const actionResults = [];
  for (const action of draft.actions) {
    actionResults.push(
      await executeAssistantJobAction(env, {
        userId,
        job,
        run,
        draft,
        action,
      }),
    );
  }

  const hasPendingApproval = actionResults.some((result) => result.status === "pending_approval");
  const hasFailure = actionResults.some(
    (result) => result.status === "failed" || result.status === "blocked",
  );
  const finalStatus: AssistantJobRunStatus = hasPendingApproval
    ? "waiting_for_approval"
    : hasFailure
      ? "failed"
      : "succeeded";
  const finishedAt = finalStatus === "waiting_for_approval" ? null : new Date().toISOString();
  const outputPreview = await summarizeAssistantJobRunOutput(env, userId, job, draft, actionResults);
  await setAssistantJobRunStatus(env, userId, run.id, {
    status: finalStatus,
    finishedAt,
    outputPreview,
    errorCode: hasFailure ? "action_failed" : null,
    errorMessage: hasFailure ? "One or more Assistant Job actions failed" : null,
    eventType: finalStatus,
    message:
      finalStatus === "waiting_for_approval"
        ? "Assistant Job run is waiting for owner approval"
        : finalStatus === "succeeded"
          ? "Assistant Job run completed"
          : "Assistant Job run failed",
    payload: { actionResults },
  });
  await upsertAssistantJobMissionAgentRun(env, userId, {
    job,
    run: await requireAssistantJobRun(env, userId, run.id),
    draft,
    status: finalStatus === "failed" ? "failed" : finalStatus === "succeeded" ? "succeeded" : "running",
    startedAt: run.started_at || now,
    finishedAt,
    context,
    actionResults,
    outputPreview,
  });

  return {
    run: serializeRun(await requireAssistantJobRun(env, userId, run.id)),
    execution: finalStatus,
    validation,
    actionResults,
  };
}

export async function createAssistantJob(env: Env, userId: string, body: CreateAssistantJobBody) {
  const draft = normalizeAssistantJobDraft(body);
  if (normalizeOptionalText(body.recipeId) && !body.draft) {
    const existing = await findExistingAssistantJobForRecipe(env, userId, draft.recipeId);
    if (existing) {
      throw new AssistantJobsInputError("That job has already been added.", 409);
    }
  }
  const draftForStorage = await withComputedScheduleNextRunAt(env, userId, draft);
  const validation = await validateAssistantJobDraftForUser(env, userId, draftForStorage);
  const requestedStatus = normalizeJobStatus(body.status);
  const status = resolveInitialStatus(validation, requestedStatus);
  const jobId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const triggerSummary = summarizeTrigger(draftForStorage.trigger);
  const setupState = { validationStatus: validation.status, errors: validation.errors };

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO assistant_jobs
       (id, user_id, recipe_id, name, purpose, status, current_version_id, project_id,
        destination_json, trigger_summary, next_run_at, setup_state_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'owner', ?, ?)`,
    ).bind(
      jobId,
      userId,
      draftForStorage.recipeId,
      draftForStorage.name,
      draftForStorage.purpose,
      status,
      versionId,
      draftForStorage.projectId,
      stringifyJson(draftForStorage.destination),
      triggerSummary,
      draftForStorage.trigger.kind === "schedule" ? draftForStorage.trigger.nextRunAt : null,
      stringifyJson(setupState),
      now,
      now,
    ),
    buildInsertVersionStatement(env, {
      versionId,
      jobId,
      userId,
      versionNumber: 1,
      draft: draftForStorage,
      validation,
      createdAt: now,
    }),
  ]);

  return {
    job: serializeJob(
      (await getAssistantJobRow(env, userId, jobId)) ||
        fail("Created Assistant Job was not found", 404),
    ),
    version: await getAssistantJobVersion(env, userId, versionId),
    validation,
  };
}

export async function updateAssistantJob(
  env: Env,
  userId: string,
  jobId: string,
  body: UpdateAssistantJobBody,
) {
  const existing = await requireAssistantJob(env, userId, jobId);
  const name = normalizeOptionalText(body.name) ?? existing.name;
  const purpose = normalizeOptionalText(body.purpose) ?? existing.purpose;
  const projectId = normalizeNullableText(body.projectId) ?? existing.project_id;
  const status = normalizeJobStatus(body.status) ?? existing.status;
  const dailyBriefingMessageTemplate =
    typeof body.dailyBriefingMessageTemplate === "string"
      ? body.dailyBriefingMessageTemplate.trim()
      : null;
  const schedulePatch = isRecord(body.schedule)
    ? (body.schedule as AssistantJobSchedulePatch)
    : null;
  const inboxWatchRules = Array.isArray(body.inboxWatchRules)
    ? (body.inboxWatchRules as AssistantJobRule[])
    : null;

  if (status === "archived") {
    throw new AssistantJobsInputError("Use DELETE to archive a job");
  }

  const version = existing.current_version_id
    ? await requireAssistantJobVersion(env, userId, existing.current_version_id)
    : null;
  let nextVersionId: string | null = null;
  let setupState: Record<string, unknown> | null = null;
  let nextTriggerSummary: string | null = null;
  let nextRunAt: string | null = null;

  if (dailyBriefingMessageTemplate !== null || schedulePatch || inboxWatchRules) {
    if (!version) throw new AssistantJobsInputError("Job version not found", 404);
    let nextDraft = draftFromVersion(existing, version);

    if (existing.recipe_id !== "daily-briefing") {
      if (dailyBriefingMessageTemplate !== null) {
        throw new AssistantJobsInputError("Daily briefing message can only be set on Daily Briefing jobs", 409);
      }
    }

    if (dailyBriefingMessageTemplate !== null) {
      nextDraft = withDailyBriefingMessageTemplate(nextDraft, dailyBriefingMessageTemplate);
    }
    if (schedulePatch) {
      nextDraft = await withUpdatedScheduleTrigger(env, userId, nextDraft, schedulePatch);
    }
    if (inboxWatchRules) {
      if (existing.recipe_id !== "email-triage") {
        throw new AssistantJobsInputError("Inbox Watch rules can only be set on Inbox Watch jobs", 409);
      }
      nextDraft = withInboxWatchRules(nextDraft, inboxWatchRules);
    }

    const validation = await validateAssistantJobDraftForUser(env, userId, nextDraft);
    nextVersionId = crypto.randomUUID();
    setupState = { validationStatus: validation.status, errors: validation.errors };
    nextTriggerSummary = summarizeTrigger(nextDraft.trigger);
    nextRunAt = nextDraft.trigger.kind === "schedule" ? nextDraft.trigger.nextRunAt : null;
    await buildInsertVersionStatement(env, {
      versionId: nextVersionId,
      jobId,
      userId,
      versionNumber: version.version_number + 1,
      draft: nextDraft,
      validation,
      createdAt: new Date().toISOString(),
    }).run();
  }

  if (nextVersionId && setupState) {
    await env.DB.prepare(
      `UPDATE assistant_jobs
       SET name = ?, purpose = ?, project_id = ?, status = ?, current_version_id = ?,
           trigger_summary = ?, next_run_at = ?, setup_state_json = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
    )
      .bind(
        name,
        purpose,
        projectId,
        status,
        nextVersionId,
        nextTriggerSummary,
        nextRunAt,
        stringifyJson(setupState),
        jobId,
        userId,
      )
      .run();
  } else {
    await env.DB.prepare(
      `UPDATE assistant_jobs
       SET name = ?, purpose = ?, project_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
    )
      .bind(name, purpose, projectId, status, jobId, userId)
      .run();
  }

  return { job: serializeJob(await requireAssistantJob(env, userId, jobId)) };
}

export async function setAssistantJobPaused(
  env: Env,
  userId: string,
  jobId: string,
  paused: boolean,
) {
  const existing = await requireAssistantJob(env, userId, jobId);
  if (existing.status === "archived") {
    throw new AssistantJobsInputError("Archived jobs cannot be changed", 409);
  }
  const status: AssistantJobStatus = paused ? "paused" : "active";
  await env.DB.prepare(
    `UPDATE assistant_jobs
     SET status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
  )
    .bind(status, jobId, userId)
    .run();
  return { job: serializeJob(await requireAssistantJob(env, userId, jobId)) };
}

export async function duplicateAssistantJob(env: Env, userId: string, jobId: string) {
  const existing = await requireAssistantJob(env, userId, jobId);
  const version = existing.current_version_id
    ? await requireAssistantJobVersion(env, userId, existing.current_version_id)
    : null;
  if (!version) throw new AssistantJobsInputError("Job version not found", 404);

  const draft: AssistantJobDraft = {
    name: `${version.name} copy`,
    purpose: version.purpose,
    recipeId: null,
    trigger: parseJson(version.trigger_json, { kind: "manual" }) as AssistantJobDraft["trigger"],
    scope: parseJson(version.scope_json, {
      projectId: null,
      sourceIds: [],
      providerAccountIds: [],
      filters: [],
    }) as AssistantJobDraft["scope"],
    rules: parseJson(version.rules_json, []),
    actions: parseJson(version.actions_json, []),
    approvalPolicy: parseJson(version.approval_policy_json, {
      defaultMode: "review_required",
      overrides: [],
      ownerCanApproveFrom: "mission_control",
      approvalExpiresAfterHours: null,
    }) as AssistantJobDraft["approvalPolicy"],
    destination: parseJson(version.destination_json, {
      kind: "mission_control",
      projectId: null,
      landing: "review_packet",
      quietIfNoChanges: true,
    }) as AssistantJobDraft["destination"],
    projectId: existing.project_id,
    recommendedSkillIds: parseJson(version.recommended_skill_ids_json, []),
    requiredSkillIds: parseJson(version.required_skill_ids_json, []),
  };

  return createAssistantJob(env, userId, { draft, status: "draft" });
}

export async function archiveAssistantJob(env: Env, userId: string, jobId: string) {
  const existing = await requireAssistantJob(env, userId, jobId);
  if (isDefaultAssistantJobRecipeId(existing.recipe_id)) {
    throw new AssistantJobsInputError("Default Assistant Jobs cannot be removed.", 409);
  }
  await env.DB.prepare(
    `UPDATE assistant_jobs
     SET status = 'archived', archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
  )
    .bind(jobId, userId)
    .run();
  return { ok: true };
}

export async function runAssistantJobNow(env: Env, userId: string, jobId: string) {
  const job = await requireAssistantJob(env, userId, jobId);
  if (job.status === "archived") throw new AssistantJobsInputError("Archived jobs cannot run", 409);
  if (job.status === "paused") throw new AssistantJobsInputError("Paused jobs cannot run", 409);
  if (!job.current_version_id) throw new AssistantJobsInputError("Job has no runnable version", 409);

  const version = await requireAssistantJobVersion(env, userId, job.current_version_id);
  const draft = draftFromVersion(job, version);
  const validation = await validateAssistantJobDraftForUser(env, userId, draft);
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  const blocked = validation.status !== "valid" || job.status === "needs_setup" || job.status === "draft";
  const status: AssistantJobRunStatus = blocked ? "blocked" : "queued";
  const errorMessage = blocked
    ? validation.errors[0]?.message || "Job is not ready to run"
    : null;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO assistant_job_runs
       (id, user_id, job_id, job_version_id, trigger_kind, trigger_ref, status,
        error_code, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      runId,
      userId,
      job.id,
      version.id,
      `manual:${crypto.randomUUID()}`,
      status,
      blocked ? "validation_blocked" : null,
      errorMessage,
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO assistant_job_run_events (id, run_id, event_type, message, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      runId,
      blocked ? "blocked" : "queued",
      blocked ? "Manual run blocked by validation" : "Manual run queued",
      stringifyJson({ validation }),
      now,
    ),
    env.DB.prepare(
      `UPDATE assistant_jobs
       SET last_run_at = ?, last_run_status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
    ).bind(now, status, job.id, userId),
  ]);

  if (status !== "queued") {
    return {
      run: serializeRun(await requireAssistantJobRun(env, userId, runId)),
      validation,
      execution: "not_started",
      actionResults: await listAssistantJobActionResults(env, runId),
    };
  }

  const execution = await executeAssistantJobRun(env, userId, runId);
  return {
    ...execution,
    validation,
  };
}

async function createAssistantJobRunForEvent(
  env: Env,
  candidate: AssistantJobMatchCandidateRow,
  event: AssistantJobIngressEventRow,
) {
  const version = candidateVersionFromRow(candidate);
  const draft = draftFromVersion(candidate, version);
  const validation = await validateAssistantJobDraftForUser(env, candidate.user_id, draft);
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  const blocked = validation.status !== "valid";
  const status: AssistantJobRunStatus = blocked ? "blocked" : "queued";
  const errorMessage = blocked
    ? validation.errors[0]?.message || "Job is not ready to run"
    : null;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO assistant_job_runs
       (id, user_id, job_id, job_version_id, trigger_kind, trigger_ref, status,
        error_code, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'event', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      runId,
      event.user_id,
      candidate.id,
      version.id,
      event.id,
      status,
      blocked ? "validation_blocked" : null,
      errorMessage,
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO assistant_job_run_events (id, run_id, event_type, message, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      runId,
      blocked ? "blocked" : "queued",
      blocked ? "Event-triggered run blocked by validation" : "Event-triggered run queued",
      stringifyJson({ validation, ingressEventId: event.id }),
      now,
    ),
    env.DB.prepare(
      `UPDATE assistant_jobs
       SET last_run_at = ?, last_run_status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
    ).bind(now, status, candidate.id, event.user_id),
  ]);

  return serializeRun(await requireAssistantJobRun(env, event.user_id, runId));
}

async function dispatchDueScheduledAssistantJob(
  env: Env,
  job: AssistantJobRow,
  now: Date,
) {
  if (!job.current_version_id || !job.next_run_at) {
    return {
      jobId: job.id,
      outcome: "skipped",
      reason: "missing_schedule_metadata",
    };
  }

  const dueRunAt = job.next_run_at;
  const dueDate = new Date(dueRunAt);
  const scheduleAnchor = Number.isNaN(dueDate.getTime()) ? now : dueDate;
  const version = await requireAssistantJobVersion(env, job.user_id, job.current_version_id);
  const draft = draftFromVersion(job, version);
  if (draft.trigger.kind !== "schedule") {
    await updateAssistantJobNextRunAt(env, job.user_id, job.id, null);
    return {
      jobId: job.id,
      outcome: "skipped",
      reason: "current_version_is_not_scheduled",
      dueRunAt,
      nextRunAt: null,
    };
  }

  const triggerRef = buildScheduleTriggerRef(job.id, dueRunAt);
  const existingRuns = await listAssistantJobRunsForTrigger(
    env,
    job.user_id,
    "schedule",
    triggerRef,
  );
  let run =
    existingRuns[0] ||
    (await createAssistantJobRunForSchedule(env, job, version, draft, dueRunAt, triggerRef));
  let execution = null;
  let queueMessageSent = false;

  if (run.status === "queued") {
    if (env.ASSISTANT_JOB_EVENTS) {
      await env.ASSISTANT_JOB_EVENTS.send({
        kind: "scheduled_run",
        runId: run.id,
        userId: job.user_id,
      });
      queueMessageSent = true;
    } else {
      execution = await executeAssistantJobRun(env, job.user_id, run.id);
      run = await requireAssistantJobRun(env, job.user_id, run.id);
    }
  }

  const nextRunAt = await computeNextScheduleRunAt(
    env,
    job.user_id,
    draft.trigger,
    scheduleAnchor,
  );
  await updateAssistantJobNextRunAt(env, job.user_id, job.id, nextRunAt);

  return {
    jobId: job.id,
    run: serializeRun(run),
    dueRunAt,
    nextRunAt,
    queueMessageSent,
    execution,
    outcome: queueMessageSent
      ? "queued"
      : execution
        ? "executed"
        : run.status === "blocked"
          ? "blocked"
          : "recorded",
  };
}

async function createAssistantJobRunForSchedule(
  env: Env,
  job: AssistantJobRow,
  version: AssistantJobVersionRow,
  draft: AssistantJobDraft,
  dueRunAt: string,
  triggerRef: string,
) {
  const validation = await validateAssistantJobDraftForUser(env, job.user_id, draft);
  const runId = crypto.randomUUID();
  const now = new Date().toISOString();
  const blocked = validation.status !== "valid";
  const status: AssistantJobRunStatus = blocked ? "blocked" : "queued";
  const errorMessage = blocked
    ? validation.errors[0]?.message || "Job is not ready to run"
    : null;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO assistant_job_runs
       (id, user_id, job_id, job_version_id, trigger_kind, trigger_ref, status,
        error_code, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'schedule', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      runId,
      job.user_id,
      job.id,
      version.id,
      triggerRef,
      status,
      blocked ? "validation_blocked" : null,
      errorMessage,
      now,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO assistant_job_run_events (id, run_id, event_type, message, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      runId,
      blocked ? "blocked" : "queued",
      blocked ? "Scheduled run blocked by validation" : "Scheduled run queued",
      stringifyJson({ validation, dueRunAt }),
      now,
    ),
    env.DB.prepare(
      `UPDATE assistant_jobs
       SET last_run_at = ?, last_run_status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
    ).bind(now, status, job.id, job.user_id),
  ]);

  return await requireAssistantJobRun(env, job.user_id, runId);
}

async function executeAssistantJobAction(
  env: Env,
  input: {
    userId: string;
    job: AssistantJobRow;
    run: AssistantJobRunRow;
    draft: AssistantJobDraft;
    action: AssistantJobAction;
  },
) {
  const capability = getAssistantJobCapability(input.action.capabilityId);
  const idempotencyKey = buildActionIdempotencyKey(input.run, input.action);
  const existing = await getAssistantJobActionResult(
    env,
    input.run.id,
    input.action.id,
    idempotencyKey,
  );
  if (existing) return serializeActionResult(existing);

  if (!capability) {
    return insertAssistantJobActionResult(env, {
      runId: input.run.id,
      actionId: input.action.id,
      capabilityId: input.action.capabilityId,
      idempotencyKey,
      status: "failed",
      errorMessage: "Unknown Assistant Job capability",
    });
  }

  const approvalMode = resolveActionApprovalMode(input.draft, input.action, capability);
  if (approvalMode === "forbidden") {
    return insertAssistantJobActionResult(env, {
      runId: input.run.id,
      actionId: input.action.id,
      capabilityId: capability.id,
      idempotencyKey,
      status: "blocked",
      errorMessage: "Capability is forbidden by Assistant Job policy",
    });
  }

  if (capability.id === "local_executor.run") {
    try {
      const localRun = await createLocalExecutorRunFromAssistantJobAction(env, input.userId, {
        job: input.job,
        run: input.run,
        draft: input.draft,
        action: input.action,
        ownerDirected: input.run.trigger_kind === "manual",
      });
      return insertAssistantJobActionResult(env, {
        runId: input.run.id,
        actionId: input.action.id,
        capabilityId: capability.id,
        idempotencyKey,
        status: localRun.approvalId ? "pending_approval" : "succeeded",
        approvalId: localRun.approvalId,
        externalRef: `local-executor-run:${localRun.run.id}`,
      });
    } catch (error) {
      return insertAssistantJobActionResult(env, {
        runId: input.run.id,
        actionId: input.action.id,
        capabilityId: capability.id,
        idempotencyKey,
        status: error instanceof LocalExecutorInputError && error.status === 409 ? "blocked" : "failed",
        errorMessage: error instanceof Error ? error.message : "Local Executor run could not be queued",
      });
    }
  }

  if (approvalMode === "approval_required") {
    const approvalId = await createAssistantJobActionApproval(env, input.userId, {
      job: input.job,
      run: input.run,
      action: input.action,
      capability,
      idempotencyKey,
    });
    return insertAssistantJobActionResult(env, {
      runId: input.run.id,
      actionId: input.action.id,
      capabilityId: capability.id,
      idempotencyKey,
      status: "pending_approval",
      approvalId,
    });
  }

  const providerBackedResult = await executeAssistantJobProviderBackedAction(env, {
    ...input,
    capability,
    idempotencyKey,
  });
  if (providerBackedResult) return providerBackedResult;

  const missionOutputResult = await executeAssistantJobMissionOutputAction(env, {
    ...input,
    capability,
    idempotencyKey,
  });
  if (missionOutputResult) return missionOutputResult;

  return insertAssistantJobActionResult(env, {
    runId: input.run.id,
    actionId: input.action.id,
    capabilityId: capability.id,
    idempotencyKey,
    status: "succeeded",
    externalRef: `${capability.auditEventKind}:${input.run.id}:${input.action.id}`,
  });
}

async function executeAssistantJobProviderBackedAction(
  env: Env,
  input: {
    userId: string;
    job: AssistantJobRow;
    run: AssistantJobRunRow;
    draft: AssistantJobDraft;
    action: AssistantJobAction;
    capability: AssistantCapability;
    idempotencyKey: string;
  },
) {
  if (isInvoiceReceiptTriageJob(input.job, input.draft)) {
    if (input.capability.id === "email.message.read") {
      const triage = await buildInvoiceReceiptTriageResult(env, input.userId, { dryRun: true });
      return insertAssistantJobActionResult(env, {
        runId: input.run.id,
        actionId: input.action.id,
        capabilityId: input.capability.id,
        idempotencyKey: input.idempotencyKey,
        status: "succeeded",
        externalRef: `mailbox:${triage.scanned}:messages:${triage.candidates}:invoice-candidates`,
      });
    }

    if (
      input.capability.id === "accounts.entry.create" ||
      input.capability.id === "mission.task.create"
    ) {
      const triage = await buildInvoiceReceiptTriageResult(env, input.userId, { dryRun: false });
      return insertAssistantJobActionResult(env, {
        runId: input.run.id,
        actionId: input.action.id,
        capabilityId: input.capability.id,
        idempotencyKey: input.idempotencyKey,
        status: "succeeded",
        externalRef: invoiceTriageExternalRef(triage),
      });
    }
  }

  if (input.capability.id === "email.message.read") {
    const triage = await buildEmailTriageResult(env, input.userId, input.draft);
    return insertAssistantJobActionResult(env, {
      runId: input.run.id,
      actionId: input.action.id,
      capabilityId: input.capability.id,
      idempotencyKey: input.idempotencyKey,
      status: "succeeded",
      externalRef: `mailbox:${triage.messageCount}:messages`,
    });
  }

  if (input.capability.id === "email.thread.summarize") {
    const triage = await buildEmailTriageResult(env, input.userId, input.draft);
    await persistEmailTriageSummaries(env, triage.items);
    const counts = await executeInboxWatchRuleOutcomes(env, input, triage);
    return insertAssistantJobActionResult(env, {
      runId: input.run.id,
      actionId: input.action.id,
      capabilityId: input.capability.id,
      idempotencyKey: input.idempotencyKey,
      status: "succeeded",
      externalRef:
        `mailbox:${triage.threadCount}:threads` +
        `:drafted:${counts.drafted}:tasks:${counts.tasks}:notified:${counts.notified}:notify_skipped:${counts.skippedNotifications}`,
    });
  }

  return null;
}

async function executeAssistantJobMissionOutputAction(
  env: Env,
  input: {
    userId: string;
    job: AssistantJobRow;
    run: AssistantJobRunRow;
    draft: AssistantJobDraft;
    action: AssistantJobAction;
    capability: AssistantCapability;
    idempotencyKey: string;
  },
) {
  if (input.capability.id === "mission.task.create") {
    return createAssistantJobMissionTask(env, input);
  }
  if (input.capability.id === "mission.activity.create") {
    return createAssistantJobMissionActivity(env, input, "assistant_job.activity");
  }
  if (input.capability.id === "mission.review_packet.create") {
    return createAssistantJobMissionActivity(env, input, "assistant_job.review_packet");
  }
  if (input.capability.id === "message.owner.notify") {
    return createAssistantJobOwnerNotification(env, input);
  }
  return null;
}

async function createAssistantJobOwnerNotification(
  env: Env,
  input: {
    userId: string;
    job: AssistantJobRow;
    run: AssistantJobRunRow;
    draft: AssistantJobDraft;
    action: AssistantJobAction;
    capability: AssistantCapability;
    idempotencyKey: string;
  },
) {
  if (input.job.recipe_id === "daily-briefing" || input.draft.recipeId === "daily-briefing") {
    const reviewAction = input.draft.actions.find(
      (action) => action.capabilityId === "mission.review_packet.create",
    );
    const briefingId = missionOutputId(input.run, reviewAction || input.action, "activity");
    const summary = await loadDailyBriefingPushSummary(
      env,
      input.userId,
      briefingId,
    ).catch(() => null);
    const delivery = await notifyDailyBriefingReady(env, briefingId, summary);
    return insertAssistantJobActionResult(env, {
      runId: input.run.id,
      actionId: input.action.id,
      capabilityId: input.capability.id,
      idempotencyKey: input.idempotencyKey,
      status: delivery.ok ? "succeeded" : "skipped",
      externalRef: briefingId,
      errorMessage: delivery.ok ? null : "Native Daily Briefing notification is not available.",
    });
  }

  const connection = await getActiveOwnerNotificationConnection(env, input.userId);
  if (!connection) {
    return insertAssistantJobActionResult(env, {
      runId: input.run.id,
      actionId: input.action.id,
      capabilityId: input.capability.id,
      idempotencyKey: input.idempotencyKey,
      status: "failed",
      errorMessage: "Owner notifications are not connected.",
    });
  }

  const providerEventId = `${input.run.id}:${input.action.id}:owner-notify`;
  const existingEvent = await getAgentChannelEventByProviderEventId(
    env,
    connection.id,
    providerEventId,
  );
  if (existingEvent?.status === "sent" || existingEvent?.status === "pending") {
    return insertAssistantJobActionResult(env, {
      runId: input.run.id,
      actionId: input.action.id,
      capabilityId: input.capability.id,
      idempotencyKey: input.idempotencyKey,
      status: "succeeded",
      externalRef: existingEvent.id,
    });
  }

  const message = await resolveOwnerNotificationMessage(env, input);
  const eventId = await insertOwnerNotificationChannelEvent(env, {
    connection,
    providerEventId,
    status: "pending",
    message,
    rawJson: {
      assistantJobId: input.job.id,
      assistantJobRunId: input.run.id,
      assistantJobActionId: input.action.id,
      idempotencyKey: input.idempotencyKey,
    },
  });

  try {
    const response = await fetch(`${getSoulinkApiOrigin(env)}/api/me3/assistant-channel/notify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.setup_token}`,
        "Content-Type": "application/json",
      },
      body: stringifyJson({
        streamChannelType: connection.provider_connection_id || "messaging",
        streamChannelId: connection.provider_thread_id,
        messageId: providerEventId,
        messageText: message,
        createdAt: new Date().toISOString(),
      }),
    });
    const payload = await response.json().catch(() => null) as OwnerNotificationResult | null;
    if (!response.ok || payload?.ok !== true) {
      const errorMessage =
        normalizeOptionalText(payload?.error) ||
        `Soulink notification failed with ${response.status}`;
      await updateOwnerNotificationChannelEvent(env, {
        eventId,
        status: "failed",
        providerMessageId: normalizeOptionalText(payload?.messageId),
        rawJson: payload,
        errorMessage,
      });
      return insertAssistantJobActionResult(env, {
        runId: input.run.id,
        actionId: input.action.id,
        capabilityId: input.capability.id,
        idempotencyKey: input.idempotencyKey,
        status: "failed",
        externalRef: eventId,
        errorMessage,
      });
    }

    const providerMessageId =
      normalizeOptionalText(payload.messageId) ||
      normalizeOptionalText(payload.eventId) ||
      providerEventId;
    await updateOwnerNotificationChannelEvent(env, {
      eventId,
      status: "sent",
      providerMessageId,
      rawJson: payload,
      errorMessage: null,
    });
    await updateOwnerNotificationConnectionSentAt(env, connection.id);
    return insertAssistantJobActionResult(env, {
      runId: input.run.id,
      actionId: input.action.id,
      capabilityId: input.capability.id,
      idempotencyKey: input.idempotencyKey,
      status: "succeeded",
      externalRef: eventId,
    });
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    await updateOwnerNotificationChannelEvent(env, {
      eventId,
      status: "failed",
      providerMessageId: null,
      rawJson: { errorMessage },
      errorMessage,
    });
    return insertAssistantJobActionResult(env, {
      runId: input.run.id,
      actionId: input.action.id,
      capabilityId: input.capability.id,
      idempotencyKey: input.idempotencyKey,
      status: "failed",
      externalRef: eventId,
      errorMessage,
    });
  }
}

async function loadDailyBriefingPushSummary(
  env: Env,
  userId: string,
  briefingId: string,
): Promise<DailyBriefingPushSummary | null> {
  const row = await env.DB.prepare(
    `SELECT metadata_json
     FROM mission_plugin_activity
     WHERE id = ? AND user_id = ? AND activity_type = 'assistant_job.review_packet'
     LIMIT 1`,
  )
    .bind(briefingId, userId)
    .first<{ metadata_json: string }>();
  if (!row) return null;

  const metadata = parseJson<Record<string, unknown>>(row.metadata_json, {});
  const dailyBriefing = isRecord(metadata.dailyBriefing)
    ? metadata.dailyBriefing
    : null;
  const notification = dailyBriefing && isRecord(dailyBriefing.notification)
    ? dailyBriefing.notification
    : null;
  const counts = notification && isRecord(notification.counts)
    ? notification.counts
    : null;
  if (!notification || !counts) return null;

  const reminders = normalizeDailyBriefingPushCount(counts.reminders);
  const tasks = normalizeDailyBriefingPushCount(counts.tasks);
  const bookings = normalizeDailyBriefingPushCount(counts.bookings);
  if (reminders === null || tasks === null || bookings === null) return null;

  return {
    ownerName: normalizeNullableText(notification.ownerName),
    counts: { reminders, tasks, bookings },
  };
}

function normalizeDailyBriefingPushCount(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? Math.min(value, 9_999)
    : null;
}

async function sendWeeklyReviewOwnerNotificationIfConnected(
  env: Env,
  input: {
    userId: string;
    job: AssistantJobRow;
    run: AssistantJobRunRow;
    draft: AssistantJobDraft;
  },
) {
  const connection = await getActiveOwnerNotificationConnection(env, input.userId);
  if (!connection) return;
  const providerEventId = `${input.run.id}:weekly-review-ready`;
  const existingEvent = await getAgentChannelEventByProviderEventId(
    env,
    connection.id,
    providerEventId,
  );
  if (existingEvent?.status === "sent" || existingEvent?.status === "pending") return;

  const review = await buildWeeklyReviewResult(env, input.userId, input.run.id);
  const message = formatWeeklyReviewReadyMessage(review);
  const eventId = await insertOwnerNotificationChannelEvent(env, {
    connection,
    providerEventId,
    status: "pending",
    message,
    rawJson: {
      assistantJobId: input.job.id,
      assistantJobRunId: input.run.id,
      notificationKind: "weekly_review.ready",
    },
  });

  const response = await fetch(`${getSoulinkApiOrigin(env)}/api/me3/assistant-channel/notify`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.setup_token}`,
      "Content-Type": "application/json",
    },
    body: stringifyJson({
      streamChannelType: connection.provider_connection_id || "messaging",
      streamChannelId: connection.provider_thread_id,
      messageId: providerEventId,
      messageText: message,
      createdAt: new Date().toISOString(),
    }),
  });
  const payload = await response.json().catch(() => null) as OwnerNotificationResult | null;
  if (!response.ok || payload?.ok !== true) {
    await updateOwnerNotificationChannelEvent(env, {
      eventId,
      status: "failed",
      providerMessageId: normalizeOptionalText(payload?.messageId),
      rawJson: payload,
      errorMessage:
        normalizeOptionalText(payload?.error) ||
        `Soulink notification failed with ${response.status}`,
    });
    return;
  }

  await updateOwnerNotificationChannelEvent(env, {
    eventId,
    status: "sent",
    providerMessageId:
      normalizeOptionalText(payload.messageId) ||
      normalizeOptionalText(payload.eventId) ||
      providerEventId,
    rawJson: payload,
    errorMessage: null,
  });
  await updateOwnerNotificationConnectionSentAt(env, connection.id);
}

async function resolveOwnerNotificationMessage(
  env: Env,
  input: {
    userId: string;
    job: AssistantJobRow;
    run: AssistantJobRunRow;
    draft: AssistantJobDraft;
    action: AssistantJobAction;
  },
) {
  if (isWeeklyReviewJob(input.job, input.draft)) {
    const review = await buildWeeklyReviewResult(env, input.userId, input.run.id);
    return formatWeeklyReviewReadyMessage(review);
  }

  if (input.job.recipe_id === "daily-briefing" || input.draft.recipeId === "daily-briefing") {
    const template =
      missionTextInput(input.action, "messageTemplate") ||
      missionTextInput(input.action, "message") ||
      DEFAULT_DAILY_BRIEFING_MESSAGE_TEMPLATE;
    return renderDailyBriefingMessage(await buildDailyBriefingRenderContext(env, input.userId), template);
  }

  return (
    missionTextInput(input.action, "message") ||
    missionTextInput(input.action, "text") ||
    `${input.job.name} is ready. I created a review result for you.`
  );
}

async function createAssistantJobMissionTask(
  env: Env,
  input: {
    userId: string;
    job: AssistantJobRow;
    run: AssistantJobRunRow;
    draft: AssistantJobDraft;
    action: AssistantJobAction;
    capability: AssistantCapability;
    idempotencyKey: string;
  },
) {
  const taskId = missionOutputId(input.run, input.action, "task");
  const title = missionTextInput(input.action, "title")
    || input.action.label
    || `${input.job.name} follow-up`;
  const description = missionTextInput(input.action, "description") || input.job.purpose || null;
  const projectId = resolveMissionOutputProjectId(input.job, input.draft, input.action);
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO mission_tasks
       (id, user_id, project_id, title, description, status, priority, due_at, scheduled_for,
        source_kind, source_ref, approval_id, metadata_json, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ?, ?, 'backlog', ?, ?, ?, 'agent', ?, NULL, ?, ?, ?, NULL)`,
  )
    .bind(
      taskId,
      input.userId,
      projectId,
      title,
      description,
      normalizeMissionPriority(input.action.inputs.priority),
      normalizeNullableText(input.action.inputs.dueAt),
      normalizeNullableText(input.action.inputs.scheduledFor),
      input.idempotencyKey,
      stringifyJson(missionOutputMetadata(input)),
      now,
      now,
    )
    .run();

  return insertAssistantJobActionResult(env, {
    runId: input.run.id,
    actionId: input.action.id,
    capabilityId: input.capability.id,
    idempotencyKey: input.idempotencyKey,
    status: "succeeded",
    externalRef: taskId,
  });
}

async function createAssistantJobMissionActivity(
  env: Env,
  input: {
    userId: string;
    job: AssistantJobRow;
    run: AssistantJobRunRow;
    draft: AssistantJobDraft;
    action: AssistantJobAction;
    capability: AssistantCapability;
    idempotencyKey: string;
  },
  defaultActivityType: string,
) {
  const activityId = missionOutputId(input.run, input.action, "activity");
  const generated = await buildGeneratedMissionActivity(env, input, defaultActivityType);
  const title = missionTextInput(input.action, "title")
    || generated.title
    || (defaultActivityType === "assistant_job.review_packet"
      ? `Result: ${input.job.name}`
      : input.action.label)
    || input.job.name;
  const summary =
    missionTextInput(input.action, "summary") ||
    generated.summary ||
    (defaultActivityType === "assistant_job.review_packet"
      ? `Created a review result for ${input.job.name}.`
      : input.job.purpose) ||
    null;
  const status = missionTextInput(input.action, "status") || "succeeded";
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT OR IGNORE INTO mission_plugin_activity
       (id, user_id, plugin_id, activity_type, title, summary, status, related_id, metadata_json, created_at)
     VALUES (?, ?, 'me3.assistant-jobs', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      activityId,
      input.userId,
      missionTextInput(input.action, "activityType") || defaultActivityType,
      title,
      summary,
      status,
      input.run.id,
      stringifyJson(missionOutputMetadata(input, generated.metadata)),
      now,
    )
    .run();

  if (
    defaultActivityType === "assistant_job.review_packet" &&
    isWeeklyReviewJob(input.job, input.draft)
  ) {
    await upsertWeeklyReviewMissionTask(env, input, generated.metadata?.weeklyReview);
    await sendWeeklyReviewOwnerNotificationIfConnected(env, input).catch(() => null);
  }

  return insertAssistantJobActionResult(env, {
    runId: input.run.id,
    actionId: input.action.id,
    capabilityId: input.capability.id,
    idempotencyKey: input.idempotencyKey,
    status: "succeeded",
    externalRef: activityId,
  });
}

async function upsertWeeklyReviewMissionTask(
  env: Env,
  input: {
    userId: string;
    job: AssistantJobRow;
    run: AssistantJobRunRow;
    draft: AssistantJobDraft;
    action: AssistantJobAction;
    capability: AssistantCapability;
    idempotencyKey: string;
  },
  reviewValue: unknown,
) {
  const review = isRecord(reviewValue)
    ? reviewValue
    : await buildWeeklyReviewResult(env, input.userId, input.run.id);
  const weekStart = normalizeOptionalText(review.weekStart) || new Date().toISOString().slice(0, 10);
  const weekEnd = normalizeOptionalText(review.weekEnd) || weekStart;
  const taskId = `weekly-review-task:${input.userId}:${weekStart}:${weekEnd}`;
  const sourceRef = `weekly-review:${weekStart}:${weekEnd}`;
  const title = `Weekly Review: ${weekStart} to ${weekEnd}`;
  const summary =
    normalizeOptionalText(review.journalSummary) ||
    `Review ${weekStart} to ${weekEnd}.`;
  const now = new Date().toISOString();
  const metadata = missionOutputMetadata(input, {
    kind: "weekly_review",
    weeklyReview: {
      ...review,
      taskId,
      missionAgentRunId: missionAgentRunIdForAssistantJobRun(input.run.id),
      assistantJobRunId: input.run.id,
      submittedAt: null,
    },
  });

  await env.DB.prepare(
    `INSERT OR IGNORE INTO mission_tasks
       (id, user_id, project_id, title, description, status, priority, due_at, scheduled_for,
        source_kind, source_ref, approval_id, metadata_json, created_at, updated_at, archived_at)
     VALUES (?, ?, ?, ?, ?, 'backlog', ?, ?, ?, 'agent', ?, NULL, ?, ?, ?, NULL)`,
  )
    .bind(
      taskId,
      input.userId,
      input.draft.destination.projectId || input.draft.scope.projectId || input.job.project_id || "mission-project-personal",
      title,
      summary,
      2,
      null,
      weekEnd,
      sourceRef,
      stringifyJson(metadata),
      now,
      now,
    )
    .run();

  await env.DB.prepare(
    `UPDATE mission_tasks
     SET title = ?, description = ?, status = CASE
           WHEN status = 'done' THEN status
           ELSE 'backlog'
         END,
         priority = ?, scheduled_for = ?, metadata_json = ?, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  )
    .bind(title, summary, 2, weekEnd, stringifyJson(metadata), now, taskId, input.userId)
    .run();
}

async function buildGeneratedMissionActivity(
  env: Env,
  input: {
    userId: string;
    job: AssistantJobRow;
    run: AssistantJobRunRow;
    draft: AssistantJobDraft;
    action: AssistantJobAction;
    capability: AssistantCapability;
    idempotencyKey: string;
  },
  defaultActivityType: string,
): Promise<{ title: string | null; summary: string | null; metadata?: Record<string, unknown> }> {
  if (
    defaultActivityType === "assistant_job.review_packet" &&
    isInvoiceReceiptTriageJob(input.job, input.draft)
  ) {
    const triage = await buildInvoiceReceiptTriageResult(env, input.userId, { dryRun: true });
    return {
      title: `Result: ${input.job.name}`,
      summary: formatInvoiceTriageMissionSummary(triage),
      metadata: { invoiceTriage: triage },
    };
  }

  if (
    defaultActivityType === "assistant_job.review_packet" &&
    (input.job.recipe_id === "email-triage" ||
      input.draft.recipeId === "email-triage")
  ) {
    const triage = await buildEmailTriageResult(env, input.userId, input.draft);
    const jobName = input.job.name || input.draft.name || "Inbox Watch";
    return {
      title: `${jobName}: ${triage.messageCount} message${triage.messageCount === 1 ? "" : "s"} reviewed`,
      summary: formatEmailTriageMissionSummary(triage),
      metadata: { emailTriage: triage },
    };
  }

  if (
    defaultActivityType === "assistant_job.review_packet" &&
    isWeeklyReviewJob(input.job, input.draft)
  ) {
    const review = await buildWeeklyReviewResult(env, input.userId, input.run.id);
    return {
      title: `Weekly Review: ${review.weekLabel}`,
      summary: review.journalSummary,
      metadata: { weeklyReview: review },
    };
  }

  if (
    defaultActivityType === "assistant_job.review_packet" &&
    (input.job.recipe_id === "daily-briefing" || input.draft.recipeId === "daily-briefing")
  ) {
    const notifyAction =
      input.draft.actions.find((action) => action.capabilityId === "message.owner.notify") ||
      input.action;
    const template =
      missionTextInput(notifyAction, "messageTemplate") ||
      missionTextInput(notifyAction, "message") ||
      DEFAULT_DAILY_BRIEFING_MESSAGE_TEMPLATE;
    const context = await buildDailyBriefingRenderContext(env, input.userId);
    const message = renderDailyBriefingMessage(context, template);
    return {
      title: `Daily Briefing: ${context.dateLabel}`,
      summary: message,
      metadata: {
        dailyBriefing: {
          version: 1,
          date: context.dateKey,
          message,
          plainText: message,
          sections: context.sections,
          notification: context.notification,
          template,
        },
      },
    };
  }

  return { title: null, summary: null };
}

async function createAssistantJobActionApproval(
  env: Env,
  userId: string,
  input: {
    job: AssistantJobRow;
    run: AssistantJobRunRow;
    action: AssistantJobAction;
    capability: AssistantCapability;
    idempotencyKey: string;
  },
) {
  const approvalId = crypto.randomUUID();
  const title = `Approve ${input.action.label}`;
  await env.DB.prepare(
    `INSERT INTO mission_approvals
       (id, user_id, plugin_id, action_id, title, summary, payload_json, risk_level, requested_by, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'assistant_job', NULL)`,
  )
    .bind(
      approvalId,
      userId,
      input.capability.pluginId || "me3.core",
      input.action.id,
      title,
      `${input.job.name} wants to use ${input.capability.label}.`,
      stringifyJson({
        jobId: input.job.id,
        runId: input.run.id,
        actionId: input.action.id,
        capabilityId: input.capability.id,
        idempotencyKey: input.idempotencyKey,
        inputs: input.action.inputs,
      }),
      riskLevelForCapability(input.capability),
    )
    .run();
  return approvalId;
}

async function insertAssistantJobActionResult(
  env: Env,
  input: {
    runId: string;
    actionId: string;
    capabilityId: string;
    idempotencyKey: string;
    status: AssistantJobActionResultStatus;
    approvalId?: string | null;
    artifactId?: string | null;
    externalRef?: string | null;
    errorMessage?: string | null;
  },
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO assistant_job_action_results
       (id, run_id, action_id, capability_id, idempotency_key, status,
        approval_id, artifact_id, external_ref, error_message, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      input.runId,
      input.actionId,
      input.capabilityId,
      input.idempotencyKey,
      input.status,
      input.approvalId || null,
      input.artifactId || null,
      input.externalRef || null,
      input.errorMessage || null,
      now,
      now,
    )
    .run();

  const row = await getAssistantJobActionResult(
    env,
    input.runId,
    input.actionId,
    input.idempotencyKey,
  );
  if (!row) throw new AssistantJobsInputError("Assistant Job action result was not recorded", 409);
  return serializeActionResult(row);
}

async function setAssistantJobRunStatus(
  env: Env,
  userId: string,
  runId: string,
  input: {
    status: AssistantJobRunStatus;
    startedAt?: string | null;
    finishedAt?: string | null;
    outputPreview?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    eventType: string;
    message: string;
    payload?: Record<string, unknown>;
  },
) {
  const existing = await requireAssistantJobRun(env, userId, runId);
  const startedAt =
    input.startedAt !== undefined ? input.startedAt : existing.started_at;
  const finishedAt =
    input.finishedAt !== undefined ? input.finishedAt : existing.finished_at;
  const outputPreview =
    input.outputPreview !== undefined ? input.outputPreview : existing.output_preview;
  const errorCode =
    input.errorCode !== undefined ? input.errorCode : existing.error_code;
  const errorMessage =
    input.errorMessage !== undefined ? input.errorMessage : existing.error_message;
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE assistant_job_runs
       SET status = ?, started_at = ?, finished_at = ?, output_preview = ?,
           error_code = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
    ).bind(
      input.status,
      startedAt,
      finishedAt,
      outputPreview,
      errorCode,
      errorMessage,
      runId,
      userId,
    ),
    env.DB.prepare(
      `INSERT INTO assistant_job_run_events (id, run_id, event_type, message, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      runId,
      input.eventType,
      input.message,
      stringifyJson(input.payload || {}),
      now,
    ),
    env.DB.prepare(
      `UPDATE assistant_jobs
       SET last_run_at = ?, last_run_status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
    ).bind(now, input.status, existing.job_id, userId),
  ]);
}

async function loadAssistantJobRunContext(
  env: Env,
  userId: string,
  input: {
    job: AssistantJobRow;
    run: AssistantJobRunRow;
    draft: AssistantJobDraft;
  },
): Promise<AssistantJobContextResult | null> {
  const failedSources: Me3AgentContextSource[] = [];
  try {
    const owner = await loadAssistantJobOwnerContext(env, userId, failedSources);
    const [projects, tasks, calendarEvents, privateMemory, recentMessages] = await Promise.all([
      loadAssistantJobProjectsContext(env, userId, failedSources),
      loadAssistantJobTasksContext(env, userId, failedSources),
      loadAssistantJobCalendarContext(env, userId, failedSources),
      loadAssistantJobMemoryContext(env, userId, failedSources),
      loadAssistantJobRecentMessagesContext(env, userId, failedSources),
    ]);
    const projectId =
      input.draft.destination.projectId || input.draft.scope.projectId || input.job.project_id;

    return createAssistantJobContext({
      ownerId: userId,
      jobId: input.job.id,
      runId: input.run.id,
      jobName: input.job.name,
      jobPurpose: input.job.purpose,
      trigger: input.draft.trigger,
      scope: input.draft.scope,
      destination: input.draft.destination,
      ownerProfile: owner,
      candidateProjects: projectId
        ? projects.filter((project) => project.id === projectId)
        : projects,
      candidateTasks: projectId
        ? tasks.filter((task) => task.projectId === projectId)
        : tasks,
      candidateCalendarEvents: calendarEvents,
      candidatePrivateMemory: privateMemory,
      candidateRecentMessages: recentMessages,
      failedSources,
      budget: { maxPromptChars: 6000 },
    });
  } catch {
    return null;
  }
}

async function upsertAssistantJobMissionAgentRun(
  env: Env,
  userId: string,
  input: {
    job: AssistantJobRow;
    run: AssistantJobRunRow;
    draft: AssistantJobDraft;
    status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
    startedAt?: string | null;
    finishedAt?: string | null;
    context: AssistantJobContextResult | null;
    actionResults?: SerializedActionResult[];
    outputPreview?: string | null;
  },
) {
  const id = missionAgentRunIdForAssistantJobRun(input.run.id);
  const result = input.context
    ? attachAssistantJobContextToRunResult(
        {
          assistantJobRunId: input.run.id,
          assistantJobId: input.job.id,
          assistantJobStatus: input.run.status,
          outputPreview: input.outputPreview || input.run.output_preview || null,
          actionResults: input.actionResults || [],
          ...(isWeeklyReviewJob(input.job, input.draft)
            ? { weeklyReview: await buildWeeklyReviewResult(env, userId, input.run.id) }
            : {}),
        },
        input.context,
      )
    : {
        assistantJobRunId: input.run.id,
        assistantJobId: input.job.id,
        assistantJobStatus: input.run.status,
        outputPreview: input.outputPreview || input.run.output_preview || null,
        actionResults: input.actionResults || [],
        ...(isWeeklyReviewJob(input.job, input.draft)
          ? { weeklyReview: await buildWeeklyReviewResult(env, userId, input.run.id) }
          : {}),
        contextPacketId: null,
        contextManifest: null,
      };
  const promptSummary =
    input.outputPreview ||
    input.run.output_preview ||
    `Ran ${input.job.name}.`;
  const projectId = input.draft.destination.projectId || input.draft.scope.projectId || input.job.project_id;
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO mission_agent_runs
       (id, user_id, source, project_id, title, prompt_summary, status, model,
        runner_id, started_at, finished_at, result_json, artifact_manifest_json, created_at, updated_at)
     VALUES (?, ?, 'core', ?, ?, ?, ?, 'structured-assistant-job-runner-v1',
             'assistant-jobs', ?, ?, ?, '[]', ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status,
       prompt_summary = excluded.prompt_summary,
       started_at = COALESCE(mission_agent_runs.started_at, excluded.started_at),
       finished_at = excluded.finished_at,
       result_json = excluded.result_json,
       updated_at = excluded.updated_at`,
  )
    .bind(
      id,
      userId,
      projectId,
      `Assistant Job: ${input.job.name}`,
      promptSummary,
      input.status,
      input.startedAt || null,
      input.finishedAt || null,
      stringifyJson(result),
      now,
      now,
    )
    .run();
}

function normalizeAssistantJobDraft(body: CreateAssistantJobBody): AssistantJobDraft {
  const rawDraft = body.draft;
  const recipeId = normalizeOptionalText(body.recipeId);
  const recipe = recipeId ? getAssistantJobStarterRecipe(recipeId) : null;
  if (recipeId && !recipe) throw new AssistantJobsInputError(`Unknown recipe: ${recipeId}`, 404);

  const baseDraft = isRecord(rawDraft)
    ? normalizeDraftRecord(rawDraft, recipe)
    : recipe
      ? createAssistantJobDraftFromRecipe(recipe)
      : null;

  if (!baseDraft) {
    throw new AssistantJobsInputError("recipeId or draft is required");
  }

  const name = normalizeOptionalText(body.name);
  const purpose = normalizeOptionalText(body.purpose);
  const projectId = normalizeNullableText(body.projectId);

  return {
    ...baseDraft,
    name: name ?? baseDraft.name,
    purpose: purpose ?? baseDraft.purpose,
    projectId: projectId ?? baseDraft.projectId,
    destination: {
      ...baseDraft.destination,
      projectId: projectId ?? baseDraft.destination.projectId,
    },
    scope: {
      ...baseDraft.scope,
      projectId: projectId ?? baseDraft.scope.projectId,
    },
  };
}

function normalizeDraftRecord(
  rawDraft: Record<string, unknown>,
  recipe: AssistantJobStarterRecipe | null,
): AssistantJobDraft {
  const fallback = recipe ? createAssistantJobDraftFromRecipe(recipe) : null;
  const name = normalizeOptionalText(rawDraft.name) ?? fallback?.name;
  const purpose = normalizeOptionalText(rawDraft.purpose) ?? fallback?.purpose;
  if (!name) throw new AssistantJobsInputError("Job name is required");
  if (!purpose) throw new AssistantJobsInputError("Job purpose is required");
  const trigger = isRecord(rawDraft.trigger) ? rawDraft.trigger : fallback?.trigger;
  const scope = isRecord(rawDraft.scope) ? rawDraft.scope : fallback?.scope;
  const destination = isRecord(rawDraft.destination) ? rawDraft.destination : fallback?.destination;
  const approvalPolicy = isRecord(rawDraft.approvalPolicy)
    ? rawDraft.approvalPolicy
    : fallback?.approvalPolicy;
  if (!trigger || !scope || !destination || !approvalPolicy) {
    throw new AssistantJobsInputError("Draft trigger, scope, destination, and approval policy are required");
  }

  return {
    name,
    purpose,
    recipeId: normalizeNullableText(rawDraft.recipeId) ?? fallback?.recipeId ?? null,
    trigger: trigger as AssistantJobDraft["trigger"],
    scope: scope as AssistantJobDraft["scope"],
    rules: Array.isArray(rawDraft.rules) ? rawDraft.rules as AssistantJobDraft["rules"] : fallback?.rules ?? [],
    actions: Array.isArray(rawDraft.actions)
      ? rawDraft.actions as AssistantJobDraft["actions"]
      : fallback?.actions ?? [],
    approvalPolicy: approvalPolicy as AssistantJobDraft["approvalPolicy"],
    destination: destination as AssistantJobDraft["destination"],
    projectId: normalizeNullableText(rawDraft.projectId) ?? fallback?.projectId ?? null,
    recommendedSkillIds: normalizeStringArray(rawDraft.recommendedSkillIds) ?? fallback?.recommendedSkillIds ?? [],
    requiredSkillIds: normalizeStringArray(rawDraft.requiredSkillIds) ?? fallback?.requiredSkillIds ?? [],
  };
}

function withDailyBriefingMessageTemplate(
  draft: AssistantJobDraft,
  messageTemplate: string,
): AssistantJobDraft {
  return {
    ...draft,
    actions: draft.actions.map((action) =>
      action.capabilityId === "message.owner.notify"
        ? {
            ...action,
            inputs: {
              ...action.inputs,
              messageTemplate: messageTemplate || DEFAULT_DAILY_BRIEFING_MESSAGE_TEMPLATE,
            },
          }
        : action,
    ),
  };
}

function withInboxWatchRules(
  draft: AssistantJobDraft,
  rules: readonly AssistantJobRule[],
): AssistantJobDraft {
  const normalizedRules = rules
    .filter((rule) => isRecord(rule) && normalizeOptionalText(rule.id))
    .map((rule) => ({
      id: normalizeOptionalText(rule.id) || crypto.randomUUID(),
      label: normalizeOptionalText(rule.label) || "Inbox Watch rule",
      field: "inbox_watch.rule",
      operator: "matches",
      value: isRecord(rule.value) ? rule.value : {},
    }));
  if (normalizedRules.length === 0) {
    throw new AssistantJobsInputError("At least one Inbox Watch rule is required");
  }
  return {
    ...draft,
    rules: normalizedRules,
  };
}

async function withUpdatedScheduleTrigger(
  env: Env,
  userId: string,
  draft: AssistantJobDraft,
  patch: AssistantJobSchedulePatch,
): Promise<AssistantJobDraft> {
  if (draft.trigger.kind !== "schedule") {
    throw new AssistantJobsInputError("Only scheduled jobs can change schedule", 409);
  }
  if (patch.cadence !== undefined && !normalizeScheduleCadence(patch.cadence)) {
    throw new AssistantJobsInputError("Schedule cadence is invalid");
  }
  if (patch.localTime !== undefined && !normalizeScheduleLocalTime(patch.localTime)) {
    throw new AssistantJobsInputError("Schedule time must use HH:mm");
  }
  if (patch.timezone !== undefined && !normalizeScheduleTimezone(patch.timezone)) {
    throw new AssistantJobsInputError("Schedule timezone is invalid");
  }

  const cadence = normalizeScheduleCadence(patch.cadence) || draft.trigger.cadence;
  const localTime =
    normalizeScheduleLocalTime(patch.localTime) || draft.trigger.localTime || "08:00";
  const timezone = normalizeScheduleTimezone(patch.timezone) || draft.trigger.timezone || "owner";
  if (
    cadence === "weekly" &&
    patch.dayOfWeek !== undefined &&
    normalizeScheduleDayOfWeek(patch.dayOfWeek) === null
  ) {
    throw new AssistantJobsInputError("Schedule day of week is invalid");
  }
  if (
    cadence === "monthly" &&
    patch.dayOfMonth !== undefined &&
    normalizeScheduleDayOfMonth(patch.dayOfMonth) === null
  ) {
    throw new AssistantJobsInputError("Schedule day of month is invalid");
  }
  const dayOfWeek =
    cadence === "weekly"
      ? normalizeScheduleDayOfWeek(patch.dayOfWeek) ?? draft.trigger.dayOfWeek ?? 1
      : null;
  const dayOfMonth =
    cadence === "monthly"
      ? normalizeScheduleDayOfMonth(patch.dayOfMonth) ??
        parseMonthlyDayOfMonth(draft.trigger.rrule) ??
        1
      : null;
  const rrule = cadence === "monthly" ? `FREQ=MONTHLY;BYMONTHDAY=${dayOfMonth}` : null;
  const trigger: AssistantJobDraft["trigger"] = {
    kind: "schedule",
    timezone,
    cadence,
    rrule,
    localTime,
    dayOfWeek,
    nextRunAt: null,
  };

  return withComputedScheduleNextRunAt(env, userId, { ...draft, trigger });
}

async function withComputedScheduleNextRunAt(
  env: Env,
  userId: string,
  draft: AssistantJobDraft,
): Promise<AssistantJobDraft> {
  if (draft.trigger.kind !== "schedule") return draft;
  return {
    ...draft,
    trigger: {
      ...draft.trigger,
      nextRunAt: await computeNextScheduleRunAt(env, userId, draft.trigger),
    },
  };
}

function buildInsertVersionStatement(
  env: Env,
  input: {
    versionId: string;
    jobId: string;
    userId: string;
    versionNumber: number;
    draft: AssistantJobDraft;
    validation: AssistantJobDraftValidation;
    createdAt: string;
  },
) {
  return env.DB.prepare(
    `INSERT INTO assistant_job_versions
     (id, job_id, user_id, version_number, name, purpose, trigger_json, scope_json,
      rules_json, actions_json, approval_policy_json, destination_json, capability_ids_json,
      permission_summary_json, recommended_skill_ids_json, required_skill_ids_json,
      validation_status, validation_errors_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.versionId,
    input.jobId,
    input.userId,
    input.versionNumber,
    input.draft.name,
    input.draft.purpose,
    stringifyJson(input.draft.trigger),
    stringifyJson(input.draft.scope),
    stringifyJson(input.draft.rules),
    stringifyJson(input.draft.actions),
    stringifyJson(input.draft.approvalPolicy),
    stringifyJson(input.draft.destination),
    stringifyJson(input.draft.actions.map((action) => action.capabilityId)),
    stringifyJson(input.validation.permissionSummary),
    stringifyJson(input.draft.recommendedSkillIds),
    stringifyJson(input.draft.requiredSkillIds),
    input.validation.status,
    stringifyJson(input.validation.errors),
    input.createdAt,
  );
}

async function getAssistantJobRow(env: Env, userId: string, jobId: string) {
  return env.DB.prepare("SELECT * FROM assistant_jobs WHERE id = ? AND user_id = ?")
    .bind(jobId, userId)
    .first<AssistantJobRow>();
}

async function findExistingAssistantJobForRecipe(
  env: Env,
  userId: string,
  recipeId: string | null,
) {
  if (!recipeId) return null;
  return env.DB.prepare(
    `SELECT * FROM assistant_jobs
     WHERE user_id = ? AND recipe_id = ? AND status != 'archived'
     ORDER BY updated_at DESC
     LIMIT 1`,
  )
    .bind(userId, recipeId)
    .first<AssistantJobRow>();
}

async function requireAssistantJob(env: Env, userId: string, jobId: string) {
  const job = await getAssistantJobRow(env, userId, jobId);
  if (!job) throw new AssistantJobsInputError("Assistant Job not found", 404);
  return job;
}

async function getAssistantJobVersion(env: Env, userId: string, versionId: string) {
  const version = await env.DB.prepare("SELECT * FROM assistant_job_versions WHERE id = ? AND user_id = ?")
    .bind(versionId, userId)
    .first<AssistantJobVersionRow>();
  return version ? serializeVersion(version) : null;
}

async function requireAssistantJobVersion(env: Env, userId: string, versionId: string) {
  const version = await env.DB.prepare("SELECT * FROM assistant_job_versions WHERE id = ? AND user_id = ?")
    .bind(versionId, userId)
    .first<AssistantJobVersionRow>();
  if (!version) throw new AssistantJobsInputError("Assistant Job version not found", 404);
  return version;
}

async function requireAssistantJobRun(env: Env, userId: string, runId: string) {
  const run = await env.DB.prepare("SELECT * FROM assistant_job_runs WHERE id = ? AND user_id = ?")
    .bind(runId, userId)
    .first<AssistantJobRunRow>();
  if (!run) throw new AssistantJobsInputError("Assistant Job run not found", 404);
  return run;
}

async function getAssistantJobActionResult(
  env: Env,
  runId: string,
  actionId: string,
  idempotencyKey: string,
) {
  return env.DB.prepare(
    `SELECT * FROM assistant_job_action_results
     WHERE run_id = ? AND action_id = ? AND idempotency_key = ?`,
  )
    .bind(runId, actionId, idempotencyKey)
    .first<AssistantJobActionResultRow>();
}

async function listAssistantJobActionResults(env: Env, runId: string) {
  const rows = await env.DB.prepare(
    `SELECT * FROM assistant_job_action_results
     WHERE run_id = ?
     ORDER BY created_at ASC`,
  )
    .bind(runId)
    .all<AssistantJobActionResultRow>();
  return rows.results.map(serializeActionResult);
}

async function listAssistantJobRunsForTrigger(
  env: Env,
  userId: string,
  triggerKind: AssistantJobRunRow["trigger_kind"],
  triggerRef: string,
) {
  const rows = await env.DB.prepare(
    `SELECT * FROM assistant_job_runs
     WHERE user_id = ? AND trigger_kind = ? AND trigger_ref = ?
     ORDER BY created_at DESC`,
  )
    .bind(userId, triggerKind, triggerRef)
    .all<AssistantJobRunRow>();
  return rows.results;
}

async function updateAssistantJobNextRunAt(
  env: Env,
  userId: string,
  jobId: string,
  nextRunAt: string | null,
) {
  await env.DB.prepare(
    `UPDATE assistant_jobs
     SET next_run_at = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
  )
    .bind(nextRunAt, jobId, userId)
    .run();
}

function buildScheduleTriggerRef(jobId: string, dueRunAt: string) {
  return `schedule:${jobId}:${dueRunAt}`;
}

function isAssistantJobScheduledRunQueueMessage(
  message: AssistantJobEventQueueMessage,
): message is AssistantJobScheduledRunQueueMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { kind?: unknown }).kind === "scheduled_run"
  );
}

async function listEventTriggerCandidates(env: Env, userId: string) {
  const rows = await env.DB.prepare(
    `SELECT
       j.*,
       v.id AS version_id,
       v.version_number AS version_number,
       v.name AS version_name,
       v.purpose AS version_purpose,
       v.trigger_json AS candidate_trigger_json,
       v.scope_json AS candidate_scope_json,
       v.rules_json AS candidate_rules_json,
       v.actions_json AS candidate_actions_json,
       v.approval_policy_json AS candidate_approval_policy_json,
       v.destination_json AS candidate_destination_json,
       v.capability_ids_json AS candidate_capability_ids_json,
       v.permission_summary_json AS candidate_permission_summary_json,
       v.recommended_skill_ids_json AS candidate_recommended_skill_ids_json,
       v.required_skill_ids_json AS candidate_required_skill_ids_json,
       v.validation_status AS candidate_validation_status,
       v.validation_errors_json AS candidate_validation_errors_json,
       v.created_at AS version_created_at
     FROM assistant_jobs j
     JOIN assistant_job_versions v
       ON v.id = j.current_version_id AND v.user_id = j.user_id
     WHERE j.user_id = ?
       AND j.status = 'active'
       AND ${visibleAssistantJobRecipeSql("j.recipe_id")}
       AND j.archived_at IS NULL
     ORDER BY j.updated_at DESC, j.created_at DESC`,
  )
    .bind(userId, ...HIDDEN_ASSISTANT_JOB_RECIPE_IDS)
    .all<AssistantJobMatchCandidateRow>();
  return rows.results;
}

async function getActiveOwnerNotificationConnection(env: Env, userId: string) {
  return env.DB.prepare(
    `SELECT id, user_id, channel, status, setup_token,
            provider_connection_id, provider_thread_id, last_outbound_at
     FROM agent_channel_connections
     WHERE user_id = ?
       AND status = 'active'
       AND channel = 'soulink'
       AND provider_thread_id IS NOT NULL
     ORDER BY updated_at DESC
     LIMIT 1`,
  )
    .bind(userId)
    .first<AgentChannelConnectionRow>();
}

async function getAgentChannelEventByProviderEventId(
  env: Env,
  connectionId: string,
  providerEventId: string,
) {
  return env.DB.prepare(
    `SELECT id, connection_id, provider_event_id, status
     FROM agent_channel_events
     WHERE connection_id = ? AND provider_event_id = ?
     LIMIT 1`,
  )
    .bind(connectionId, providerEventId)
    .first<AgentChannelEventRow>();
}

async function insertOwnerNotificationChannelEvent(
  env: Env,
  input: {
    connection: AgentChannelConnectionRow;
    providerEventId: string;
    status: "pending" | "sent" | "failed";
    message: string;
    rawJson: unknown;
  },
) {
  const existing = await getAgentChannelEventByProviderEventId(
    env,
    input.connection.id,
    input.providerEventId,
  );
  if (existing) return existing.id;

  const eventId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO agent_channel_events
       (id, connection_id, channel, direction, event_type, status,
        provider_event_id, provider_message_id, reply_to_message_id,
        text_body, raw_json, error_message, created_at, updated_at)
     VALUES (?, ?, ?, 'outbound', 'send', ?, ?, NULL, NULL, ?, ?, NULL,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
  )
    .bind(
      eventId,
      input.connection.id,
      input.connection.channel,
      input.status,
      input.providerEventId,
      input.message,
      stringifyJson(input.rawJson),
    )
    .run();
  return eventId;
}

async function updateOwnerNotificationChannelEvent(
  env: Env,
  input: {
    eventId: string;
    status: "sent" | "failed";
    providerMessageId: string | null;
    rawJson: unknown;
    errorMessage: string | null;
  },
) {
  await env.DB.prepare(
    `UPDATE agent_channel_events
     SET status = ?,
         provider_message_id = ?,
         raw_json = ?,
         error_message = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(
      input.status,
      input.providerMessageId,
      stringifyJson(input.rawJson),
      input.errorMessage,
      input.eventId,
    )
    .run();
}

async function updateOwnerNotificationConnectionSentAt(env: Env, connectionId: string) {
  await env.DB.prepare(
    `UPDATE agent_channel_connections
     SET last_outbound_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(connectionId)
    .run();
}

async function loadAssistantJobOwnerContext(
  env: Env,
  userId: string,
  failedSources: Me3AgentContextSource[],
) {
  try {
    const row = await env.DB.prepare(
      "SELECT id, name, username, bio, timezone FROM owner_profile WHERE id = ?",
    )
      .bind(userId)
      .first<OwnerProfileContextRow>();
    if (!row) return null;
    return {
      displayName: row.name,
      username: row.username,
      bio: row.bio,
      timezone: row.timezone,
      source: contextSource({
        id: row.id,
        kind: "owner_profile",
        label: "Owner profile",
        visibility: "public",
        reason: "Always include a small owner profile.",
      }),
    };
  } catch {
    failedSources.push(failedContextSource("owner-profile", "owner_profile", "Owner profile"));
    return null;
  }
}

async function loadAssistantJobProjectsContext(
  env: Env,
  userId: string,
  failedSources: Me3AgentContextSource[],
): Promise<Me3AgentContextProject[]> {
  try {
    const rows = await env.DB.prepare(
      `SELECT id, name, slug, description, status, source_ref, updated_at
       FROM mission_projects
       WHERE user_id = ? AND status != 'archived'
       ORDER BY updated_at DESC
       LIMIT 30`,
    )
      .bind(userId)
      .all<MissionProjectContextRow>();
    return (rows.results || []).map((row) => ({
      id: row.id,
      name: row.name,
      aliases: [row.slug].filter((value): value is string => Boolean(value)),
      summary: row.description,
      status: row.status,
      source: contextSource({
        id: row.id,
        kind: "project",
        label: row.name,
        visibility: "private",
        sourceRef: row.source_ref,
        updatedAt: row.updated_at,
      }),
    }));
  } catch {
    failedSources.push(failedContextSource("mission-projects", "project", "Mission projects"));
    return [];
  }
}

async function loadAssistantJobTasksContext(
  env: Env,
  userId: string,
  failedSources: Me3AgentContextSource[],
): Promise<Me3AgentContextTask[]> {
  try {
    const rows = await env.DB.prepare(
      `SELECT id, project_id, title, description, status, due_at, scheduled_for,
              source_ref, updated_at
       FROM mission_tasks
       WHERE user_id = ?
         AND archived_at IS NULL
         AND status NOT IN ('done', 'cancelled')
         AND (source_ref IS NULL OR source_ref NOT LIKE 'weekly-review:%')
       ORDER BY priority ASC, COALESCE(due_at, scheduled_for, updated_at) ASC
       LIMIT 50`,
    )
      .bind(userId)
      .all<MissionTaskContextRow>();
    return (rows.results || []).map((row) => {
      const description = richTextToPlainText(row.description);
      return {
        id: row.id,
        title: description ? `${row.title}: ${description}` : row.title,
        status: row.status,
        dueAt: row.due_at || row.scheduled_for,
        projectId: row.project_id,
        source: contextSource({
          id: row.id,
          kind: "task",
          label: row.title,
          visibility: "private",
          sourceRef: row.source_ref,
          updatedAt: row.updated_at,
        }),
      };
    });
  } catch {
    failedSources.push(failedContextSource("mission-tasks", "task", "Mission tasks"));
    return [];
  }
}

function richTextToPlainText(value: string | null) {
  if (!value) return "";
  return stripRichTextHtml(decodeHtmlEntities(value))
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string) {
  let decoded = "";
  let index = 0;
  while (index < value.length) {
    if (value[index] !== "&") {
      decoded += value[index];
      index += 1;
      continue;
    }
    const end = value.indexOf(";", index + 1);
    if (end < 0 || end - index > 12) {
      decoded += value[index];
      index += 1;
      continue;
    }
    const replacement = decodeHtmlEntity(value.slice(index + 1, end));
    if (replacement === null) {
      decoded += value[index];
      index += 1;
      continue;
    }
    decoded += replacement;
    index = end + 1;
  }
  return decoded;
}

function decodeHtmlEntity(entity: string): string | null {
  switch (entity.toLowerCase()) {
    case "nbsp": return " ";
    case "amp": return "&";
    case "lt": return "<";
    case "gt": return ">";
    case "quot": return '"';
    case "#39": return "'";
  }
  if (!entity.startsWith("#")) return null;
  const hexadecimal = entity[1]?.toLowerCase() === "x";
  const digits = entity.slice(hexadecimal ? 2 : 1);
  if (!digits || !isHtmlEntityNumber(digits, hexadecimal ? 16 : 10)) return null;
  const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return null;
  return String.fromCodePoint(codePoint);
}

function isHtmlEntityNumber(value: string, radix: 10 | 16): boolean {
  for (const character of value.toLowerCase()) {
    const code = character.charCodeAt(0);
    const digit = code >= 48 && code <= 57;
    const hexLetter = radix === 16 && code >= 97 && code <= 102;
    if (!digit && !hexLetter) return false;
  }
  return true;
}

function stripRichTextHtml(value: string): string {
  let text = "";
  let ignoredContentTag: "script" | "style" | null = null;
  let index = 0;
  while (index < value.length) {
    if (value[index] !== "<") {
      if (!ignoredContentTag) text += value[index];
      index += 1;
      continue;
    }
    const tagEnd = findRichTextTagEnd(value, index + 1);
    if (tagEnd < 0) {
      if (!ignoredContentTag) text += value[index];
      index += 1;
      continue;
    }
    const tag = parseRichTextTag(value.slice(index + 1, tagEnd));
    if (!ignoredContentTag) {
      text += " ";
      if (!tag?.closing && (tag?.name === "script" || tag?.name === "style")) {
        ignoredContentTag = tag.name;
      }
    } else if (tag?.closing && tag.name === ignoredContentTag) {
      ignoredContentTag = null;
      text += " ";
    }
    index = tagEnd + 1;
  }
  return text;
}

function findRichTextTagEnd(value: string, start: number): number {
  let quote: "'" | '"' | null = null;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

function parseRichTextTag(value: string): { name: string; closing: boolean } | null {
  let index = 0;
  while (isRichTextWhitespace(value[index] || "")) index += 1;
  const closing = value[index] === "/";
  if (closing) index += 1;
  while (isRichTextWhitespace(value[index] || "")) index += 1;
  const start = index;
  while (isRichTextTagNameCharacter(value[index] || "")) index += 1;
  if (index === start) return null;
  return { name: value.slice(start, index).toLowerCase(), closing };
}

function isRichTextTagNameCharacter(value: string): boolean {
  const code = value.charCodeAt(0);
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) || value === "-";
}

function isRichTextWhitespace(value: string): boolean {
  return value === " " || value === "\t" || value === "\n" || value === "\r";
}

async function loadAssistantJobMemoryContext(
  env: Env,
  userId: string,
  failedSources: Me3AgentContextSource[],
): Promise<Me3AgentContextPrivateMemory[]> {
  try {
    const rows = await env.DB.prepare(
      `SELECT id, memory_kind, scope_kind, scope_id, title, body, confidence,
              source_ref, updated_at
       FROM mission_private_memory
       WHERE user_id = ? AND review_status = 'active'
       ORDER BY updated_at DESC
       LIMIT 40`,
    )
      .bind(userId)
      .all<MissionMemoryContextRow>();
    return (rows.results || []).map((row) => ({
      id: row.id,
      kind: row.memory_kind,
      title: row.title,
      body: row.body,
      scope: row.scope_id ? `${row.scope_kind}:${row.scope_id}` : row.scope_kind,
      confidence: row.confidence,
      source: contextSource({
        id: row.id,
        kind: "private_memory",
        label: row.title || row.memory_kind,
        visibility: "private",
        sourceRef: row.source_ref,
        updatedAt: row.updated_at,
      }),
    }));
  } catch {
    failedSources.push(failedContextSource("mission-memory", "private_memory", "Private memory"));
    return [];
  }
}

async function loadAssistantJobCalendarContext(
  env: Env,
  userId: string,
  failedSources: Me3AgentContextSource[],
): Promise<Me3AgentContextCalendarEvent[]> {
  try {
    const rows = await env.DB.prepare(
      `SELECT id, title, notes, starts_at, ends_at, timezone, created_at, updated_at
       FROM user_calendar_events
       WHERE user_id = ?
       ORDER BY starts_at ASC
       LIMIT 30`,
    )
      .bind(userId)
      .all<CalendarEventContextRow>();
    return (rows.results || []).map((row) => ({
      id: row.id,
      title: row.notes ? `${row.title}: ${row.notes}` : row.title,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      timezone: row.timezone,
      source: contextSource({
        id: row.id,
        kind: "calendar_event",
        label: row.title,
        visibility: "private",
        updatedAt: row.updated_at || row.created_at,
      }),
    }));
  } catch {
    failedSources.push(failedContextSource("calendar-events", "calendar_event", "Calendar events"));
    return [];
  }
}

async function loadAssistantJobRecentMessagesContext(
  env: Env,
  userId: string,
  failedSources: Me3AgentContextSource[],
): Promise<Me3AgentContextRecentMessage[]> {
  try {
    const rows = await env.DB.prepare(
      `SELECT id, role, content, created_at
       FROM assistant_messages
       WHERE owner_id = ?
       ORDER BY created_at DESC
       LIMIT 12`,
    )
      .bind(userId)
      .all<AssistantMessageContextRow>();
    return (rows.results || []).map((row, index) => ({
      id: row.id || `recent-${index + 1}`,
      role: row.role,
      content: row.content,
      createdAt: row.created_at || null,
      source: contextSource({
        id: row.id || `recent-${index + 1}`,
        kind: "assistant_message",
        label: "Recent chat",
        visibility: "private",
        updatedAt: row.created_at || null,
      }),
    }));
  } catch {
    failedSources.push(failedContextSource("assistant-messages", "assistant_message", "Recent chat"));
    return [];
  }
}

async function getAssistantJobIngressEventByIdempotencyKey(
  env: Env,
  userId: string,
  idempotencyKey: string,
) {
  return env.DB.prepare(
    "SELECT * FROM assistant_job_ingress_events WHERE user_id = ? AND idempotency_key = ?",
  )
    .bind(userId, idempotencyKey)
    .first<AssistantJobIngressEventRow>();
}

async function requireAssistantJobIngressEvent(env: Env, userId: string, eventId: string) {
  const event = await env.DB.prepare(
    "SELECT * FROM assistant_job_ingress_events WHERE id = ? AND user_id = ?",
  )
    .bind(eventId, userId)
    .first<AssistantJobIngressEventRow>();
  if (!event) throw new AssistantJobsInputError("Assistant Job ingress event not found", 404);
  return event;
}

async function enqueueAssistantJobIngressEvent(env: Env, row: AssistantJobIngressEventRow) {
  if (!env.ASSISTANT_JOB_EVENTS) return false;

  try {
    await env.ASSISTANT_JOB_EVENTS.send({ eventId: row.id, userId: row.user_id });
    await setAssistantJobIngressEventStatus(env, row.user_id, row.id, "queued", {
      queuedAt: new Date().toISOString(),
    }, row);
    return true;
  } catch (error) {
    await setAssistantJobIngressEventStatus(env, row.user_id, row.id, "failed", {
      queueFailedAt: new Date().toISOString(),
      errorMessage: getErrorMessage(error),
    }, row);
    throw error;
  }
}

async function setAssistantJobIngressEventStatus(
  env: Env,
  userId: string,
  eventId: string,
  status: AssistantJobIngressStatus,
  payloadPatch?: Record<string, unknown>,
  existing?: AssistantJobIngressEventRow,
) {
  const row = existing || (await requireAssistantJobIngressEvent(env, userId, eventId));
  const payload = parseJson<Record<string, unknown>>(row.payload_json, {});
  const nextPayload = payloadPatch ? { ...payload, ...payloadPatch } : payload;

  await env.DB.prepare(
    `UPDATE assistant_job_ingress_events
     SET status = ?, payload_json = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
  )
    .bind(status, stringifyJson(nextPayload), eventId, userId)
    .run();

  return requireAssistantJobIngressEvent(env, userId, eventId);
}

async function appendAssistantJobMissionActivity(
  env: Env,
  userId: string,
  input: {
    activityType: string;
    title: string;
    summary?: string | null;
    status?: string | null;
    relatedId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  try {
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO mission_plugin_activity
         (id, user_id, plugin_id, activity_type, title, summary, status, related_id, metadata_json, created_at)
       VALUES (?, ?, 'me3.assistant-jobs', ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        userId,
        input.activityType,
        input.title,
        input.summary || null,
        input.status || null,
        input.relatedId || null,
        stringifyJson(input.metadata || {}),
        now,
      )
      .run();
  } catch {
    // Activity logging should not make queue failure handling fail again.
  }
}

function draftFromVersion(job: AssistantJobRow, version: AssistantJobVersionRow): AssistantJobDraft {
  return {
    name: version.name,
    purpose: version.purpose,
    recipeId: job.recipe_id,
    trigger: parseJson(version.trigger_json, { kind: "manual" }) as AssistantJobDraft["trigger"],
    scope: parseJson(version.scope_json, {
      projectId: null,
      sourceIds: [],
      providerAccountIds: [],
      filters: [],
    }) as AssistantJobDraft["scope"],
    rules: parseJson(version.rules_json, []),
    actions: parseJson(version.actions_json, []),
    approvalPolicy: parseJson(version.approval_policy_json, {
      defaultMode: "review_required",
      overrides: [],
      ownerCanApproveFrom: "mission_control",
      approvalExpiresAfterHours: null,
    }) as AssistantJobDraft["approvalPolicy"],
    destination: parseJson(version.destination_json, {
      kind: "mission_control",
      projectId: null,
      landing: "review_packet",
      quietIfNoChanges: true,
    }) as AssistantJobDraft["destination"],
    projectId: job.project_id,
    recommendedSkillIds: parseJson(version.recommended_skill_ids_json, []),
    requiredSkillIds: parseJson(version.required_skill_ids_json, []),
  };
}

function candidateVersionFromRow(row: AssistantJobMatchCandidateRow): AssistantJobVersionRow {
  return {
    id: row.version_id,
    job_id: row.id,
    user_id: row.user_id,
    version_number: row.version_number,
    name: row.version_name,
    purpose: row.version_purpose,
    trigger_json: row.candidate_trigger_json,
    scope_json: row.candidate_scope_json,
    rules_json: row.candidate_rules_json,
    actions_json: row.candidate_actions_json,
    approval_policy_json: row.candidate_approval_policy_json,
    destination_json: row.candidate_destination_json,
    capability_ids_json: row.candidate_capability_ids_json,
    permission_summary_json: row.candidate_permission_summary_json,
    recommended_skill_ids_json: row.candidate_recommended_skill_ids_json,
    required_skill_ids_json: row.candidate_required_skill_ids_json,
    validation_status: row.candidate_validation_status,
    validation_errors_json: row.candidate_validation_errors_json,
    created_at: row.version_created_at,
  };
}

function assistantJobCandidateMatchesEvent(
  candidate: AssistantJobMatchCandidateRow,
  event: AssistantJobIngressEventRow,
) {
  const trigger = parseJson<AssistantJobDraft["trigger"]>(candidate.candidate_trigger_json, {
    kind: "manual",
  });
  if (trigger.kind !== "event") return false;
  if (trigger.source !== event.source_kind) return false;
  if (trigger.sourceId !== event.source_id) return false;
  if (trigger.eventType !== event.event_type) return false;
  return trigger.filters.every((filter) =>
    matchesEventFilter(
      parseJson(event.payload_json, {}),
      filter.field,
      filter.operator,
      filter.value,
    ),
  );
}

function matchesEventFilter(
  payload: Record<string, unknown>,
  field: string,
  operator: string,
  expected: unknown,
) {
  const actual = getValueAtPath(payload, field);
  if (operator === "equals") return actual === expected;
  if (operator === "contains") {
    if (typeof actual === "string") return actual.includes(String(expected));
    if (Array.isArray(actual)) return actual.includes(expected);
    return false;
  }
  if (operator === "starts_with") {
    return typeof actual === "string" && actual.startsWith(String(expected));
  }
  if (operator === "in") {
    return Array.isArray(expected) && expected.includes(actual);
  }
  return false;
}

function getValueAtPath(payload: Record<string, unknown>, path: string) {
  return path.split(".").reduce<unknown>((value, part) => {
    if (!isRecord(value)) return undefined;
    return value[part];
  }, payload);
}

function resolveActionApprovalMode(
  draft: AssistantJobDraft,
  action: AssistantJobAction,
  capability: AssistantCapability,
): AssistantJobApprovalMode {
  const override = draft.approvalPolicy.overrides.find(
    (entry) => entry.capabilityId === capability.id,
  )?.mode;
  return strongestApprovalMode([
    draft.approvalPolicy.defaultMode,
    capability.approvalMode,
    action.approvalMode,
    override,
  ]);
}

function strongestApprovalMode(modes: readonly (AssistantJobApprovalMode | undefined)[]) {
  const order: Record<AssistantJobApprovalMode, number> = {
    none: 0,
    review_required: 1,
    approval_required: 2,
    forbidden: 3,
  };
  return modes.reduce<AssistantJobApprovalMode>((strongest, mode) => {
    if (!mode) return strongest;
    return order[mode] > order[strongest] ? mode : strongest;
  }, "none");
}

function buildActionIdempotencyKey(run: AssistantJobRunRow, action: AssistantJobAction) {
  if (action.idempotencyScope === "source_event" && run.trigger_ref) {
    return `${run.user_id}:${run.job_id}:${action.id}:${run.trigger_ref}`;
  }
  return `${run.id}:${action.id}`;
}

function missionOutputId(run: AssistantJobRunRow, action: AssistantJobAction, kind: string) {
  return `assistant-job-output:${run.id}:${action.id}:${kind}`;
}

function missionTextInput(action: AssistantJobAction, key: string) {
  return normalizeNullableText(action.inputs[key]);
}

async function buildDailyBriefingRenderContext(
  env: Env,
  userId: string,
): Promise<DailyBriefingRenderContext> {
  const owner = await env.DB.prepare(
    "SELECT id, name, username, bio, timezone FROM owner_profile WHERE id = ?",
  )
    .bind(userId)
    .first<OwnerProfileContextRow>()
    .catch(() => null);
  const timezone = owner?.timezone || "UTC";
  const now = new Date();
  const dateKey = dateKeyInTimezone(now, timezone);
  const dateLabel = formatFriendlyDate(dateKey, timezone);
  const { start, end } = utcWindowForLocalDate(dateKey, timezone);
  const [events, bookings, reminders, tasks] = await Promise.all([
    loadDailyBriefingEvents(env, userId, start, end),
    loadDailyBriefingBookings(env, userId, start, end, timezone),
    loadDailyBriefingReminders(env, userId, start, end),
    loadDailyBriefingTasks(env, userId),
  ]);
  const calendarEvents = [...events, ...bookings].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const dueTaskCount = tasks.filter((task) => task.dueAt?.slice(0, 10) === dateKey).length;

  return {
    ownerName: owner?.name || owner?.username || "there",
    dateKey,
    dateLabel,
    calendarSummary: formatDailyCalendarSummary(calendarEvents, dateLabel),
    calendarEvents: formatDailyCalendarEvents(calendarEvents, timezone),
    calendarReminders: formatDailyReminders(reminders, timezone),
    missionTasks: formatDailyTasks(tasks, dateKey),
    sections: buildDailyBriefingSections(
      calendarEvents,
      reminders,
      tasks,
      dateKey,
      dateLabel,
      timezone,
    ),
    notification: {
      ownerName: dailyBriefingPushOwnerName(owner?.name),
      counts: {
        reminders: reminders.length,
        tasks: dueTaskCount,
        bookings: bookings.length,
      },
    },
  };
}

function dailyBriefingPushOwnerName(value: unknown) {
  const name = normalizeNullableText(value);
  if (!name || /^ME3(?:\s+Core)?\s+Owner$/i.test(name)) return null;
  return name;
}

function buildDailyBriefingSections(
  events: CalendarEventContextRow[],
  reminders: DailyBriefingReminderRow[],
  tasks: DailyBriefingTask[],
  dateKey: string,
  dateLabel: string,
  fallbackTimezone: string,
): DailyBriefingSection[] {
  const dueTasks = tasks.filter((task) => task.dueAt?.slice(0, 10) === dateKey);
  return [
    {
      kind: "calendar",
      title: "Calendar",
      summary: formatDailyCalendarSummary(events, dateLabel),
      items: events.slice(0, 4).map((event) => ({
        id: event.id,
        title: event.title,
        detail: formatTimeInTimezone(event.starts_at, event.timezone || fallbackTimezone),
      })),
    },
    {
      kind: "reminders",
      title: "Reminders",
      summary: reminders.length === 0
        ? "No reminders due today."
        : `${reminders.length} reminder${reminders.length === 1 ? "" : "s"} due today.`,
      items: reminders.slice(0, 4).map((reminder) => ({
        id: reminder.id,
        title: reminder.title,
        detail: formatTimeInTimezone(
          reminder.remind_at,
          reminder.timezone || fallbackTimezone,
        ),
      })),
    },
    {
      kind: "tasks",
      title: "Tasks",
      summary: dueTasks.length === 0
        ? "No tasks due today."
        : `${dueTasks.length} task${dueTasks.length === 1 ? "" : "s"} due today.`,
      items: dueTasks.slice(0, 4).map((task) => ({
        id: task.id,
        title: task.title,
        detail: formatDailyBriefingTaskDetail(task.description),
      })),
    },
  ];
}

function renderDailyBriefingMessage(context: DailyBriefingRenderContext, template: string) {
  const values: Record<string, string> = {
    "owner.name": context.ownerName,
    "today.date": context.dateLabel,
    "calendar.summary": context.calendarSummary,
    "calendar.events": context.calendarEvents,
    "calendar.reminders": context.calendarReminders,
    "mission.tasks": context.missionTasks,
  };
  const rendered = template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    return values[key] ?? "";
  });
  return rendered
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function getLiveDailyBriefing(env: Env, userId: string) {
  const context = await buildDailyBriefingRenderContext(env, userId);
  const job = await findExistingAssistantJobForRecipe(env, userId, "daily-briefing");
  const version = job?.current_version_id
    ? await env.DB.prepare("SELECT * FROM assistant_job_versions WHERE id = ? AND user_id = ?")
        .bind(job.current_version_id, userId)
        .first<AssistantJobVersionRow>()
    : null;
  const draft = job && version ? draftFromVersion(job, version) : null;
  const notifyAction = draft?.actions.find(
    (action) => action.capabilityId === "message.owner.notify",
  );
  const template = notifyAction
    ? missionTextInput(notifyAction, "messageTemplate") ||
      missionTextInput(notifyAction, "message") ||
      DEFAULT_DAILY_BRIEFING_MESSAGE_TEMPLATE
    : DEFAULT_DAILY_BRIEFING_MESSAGE_TEMPLATE;
  const message = renderDailyBriefingMessage(
    context,
    template,
  );
  return {
    id: `live:${context.dateKey}`,
    title: `Daily Briefing: ${context.dateLabel}`,
    version: 1,
    message,
    plainText: message,
    date: context.dateKey,
    sections: context.sections,
    createdAt: new Date().toISOString(),
    status: "live",
    relatedId: null,
  };
}

async function loadDailyBriefingEvents(
  env: Env,
  userId: string,
  start: string,
  end: string,
) {
  const rows = await env.DB.prepare(
    `SELECT id, title, notes, starts_at, ends_at, timezone, created_at, updated_at
     FROM user_calendar_events
     WHERE user_id = ? AND starts_at < ? AND ends_at > ?
     ORDER BY starts_at ASC
     LIMIT 12`,
  )
    .bind(userId, end, start)
    .all<CalendarEventContextRow>()
    .catch(() => ({ results: [] as CalendarEventContextRow[] }));
  return (rows.results || []).filter((event) => event.starts_at < end && event.ends_at > start);
}

async function loadDailyBriefingBookings(
  env: Env,
  userId: string,
  start: string,
  end: string,
  timezone: string,
) {
  const rows = await env.DB.prepare(
    `SELECT b.id, b.guest_name, b.starts_at, b.ends_at, b.created_at, b.cancelled_at AS updated_at
     FROM bookings b
     JOIN sites s ON b.site_id = s.id
     WHERE s.user_id = ? AND b.status = 'confirmed'
       AND b.starts_at < ? AND b.ends_at > ?
     ORDER BY b.starts_at ASC
     LIMIT 12`,
  )
    .bind(userId, end, start)
    .all<DailyBriefingBookingRow>()
    .catch(() => ({ results: [] as DailyBriefingBookingRow[] }));

  return (rows.results || [])
    .filter((booking) => booking.starts_at < end && booking.ends_at > start)
    .map((booking): CalendarEventContextRow => ({
      id: `booking:${booking.id}`,
      title: `Booking with ${booking.guest_name}`,
      notes: null,
      starts_at: booking.starts_at,
      ends_at: booking.ends_at,
      timezone,
      created_at: booking.created_at,
      updated_at: booking.updated_at,
    }));
}

async function loadDailyBriefingReminders(
  env: Env,
  userId: string,
  start: string,
  end: string,
) {
  const rows = await env.DB.prepare(
    `SELECT id, title, notes, remind_at, timezone, status
     FROM user_reminders
     WHERE user_id = ? AND status = 'pending' AND remind_at >= ? AND remind_at < ?
     ORDER BY remind_at ASC
     LIMIT 12`,
  )
    .bind(userId, start, end)
    .all<DailyBriefingReminderRow>()
    .catch(() => ({ results: [] as DailyBriefingReminderRow[] }));
  return (rows.results || []).filter(
    (reminder) => reminder.status === "pending" && reminder.remind_at >= start && reminder.remind_at < end,
  );
}

async function loadDailyBriefingTasks(env: Env, userId: string) {
  try {
    const rows = await env.DB.prepare(
      `SELECT id, project_id, title, description, status, due_at, scheduled_for,
              source_ref, updated_at
       FROM mission_tasks
       WHERE user_id = ?
         AND archived_at IS NULL
         AND status NOT IN ('done', 'cancelled')
         AND (source_ref IS NULL OR source_ref NOT LIKE 'weekly-review:%')
       ORDER BY priority ASC, COALESCE(due_at, scheduled_for, updated_at) ASC
       LIMIT 50`,
    )
      .bind(userId)
      .all<MissionTaskContextRow>();
    return (rows.results || []).map((row): DailyBriefingTask => ({
      id: row.id,
      title: row.title,
      description: richTextToPlainText(row.description),
      status: row.status,
      dueAt: row.due_at || row.scheduled_for,
      projectId: row.project_id,
      source: contextSource({
        id: row.id,
        kind: "task",
        label: row.title,
        visibility: "private",
        sourceRef: row.source_ref,
        updatedAt: row.updated_at,
      }),
    }));
  } catch {
    return [];
  }
}

function formatDailyCalendarSummary(events: CalendarEventContextRow[], dateLabel: string) {
  if (events.length === 0) return `Your calendar is clear for ${dateLabel}.`;
  if (events.length === 1) return `You have 1 calendar event for ${dateLabel}.`;
  return `You have ${events.length} calendar events for ${dateLabel}.`;
}

function formatDailyCalendarEvents(events: CalendarEventContextRow[], fallbackTimezone: string) {
  if (events.length === 0) return "";
  return [
    "Calendar:",
    ...events.slice(0, 4).map((event) => {
      const time = formatTimeInTimezone(event.starts_at, event.timezone || fallbackTimezone);
      return `- ${time} ${event.title}`;
    }),
  ].join("\n");
}

function formatDailyReminders(reminders: DailyBriefingReminderRow[], fallbackTimezone: string) {
  if (reminders.length === 0) return "";
  const count = reminders.length;
  return [
    `Reminders: ${count} due today.`,
    ...reminders.slice(0, 4).map((reminder) => {
      const time = formatTimeInTimezone(reminder.remind_at, reminder.timezone || fallbackTimezone);
      return `- ${time} ${reminder.title}`;
    }),
  ].join("\n");
}

const DAILY_BRIEFING_TASK_DETAIL_LIMIT = 180;

function formatDailyBriefingTaskDetail(description: string | null | undefined) {
  const normalized = description?.trim() || "";
  if (!normalized) return null;
  if (normalized.length <= DAILY_BRIEFING_TASK_DETAIL_LIMIT) return normalized;
  return `${normalized.slice(0, DAILY_BRIEFING_TASK_DETAIL_LIMIT - 1).trimEnd()}…`;
}

function formatDailyTasks(tasks: DailyBriefingTask[], dateKey: string) {
  const due = tasks.filter((task) => {
    const dueAt = task.dueAt;
    return dueAt?.slice(0, 10) === dateKey;
  });
  if (due.length === 0) return "";
  return [
    `Tasks: ${due.length} task${due.length === 1 ? "" : "s"} due today.`,
    ...due.slice(0, 4).map((task) => {
      const detail = formatDailyBriefingTaskDetail(task.description);
      return `- ${task.title}${detail ? `: ${detail}` : ""}`;
    }),
  ].join("\n");
}

function isWeeklyReviewJob(job: AssistantJobRow, draft: AssistantJobDraft) {
  return job.recipe_id === "weekly-review" || draft.recipeId === "weekly-review";
}

async function buildWeeklyReviewResult(env: Env, userId: string, runId: string) {
  const now = new Date();
  const reviewDate = now.toISOString().slice(0, 10);
  const weekStart = addIsoDays(reviewDate, -6);
  const [openTasks, completedTasks, reminders, memoryRows] = await Promise.all([
    loadWeeklyReviewOpenTasks(env, userId),
    loadWeeklyReviewCompletedTasks(env, userId, weekStart, reviewDate),
    loadWeeklyReviewReminders(env, userId, now.toISOString()),
    loadWeeklyReviewMemoryRows(env, userId),
  ]);
  const taskSummary = summarizeWeeklyReviewTasks(openTasks, completedTasks, reminders);
  const memorySuggestions = suggestWeeklyReviewMemory(memoryRows, openTasks);

  return {
    kind: "weekly_review",
    version: 1,
    runId,
    reviewDate,
    weekStart,
    weekEnd: reviewDate,
    weekLabel: `${weekStart} to ${reviewDate}`,
    openTasks: openTasks.map((task) => ({
      id: task.id,
      title: task.title,
      projectId: task.projectId,
      dueAt: task.dueAt,
      status: task.status,
      suggestedCarryOver: true,
    })),
    completedTasks: completedTasks.map((task) => ({
      id: task.id,
      title: task.title,
      projectId: task.projectId,
      completedAt: task.updatedAt,
    })),
    reminders: reminders.map((reminder) => ({
      id: reminder.id,
      title: reminder.title,
      remindAt: reminder.remind_at,
      status: reminder.status,
    })),
    journalSummary: taskSummary,
    memorySuggestions,
  };
}

async function loadWeeklyReviewOpenTasks(env: Env, userId: string) {
  return loadAssistantJobTasksContext(env, userId, []);
}

async function loadWeeklyReviewCompletedTasks(
  env: Env,
  userId: string,
  weekStart: string,
  weekEnd: string,
) {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, project_id, title, description, status, priority, due_at,
            scheduled_for, source_kind, source_ref, approval_id, metadata_json,
            created_at, updated_at, archived_at
     FROM mission_tasks
     WHERE user_id = ?
       AND status = 'done'
       AND (source_ref IS NULL OR source_ref NOT LIKE 'weekly-review:%')
       AND substr(updated_at, 1, 10) >= ?
       AND substr(updated_at, 1, 10) <= ?
     ORDER BY updated_at DESC
     LIMIT 20`,
  )
    .bind(userId, weekStart, weekEnd)
    .all<MissionTaskContextRow>()
    .catch(() => ({ results: [] as MissionTaskContextRow[] }));

  return (rows.results || []).map((row) => ({
    id: row.id,
    title: row.title,
    projectId: row.project_id,
    updatedAt: row.updated_at,
  }));
}

async function loadWeeklyReviewReminders(env: Env, userId: string, now: string) {
  const rows = await env.DB.prepare(
    `SELECT id, title, remind_at, status
     FROM user_reminders
     WHERE user_id = ? AND status = 'pending' AND remind_at >= ?
     ORDER BY remind_at ASC
     LIMIT 20`,
  )
    .bind(userId, now)
    .all<WeeklyReviewReminderRow>()
    .catch(() => ({ results: [] as WeeklyReviewReminderRow[] }));
  return rows.results || [];
}

async function loadWeeklyReviewMemoryRows(env: Env, userId: string) {
  const rows = await env.DB.prepare(
    `SELECT id, title, body
     FROM mission_private_memory
     WHERE user_id = ? AND review_status = 'active'
     ORDER BY updated_at DESC
     LIMIT 100`,
  )
    .bind(userId)
    .all<WeeklyReviewMemoryRow>()
    .catch(() => ({ results: [] as WeeklyReviewMemoryRow[] }));
  return rows.results || [];
}

function summarizeWeeklyReviewTasks(
  openTasks: Me3AgentContextTask[],
  completedTasks: Array<{ title: string }>,
  reminders: WeeklyReviewReminderRow[],
) {
  return [
    `${openTasks.length} open task${openTasks.length === 1 ? "" : "s"}`,
    `${completedTasks.length} completed this week`,
    `${reminders.length} upcoming reminder${reminders.length === 1 ? "" : "s"}`,
  ].join(", ");
}

function suggestWeeklyReviewMemory(
  memoryRows: WeeklyReviewMemoryRow[],
  openTasks: Me3AgentContextTask[],
) {
  void memoryRows;
  void openTasks;
  return [];
}

function formatWeeklyReviewReadyMessage(review: Awaited<ReturnType<typeof buildWeeklyReviewResult>>) {
  const openLabel = `${review.openTasks.length} open task${review.openTasks.length === 1 ? "" : "s"}`;
  const completedLabel = `${review.completedTasks.length} completed`;
  return `Your weekly task review is ready. You have ${openLabel}, and ${completedLabel} over the last 7 days.`;
}

function sharedSignificantWordCount(left: string, right: string) {
  if (left === right) return 0;
  const leftWords = significantWords(left);
  const rightWords = significantWords(right);
  return leftWords.filter((word) => rightWords.includes(word)).length;
}

function significantWords(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 5);
}

function addIsoDays(date: string, delta: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + delta);
  return parsed.toISOString().slice(0, 10);
}

function dateKeyInTimezone(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value || "1970";
  const month = parts.find((part) => part.type === "month")?.value || "01";
  const day = parts.find((part) => part.type === "day")?.value || "01";
  return `${year}-${month}-${day}`;
}

function formatFriendlyDate(dateKey: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${dateKey}T12:00:00.000Z`));
}

function utcWindowForLocalDate(dateKey: string, timezone: string) {
  const start = zonedLocalTimeToUtc(dateKey, "00:00", timezone);
  const end = zonedLocalTimeToUtc(dateKey, "24:00", timezone);
  return { start: start.toISOString(), end: end.toISOString() };
}

function zonedLocalTimeToUtc(dateKey: string, time: string, timezone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute || 0, 0);
  const offset = timezoneOffsetMs(new Date(guess), timezone);
  return new Date(guess - offset);
}

function timezoneOffsetMs(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(map.get("year")),
    Number(map.get("month")) - 1,
    Number(map.get("day")),
    Number(map.get("hour")) % 24,
    Number(map.get("minute")),
    Number(map.get("second")),
  );
  return asUtc - date.getTime();
}

function formatTimeInTimezone(value: string, timezone: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function resolveMissionOutputProjectId(
  job: AssistantJobRow,
  draft: AssistantJobDraft,
  action: AssistantJobAction,
) {
  return missionTextInput(action, "projectId")
    || draft.destination.projectId
    || draft.projectId
    || draft.scope.projectId
    || job.project_id
    || null;
}

const INVOICE_SUBJECT_KEYWORDS = [
  "invoice",
  "receipt",
  "billing",
  "payment",
  "statement",
  "subscription",
  "charge",
  "order confirmation",
];
const INVOICE_SENDER_KEYWORDS = [
  "billing",
  "invoice",
  "receipt",
  "stripe",
  "paypal",
  "wise",
  "quickbooks",
  "xero",
];
const INVOICE_BODY_CUES = [
  "amount due",
  "balance due",
  "grand total",
  "invoice number",
  "invoice #",
  "payment received",
  "payment confirmation",
  "thank you for your payment",
];
const INVOICE_NON_TRANSACTIONAL_NOTICE_CUES = [
  "introducing",
  "eligible for",
  "how it works",
  "learn more",
  "for example",
  "available for",
  "available to",
  "allowing you to",
  "new feature",
  "beta",
  "preview",
];
const INVOICE_TRANSACTIONAL_CUE_PATTERN =
  /\b(invoice|receipt|billing statement|amount due|balance due|grand total|invoice number|invoice #|payment received|payment confirmation|thank you for your payment|successful payment|payment of|charged|charge receipt|paid invoice|order confirmation)\b/i;
const INVOICE_AMOUNT_PATTERN =
  /([$€£¥])\s?(\d[\d,]*(?:\.\d{1,2})?)|(?:\b(USD|EUR|GBP|CAD|AUD|NZD|JPY|CHF|SEK|NOK|DKK|SGD|HKD)\b)\s?(\d[\d,]*(?:\.\d{1,2})?)/i;
const INVOICE_LABELLED_AMOUNT_PATTERN =
  /(?:total|amount\s*due|balance\s*due|grand\s*total|subtotal|net\s*amount|invoice\s*total)[:\s]*[$€£¥]?\s?(\d[\d,]*(?:\.\d{1,2})?)/i;
const MIN_INVOICE_MESSAGE_SCORE = 5;
function isInvoiceReceiptTriageJob(job: AssistantJobRow, draft: AssistantJobDraft) {
  return job.recipe_id === "invoice-receipt-triage" || draft.recipeId === "invoice-receipt-triage";
}

async function buildInvoiceReceiptTriageResult(
  env: Env,
  userId: string,
  options: { dryRun: boolean },
): Promise<InvoiceTriageResult> {
  if (!options.dryRun) await ensureDefaultCategories(env, userId, ["expense", "income"]);
  const messages = await loadAssistantJobMailboxMessages(env, userId, 50);
  const defaultCurrency = await getDefaultCommerceCurrency(env, userId);
  const entries: InvoiceExtraction[] = [];
  let candidates = 0;
  let skipped = 0;
  let filed = 0;
  let reviewed = 0;

  for (const message of messages) {
    const score = scoreInvoiceMessage(message);
    if (score < MIN_INVOICE_MESSAGE_SCORE) {
      skipped += 1;
      continue;
    }
    candidates += 1;
    const extraction = extractInvoiceFromMessage(message, score, defaultCurrency);
    if (!extraction) {
      skipped += 1;
      continue;
    }
    entries.push(extraction);

    if (options.dryRun) continue;
    const inserted = await insertInvoiceFinancialEntry(env, userId, extraction);
    if (inserted) {
      filed += 1;
      if (extraction.status === "needs_review") reviewed += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    scanned: messages.length,
    candidates,
    filed: options.dryRun ? entries.length : filed,
    reviewed: options.dryRun
      ? entries.filter((entry) => entry.status === "needs_review").length
      : reviewed,
    skipped,
    entries,
  };
}

async function insertInvoiceFinancialEntry(
  env: Env,
  userId: string,
  extraction: InvoiceExtraction,
) {
  const category = extraction.categoryHint
    ? await getOrCreateCategoryByName(
        env,
        userId,
        extraction.entryType,
        extraction.categoryHint,
      )
    : null;
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO financial_entries
       (id, user_id, entry_type, date, description, category_id, amount_cents,
        currency, status, source, notes, source_ref, source_email_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'email_triage', ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      userId,
      extraction.entryType,
      extraction.date,
      extraction.description,
      category?.id || null,
      extraction.amountCents,
      extraction.currency,
      extraction.status,
      `Auto-triaged from email with ${extraction.confidence} confidence.`,
      extraction.sourceRef,
      extraction.messageId,
    )
    .run();
  return (result.meta?.changes || 0) > 0;
}

function scoreInvoiceMessage(message: MailboxMessageRow) {
  const subject = decodedMessageSubject(message).toLowerCase();
  const from = (message.from_address || "").toLowerCase();
  const body = (message.text_body || "").toLowerCase();
  if (looksLikeNonTransactionalFinanceNotice(subject, body)) return 0;
  let score = 0;
  if (INVOICE_SUBJECT_KEYWORDS.some((keyword) => subject.includes(keyword))) score += 3;
  if (INVOICE_SENDER_KEYWORDS.some((keyword) => from.includes(keyword))) score += 2;
  if (INVOICE_AMOUNT_PATTERN.test(`${subject}\n${body}`)) score += 2;
  for (const cue of INVOICE_BODY_CUES) {
    if (body.includes(cue)) score += 1;
  }
  if (INVOICE_LABELLED_AMOUNT_PATTERN.test(body)) score += 2;
  return score;
}

function looksLikeNonTransactionalFinanceNotice(subject: string, body: string) {
  const text = `${subject}\n${body}`;
  if (INVOICE_TRANSACTIONAL_CUE_PATTERN.test(text)) return false;
  return INVOICE_NON_TRANSACTIONAL_NOTICE_CUES.some((cue) => text.includes(cue));
}

function extractInvoiceFromMessage(
  message: MailboxMessageRow,
  score: number,
  defaultCurrency: string,
): InvoiceExtraction | null {
  const subject = normalizeOptionalText(decodedMessageSubject(message)) || "Invoice";
  const body = normalizeWhitespace(message.text_body || "");
  const combined = `${subject}\n${body}`;
  const amount = parseInvoiceAmount(combined, defaultCurrency);
  if (!amount) return null;
  const confidence = score >= 7 ? "high" : score >= 5 ? "medium" : "low";
  const status = confidence === "high" && looksPaid(combined) ? "paid" : "needs_review";
  return {
    messageId: message.id,
    entryType: inferInvoiceEntryType(message, subject, body),
    description: subject,
    amountCents: amount.amountCents,
    currency: amount.currency,
    date: normalizeMissionDate(message.received_at?.slice(0, 10)) ||
      normalizeMissionDate(message.created_at?.slice(0, 10)) ||
      new Date().toISOString().slice(0, 10),
    status,
    categoryHint: inferInvoiceCategory(message),
    confidence,
    sourceRef: `email:${message.id}`,
  };
}

function decodedMessageSubject(message: MailboxMessageRow) {
  return decodeMimeHeaderValue(message.subject || "");
}

function inferInvoiceEntryType(
  message: MailboxMessageRow,
  subject: string,
  body: string,
): "income" | "expense" {
  const from = (message.from_address || "").toLowerCase();
  const text = `${subject}\n${body}`.toLowerCase();
  if (
    /\b(stripe|paypal|wise)\b/.test(from) &&
    (/\bpayment\s+of\b/.test(text) ||
      /\bpayment\s+received\b/.test(text) ||
      /\bsuccessful\s+payment\b/.test(text) ||
      /\byou\s+received\b/.test(text))
  ) {
    return "income";
  }
  return "expense";
}

function parseInvoiceAmount(text: string, defaultCurrency: string) {
  const amountMatch = text.match(INVOICE_AMOUNT_PATTERN);
  if (amountMatch) {
    const symbol = amountMatch[1];
    const symbolAmount = amountMatch[2];
    const code = amountMatch[3];
    const codeAmount = amountMatch[4];
    const parsed = Number.parseFloat((symbolAmount || codeAmount || "").replace(/,/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) {
      return {
        amountCents: Math.round(parsed * 100),
        currency: currencyFromSymbol(symbol) || normalizeInvoiceCurrency(code) || defaultCurrency,
      };
    }
  }
  const labelledMatch = text.match(INVOICE_LABELLED_AMOUNT_PATTERN);
  if (labelledMatch?.[1]) {
    const parsed = Number.parseFloat(labelledMatch[1].replace(/,/g, ""));
    if (Number.isFinite(parsed) && parsed > 0) {
      return { amountCents: Math.round(parsed * 100), currency: defaultCurrency };
    }
  }
  return null;
}

function currencyFromSymbol(symbol: string | undefined) {
  if (symbol === "$") return "USD";
  if (symbol === "€") return "EUR";
  if (symbol === "£") return "GBP";
  if (symbol === "¥") return "JPY";
  return null;
}

function normalizeInvoiceCurrency(value: string | undefined) {
  const currency = value?.trim().toUpperCase();
  return currency && /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function looksPaid(text: string) {
  const lower = text.toLowerCase();
  return lower.includes("receipt") ||
    lower.includes("paid") ||
    lower.includes("payment received") ||
    lower.includes("payment confirmation") ||
    lower.includes("successful payment") ||
    lower.includes("thank you for your payment");
}

function inferInvoiceCategory(message: MailboxMessageRow) {
  const text = `${decodedMessageSubject(message)}\n${message.from_address || ""}\n${message.text_body || ""}`.toLowerCase();
  if (/\b(hosting|cloudflare|vercel|netlify|aws|google cloud|render)\b/.test(text)) return "Hosting";
  if (/\b(software|subscription|saas|github|notion|linear|figma|openai)\b/.test(text)) return "Software";
  if (/\b(contractor|freelance|consultant)\b/.test(text)) return "Contractor";
  if (/\b(marketing|ads|campaign)\b/.test(text)) return "Marketing";
  if (/\b(travel|hotel|flight|train|taxi|uber)\b/.test(text)) return "Travel";
  return "Other";
}

function formatInvoiceTriageMissionSummary(triage: InvoiceTriageResult) {
  if (triage.candidates === 0) {
    return `Scanned ${triage.scanned} inbox messages. No likely invoices or receipts were found.`;
  }
  const header = `Scanned ${triage.scanned} inbox messages and found ${triage.candidates} likely invoices or receipts. ${triage.filed} account entr${triage.filed === 1 ? "y" : "ies"} ready for the Accounts ledger; ${triage.reviewed} need${triage.reviewed === 1 ? "s" : ""} review.`;
  const lines = triage.entries.slice(0, 5).map((entry) =>
    `- ${entry.description}: ${formatInvoiceAmount(entry.amountCents, entry.currency)} (${entry.status})`,
  );
  return [header, ...lines].join("\n");
}

function formatInvoiceAmount(amountCents: number, currency: string) {
  return `${currency} ${(amountCents / 100).toFixed(2)}`;
}

function invoiceTriageExternalRef(triage: InvoiceTriageResult) {
  return `accounts:${triage.filed}:entries:${triage.reviewed}:review:${triage.candidates}:candidates:${triage.skipped}:skipped`;
}

function invoiceTriageResultFromActionResults(actionResults: SerializedActionResult[]) {
  const ref = actionResults.find((result) => result.externalRef?.startsWith("accounts:"))?.externalRef;
  const match = ref?.match(/^accounts:(\d+):entries:(\d+):review:(\d+):candidates:(\d+):skipped$/);
  if (!match) return null;
  return {
    filed: Number.parseInt(match[1] || "0", 10),
    reviewed: Number.parseInt(match[2] || "0", 10),
    candidates: Number.parseInt(match[3] || "0", 10),
    skipped: Number.parseInt(match[4] || "0", 10),
  };
}

function inboxWatchCountsFromActionResults(actionResults: SerializedActionResult[]) {
  const ref = actionResults.find((result) => result.externalRef?.includes(":drafted:"))?.externalRef;
  const match = ref?.match(/:drafted:(\d+):tasks:(\d+):notified:(\d+):notify_skipped:(\d+)$/);
  if (!match) {
    return { drafted: 0, tasks: 0, notified: 0, notifySkipped: 0 };
  }
  return {
    drafted: Number.parseInt(match[1] || "0", 10),
    tasks: Number.parseInt(match[2] || "0", 10),
    notified: Number.parseInt(match[3] || "0", 10),
    notifySkipped: Number.parseInt(match[4] || "0", 10),
  };
}

async function buildEmailTriageResult(
  env: Env,
  userId: string,
  draft?: AssistantJobDraft,
): Promise<EmailTriageResult> {
  const messages = await loadAssistantJobMailboxMessages(env, userId);
  const items = messages.map((message) => summarizeMailboxMessageForTriage(message, draft));
  const threadKeys = new Set(items.map((item) => item.threadKey || item.id));
  const matchedItems = items.filter((item) => item.matchedRuleIds.length > 0);
  const ruleMatchCounts: Record<string, number> = {};
  for (const item of matchedItems) {
    for (const ruleId of item.matchedRuleIds) {
      ruleMatchCounts[ruleId] = (ruleMatchCounts[ruleId] || 0) + 1;
    }
  }
  return {
    messageCount: items.length,
    threadCount: threadKeys.size,
    matchedCount: matchedItems.length,
    ruleMatchCounts,
    needsReplyCount: matchedItems.filter((item) => item.labels.includes("needs_reply")).length,
    importantCount: matchedItems.filter((item) => item.labels.includes("important")).length,
    items,
  };
}

async function loadAssistantJobMailboxMessages(
  env: Env,
  userId: string,
  limit = 12,
): Promise<MailboxMessageRow[]> {
  const rows = await env.DB.prepare(
    `SELECT m.id, m.mailbox_id, m.thread_key, m.provider_id, m.provider_message_id,
            m.from_address, m.to_address, m.subject, m.text_body, m.agent_summary,
            m.raw_headers_json, m.metadata_json, m.agent_labels_json, m.received_at, m.created_at
     FROM mailbox_messages m
     INNER JOIN mailbox_aliases a ON a.id = m.mailbox_id
     WHERE a.user_id = ?
       AND a.status = 'active'
       AND m.direction = 'inbound'
       AND m.message_kind = 'email'
       AND m.folder = 'inbox'
       AND m.status IN ('received', 'forwarded')
     ORDER BY COALESCE(m.received_at, m.created_at) DESC, m.created_at DESC
     LIMIT ?`,
  )
    .bind(userId, limit)
    .all<MailboxMessageRow>();
  return rows.results || [];
}

async function persistEmailTriageSummaries(env: Env, items: EmailTriageItem[]) {
  const now = new Date().toISOString();
  for (const item of items.slice(0, 12)) {
    await env.DB.prepare(
      `UPDATE mailbox_messages
       SET agent_summary = ?,
           agent_labels_json = ?,
           updated_at = ?
       WHERE id = ?`,
    )
      .bind(item.summary, stringifyJson(item.labels), now, item.id)
      .run();
  }
}

async function executeInboxWatchRuleOutcomes(
  env: Env,
  input: {
    userId: string;
    job: AssistantJobRow;
    run: AssistantJobRunRow;
    draft: AssistantJobDraft;
    action: AssistantJobAction;
    capability: AssistantCapability;
    idempotencyKey: string;
  },
  triage: EmailTriageResult,
): Promise<InboxWatchActionCounts> {
  const counts: InboxWatchActionCounts = {
    drafted: 0,
    tasks: 0,
    notified: 0,
    skippedNotifications: 0,
    draftIds: [],
    taskIds: [],
    notificationIds: [],
  };
  if (input.job.recipe_id !== "email-triage" && input.draft.recipeId !== "email-triage") {
    return counts;
  }

  const rulesById = new Map(normalizeInboxWatchRules(input.draft.rules).map((rule) => [rule.id, rule]));
  const activeMailbox = await getActiveAssistantJobMailbox(env, input.userId);
  const notificationConnection = await getActiveOwnerNotificationConnection(env, input.userId);

  for (const item of triage.items) {
    for (const ruleId of item.matchedRuleIds) {
      const rule = rulesById.get(ruleId);
      if (!rule?.enabled) continue;

      if (rule.actions.draftReply && activeMailbox) {
        const draftId = await createInboxWatchReplyDraft(env, {
          userId: input.userId,
          mailboxId: activeMailbox.id,
          runId: input.run.id,
          jobId: input.job.id,
          rule,
          item,
        });
        if (draftId) {
          counts.drafted += 1;
          counts.draftIds.push(draftId);
        }
      }

      if (rule.actions.notifyOwner) {
        if (!notificationConnection) {
          counts.skippedNotifications += 1;
          continue;
        }
        const notificationId = await sendInboxWatchOwnerNotification(env, {
          connection: notificationConnection,
          runId: input.run.id,
          jobId: input.job.id,
          rule,
          item,
        });
        if (notificationId) {
          counts.notified += 1;
          counts.notificationIds.push(notificationId);
        }
      }
    }
  }

  return counts;
}

async function getActiveAssistantJobMailbox(
  env: Env,
  userId: string,
): Promise<MailboxSetupRow | null> {
  return env.DB.prepare(
    `SELECT id
     FROM mailbox_aliases
     WHERE user_id = ?
       AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
  )
    .bind(userId)
    .first<MailboxSetupRow>();
}

async function createInboxWatchReplyDraft(
  env: Env,
  input: {
    userId: string;
    mailboxId: string;
    runId: string;
    jobId: string;
    rule: InboxWatchRuleConfig;
    item: EmailTriageItem;
  },
): Promise<string | null> {
  const draftId = inboxWatchArtifactId("draft", input.runId, input.item.id, input.rule.id);
  const existing = await env.DB.prepare(
    `SELECT id
     FROM mailbox_messages
     WHERE id = ? AND mailbox_id = ?
     LIMIT 1`,
  )
    .bind(draftId, input.mailboxId)
    .first<{ id: string }>();
  if (existing) return null;

  const now = new Date().toISOString();
  const subject = /^re:/i.test(input.item.subject) ? input.item.subject : `Re: ${input.item.subject}`;
  const body =
    `Hi,\n\nThanks for your email. I have this and will come back to you shortly.\n\nBest,\n`;
  await env.DB.prepare(
    `INSERT INTO mailbox_messages (
       id, mailbox_id, direction, message_kind, status, thread_key,
       from_address, to_address, subject, text_body, html_body,
       metadata_json, source_id, folder, created_by, created_at, updated_at
     )
     VALUES (?, ?, 'outbound', 'draft', 'pending_approval', ?, NULL, ?, ?, ?, NULL, ?, ?, 'drafts', 'assistant_job', ?, ?)`,
  )
    .bind(
      draftId,
      input.mailboxId,
      input.item.threadKey,
      input.item.from,
      subject,
      body,
      stringifyJson({
        assistantJobId: input.jobId,
        assistantJobRunId: input.runId,
        inboxWatchRuleId: input.rule.id,
        inboxWatchRuleLabel: input.rule.label,
        sourceMessageId: input.item.id,
        sourceSummary: input.item.summary,
      }),
      input.item.id,
      now,
      now,
    )
    .run();
  return draftId;
}

async function sendInboxWatchOwnerNotification(
  env: Env,
  input: {
    connection: AgentChannelConnectionRow;
    runId: string;
    jobId: string;
    rule: InboxWatchRuleConfig;
    item: EmailTriageItem;
  },
): Promise<string | null> {
  const providerEventId = `inbox-watch:${input.runId}:${input.item.id}:${input.rule.id}:owner-notify`;
  const existingEvent = await getAgentChannelEventByProviderEventId(
    env,
    input.connection.id,
    providerEventId,
  );
  if (existingEvent?.status === "sent" || existingEvent?.status === "pending") {
    return null;
  }

  const message =
    `Inbox Watch matched ${input.rule.label}: ${input.item.from} - ${input.item.subject}. ` +
    truncateText(input.item.summary, 180);
  const eventId = await insertOwnerNotificationChannelEvent(env, {
    connection: input.connection,
    providerEventId,
    status: "pending",
    message,
    rawJson: {
      assistantJobId: input.jobId,
      assistantJobRunId: input.runId,
      inboxWatchRuleId: input.rule.id,
      sourceMessageId: input.item.id,
    },
  });

  try {
    const response = await fetch(`${getSoulinkApiOrigin(env)}/api/me3/assistant-channel/notify`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.connection.setup_token}`,
        "Content-Type": "application/json",
      },
      body: stringifyJson({
        streamChannelType: input.connection.provider_connection_id || "messaging",
        streamChannelId: input.connection.provider_thread_id,
        messageId: providerEventId,
        messageText: message,
        createdAt: new Date().toISOString(),
      }),
    });
    const payload = await response.json().catch(() => null) as OwnerNotificationResult | null;
    if (!response.ok || payload?.ok !== true) {
      await updateOwnerNotificationChannelEvent(env, {
        eventId,
        status: "failed",
        providerMessageId: normalizeOptionalText(payload?.messageId),
        rawJson: payload,
        errorMessage:
          normalizeOptionalText(payload?.error) ||
          `Soulink notification failed with ${response.status}`,
      });
      return null;
    }
    await updateOwnerNotificationChannelEvent(env, {
      eventId,
      status: "sent",
      providerMessageId:
        normalizeOptionalText(payload.messageId) ||
        normalizeOptionalText(payload.eventId) ||
        providerEventId,
      rawJson: payload,
      errorMessage: null,
    });
    await updateOwnerNotificationConnectionSentAt(env, input.connection.id);
    return eventId;
  } catch (error) {
    await updateOwnerNotificationChannelEvent(env, {
      eventId,
      status: "failed",
      providerMessageId: null,
      rawJson: { errorMessage: getErrorMessage(error) },
      errorMessage: getErrorMessage(error),
    });
    return null;
  }
}

function inboxWatchArtifactId(
  kind: "draft" | "task",
  runId: string,
  messageId: string,
  ruleId: string,
) {
  return `inbox-watch-${kind}:${runId}:${messageId}:${ruleId}`;
}

function summarizeMailboxMessageForTriage(
  row: MailboxMessageRow,
  draft?: AssistantJobDraft,
): EmailTriageItem {
  const subject = normalizeOptionalText(row.subject) || "(no subject)";
  const from = normalizeOptionalText(row.from_address) || "Unknown sender";
  const body = normalizeWhitespace(row.text_body || "");
  const existingSummary = normalizeOptionalText(row.agent_summary);
  const labels = inferEmailTriageLabels(subject, body);
  const ruleMatch = matchInboxWatchMessage(
    {
      fromAddress: from,
      subject,
      body,
      labels,
    },
    draft?.rules,
    "all",
  );
  const summary =
    existingSummary ||
    `${from} - ${subject}${body ? `: ${truncateText(body, 180)}` : ""}`;
  return {
    id: row.id,
    threadKey: row.thread_key,
    from,
    subject,
    summary,
    labels,
    matchedRuleIds: ruleMatch.ruleIds,
    receivedAt: row.received_at || row.created_at || null,
  };
}

function inferEmailTriageLabels(subject: string, body: string): string[] {
  const text = `${subject}\n${body}`.toLowerCase();
  const labels = new Set<string>();
  if (
    text.includes("?") ||
    /\b(reply|respond|thoughts|can you|could you|please|need your|let me know)\b/.test(text)
  ) {
    labels.add("needs_reply");
  }
  if (/\b(urgent|asap|important|deadline|blocked|overdue|today|tomorrow)\b/.test(text)) {
    labels.add("important");
  }
  if (/\b(invoice|receipt|payment|paid|due|statement)\b/.test(text)) labels.add("finance");
  if (/\b(meeting|calendar|schedule|reschedule|call|zoom)\b/.test(text)) labels.add("scheduling");
  if (labels.size === 0) labels.add("review");
  return Array.from(labels);
}

function formatEmailTriageMissionSummary(triage: EmailTriageResult) {
  if (triage.messageCount === 0) {
    return "No new inbox messages were ready for triage.";
  }

  const header = [
    `${triage.messageCount} inbox message${triage.messageCount === 1 ? "" : "s"} across ${triage.threadCount} thread${triage.threadCount === 1 ? "" : "s"}.`,
    `${triage.matchedCount} matched Inbox Watch rule${triage.matchedCount === 1 ? "" : "s"}.`,
    `${triage.needsReplyCount} need${triage.needsReplyCount === 1 ? "s" : ""} a reply; ${triage.importantCount} flagged important.`,
  ].join(" ");
  const lines = triage.items.filter((item) => item.matchedRuleIds.length > 0).slice(0, 5).map((item) => {
    const labels = item.labels.length ? ` [${item.labels.join(", ")}]` : "";
    return `- ${item.from}: ${item.subject}${labels}. ${truncateText(item.summary, 180)}`;
  });
  return [header, ...lines].join("\n");
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, maxLength: number) {
  const text = normalizeWhitespace(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function missionOutputMetadata(input: {
  job: AssistantJobRow;
  run: AssistantJobRunRow;
  action: AssistantJobAction;
  capability: AssistantCapability;
  idempotencyKey: string;
}, extra: Record<string, unknown> = {}) {
  return {
    assistantJobId: input.job.id,
    assistantJobName: input.job.name,
    assistantJobRunId: input.run.id,
    actionId: input.action.id,
    capabilityId: input.capability.id,
    idempotencyKey: input.idempotencyKey,
    inputs: input.action.inputs,
    ...extra,
  };
}

function normalizeMissionPriority(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(5, Math.round(value)));
}

function normalizeMissionDate(value: unknown) {
  const text = normalizeNullableText(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

function riskLevelForCapability(capability: AssistantCapability) {
  if (
    capability.sideEffect === "destructive" ||
    capability.sideEffect === "money_or_account" ||
    capability.sideEffect === "permission_change" ||
    capability.sideEffect === "external_send" ||
    capability.sideEffect === "public_publish"
  ) {
    return "high";
  }
  if (
    capability.sideEffect === "external_write" ||
    capability.sideEffect === "local_write" ||
    capability.sideEffect === "local_shell" ||
    capability.sideEffect === "memory_write"
  ) {
    return "medium";
  }
  return "low";
}

function missionAgentRunIdForAssistantJobRun(runId: string) {
  return `assistant-job-run:${runId}`;
}

function contextSource(input: {
  id: string;
  kind: Me3AgentContextSource["kind"];
  label: string;
  visibility: Me3AgentContextSource["visibility"];
  status?: Me3AgentContextSource["status"];
  reason?: string;
  sourceRef?: string | null;
  updatedAt?: string | null;
}): Me3AgentContextSource {
  return {
    id: input.id,
    kind: input.kind,
    label: input.label,
    visibility: input.visibility,
    status: input.status,
    reason: input.reason,
    sourceRef: input.sourceRef ?? null,
    updatedAt: input.updatedAt ?? null,
  };
}

function failedContextSource(
  id: string,
  kind: Me3AgentContextSource["kind"],
  label: string,
): Me3AgentContextSource {
  return contextSource({
    id,
    kind,
    label,
    visibility: "private",
    status: "failed",
    reason: "Context lookup failed.",
  });
}

async function summarizeAssistantJobRunOutput(
  env: Env,
  userId: string,
  job: AssistantJobRow,
  draft: AssistantJobDraft,
  actionResults: SerializedActionResult[],
) {
  const pending = actionResults.filter((result) => result.status === "pending_approval").length;
  const succeeded = actionResults.filter((result) => result.status === "succeeded").length;
  const failed = actionResults.filter(
    (result) => result.status === "failed" || result.status === "blocked",
  ).length;
  if (pending > 0) return `${pending} action${pending === 1 ? "" : "s"} waiting for approval`;
  if (failed > 0) return `${failed} action${failed === 1 ? "" : "s"} failed`;
  if (isInvoiceReceiptTriageJob(job, draft)) {
    const triage = invoiceTriageResultFromActionResults(actionResults);
    if (triage) {
      return `Invoice and Receipt Triage added ${triage.filed} account entr${triage.filed === 1 ? "y" : "ies"}; ${triage.reviewed} need${triage.reviewed === 1 ? "s" : ""} review and ${triage.skipped} skipped.`;
    }
    return "Invoice and Receipt Triage ran successfully. Check Accounts for review items.";
  }
  if (isWeeklyReviewJob(job, draft)) {
    const review = await buildWeeklyReviewResult(env, userId, "");
    return formatWeeklyReviewReadyMessage(review);
  }
  if (
    job.recipe_id === "email-triage" ||
    draft.recipeId === "email-triage"
  ) {
    const triage = await buildEmailTriageResult(env, userId, draft);
    const jobName = job.name || draft.name || "Inbox Watch";
    const counts = inboxWatchCountsFromActionResults(actionResults);
    const outcomeBits = [
      counts.drafted ? `drafted ${counts.drafted} repl${counts.drafted === 1 ? "y" : "ies"}` : null,
      counts.tasks ? `created ${counts.tasks} task${counts.tasks === 1 ? "" : "s"}` : null,
      counts.notified ? `notified you ${counts.notified} time${counts.notified === 1 ? "" : "s"}` : null,
      counts.notifySkipped ? `${counts.notifySkipped} notification${counts.notifySkipped === 1 ? "" : "s"} skipped because Soulink is not connected` : null,
    ].filter(Boolean);
    return `${jobName} reviewed ${triage.messageCount} inbox message${triage.messageCount === 1 ? "" : "s"}, matched ${triage.matchedCount} across ${Object.keys(triage.ruleMatchCounts).length} rule${Object.keys(triage.ruleMatchCounts).length === 1 ? "" : "s"}; ${triage.needsReplyCount} need${triage.needsReplyCount === 1 ? "s" : ""} a reply and ${triage.importantCount} flagged important${outcomeBits.length ? `; ${outcomeBits.join(", ")}.` : "."}`;
  }
  if (job.recipe_id === "daily-briefing" || draft.recipeId === "daily-briefing") {
    const context = await buildDailyBriefingRenderContext(env, userId);
    const bits = [
      context.calendarSummary,
      context.calendarReminders ? "included reminders" : null,
      context.missionTasks ? "included tasks" : null,
    ].filter(Boolean);
    return `Daily Briefing ready: ${bits.join("; ")}.`;
  }
  const createdResult = draft.actions.some(
    (action) => action.capabilityId === "mission.review_packet.create",
  );
  const createdTask = draft.actions.some(
    (action) => action.capabilityId === "mission.task.create",
  );
  const createdParts = [
    createdResult ? "created a review result" : null,
    createdTask ? "created follow-up tasks" : null,
  ].filter(Boolean);
  if (createdParts.length > 0) {
    return `${job.name} ran successfully and ${createdParts.join(" and ")}.`;
  }
  return `${job.name} ran successfully. ${succeeded} action${succeeded === 1 ? "" : "s"} completed.`;
}

function resolveInitialStatus(
  validation: AssistantJobDraftValidation,
  requestedStatus: AssistantJobStatus | null,
): AssistantJobStatus {
  if (requestedStatus === "draft" || requestedStatus === "paused") return requestedStatus;
  if (validation.status === "valid") return requestedStatus === "active" ? "active" : "active";
  if (validation.status === "needs_setup") return "needs_setup";
  return "draft";
}

function serializeRecipe(recipe: AssistantJobStarterRecipe) {
  return {
    id: recipe.id,
    name: recipe.name,
    outcome: recipe.outcome,
    firstVersion: recipe.firstVersion,
    state: recipe.state,
    requiredCapabilityIds: recipe.requiredCapabilityIds,
    optionalCapabilityIds: recipe.optionalCapabilityIds,
    recommendedSkillIds: recipe.recommendedSkillIds,
    requiredSkillIds: recipe.requiredSkillIds,
    defaultDraft: recipe.defaultDraft,
  };
}

function serializeJob(row: AssistantJobRow) {
  return {
    id: row.id,
    recipeId: row.recipe_id,
    name: row.name,
    purpose: row.purpose,
    status: row.status,
    currentVersionId: row.current_version_id,
    projectId: row.project_id,
    destination: parseJson(row.destination_json, {}),
    triggerSummary: row.trigger_summary,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastRunStatus: row.last_run_status,
    failureCount: row.failure_count,
    setupState: parseJson(row.setup_state_json, {}),
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function serializeVersion(row: AssistantJobVersionRow) {
  return {
    id: row.id,
    jobId: row.job_id,
    versionNumber: row.version_number,
    name: row.name,
    purpose: row.purpose,
    trigger: parseJson(row.trigger_json, {}),
    scope: parseJson(row.scope_json, {}),
    rules: parseJson(row.rules_json, []),
    actions: parseJson(row.actions_json, []),
    approvalPolicy: parseJson(row.approval_policy_json, {}),
    destination: parseJson(row.destination_json, {}),
    capabilityIds: parseJson(row.capability_ids_json, []),
    permissionSummary: parseJson(row.permission_summary_json, {}),
    recommendedSkillIds: parseJson(row.recommended_skill_ids_json, []),
    requiredSkillIds: parseJson(row.required_skill_ids_json, []),
    validationStatus: row.validation_status,
    validationErrors: parseJson(row.validation_errors_json, []),
    createdAt: row.created_at,
  };
}

function serializeRun(row: AssistantJobRunRow) {
  return {
    id: row.id,
    jobId: row.job_id,
    jobVersionId: row.job_version_id,
    triggerKind: row.trigger_kind,
    triggerRef: row.trigger_ref,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    outputPreview: row.output_preview,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    retryCount: row.retry_count,
    nextRetryAt: row.next_retry_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeActionResult(row: AssistantJobActionResultRow) {
  return {
    id: row.id,
    runId: row.run_id,
    actionId: row.action_id,
    capabilityId: row.capability_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    approvalId: row.approval_id,
    artifactId: row.artifact_id,
    externalRef: row.external_ref,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeIngressEvent(row: AssistantJobIngressEventRow) {
  return {
    id: row.id,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    sourceEventId: row.source_event_id,
    eventType: row.event_type,
    idempotencyKey: row.idempotency_key,
    payload: parseJson(row.payload_json, {}),
    rawPayloadRef: row.raw_payload_ref,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function summarizeTrigger(trigger: AssistantJobDraft["trigger"]) {
  if (trigger.kind === "manual") return "Manual";
  if (trigger.kind === "event") return `When ${trigger.eventType} happens`;
  if (trigger.cadence === "weekly" && trigger.localTime) {
    return `Weekly on ${scheduleWeekdayLabel(trigger.dayOfWeek)} at ${trigger.localTime}`;
  }
  if (trigger.cadence === "daily" && trigger.localTime) return `Daily at ${trigger.localTime}`;
  if (trigger.cadence === "monthly" && trigger.localTime) {
    return `Monthly on day ${parseMonthlyDayOfMonth(trigger.rrule) || 1} at ${trigger.localTime}`;
  }
  return trigger.cadence;
}

async function computeNextScheduleRunAt(
  env: Env,
  userId: string,
  trigger: Extract<AssistantJobDraft["trigger"], { kind: "schedule" }>,
  now = new Date(),
) {
  const timezone = await resolveAssistantJobScheduleTimezone(env, userId, trigger.timezone);
  const localTime = normalizeScheduleLocalTime(trigger.localTime) || "08:00";
  const today = dateKeyInTimezone(now, timezone);
  let candidateDate = today;

  if (trigger.cadence === "weekly") {
    candidateDate = nextWeeklyScheduleDate(today, trigger.dayOfWeek ?? 1);
  } else if (trigger.cadence === "monthly") {
    candidateDate = nextMonthlyScheduleDate(today, parseMonthlyDayOfMonth(trigger.rrule) || 1);
  }

  let candidate = zonedLocalTimeToUtc(candidateDate, localTime, timezone);
  if (candidate.getTime() <= now.getTime()) {
    if (trigger.cadence === "weekly") {
      candidateDate = addDaysToDateKey(candidateDate, 7);
    } else if (trigger.cadence === "monthly") {
      candidateDate = nextMonthScheduleDate(
        candidateDate,
        parseMonthlyDayOfMonth(trigger.rrule) || 1,
      );
    } else {
      candidateDate = addDaysToDateKey(candidateDate, 1);
    }
    candidate = zonedLocalTimeToUtc(candidateDate, localTime, timezone);
  }

  return candidate.toISOString();
}

async function resolveAssistantJobScheduleTimezone(env: Env, userId: string, timezone: string) {
  if (timezone === "owner") {
    const row = await env.DB.prepare("SELECT timezone FROM owner_profile WHERE id = ?")
      .bind(userId)
      .first<{ timezone: string | null }>()
      .catch(() => null);
    return normalizeTimeZone(row?.timezone) || "UTC";
  }
  return normalizeTimeZone(timezone) || "UTC";
}

function normalizeScheduleCadence(
  value: unknown,
): "daily" | "weekly" | "monthly" | "custom" | null {
  return value === "daily" || value === "weekly" || value === "monthly" || value === "custom"
    ? value
    : null;
}

function normalizeScheduleLocalTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  return match ? trimmed : null;
}

function normalizeScheduleTimezone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "owner") return "owner";
  return normalizeTimeZone(trimmed);
}

function normalizeScheduleDayOfWeek(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 6 ? parsed : null;
}

function normalizeScheduleDayOfMonth(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 28 ? parsed : null;
}

function parseMonthlyDayOfMonth(rrule: string | null | undefined): number | null {
  const match = rrule?.match(/(?:^|;)BYMONTHDAY=(\d{1,2})(?:;|$)/i);
  if (!match?.[1]) return null;
  return normalizeScheduleDayOfMonth(Number.parseInt(match[1], 10));
}

function scheduleWeekdayLabel(dayOfWeek: number | null | undefined) {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[normalizeScheduleDayOfWeek(dayOfWeek) ?? 1] || "Monday";
}

function nextWeeklyScheduleDate(today: string, dayOfWeek: number) {
  const todayDay = dayOfWeekForDateKey(today);
  const normalizedDay = normalizeScheduleDayOfWeek(dayOfWeek) ?? 1;
  const delta = (normalizedDay - todayDay + 7) % 7;
  return addDaysToDateKey(today, delta);
}

function nextMonthlyScheduleDate(today: string, dayOfMonth: number) {
  const [year, month, day] = today.split("-").map(Number);
  const normalizedDay = normalizeScheduleDayOfMonth(dayOfMonth) ?? 1;
  if (day <= normalizedDay) return dateKeyFromParts(year, month, normalizedDay);
  return nextMonthScheduleDate(today, normalizedDay);
}

function nextMonthScheduleDate(dateKey: string, dayOfMonth: number) {
  const [year, month] = dateKey.split("-").map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return dateKeyFromParts(nextYear, nextMonth, dayOfMonth);
}

function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return date.toISOString().slice(0, 10);
}

function dayOfWeekForDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
}

function dateKeyFromParts(year: number, month: number, day: number) {
  const safeDay = Math.min(day, daysInMonth(year, month));
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${safeDay
    .toString()
    .padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0, 12, 0, 0)).getUTCDate();
}

function normalizeIngressEventBody(body: CreateAssistantJobIngressEventBody) {
  const sourceKind = normalizeIngressSourceKind(body.sourceKind);
  const sourceId = normalizeOptionalText(body.sourceId);
  const sourceEventId = normalizeOptionalText(body.sourceEventId);
  const eventType = normalizeOptionalText(body.eventType);
  if (!sourceKind) throw new AssistantJobsInputError("Valid sourceKind is required");
  if (!sourceId) throw new AssistantJobsInputError("sourceId is required");
  if (!sourceEventId) throw new AssistantJobsInputError("sourceEventId is required");
  if (!eventType) throw new AssistantJobsInputError("eventType is required");

  const idempotencyKey =
    normalizeOptionalText(body.idempotencyKey) ||
    buildIngressIdempotencyKey(sourceKind, sourceId, eventType, sourceEventId);

  return {
    sourceKind,
    sourceId,
    sourceEventId,
    eventType,
    idempotencyKey,
    payload: body.payload === undefined ? {} : body.payload,
    rawPayloadRef: normalizeNullableText(body.rawPayloadRef),
  };
}

function buildIngressIdempotencyKey(
  sourceKind: AssistantJobIngressSourceKind,
  sourceId: string,
  eventType: string,
  sourceEventId: string,
) {
  return `${sourceKind}:${sourceId}:${eventType}:${sourceEventId}`;
}

function normalizeIngressSourceKind(value: unknown): AssistantJobIngressSourceKind | null {
  if (
    value === "core" ||
    value === "mission_control" ||
    value === "plugin" ||
    value === "webhook"
  ) {
    return value;
  }
  return null;
}

function normalizeIngressStatus(value: unknown): AssistantJobIngressStatus | null {
  if (
    value === "received" ||
    value === "matched" ||
    value === "queued" ||
    value === "processed" ||
    value === "ignored" ||
    value === "failed"
  ) {
    return value;
  }
  return null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Assistant Job queue error";
}

function normalizeJobStatus(value: unknown): AssistantJobStatus | null {
  if (
    value === "draft" ||
    value === "active" ||
    value === "paused" ||
    value === "needs_setup" ||
    value === "failing" ||
    value === "archived"
  ) {
    return value;
  }
  return null;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizeNullableText(value: unknown): string | null {
  if (value === null) return null;
  return normalizeOptionalText(value);
}

function normalizeStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function stringifyJson(value: unknown) {
  return JSON.stringify(value);
}

function getSoulinkApiOrigin(env: Env) {
  const configured = normalizeOptionalText(env.SOULINK_API_ORIGIN);
  if (!configured) return "https://soulinkfoundation.org";
  try {
    const url = new URL(configured);
    return url.origin;
  } catch {
    return "https://soulinkfoundation.org";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string, status: 400 | 404 | 409): never {
  throw new AssistantJobsInputError(message, status);
}
