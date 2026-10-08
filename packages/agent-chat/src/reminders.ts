import {
  getUtcMsForLocalTime,
  normalizeEventRecurrenceRule,
  normalizeTimeZone,
} from "@me3-core/plugin-calendar";

export type AgentReminderInput = {
  title?: unknown;
  notes?: unknown;
  remindAt?: unknown;
  date?: unknown;
  time?: unknown;
  timezone?: unknown;
  recurrence?: unknown;
};

export type AgentReminder = {
  id: string;
  title: string;
  notes: string | null;
  remindAt: string;
  timezone: string | null;
  recurrenceRule: string | null;
  contextType?: "contact" | "booking" | null;
  contextId?: string | null;
  contextLabel?: string | null;
  status: "pending" | "delivered" | "dismissed" | "cancelled" | "failed";
  deliveredAt?: string | null;
  dismissedAt?: string | null;
  createdAt?: string;
};

export type AgentReminderParseResult =
  | {
      title: string;
      notes: string | null;
      remindAt: string;
      timezone: string;
      recurrenceRule: string | null;
    }
  | { error: string };

export type ReminderDb = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      all<T = unknown>(): Promise<{ results?: T[] }>;
      run(): Promise<{ meta?: { changes?: number } }>;
    };
  };
};

type ReminderEnv = { DB: ReminderDb };

type DbReminderRow = {
  id: string;
  title: string;
  notes: string | null;
  remind_at: string;
  timezone: string | null;
  recurrence_rule: string | null;
  context_type?: "contact" | "booking" | null;
  context_id?: string | null;
  context_label?: string | null;
  status: "pending" | "delivered" | "dismissed" | "cancelled" | "failed";
  delivered_at?: string | null;
  dismissed_at?: string | null;
  created_at?: string;
};

export function parseAgentReminderInput(
  input: AgentReminderInput | null | undefined,
): AgentReminderParseResult {
  const title = normalizeNullableText(input?.title);
  const notes = normalizeNullableText(input?.notes);
  const directRemindAt = normalizeNullableText(input?.remindAt);
  const date = typeof input?.date === "string" ? input.date.trim() : "";
  const time = typeof input?.time === "string" ? input.time.trim() : "";

  if (!title) return { error: "Title is required" };
  if (directRemindAt) {
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(directRemindAt)) {
      return { error: "Reminder timestamp must include a timezone offset" };
    }
    const parsedRemindAt = Date.parse(directRemindAt);
    if (!Number.isFinite(parsedRemindAt)) {
      return { error: "Reminder timestamp must be a valid ISO date-time" };
    }
    const timezone = normalizeTimeZone(input?.timezone) || "UTC";
    const recurrenceRule = parseReminderRecurrenceRule(
      input?.recurrence,
      new Date(parsedRemindAt).toISOString().slice(0, 10),
    );
    if (hasExplicitReminderRecurrence(input?.recurrence) && !recurrenceRule) {
      return { error: "Invalid recurrence value" };
    }
    return {
      title,
      notes,
      remindAt: new Date(parsedRemindAt).toISOString(),
      timezone,
      recurrenceRule,
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "Date must be in YYYY-MM-DD format" };
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return { error: "Time must be in HH:MM format" };
  }

  const timezone = normalizeTimeZone(input?.timezone) || "UTC";
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const remindAt = new Date(
    getUtcMsForLocalTime({ year, month, day, hour, minute }, timezone),
  ).toISOString();
  const recurrenceRule = parseReminderRecurrenceRule(input?.recurrence, date);
  if (hasExplicitReminderRecurrence(input?.recurrence) && !recurrenceRule) {
    return { error: "Invalid recurrence value" };
  }

  return { title, notes, remindAt, timezone, recurrenceRule };
}

export async function listPendingAgentReminders(
  env: ReminderEnv,
  userId: string,
): Promise<AgentReminder[]> {
  const now = new Date().toISOString();
  const rows = await env.DB.prepare(
    `SELECT id, title, notes, remind_at, timezone, recurrence_rule, context_type,
            context_id, context_label, status, delivered_at, dismissed_at, created_at
     FROM user_reminders
     WHERE user_id = ? AND status IN ('pending', 'failed') AND remind_at >= ?
     ORDER BY remind_at ASC
     LIMIT 8`,
  )
    .bind(userId, now)
    .all<DbReminderRow>();
  return (rows.results || []).map(serializeAgentReminder);
}

export async function getPendingAgentReminder(
  env: ReminderEnv,
  userId: string,
  reminderId: string,
): Promise<AgentReminder | null> {
  const row = await env.DB.prepare(
    `SELECT id, title, notes, remind_at, timezone, recurrence_rule, context_type,
            context_id, context_label, status, delivered_at, dismissed_at, created_at
     FROM user_reminders
     WHERE id = ? AND user_id = ? AND status IN ('pending', 'failed')
     LIMIT 1`,
  )
    .bind(reminderId, userId)
    .first<DbReminderRow>();
  return row ? serializeAgentReminder(row) : null;
}

export async function createAgentReminder(
  env: ReminderEnv,
  userId: string,
  input: AgentReminderInput,
  options: { idempotencyKey?: string | null } = {},
): Promise<AgentReminder | { error: string }> {
  const parsed = parseAgentReminderInput(input);
  if ("error" in parsed) return parsed;

  const idempotencyKey = normalizeNullableText(options.idempotencyKey);
  if (idempotencyKey) {
    const existing = await getAgentReminderByDispatchId(
      env,
      userId,
      idempotencyKey,
    );
    if (existing) return serializeAgentReminder(existing);
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT ${idempotencyKey ? "OR IGNORE " : ""}INTO user_reminders
       (id, user_id, title, notes, remind_at, timezone, recurrence_rule,
        status, source_dispatch_id, created_via)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, 'agent')`,
  )
    .bind(
      id,
      userId,
      parsed.title,
      parsed.notes,
      parsed.remindAt,
      parsed.timezone,
      parsed.recurrenceRule,
      idempotencyKey,
    )
    .run();

  if (idempotencyKey) {
    const stored = await getAgentReminderByDispatchId(env, userId, idempotencyKey);
    if (!stored) return { error: "Reminder could not be recorded." };
    return serializeAgentReminder(stored);
  }

  return {
    id,
    title: parsed.title,
    notes: parsed.notes,
    remindAt: parsed.remindAt,
    timezone: parsed.timezone,
    recurrenceRule: parsed.recurrenceRule,
    status: "pending",
  };
}

export async function updateAgentReminder(
  env: ReminderEnv,
  userId: string,
  reminderId: string,
  input: AgentReminderInput,
  expected?: AgentReminder,
): Promise<AgentReminder | { error: string; status?: 400 | 404 }> {
  const parsed = parseAgentReminderInput(input);
  if ("error" in parsed) return { ...parsed, status: 400 };

  const result = await env.DB.prepare(
    `UPDATE user_reminders
     SET title = ?, notes = ?, remind_at = ?, timezone = ?, recurrence_rule = ?,
         error_message = NULL, updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND status IN ('pending', 'failed')
       ${expected ? "AND title = ? AND remind_at = ? AND notes IS ? AND timezone IS ? AND recurrence_rule IS ?" : ""}`,
  )
    .bind(
      parsed.title,
      parsed.notes,
      parsed.remindAt,
      parsed.timezone,
      parsed.recurrenceRule,
      reminderId,
      userId,
      ...(expected ? [expected.title, expected.remindAt, expected.notes, expected.timezone, expected.recurrenceRule] : []),
    )
    .run();

  if ((result.meta?.changes || 0) === 0) {
    return { error: "Reminder not found", status: 404 };
  }

  return {
    id: reminderId,
    title: parsed.title,
    notes: parsed.notes,
    remindAt: parsed.remindAt,
    timezone: parsed.timezone,
    recurrenceRule: parsed.recurrenceRule,
    status: "pending",
  };
}

export async function cancelAgentReminder(
  env: ReminderEnv,
  userId: string,
  reminderId: string,
  expected?: AgentReminder,
): Promise<{ ok: true } | { error: string; status: 404 }> {
  const result = await env.DB.prepare(
    `UPDATE user_reminders
     SET status = 'cancelled', cancelled_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND status IN ('pending', 'failed')
       ${expected ? "AND title = ? AND remind_at = ? AND notes IS ? AND timezone IS ? AND recurrence_rule IS ?" : ""}`,
  )
    .bind(reminderId, userId, ...(expected ? [expected.title, expected.remindAt, expected.notes, expected.timezone, expected.recurrenceRule] : []))
    .run();

  if ((result.meta?.changes || 0) === 0) {
    return { error: "Reminder not found", status: 404 };
  }
  return { ok: true };
}

export function serializeAgentReminder(reminder: DbReminderRow): AgentReminder {
  return {
    id: reminder.id,
    title: reminder.title,
    notes: reminder.notes,
    remindAt: reminder.remind_at,
    timezone: reminder.timezone,
    recurrenceRule: reminder.recurrence_rule,
    contextType: reminder.context_type ?? null,
    contextId: reminder.context_id ?? null,
    contextLabel: reminder.context_label ?? null,
    status: reminder.status,
    deliveredAt: reminder.delivered_at ?? null,
    dismissedAt: reminder.dismissed_at ?? null,
    createdAt: reminder.created_at,
  };
}

async function getAgentReminderByDispatchId(
  env: ReminderEnv,
  userId: string,
  sourceDispatchId: string,
): Promise<DbReminderRow | null> {
  return env.DB.prepare(
    `SELECT id, title, notes, remind_at, timezone, recurrence_rule, context_type,
            context_id, context_label, status, delivered_at, dismissed_at, created_at
     FROM user_reminders
     WHERE user_id = ? AND source_dispatch_id = ?
     LIMIT 1`,
  )
    .bind(userId, sourceDispatchId)
    .first<DbReminderRow>();
}

function parseReminderRecurrenceRule(recurrence: unknown, date: string): string | null {
  return normalizeEventRecurrenceRule(recurrence, "event", date);
}

function hasExplicitReminderRecurrence(recurrence: unknown): boolean {
  if (recurrence == null) return false;
  if (typeof recurrence !== "string") return true;
  const normalized = recurrence.trim().toLowerCase();
  return normalized !== "" && normalized !== "none";
}

function normalizeNullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
