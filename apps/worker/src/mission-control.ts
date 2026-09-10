import {
  normalizeMissionDateKey,
  normalizeMissionProjectStatus,
  normalizeMissionTaskStatus,
  slugifyMissionProjectName,
  type MissionProjectStatus,
  type MissionTaskStatus,
} from "@me3-core/plugin-mission-control";
import { getUtcMsForLocalTime, normalizeTimeZone } from "./calendar";
import { hasConfiguredAiProvider } from "./ai-providers";
import { isCorePluginEnabled, listCorePluginRecords } from "./plugins";
import { getSiteFileText } from "./sites";
import { getLocalExecutorSetupState } from "./local-executor";
import type { Env } from "./types";

export class MissionControlInputError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

type MissionProjectRow = {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: MissionProjectStatus;
  color: string | null;
  icon: string | null;
  source_kind: "manual" | "daemon_repo" | "beads" | "import";
  source_ref: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type MissionProjectColumnRow = {
  id: string;
  user_id: string;
  project_id: string;
  name: string;
  status: Exclude<MissionTaskStatus, "cancelled">;
  position: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type MissionTaskRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  column_id?: string | null;
  title: string;
  description: string | null;
  status: MissionTaskStatus;
  priority: number;
  position: number;
  pinned_at: string | null;
  due_at: string | null;
  scheduled_for: string | null;
  source_kind: "manual" | "capture" | "agent" | "beads" | "daemon";
  source_ref: string | null;
  approval_id: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type JournalProjectLinkRow = {
  id: string;
  user_id: string;
  journal_entry_id: string;
  project_id: string;
  source_text: string | null;
  created_task_id: string | null;
  created_reminder_id: string | null;
  created_at: string;
  entry_date: string;
  entry_title: string | null;
  task_title: string | null;
};

type MissionTaskListOptions = {
  status?: unknown;
  dueDate?: string;
  activeOnly?: boolean;
  limit?: unknown;
  archived?: boolean;
  projectId?: unknown;
  cursor?: unknown;
};

const DEFAULT_PROJECT_COLUMNS: Array<{
  status: Exclude<MissionTaskStatus, "cancelled">;
  name: string;
  position: number;
}> = [
  { status: "backlog", name: "Backlog", position: 0 },
  { status: "in_progress", name: "Doing", position: 1 },
  { status: "done", name: "Done", position: 2 },
];

type MissionTaskCursor =
  | {
      order: "active";
      pinnedRank: number;
      pinnedAt: string;
      position: number;
      priority: number;
      sortValue: string;
      id: string;
    }
  | {
      order: "archived";
      archivedAt: string;
      updatedAt: string;
      id: string;
    };

type MissionApprovalRow = {
  id: string;
  user_id: string;
  plugin_id: string;
  action_id: string;
  title: string;
  summary: string | null;
  payload_json: string;
  risk_level: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected" | "expired" | "cancelled";
  requested_by: string;
  resolved_by: string | null;
  requested_at: string;
  resolved_at: string | null;
  expires_at: string | null;
};

type MissionAgentRunRow = {
  id: string;
  user_id: string;
  source: "core" | "daemon" | "hosted_cloud" | "import";
  project_id: string | null;
  task_id: string | null;
  approval_id: string | null;
  title: string;
  prompt_summary: string | null;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  model: string | null;
  runner_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  cost_json: string;
  result_json: string;
  artifact_manifest_json: string;
  created_at: string;
  updated_at: string;
};

type MissionPluginActivityRow = {
  id: string;
  user_id: string;
  plugin_id: string;
  activity_type: string;
  title: string;
  summary: string | null;
  status: string | null;
  related_id: string | null;
  metadata_json: string;
  created_at: string;
};

type MissionDashboardSettingsRow = {
  user_id: string;
  cards_json: string;
  quick_links_json: string;
  settings_json: string;
  mission_statement: string | null;
  created_at: string;
  updated_at: string;
};

type MissionWheelSettingsRow = {
  user_id: string;
  segments_json: string;
  schema_version: number;
  created_at: string;
  updated_at: string;
};

type MissionWheelSnapshotRow = {
  id: string;
  user_id: string;
  segments_json: string;
  notes_json: string;
  created_at: string;
};

type MissionWheelSegment = {
  id: string;
  label: string;
  helper: string;
  color: string;
  emoji: string;
  value: number | null;
};

type DashboardCardSize = "small" | "medium" | "wide";

type DashboardCardContribution = {
  id: string;
  pluginId: string;
  label: string;
  componentKey: string;
  defaultEnabled: boolean;
  defaultSize: DashboardCardSize;
  dataEndpoint?: string;
  requiresPluginIds?: string[];
  requiresCapabilityIds?: string[];
};

type DashboardCardInstance = {
  instanceId: string;
  cardId: string;
  pluginId: string;
  enabled: boolean;
  available: boolean;
  size: DashboardCardSize;
  sortOrder: number;
  config?: Record<string, unknown>;
};

type DashboardQuickActionContribution = {
  id: string;
  pluginId: string;
  label: string;
  icon: string;
  defaultEnabled: boolean;
  destinationId: string;
  requiresPluginIds?: string[];
};

type DashboardQuickLink = {
  id: string;
  label: string;
  icon: string;
  enabled: boolean;
  sortOrder: number;
  destinationId: string;
  requiresPluginId?: string;
  available: boolean;
};

type AgentChannelConnectionRow = {
  id: string;
};

type MissionMemoryRow = {
  id: string;
  user_id: string;
  memory_kind:
    | "owner_note"
    | "project_context"
    | "preference"
    | "relationship_note"
    | "correction"
    | "learning";
  scope_kind: "owner" | "project" | "contact" | "plugin";
  scope_id: string | null;
  title: string | null;
  body: string;
  confidence: number;
  source_kind: "manual" | "agent" | "import" | "daemon";
  source_ref: string | null;
  review_status: "active" | "needs_review" | "archived";
  created_at: string;
  updated_at: string;
};

type MissionContextSourceRow = {
  id: string;
  user_id: string;
  source_kind:
    | "public_me_json"
    | "mission_statement"
    | "wheel_of_life"
    | "private_memory"
    | "core_table"
    | "plugin_table"
    | "daemon_directory"
    | "daemon_repo"
    | "provider"
    | "upload"
    | "url";
  label: string;
  description: string | null;
  visibility: "public" | "private";
  status: "active" | "setup_required" | "paused" | "failed" | "archived";
  source_ref: string | null;
  last_indexed_at: string | null;
  grants_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

type MissionDaemonPairingRow = {
  id: string;
  runner_id: string;
  display_name: string;
  status: "pending" | "active" | "paused" | "revoked" | "unhealthy";
  version: string | null;
  platform: string | null;
  last_seen_at: string | null;
  health_json: string;
  paired_at: string | null;
  created_at: string;
  updated_at: string;
};

type MissionDaemonAllowlistRow = {
  id: string;
  pairing_id: string;
  label: string;
  path_hint: string;
  resource_kind: "directory" | "repo";
  permission_tier: "metadata" | "read" | "write" | "shell";
  shell_policy_json: string;
  status: "active" | "paused" | "revoked" | "missing";
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
};

type MissionDaemonAuditRow = {
  id: string;
  pairing_id: string | null;
  allowlist_entry_id: string | null;
  run_id: string | null;
  approval_id: string | null;
  event_type: string;
  actor: string;
  summary: string;
  payload_json: string;
  created_at: string;
};

type OwnerTimezoneRow = {
  timezone: string | null;
};

type TemporalHint = {
  startsAt: string;
  endsAt: string;
  timezone: string;
};

type MissionSetupItem = {
  id: string;
  label: string;
  status: "ready" | "setup_required" | "optional" | "disabled";
  detail: string;
  actionPath: string | null;
};

type WeeklyReviewTaskInput = {
  id?: unknown;
  action?: unknown;
};

type WeeklyReviewMemoryInput = {
  id?: unknown;
  body?: unknown;
  title?: unknown;
  memoryKind?: unknown;
  checked?: unknown;
};

type WeeklyReviewReminderInput = {
  id?: unknown;
  checked?: unknown;
  reschedule?: unknown;
};

type ParsedWeeklyReviewResult = NonNullable<ReturnType<typeof parseWeeklyReviewResult>>;
type DashboardPluginRecord = Awaited<ReturnType<typeof listCorePluginRecords>>[number];

const PERSONAL_PROJECT_ID = "mission-project-personal";
const DEFAULT_OWNER_TIMEZONE = "UTC";
const WORKSPACE_TASK_STATUSES: MissionTaskStatus[] = ["backlog", "in_progress", "done"];
const DEFAULT_MISSION_STATEMENT =
  "I am here to help [who/what] become [desired change] by being [way of being] and creating [work/service], guided by [values].";
const DEFAULT_SETUP_CHECKLIST_DISMISSED = true;
const MISSION_WHEEL_MIN_SEGMENTS = 6;
const MISSION_WHEEL_MAX_SEGMENTS = 8;
const DEFAULT_MISSION_WHEEL_SEGMENTS: MissionWheelSegment[] = [
  {
    id: "health",
    label: "Health",
    helper: "Physical, mental and emotional wellbeing",
    color: "#26806f",
    emoji: "❤️",
    value: null,
  },
  {
    id: "spirituality",
    label: "Spirituality",
    helper: "Meaning, purpose, felt sense of connection to something greater than yourself",
    color: "#7c3aed",
    emoji: "🌿",
    value: null,
  },
  {
    id: "work",
    label: "Work",
    helper: "What you do, how you serve others",
    color: "#2563eb",
    emoji: "💼",
    value: null,
  },
  {
    id: "finances",
    label: "Finances",
    helper: "Money",
    color: "#ca8a04",
    emoji: "💰",
    value: null,
  },
  {
    id: "home",
    label: "Home",
    helper: "Environment, living situation",
    color: "#c2410c",
    emoji: "🏡",
    value: null,
  },
  {
    id: "joy",
    label: "Joy",
    helper: "What you do for fun",
    color: "#be123c",
    emoji: "🤗",
    value: null,
  },
];
const DASHBOARD_CARD_COMPONENT_KEYS = new Set([
  "DailyBriefingCard",
  "MissionStatementCard",
  "GoalsCard",
  "WheelSnapshotCard",
  "Me3ProfileCard",
  "QuickProjectTaskCard",
  "ProjectsSummaryCard",
  "AiUsageCard",
  "AccountsSummaryCard",
  "CalendarTodayCard",
  "JournalLatestEntryCard",
  "SocialQueueSummaryCard",
  "SitesBlogSummaryCard",
]);
const DASHBOARD_DESTINATIONS: Record<string, { path: string; requiresPluginId?: string }> = {
  "mission.projects": { path: "/tasks" },
  "assistant.chat": { path: "/assistant" },
  "journal.today": { path: "/journal", requiresPluginId: "me3.journal" },
  "social.schedule": { path: "/social", requiresPluginId: "me3.social-publishing" },
  "sites.blog": { path: "/build", requiresPluginId: "me3.landing-pages" },
  "accounts.ledger": { path: "/accounts", requiresPluginId: "me3.accounts" },
};
const DASHBOARD_CONTRIBUTION_ORDER = [
  "mission.daily-briefing",
  "mission.me3-profile",
  "mission.mission-statement",
  "mission.goals",
  "mission.wheel-latest-snapshot",
  "mission.quick-task-add",
  "mission.projects-summary",
  "mission.ai-usage",
  "mission.projects",
  "assistant.chat",
  "journal.latest-entry",
  "journal.today",
  "social.queue-summary",
  "social.schedule",
  "sites.blog-summary",
  "sites.blog",
  "accounts.summary",
  "accounts.ledger",
  "calendar.today",
];

export async function listMissionProjects(env: Env, userId: string) {
  await ensurePersonalProject(env, userId);
  const rows = await env.DB.prepare(
    `SELECT id, user_id, name, slug, description, status, color, icon, source_kind,
            source_ref, metadata_json, created_at, updated_at
     FROM mission_projects
     WHERE user_id = ? AND status != 'archived'
     ORDER BY CASE WHEN slug = 'personal' THEN 0 ELSE 1 END, name ASC`,
  )
    .bind(userId)
    .all<MissionProjectRow>();
  const projects = rows.results || [];
  const columnsByProject = await listMissionProjectColumnsForProjects(
    env,
    userId,
    projects.map((project) => project.id),
  );
  return projects.map((project) =>
    serializeProject(
      project,
      columnsByProject.get(project.id) ||
        defaultMissionProjectColumns(userId, project.id),
    ),
  );
}

export async function createMissionProject(env: Env, userId: string, input: unknown) {
  const body = isRecord(input) ? input : {};
  const name = normalizeNullableText(body.name);
  if (!name) throw new MissionControlInputError("Project name is required");
  const slug = slugifyMissionProjectName(
    normalizeNullableText(body.slug) || name,
  );
  const duplicate = await env.DB.prepare(
    `SELECT id FROM mission_projects WHERE user_id = ? AND slug = ? LIMIT 1`,
  )
    .bind(userId, slug)
    .first<{ id: string }>();
  if (duplicate) throw new MissionControlInputError("A project with that name already exists", 409);

  const id = crypto.randomUUID();

  try {
    await env.DB.prepare(
      `INSERT INTO mission_projects
         (id, user_id, name, slug, description, status, color, icon, source_kind,
          source_ref, metadata_json)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        userId,
        name,
        slug,
        normalizeNullableText(body.description),
        normalizeNullableText(body.color),
        normalizeNullableText(body.icon),
        "manual",
        null,
        "{}",
      )
      .run();
  } catch {
    throw new MissionControlInputError("A project with that name already exists", 409);
  }
  await ensureDefaultProjectColumns(env, userId, id);

  return {
    project: await serializeProjectWithColumns(env, userId, (await getMissionProject(env, userId, id)) as MissionProjectRow),
  };
}

export async function updateMissionProject(
  env: Env,
  userId: string,
  projectId: string,
  input: unknown,
) {
  const existing = await getMissionProject(env, userId, projectId);
  if (!existing) throw new MissionControlInputError("Project not found", 404);
  const body = isRecord(input) ? input : {};
  const name = normalizeNullableText(body.name) || existing.name;
  const status = normalizeMissionProjectStatus(body.status) || existing.status;

  await env.DB.prepare(
    `UPDATE mission_projects
     SET name = ?, description = ?, status = ?, color = ?, icon = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(
      name,
      body.description === undefined
        ? existing.description
        : normalizeNullableText(body.description),
      status,
      body.color === undefined ? existing.color : normalizeNullableText(body.color),
      body.icon === undefined ? existing.icon : normalizeNullableText(body.icon),
      projectId,
      userId,
    )
    .run();

  return {
    project: await serializeProjectWithColumns(env, userId, (await getMissionProject(env, userId, projectId)) as MissionProjectRow),
  };
}

export async function archiveMissionProject(
  env: Env,
  userId: string,
  projectId: string,
) {
  const existing = await getMissionProject(env, userId, projectId);
  if (!existing) throw new MissionControlInputError("Project not found", 404);
  if (existing.slug === "personal") {
    throw new MissionControlInputError("Personal project cannot be deleted", 409);
  }

  await env.DB.prepare(
    `UPDATE mission_projects
     SET status = 'archived', updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND status != 'archived'`,
  )
    .bind(projectId, userId)
    .run();

  const tasksResult = await env.DB.prepare(
    `UPDATE mission_tasks
     SET archived_at = datetime('now'), pinned_at = NULL, updated_at = datetime('now')
     WHERE user_id = ? AND project_id = ? AND archived_at IS NULL`,
  )
    .bind(userId, projectId)
    .run();

  return {
    ok: true,
    projectId,
    archivedTasks: tasksResult.meta?.changes || 0,
  };
}

export async function listMissionTaskPage(
  env: Env,
  userId: string,
  options: MissionTaskListOptions = {},
) {
  const limit = normalizeListLimit(options.limit, 50);
  const status = normalizeMissionTaskStatus(options.status);
  const projectId =
    typeof options.projectId === "string" && options.projectId.trim()
      ? options.projectId.trim()
      : null;
  const order = options.archived ? "archived" : "active";
  const cursor = decodeMissionTaskCursor(options.cursor, order);
  const workspaceStatusWhere = WORKSPACE_TASK_STATUSES.map((item) => `'${item}'`).join(", ");
  let sql = `SELECT id, user_id, project_id, column_id, title, description, status, priority, position, pinned_at,
                    due_at, scheduled_for, source_kind, source_ref, approval_id,
                    metadata_json, created_at, updated_at, archived_at
             FROM mission_tasks
             WHERE user_id = ? AND archived_at IS ${options.archived ? "NOT " : ""}NULL`;
  const values: unknown[] = [userId];
  if (projectId) {
    sql += " AND project_id = ?";
    values.push(projectId);
  }
  if (status) {
    sql += " AND status = ?";
    values.push(status);
  } else if (options.activeOnly) {
    sql += ` AND status IN (${workspaceStatusWhere})`;
  }
  if (options.dueDate) {
    sql += " AND (scheduled_for = ? OR substr(due_at, 1, 10) = ?)";
    values.push(options.dueDate, options.dueDate);
  }
  if (cursor?.order === "archived") {
    sql += ` AND (
      archived_at < ?
      OR (archived_at = ? AND updated_at < ?)
      OR (archived_at = ? AND updated_at = ? AND id > ?)
    )`;
    values.push(
      cursor.archivedAt,
      cursor.archivedAt,
      cursor.updatedAt,
      cursor.archivedAt,
      cursor.updatedAt,
      cursor.id,
    );
  } else if (cursor?.order === "active") {
    sql += ` AND (
      (CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END) > ?
      OR ((CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END) = ? AND COALESCE(pinned_at, '') < ?)
      OR ((CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END) = ? AND COALESCE(pinned_at, '') = ? AND position > ?)
      OR ((CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END) = ? AND COALESCE(pinned_at, '') = ? AND position = ? AND priority > ?)
      OR ((CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END) = ? AND COALESCE(pinned_at, '') = ? AND position = ? AND priority = ? AND COALESCE(due_at, scheduled_for, created_at) > ?)
      OR ((CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END) = ? AND COALESCE(pinned_at, '') = ? AND position = ? AND priority = ? AND COALESCE(due_at, scheduled_for, created_at) = ? AND id > ?)
    )`;
    values.push(
      cursor.pinnedRank,
      cursor.pinnedRank,
      cursor.pinnedAt,
      cursor.pinnedRank,
      cursor.pinnedAt,
      cursor.position,
      cursor.pinnedRank,
      cursor.pinnedAt,
      cursor.position,
      cursor.priority,
      cursor.pinnedRank,
      cursor.pinnedAt,
      cursor.position,
      cursor.priority,
      cursor.sortValue,
      cursor.pinnedRank,
      cursor.pinnedAt,
      cursor.position,
      cursor.priority,
      cursor.sortValue,
      cursor.id,
    );
  }
  sql += options.archived
    ? " ORDER BY archived_at DESC, updated_at DESC, id ASC LIMIT ?"
    : ` ORDER BY (CASE WHEN pinned_at IS NULL THEN 1 ELSE 0 END) ASC,
          pinned_at DESC,
          position ASC,
          priority ASC,
          COALESCE(due_at, scheduled_for, created_at) ASC,
          id ASC LIMIT ?`;
  values.push(limit + 1);

  const rows = await env.DB.prepare(sql)
    .bind(...values)
    .all<MissionTaskRow>();
  const allRows = rows.results || [];
  const pageRows = allRows.slice(0, limit);
  const lastRow = pageRows[pageRows.length - 1];
  return {
    tasks: pageRows.map(serializeTask),
    nextCursor: allRows.length > limit && lastRow ? encodeMissionTaskCursor(lastRow, order) : null,
    limit,
  };
}

export async function listMissionTasks(
  env: Env,
  userId: string,
  options: MissionTaskListOptions = {},
) {
  return (await listMissionTaskPage(env, userId, options)).tasks;
}

export async function getMissionTaskDetail(env: Env, userId: string, taskId: string) {
  const task = await getMissionTask(env, userId, taskId);
  if (!task || task.archived_at) throw new MissionControlInputError("Mission task not found", 404);
  return { task: serializeTask(task) };
}

export async function createMissionTask(env: Env, userId: string, input: unknown) {
  const body = isRecord(input) ? input : {};
  const title = normalizeNullableText(body.title);
  if (!title) throw new MissionControlInputError("Task title is required");
  const projectId =
    typeof body.projectId === "string" && body.projectId.trim()
      ? body.projectId.trim()
      : (await ensurePersonalProject(env, userId)).id;
  await ensureProjectExists(env, userId, projectId);
  const priority = normalizePriority(body.priority);
  const position = normalizeTaskPosition(body.position);
  const requestedStatus = normalizeMissionTaskStatus(body.status) || "backlog";
  const column = await resolveMissionTaskColumn(env, userId, projectId, {
    columnId: body.columnId,
    status: requestedStatus,
  });
  const status = column.status;
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO mission_tasks
       (id, user_id, project_id, column_id, title, description, status, priority, position, pinned_at, due_at, scheduled_for, source_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? THEN datetime('now') ELSE NULL END, ?, ?, 'manual')`,
  )
    .bind(
      id,
      userId,
      projectId,
      column.id,
      title,
      normalizeNullableText(body.description),
      status,
      priority,
      position,
      body.pinned === true ? 1 : 0,
      normalizeNullableText(body.dueAt),
      normalizeMissionDateKey(body.scheduledFor),
    )
    .run();

  const task = (await getMissionTask(env, userId, id)) as MissionTaskRow;
  return {
    task: serializeTask(task),
  };
}

export async function createMissionTaskFromJournal(
  env: Env,
  userId: string,
  input: unknown,
) {
  const body = isRecord(input) ? input : {};
  const sourceText = normalizeNullableText(body.sourceText);
  const title = normalizeNullableText(body.title) || sourceText;
  const journalEntryId = normalizeNullableText(body.journalEntryId);
  const projectId = normalizeNullableText(body.projectId);
  if (!title) throw new MissionControlInputError("Task title is required");
  if (!journalEntryId) throw new MissionControlInputError("Journal entry is required");
  if (!projectId) throw new MissionControlInputError("Project is required");

  await ensureJournalEntryExists(env, userId, journalEntryId);
  await ensureProjectExists(env, userId, projectId);
  const column = await resolveMissionTaskColumn(env, userId, projectId, {
    status: "backlog",
  });

  const taskId = crypto.randomUUID();
  const linkId = crypto.randomUUID();
  const metadata = {
    journalSource: {
      journalEntryId,
      quote: sourceText,
    },
  };

  await env.DB.prepare(
    `INSERT INTO mission_tasks
       (id, user_id, project_id, column_id, title, description, status, priority, source_kind, source_ref, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, 'backlog', 3, 'capture', ?, ?)`,
  )
    .bind(
      taskId,
      userId,
      projectId,
      column.id,
      title,
      sourceText && sourceText !== title ? sourceText : null,
      journalEntryId,
      JSON.stringify(metadata),
    )
    .run();

  await env.DB.prepare(
    `INSERT INTO journal_project_links
       (id, user_id, journal_entry_id, project_id, source_text, created_task_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(linkId, userId, journalEntryId, projectId, sourceText, taskId)
    .run();

  return {
    task: serializeTask((await getMissionTask(env, userId, taskId)) as MissionTaskRow),
    link: await getJournalProjectLink(env, userId, linkId),
  };
}

export async function updateMissionTask(
  env: Env,
  userId: string,
  taskId: string,
  input: unknown,
) {
  const existing = await getMissionTask(env, userId, taskId);
  if (!existing) throw new MissionControlInputError("Task not found", 404);
  const body = isRecord(input) ? input : {};
  const projectId =
    typeof body.projectId === "string" && body.projectId.trim()
      ? body.projectId.trim()
      : existing.project_id;
  if (projectId) await ensureProjectExists(env, userId, projectId);
  const statusInput = normalizeMissionTaskStatus(body.status);
  let status = statusInput || existing.status;
  let columnId = existing.column_id || null;
  if (projectId && status !== "cancelled") {
    const column = await resolveMissionTaskColumn(env, userId, projectId, {
      columnId: body.columnId,
      status,
      fallbackColumnId:
        projectId === existing.project_id &&
        (body.status === undefined || status === existing.status)
          ? existing.column_id
          : null,
    });
    columnId = column.id;
    if (body.columnId !== undefined) status = column.status;
  } else {
    columnId = null;
  }

  await env.DB.prepare(
    `UPDATE mission_tasks
     SET project_id = ?, column_id = ?, title = ?, description = ?, status = ?, priority = ?, position = ?,
         pinned_at = CASE
           WHEN ? THEN CASE WHEN pinned_at IS NULL THEN datetime('now') ELSE pinned_at END
           WHEN ? THEN NULL
           ELSE pinned_at
         END,
         due_at = ?, scheduled_for = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(
      projectId,
      columnId,
      normalizeNullableText(body.title) || existing.title,
      body.description === undefined
        ? existing.description
        : normalizeNullableText(body.description),
      status,
      normalizePriority(body.priority, existing.priority),
      normalizeTaskPosition(body.position, existing.position),
      body.pinned === true ? 1 : 0,
      body.pinned === false ? 1 : 0,
      body.dueAt === undefined ? existing.due_at : normalizeNullableText(body.dueAt),
      body.scheduledFor === undefined
        ? existing.scheduled_for
        : normalizeMissionDateKey(body.scheduledFor),
      taskId,
      userId,
    )
    .run();

  const task = (await getMissionTask(env, userId, taskId)) as MissionTaskRow;
  return {
    task: serializeTask(task),
  };
}

export async function listJournalEntryLinks(
  env: Env,
  userId: string,
  journalEntryId: string,
) {
  await ensureJournalEntryExists(env, userId, journalEntryId);
  const rows = await env.DB.prepare(
    `SELECT l.id, l.user_id, l.journal_entry_id, l.project_id, l.source_text,
            l.created_task_id, l.created_reminder_id, l.created_at,
            e.entry_date, e.title AS entry_title, t.title AS task_title
     FROM journal_project_links l
     INNER JOIN journal_entries e
       ON e.id = l.journal_entry_id AND e.user_id = l.user_id
     LEFT JOIN mission_tasks t
       ON t.id = l.created_task_id AND t.user_id = l.user_id
     WHERE l.user_id = ? AND l.journal_entry_id = ?
       AND l.created_task_id IS NOT NULL AND e.archived_at IS NULL
     ORDER BY l.created_at DESC
     LIMIT 100`,
  )
    .bind(userId, journalEntryId)
    .all<JournalProjectLinkRow>();

  return { links: (rows.results || []).map(serializeJournalProjectLink) };
}

export async function archiveMissionTask(env: Env, userId: string, taskId: string) {
  const result = await env.DB.prepare(
    `UPDATE mission_tasks
     SET archived_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(taskId, userId)
    .run();
  if ((result.meta?.changes || 0) === 0) {
    throw new MissionControlInputError("Task not found", 404);
  }
  return { ok: true };
}

export async function listMissionApprovals(
  env: Env,
  userId: string,
  statusInput?: unknown,
  limitInput = 50,
) {
  const status =
    statusInput === "approved" ||
    statusInput === "rejected" ||
    statusInput === "expired" ||
    statusInput === "cancelled" ||
    statusInput === "pending"
      ? statusInput
      : null;
  const limit = Math.max(1, Math.min(limitInput, 100));
  const rows = await env.DB.prepare(
    `SELECT id, user_id, plugin_id, action_id, title, summary, payload_json,
            risk_level, status, requested_by, resolved_by, requested_at, resolved_at, expires_at
     FROM mission_approvals
     WHERE user_id = ? AND (? IS NULL OR status = ?)
     ORDER BY requested_at DESC
     LIMIT ?`,
  )
    .bind(userId, status, status, limit)
    .all<MissionApprovalRow>();
  return (rows.results || []).map(serializeApproval);
}

export async function resolveMissionApproval(
  env: Env,
  userId: string,
  approvalId: string,
  input: unknown,
) {
  const body = isRecord(input) ? input : {};
  const decision =
    body.decision === "approved" || body.status === "approved"
      ? "approved"
      : body.decision === "rejected" || body.status === "rejected"
        ? "rejected"
        : body.decision === "cancelled" || body.status === "cancelled"
          ? "cancelled"
          : null;
  if (!decision) throw new MissionControlInputError("Decision is required");

  const result = await env.DB.prepare(
    `UPDATE mission_approvals
     SET status = ?, resolved_by = ?, resolved_at = datetime('now')
     WHERE id = ? AND user_id = ? AND status = 'pending'`,
  )
    .bind(decision, userId, approvalId, userId)
    .run();
  if ((result.meta?.changes || 0) === 0) {
    throw new MissionControlInputError("Pending approval not found", 404);
  }

  return { approval: (await listMissionApprovals(env, userId, decision, 1))[0] };
}

export async function listMissionAgentRuns(env: Env, userId: string, limitInput = 50) {
  const limit = Math.max(1, Math.min(limitInput, 100));
  const rows = await env.DB.prepare(
    `SELECT id, user_id, source, project_id, task_id, approval_id, title,
            prompt_summary, status, model, runner_id, started_at, finished_at,
            cost_json, result_json, artifact_manifest_json, created_at, updated_at
     FROM mission_agent_runs
     WHERE user_id = ?
     ORDER BY COALESCE(started_at, created_at) DESC
     LIMIT ?`,
  )
    .bind(userId, limit)
    .all<MissionAgentRunRow>();
  return (rows.results || []).map(serializeAgentRun);
}

export async function listMissionPluginActivity(env: Env, userId: string, limitInput = 50) {
  const limit = Math.max(1, Math.min(limitInput, 100));
  const rows = await env.DB.prepare(
    `SELECT id, user_id, plugin_id, activity_type, title, summary, status,
            related_id, metadata_json, created_at
     FROM mission_plugin_activity
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(userId, limit)
    .all<MissionPluginActivityRow>();
  return (rows.results || []).map(serializePluginActivity);
}

export async function getMissionDailyBriefing(env: Env, userId: string, briefingId: string) {
  const row = await env.DB.prepare(
    `SELECT id, user_id, plugin_id, activity_type, title, summary, status,
            related_id, metadata_json, created_at
     FROM mission_plugin_activity
     WHERE id = ? AND user_id = ? AND activity_type = 'assistant_job.review_packet'
     LIMIT 1`,
  )
    .bind(briefingId, userId)
    .first<MissionPluginActivityRow>();
  if (!row) throw new MissionControlInputError("Daily Briefing not found", 404);
  const briefing = serializeDailyBriefing(row);
  if (!briefing) throw new MissionControlInputError("Daily Briefing not found", 404);
  return { briefing };
}

type MissionProfileSnapshot = {
  name: string;
  handle: string;
  bio: string;
  missionStatement: string;
};

function missionStatementFromBusiness(
  business: Record<string, unknown>,
): string {
  const explicit = normalizeContextMissionStatement(
    business.positioningStatement,
  );
  if (explicit) return explicit;

  const audience = normalizeNullableText(business.audience);
  if (!audience) return "";
  const primaryProblem = normalizeNullableText(business.primaryProblem);
  const solution = normalizeNullableText(business.solution);
  const parts = [`I help ${audience}`];
  if (primaryProblem) parts.push(`with ${primaryProblem}`);
  if (solution) parts.push(`by ${solution}`);
  return `${parts.join(" ")}.`;
}

async function loadMissionProfileSnapshot(
  env: Env,
  userId: string,
): Promise<MissionProfileSnapshot | null> {
  const site = await env.DB.prepare(
    `SELECT id, username
     FROM sites
     WHERE user_id = ? AND COALESCE(site_type, 'profile') = 'profile' AND site_role = 'profile'
     ORDER BY updated_at DESC
     LIMIT 1`,
  )
    .bind(userId)
    .first<{ id: string; username: string }>();
  if (!site) return null;

  const text =
    (await getSiteFileText(env, site.id, "src/me.json")) ||
    (await getSiteFileText(env, site.id, "public/me.json")) ||
    (await getSiteFileText(env, site.id, "me.json"));
  if (!text) return null;

  try {
    const profile = JSON.parse(text) as unknown;
    if (!isRecord(profile)) return null;
    const business = isRecord(profile.business) ? profile.business : {};
    return {
      name: normalizeNullableText(profile.name) || site.username,
      handle: normalizeNullableText(profile.handle) || site.username,
      bio: normalizeNullableText(profile.bio) || "",
      missionStatement: missionStatementFromBusiness(business),
    };
  } catch {
    return null;
  }
}

export async function getMissionDashboard(env: Env, userId: string) {
  const [
    row,
    pluginRecords,
    latestDailyBriefing,
    latestWheelSnapshot,
    profileSnapshot,
  ] = await Promise.all([
    getOrCreateMissionDashboardSettingsRow(env, userId),
    listCorePluginRecords(env),
    getLatestMissionDailyBriefing(env, userId),
    getLatestMissionWheelSnapshot(env, userId),
    loadMissionProfileSnapshot(env, userId),
  ]);
  const allCardContributions = dashboardCardContributionsFromPlugins(pluginRecords);
  const allQuickActionContributions =
    dashboardQuickActionContributionsFromPlugins(pluginRecords);
  const enabledPluginIds = pluginRecords
    .filter((plugin) => plugin.enabled && plugin.status === "installed")
    .map((plugin) => plugin.id);
  const enabledPlugins = new Set(enabledPluginIds);
  const cardContributions = availableDashboardCardContributions(
    allCardContributions,
    enabledPlugins,
  );
  const quickActionContributions = availableDashboardQuickActionContributions(
    allQuickActionContributions,
    enabledPlugins,
  );
  const missionStatement = profileSnapshot
    ? profileSnapshot.missionStatement || DEFAULT_MISSION_STATEMENT
    : row.mission_statement || DEFAULT_MISSION_STATEMENT;
  const cards = resolveDashboardCards(
    parseJsonArray(row.cards_json),
    allCardContributions,
    cardContributions,
  );
  const quickLinks = resolveDashboardQuickLinks(
    parseJsonArray(row.quick_links_json),
    allQuickActionContributions,
    quickActionContributions,
  );
  const settings = normalizeDashboardSettings(parseJsonRecord(row.settings_json));
  const mainGoal =
    settings.goals.find((goal) => goal.status === "active")?.title || "";

  return {
    availableCards: cardContributions,
    availableQuickActions: quickActionContributions,
    destinations: DASHBOARD_DESTINATIONS,
    cards,
    quickLinks,
    settings,
    missionStatement,
    mainGoal,
    data: {
      "mission.daily-briefing": latestDailyBriefing,
      "mission.mission-statement": {
        missionStatement,
        placeholder: DEFAULT_MISSION_STATEMENT,
        source: profileSnapshot ? "profile" : "legacy",
      },
      "mission.goals": {
        goals: settings.goals,
      },
      "mission.wheel-latest-snapshot": {
        snapshot: latestWheelSnapshot,
        source: "server",
      },
      "mission.me3-profile": profileSnapshot,
    },
    updatedAt: normalizeDbDateTime(row.updated_at),
  };
}

type MissionProjectSummaryRow = {
  project_id: string | null;
  project_name: string;
  status: Extract<MissionTaskStatus, "backlog" | "in_progress">;
  count: number;
};

type MissionProjectDashboardTaskRow = {
  id: string;
  project_id: string | null;
  project_name: string;
  title: string;
  status: "backlog" | "in_progress";
  priority: number;
  pinned_at: string | null;
  due_at: string | null;
  scheduled_for: string | null;
};

export async function getMissionProjectsSummary(env: Env, userId: string) {
  const [rows, taskRows] = await Promise.all([
    env.DB.prepare(
      `SELECT CASE WHEN p.status = 'active' THEN p.id ELSE NULL END AS project_id,
              CASE WHEN p.status = 'active' THEN p.name ELSE 'Personal' END AS project_name,
              t.status,
              COUNT(*) AS count
       FROM mission_tasks t
       LEFT JOIN mission_projects p
         ON p.id = t.project_id AND p.user_id = t.user_id
       WHERE t.user_id = ?
         AND t.archived_at IS NULL
         AND t.status IN ('backlog', 'in_progress')
       GROUP BY project_id, project_name, t.status`,
    )
      .bind(userId)
      .all<MissionProjectSummaryRow>(),
    env.DB.prepare(
      `SELECT t.id,
              CASE WHEN p.status = 'active' THEN p.id ELSE NULL END AS project_id,
              CASE WHEN p.status = 'active' THEN p.name ELSE 'Personal' END AS project_name,
              t.title, t.status, t.priority, t.pinned_at, t.due_at, t.scheduled_for
       FROM mission_tasks t
       LEFT JOIN mission_projects p
         ON p.id = t.project_id AND p.user_id = t.user_id
       WHERE t.user_id = ?
         AND t.archived_at IS NULL
         AND t.status IN ('backlog', 'in_progress')
       ORDER BY CASE WHEN t.pinned_at IS NULL THEN 1 ELSE 0 END,
                t.pinned_at DESC,
                t.priority ASC,
                t.position ASC,
                COALESCE(t.due_at, t.scheduled_for, t.updated_at) ASC,
                t.id ASC
       LIMIT 100`,
    )
      .bind(userId)
      .all<MissionProjectDashboardTaskRow>(),
  ]);

  const summaries = new Map<
    string,
    {
      id: string;
      label: string;
      total: number;
      counts: Record<Exclude<MissionTaskStatus, "cancelled">, number>;
    }
  >();
  for (const row of rows.results || []) {
    const id = row.project_id || "personal";
    const summary = summaries.get(id) || {
      id,
      label: row.project_name,
      total: 0,
      counts: { backlog: 0, in_progress: 0, done: 0 },
    };
    summary.counts[row.status] = Number(row.count) || 0;
    summary.total += Number(row.count) || 0;
    summaries.set(id, summary);
  }

  return {
    summaries: Array.from(summaries.values())
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))
      .slice(0, 4),
    tasks: (taskRows.results || []).map((task) => ({
      id: task.id,
      projectId: task.project_id || "personal",
      projectName: task.project_name,
      title: task.title,
      status: task.status,
      priority: task.priority,
      pinnedAt: normalizeDbDateTime(task.pinned_at),
      dueAt: task.due_at,
      scheduledFor: task.scheduled_for,
    })),
  };
}

export async function updateMissionDashboard(
  env: Env,
  userId: string,
  input: unknown,
) {
  const body = isRecord(input) ? input : {};
  const existing = await getMissionDashboard(env, userId);
  const existingRow = await getOrCreateMissionDashboardSettingsRow(env, userId);
  const existingPersistedSettings = parseJsonRecord(existingRow.settings_json);
  const hasStructuredGoals = Array.isArray(existingPersistedSettings.goals);
  const missionStatement = existingRow.mission_statement;
  const cards =
    body.cards === undefined
      ? existing.cards
      : resolveDashboardCards(
          Array.isArray(body.cards) ? body.cards : [],
          dashboardCardContributionsFromDashboard(existing),
          existing.availableCards,
          { includeMissingDefaults: false },
        );
  const quickLinks =
    body.quickLinks === undefined
      ? existing.quickLinks
      : resolveDashboardQuickLinks(
          Array.isArray(body.quickLinks) ? body.quickLinks : [],
          dashboardQuickActionContributionsFromDashboard(existing),
          existing.availableQuickActions,
          { includeMissingDefaults: false },
        );
  const legacyGoalUpdate =
    body.goals === undefined &&
    body.mainGoal !== undefined &&
    (!hasStructuredGoals || existing.settings.goals.length === 0)
      ? normalizeMainGoal(body.mainGoal)
        ? [
            {
              id: existing.settings.goals.find((goal) => goal.status === "active")?.id ||
                "legacy-main-goal",
              title: body.mainGoal,
              status: "active",
            },
          ]
        : []
      : undefined;
  const settings = normalizeDashboardSettings({
    ...existing.settings,
    ...(isRecord(body.settings) ? body.settings : {}),
    ...(body.kanbanEnabled === undefined ? {} : { kanbanEnabled: body.kanbanEnabled }),
    ...(body.goals === undefined && legacyGoalUpdate === undefined
      ? {}
      : { goals: body.goals ?? legacyGoalUpdate }),
  });
  const persistedSettings = {
    kanbanEnabled: settings.kanbanEnabled,
    goals: settings.goals,
    setupChecklistDismissed: settings.setupChecklistDismissed,
  };

  await env.DB.prepare(
    `INSERT INTO mission_dashboard_settings
       (user_id, cards_json, quick_links_json, settings_json, mission_statement, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       cards_json = excluded.cards_json,
       quick_links_json = excluded.quick_links_json,
       settings_json = excluded.settings_json,
       mission_statement = excluded.mission_statement,
       updated_at = datetime('now')`,
  )
    .bind(
      userId,
      JSON.stringify(cards),
      JSON.stringify(quickLinks),
      JSON.stringify(persistedSettings),
      missionStatement,
    )
    .run();

  return getMissionDashboard(env, userId);
}

export async function getMissionWheel(env: Env, userId: string) {
  const [settingsRow, snapshotRows] = await Promise.all([
    getOrCreateMissionWheelSettingsRow(env, userId),
    listMissionWheelSnapshotRows(env, userId, 50),
  ]);
  return {
    settings: serializeMissionWheelSettings(settingsRow),
    snapshots: snapshotRows.map(serializeMissionWheelSnapshot),
  };
}

export async function updateMissionWheelSettings(
  env: Env,
  userId: string,
  input: unknown,
) {
  const body = isRecord(input) ? input : {};
  const existing = await getOrCreateMissionWheelSettingsRow(env, userId);
  const segments =
    body.segments === undefined
      ? sanitizeMissionWheelSegments(parseJsonArray(existing.segments_json))
      : sanitizeMissionWheelSegments(body.segments);

  await env.DB.prepare(
    `INSERT INTO mission_wheel_settings
       (user_id, segments_json, schema_version, updated_at)
     VALUES (?, ?, 1, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       segments_json = excluded.segments_json,
       schema_version = excluded.schema_version,
       updated_at = datetime('now')`,
  )
    .bind(userId, JSON.stringify(segments))
    .run();

  return {
    settings: serializeMissionWheelSettings(
      (await getMissionWheelSettingsRow(env, userId)) as MissionWheelSettingsRow,
    ),
  };
}

export async function createMissionWheelSnapshot(
  env: Env,
  userId: string,
  input: unknown,
) {
  const body = isRecord(input) ? input : {};
  const settings = await updateMissionWheelSettings(env, userId, {
    segments: body.segments,
  });
  const segments = settings.settings.segments;
  if (!segments.every((segment) => segment.value !== null)) {
    throw new MissionControlInputError("Score every Wheel area before saving a snapshot");
  }
  const notes = normalizeMissionWheelNotes(body.notes, segments);
  const id = normalizeNullableText(body.id) || crypto.randomUUID();
  const createdAt =
    normalizeIsoDateTime(body.createdAt) || new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO mission_wheel_snapshots
       (id, user_id, segments_json, notes_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, userId, JSON.stringify(segments), JSON.stringify(notes), createdAt)
    .run();

  return {
    snapshot: serializeMissionWheelSnapshot(
      (await getMissionWheelSnapshotRow(env, userId, id)) as MissionWheelSnapshotRow,
    ),
  };
}

export async function listMissionWheelSnapshots(
  env: Env,
  userId: string,
  limitInput: unknown = 50,
) {
  const rows = await listMissionWheelSnapshotRows(
    env,
    userId,
    normalizeListLimit(limitInput, 50),
  );
  return { snapshots: rows.map(serializeMissionWheelSnapshot) };
}

async function getMissionControlDailyBriefing(env: Env, userId: string, date: string) {
  const soulinkConnection = await env.DB.prepare(
    `SELECT id
     FROM agent_channel_connections
     WHERE user_id = ?
       AND channel = 'soulink'
       AND status = 'active'
       AND provider_thread_id IS NOT NULL
     LIMIT 1`,
  )
    .bind(userId)
    .first<AgentChannelConnectionRow>()
    .catch(() => null);

  const row = await env.DB.prepare(
    `SELECT id, user_id, plugin_id, activity_type, title, summary, status,
            related_id, metadata_json, created_at
     FROM mission_plugin_activity
     WHERE user_id = ?
       AND activity_type = 'assistant_job.review_packet'
     ORDER BY created_at DESC
     LIMIT 20`,
  )
    .bind(userId)
    .all<MissionPluginActivityRow>()
    .catch(() => ({ results: [] as MissionPluginActivityRow[] }));

  const activity = (row.results || [])
    .map(serializePluginActivity)
    .find((item) => {
      const briefing = parseDailyBriefingMetadata(item.metadata);
      return briefing?.date === date;
    });
  if (!activity) return null;

  const briefing = parseDailyBriefingMetadata(activity.metadata);
  if (!briefing) return null;

  return {
    id: activity.id,
    title: activity.title,
    version: briefing.version,
    message: briefing.plainText,
    plainText: briefing.plainText,
    date: briefing.date,
    sections: briefing.sections,
    createdAt: activity.createdAt,
    showInJournal: !soulinkConnection,
    deliveryHint: soulinkConnection ? "soulink" : "mission_control",
  };
}

async function getMissionControlWeeklyReview(env: Env, userId: string, date: string) {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, source, project_id, task_id, approval_id, title,
            prompt_summary, status, model, runner_id, started_at, finished_at,
            cost_json, result_json, artifact_manifest_json, created_at, updated_at
     FROM mission_agent_runs
     WHERE user_id = ?
       AND source = 'core'
       AND status = 'succeeded'
     ORDER BY COALESCE(finished_at, started_at, created_at) DESC
     LIMIT 20`,
  )
    .bind(userId)
    .all<MissionAgentRunRow>()
    .catch(() => ({ results: [] as MissionAgentRunRow[] }));

  for (const row of rows.results || []) {
    const result = parseJsonRecord(row.result_json);
    const review = parseWeeklyReviewResult(result.weeklyReview);
    if (!review) continue;
    if (review.reviewDate !== date) continue;
    return {
      ...review,
      id: row.id,
      runId: row.id,
      assistantJobRunId:
        typeof result.assistantJobRunId === "string" ? result.assistantJobRunId : null,
      title: row.title.replace(/^Assistant Job:\s*/, ""),
      createdAt: row.finished_at || row.started_at || row.created_at,
    };
  }
  return null;
}

export async function submitMissionWeeklyReview(
  env: Env,
  userId: string,
  runId: string,
  input: unknown,
) {
  const reviewRun = await env.DB.prepare(
    `SELECT id, user_id, source, project_id, task_id, approval_id, title,
            prompt_summary, status, model, runner_id, started_at, finished_at,
            cost_json, result_json, artifact_manifest_json, created_at, updated_at
     FROM mission_agent_runs
     WHERE id = ? AND user_id = ? AND source = 'core'
     LIMIT 1`,
  )
    .bind(runId, userId)
    .first<MissionAgentRunRow>();
  if (!reviewRun) throw new MissionControlInputError("Weekly Review not found", 404);
  const review = parseWeeklyReviewResult(parseJsonRecord(reviewRun.result_json).weeklyReview);
  if (!review) throw new MissionControlInputError("Weekly Review result is not available", 404);

  return submitWeeklyReviewPayload(env, userId, {
    runId,
    input,
    review,
    task: null,
  });
}

export async function submitMissionWeeklyReviewTask(
  env: Env,
  userId: string,
  taskId: string,
  input: unknown,
) {
  const task = await getMissionTask(env, userId, taskId);
  if (!task || task.archived_at) throw new MissionControlInputError("Weekly Review task not found", 404);
  const metadata = parseJsonRecord(task.metadata_json);
  const reviewMetadata = metadata.weeklyReview;
  const review = parseWeeklyReviewResult(reviewMetadata);
  if (!review || metadata.kind !== "weekly_review") {
    throw new MissionControlInputError("Task is not a Weekly Review", 409);
  }
  const reviewRecord = isRecord(reviewMetadata) ? reviewMetadata : {};
  const runId =
    normalizeNullableText(reviewRecord.assistantJobRunId) ||
    normalizeNullableText(reviewRecord.missionAgentRunId) ||
    task.source_ref ||
    task.id;

  return submitWeeklyReviewPayload(env, userId, {
    runId,
    input,
    review,
    task,
  });
}

async function submitWeeklyReviewPayload(
  env: Env,
  userId: string,
  options: {
    runId: string;
    input: unknown;
    review: ParsedWeeklyReviewResult;
    task: MissionTaskRow | null;
  },
) {
  const body = isRecord(options.input) ? options.input : {};
  const taskActions = new Map<string, "archive" | "done">(
    Array.isArray(body.tasks)
      ? (body.tasks as WeeklyReviewTaskInput[])
          .map((item) => {
            const id = normalizeNullableText(item.id);
            const action =
              item.action === "archive" || item.action === "done"
                ? item.action
                : null;
            return id && action ? ([id, action] as const) : null;
          })
          .filter((item): item is readonly [string, "archive" | "done"] => Boolean(item))
      : [],
  );
  const selectedMemory = Array.isArray(body.memorySuggestions)
    ? (body.memorySuggestions as WeeklyReviewMemoryInput[]).filter(
        (item) => item && item.checked === true && normalizeNullableText(item.body),
      )
    : [];
  const customMemoryBody = normalizeNullableText(body.customMemory);
  const selectedReminders = Array.isArray(body.reminders)
    ? (body.reminders as WeeklyReviewReminderInput[]).filter(
        (item) => item && item.checked === true && typeof item.id === "string",
      )
    : [];
  const now = new Date().toISOString();
  const actionableTaskIds = new Set(
    options.review.openTasks
      .map((task) => normalizeNullableText(task.id))
      .filter((taskId): taskId is string => taskId !== null),
  );
  const archivedTaskIds: string[] = [];
  const completedTaskIds: string[] = [];

  for (const [taskId, action] of taskActions) {
    if (!actionableTaskIds.has(taskId)) continue;
    const task = await getMissionTask(env, userId, taskId);
    if (!task || task.archived_at || task.status === "done" || task.status === "cancelled") {
      continue;
    }
    if (action === "archive") {
      const result = await env.DB.prepare(
        `UPDATE mission_tasks
         SET archived_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`,
      )
        .bind(taskId, userId)
        .run();
      if ((result.meta?.changes || 0) > 0) archivedTaskIds.push(taskId);
      continue;
    }
    const result = await env.DB.prepare(
      `UPDATE mission_tasks
       SET status = 'done', updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    )
      .bind(taskId, userId)
      .run();
    if ((result.meta?.changes || 0) > 0) completedTaskIds.push(taskId);
  }

  const reviewedTaskIds = Array.from(
    new Set([...archivedTaskIds, ...completedTaskIds]),
  );

  const memoryIds: string[] = [];
  if (customMemoryBody) {
    const result = await createMissionMemory(env, userId, {
      memoryKind: "owner_note",
      scopeKind: "owner",
      title: "Weekly Review note",
      body: customMemoryBody,
      confidence: 1,
      sourceKind: "manual",
      sourceRef: `${options.runId}:custom-memory`,
    });
    memoryIds.push(result.memory.id);
  }

  for (const suggestion of selectedMemory.slice(0, 5)) {
    const result = await createMissionMemory(env, userId, {
      memoryKind: normalizeMemoryKind(suggestion.memoryKind) || "owner_note",
      scopeKind: "owner",
      title: normalizeNullableText(suggestion.title) || "Weekly Review suggestion",
      body: normalizeNullableText(suggestion.body),
      confidence: 0.75,
      sourceKind: "agent",
      sourceRef: `${options.runId}:${normalizeNullableText(suggestion.id) || crypto.randomUUID()}`,
    });
    memoryIds.push(result.memory.id);
  }

  const rescheduledReminderIds: string[] = [];
  const tomorrow = addDays(options.review.reviewDate, 1);
  for (const reminder of selectedReminders) {
    const reminderId = normalizeNullableText(reminder.id);
    if (!reminderId) continue;
    const remindAt = reminder.reschedule === "tomorrow" ? `${tomorrow}T09:00:00.000Z` : null;
    if (!remindAt) continue;
    const result = await env.DB.prepare(
      `UPDATE user_reminders
       SET remind_at = ?, status = 'pending', updated_at = datetime('now')
       WHERE id = ? AND user_id = ? AND status = 'pending'`,
    )
      .bind(remindAt, reminderId, userId)
      .run();
    if ((result.meta?.changes || 0) > 0) rescheduledReminderIds.push(reminderId);
  }

  if (options.task) {
    const metadata = parseJsonRecord(options.task.metadata_json);
    const reviewMetadata = isRecord(metadata.weeklyReview) ? metadata.weeklyReview : {};
    await env.DB.prepare(
      `UPDATE mission_tasks
       SET status = 'done', metadata_json = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    )
      .bind(
        JSON.stringify({
          ...metadata,
          weeklyReview: {
            ...reviewMetadata,
            submittedAt: now,
            reviewedTaskIds,
            archivedTaskIds,
            completedTaskIds,
            memoryIds,
            rescheduledReminderIds,
          },
        }),
        options.task.id,
        userId,
      )
      .run();
  }

  await appendMissionPluginActivity(env, userId, {
    pluginId: "me3.mission-control",
    activityType: "weekly_review.submitted",
    title: "Weekly Review submitted",
    summary: `${archivedTaskIds.length} task${archivedTaskIds.length === 1 ? "" : "s"} archived; ${completedTaskIds.length} marked done; ${memoryIds.length} memory note${memoryIds.length === 1 ? "" : "s"} queued; ${rescheduledReminderIds.length} reminder${rescheduledReminderIds.length === 1 ? "" : "s"} rescheduled.`,
    status: "succeeded",
    relatedId: options.task?.id || options.runId,
  });

  return {
    ok: true,
    reviewedTaskIds,
    archivedTaskIds,
    completedTaskIds,
    memoryIds,
    rescheduledReminderIds,
  };
}

export async function clearMissionActivity(env: Env, userId: string) {
  const [agentRuns, pluginActivity] = await env.DB.batch([
    env.DB.prepare(`DELETE FROM mission_agent_runs WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM mission_plugin_activity WHERE user_id = ?`).bind(userId),
  ]);
  return {
    cleared: {
      agentRuns: agentRuns.meta?.changes || 0,
      pluginActivity: pluginActivity.meta?.changes || 0,
    },
  };
}

export async function listMissionMemory(env: Env, userId: string, limitInput = 50) {
  const limit = Math.max(1, Math.min(limitInput, 100));
  const rows = await env.DB.prepare(
    `SELECT id, user_id, memory_kind, scope_kind, scope_id, title, body, confidence,
            source_kind, source_ref, review_status, created_at, updated_at
     FROM mission_private_memory
     WHERE user_id = ? AND review_status != 'archived'
     ORDER BY updated_at DESC
     LIMIT ?`,
  )
    .bind(userId, limit)
    .all<MissionMemoryRow>();
  return (rows.results || []).map(serializeMemory);
}

export async function createMissionMemory(env: Env, userId: string, input: unknown) {
  const body = isRecord(input) ? input : {};
  const text = normalizeNullableText(body.body);
  if (!text) throw new MissionControlInputError("Memory body is required");
  const kind = normalizeMemoryKind(body.memoryKind) || "owner_note";
  const scopeKind = normalizeScopeKind(body.scopeKind) || "owner";
  const sourceKind = normalizeMemorySourceKind(body.sourceKind) || "manual";
  const reviewStatus =
    sourceKind === "agent"
      ? "needs_review"
      : normalizeMemoryReviewStatus(body.reviewStatus) || "active";
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO mission_private_memory
       (id, user_id, memory_kind, scope_kind, scope_id, title, body, confidence,
        source_kind, source_ref, review_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      userId,
      kind,
      scopeKind,
      normalizeNullableText(body.scopeId),
      normalizeNullableText(body.title),
      text,
      normalizeConfidence(body.confidence),
      sourceKind,
      normalizeNullableText(body.sourceRef),
      reviewStatus,
    )
    .run();

  return { memory: serializeMemory((await getMissionMemory(env, userId, id)) as MissionMemoryRow) };
}

export async function suggestMissionMemory(env: Env, userId: string, input: unknown) {
  const body = isRecord(input) ? input : {};
  return createMissionMemory(env, userId, {
    ...body,
    sourceKind: "agent",
    reviewStatus: "needs_review",
  });
}

export async function updateMissionMemory(
  env: Env,
  userId: string,
  memoryId: string,
  input: unknown,
) {
  const body = isRecord(input) ? input : {};
  const existing = await getMissionMemory(env, userId, memoryId);
  if (!existing) throw new MissionControlInputError("Memory not found", 404);
  if (existing.review_status === "archived") {
    throw new MissionControlInputError("Memory not found", 404);
  }

  await env.DB.prepare(
    `UPDATE mission_private_memory
     SET title = ?, body = ?, review_status = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND review_status != 'archived'`,
  )
    .bind(
      body.title === undefined ? existing.title : normalizeNullableText(body.title),
      normalizeNullableText(body.body) || existing.body,
      normalizeMemoryReviewStatus(body.reviewStatus) || existing.review_status,
      memoryId,
      userId,
    )
    .run();

  return { memory: serializeMemory((await getMissionMemory(env, userId, memoryId)) as MissionMemoryRow) };
}

export async function approveMissionMemory(env: Env, userId: string, memoryId: string) {
  const existing = await getMissionMemory(env, userId, memoryId);
  if (!existing || existing.review_status === "archived") {
    throw new MissionControlInputError("Memory not found", 404);
  }

  const result = await env.DB.prepare(
    `UPDATE mission_private_memory
     SET review_status = 'active', updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND review_status != 'archived'`,
  )
    .bind(memoryId, userId)
    .run();
  if ((result.meta?.changes || 0) === 0) {
    throw new MissionControlInputError("Memory not found", 404);
  }

  return { memory: serializeMemory((await getMissionMemory(env, userId, memoryId)) as MissionMemoryRow) };
}

export async function deleteMissionMemory(env: Env, userId: string, memoryId: string) {
  const result = await env.DB.prepare(
    `UPDATE mission_private_memory
     SET review_status = 'archived', updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(memoryId, userId)
    .run();
  if ((result.meta?.changes || 0) === 0) {
    throw new MissionControlInputError("Memory not found", 404);
  }
  return { ok: true };
}

export async function listMissionContextSources(env: Env, userId: string, limitInput = 50) {
  const limit = Math.max(1, Math.min(limitInput, 100));
  await ensureBaselineContextSources(env, userId);
  const rows = await env.DB.prepare(
    `SELECT id, user_id, source_kind, label, description, visibility, status,
            source_ref, last_indexed_at, grants_json, metadata_json, created_at, updated_at
     FROM mission_context_sources
     WHERE user_id = ? AND status != 'archived'
     ORDER BY CASE source_kind
                WHEN 'mission_statement' THEN 0
                WHEN 'wheel_of_life' THEN 1
                WHEN 'public_me_json' THEN 2
                WHEN 'private_memory' THEN 3
                ELSE 4
              END,
              label ASC
     LIMIT ?`,
  )
    .bind(userId, limit)
    .all<MissionContextSourceRow>();
  return (rows.results || []).map(serializeContextSource);
}

export async function createMissionContextSource(env: Env, userId: string, input: unknown) {
  const body = isRecord(input) ? input : {};
  const label = normalizeNullableText(body.label);
  if (!label) throw new MissionControlInputError("Source label is required");
  const sourceKind = normalizeSourceKind(body.sourceKind) || "url";
  const id = crypto.randomUUID();

  await env.DB.prepare(
    `INSERT INTO mission_context_sources
       (id, user_id, source_kind, label, description, visibility, status, source_ref, grants_json, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', '{}')`,
  )
    .bind(
      id,
      userId,
      sourceKind,
      label,
      normalizeNullableText(body.description),
      body.visibility === "public" ? "public" : "private",
      body.status === "setup_required" ? "setup_required" : "active",
      normalizeNullableText(body.sourceRef),
    )
    .run();

  const source = await getMissionContextSource(env, userId, id);
  return { source: serializeContextSource(source as MissionContextSourceRow) };
}

export async function updateMissionContextSource(
  env: Env,
  userId: string,
  sourceId: string,
  input: unknown,
) {
  const existing = await getMissionContextSource(env, userId, sourceId);
  if (!existing) throw new MissionControlInputError("Context source not found", 404);
  const body = isRecord(input) ? input : {};
  const status = normalizeSourceStatus(body.status) || existing.status;

  await env.DB.prepare(
    `UPDATE mission_context_sources
     SET label = ?, description = ?, visibility = ?, status = ?, source_ref = ?,
         updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(
      normalizeNullableText(body.label) || existing.label,
      body.description === undefined
        ? existing.description
        : normalizeNullableText(body.description),
      body.visibility === "public" ? "public" : existing.visibility,
      status,
      body.sourceRef === undefined
        ? existing.source_ref
        : normalizeNullableText(body.sourceRef),
      sourceId,
      userId,
    )
    .run();

  const source = await getMissionContextSource(env, userId, sourceId);
  return { source: serializeContextSource(source as MissionContextSourceRow) };
}

export async function deleteMissionContextSource(env: Env, userId: string, sourceId: string) {
  const result = await env.DB.prepare(
    `UPDATE mission_context_sources
     SET status = 'archived', updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`,
  )
    .bind(sourceId, userId)
    .run();
  if ((result.meta?.changes || 0) === 0) {
    throw new MissionControlInputError("Context source not found", 404);
  }
  return { ok: true };
}

export async function getMissionSetup(env: Env, userId: string) {
  const [aiConfigured, memory, sources, daemon, localExecutor] = await Promise.all([
    hasConfiguredAiProvider(env, userId),
    listMissionMemory(env, userId, 1),
    listMissionContextSources(env, userId, 20),
    getMissionDaemonStatus(env, userId),
    getLocalExecutorSetupState(env, userId),
  ]);

  const items: MissionSetupItem[] = [
    {
      id: "ai-provider",
      label: "AI provider",
      status: aiConfigured ? "ready" : "setup_required",
      detail: aiConfigured
        ? "Assistant routes have an AI provider available."
        : "Configure an AI provider before deeper agent workflows.",
      actionPath: "/account?section=ai",
    },
    {
      id: "private-memory",
      label: "Private memory",
      status: memory.length > 0 ? "ready" : "optional",
      detail: memory.length > 0
        ? "Private memory is available for owner-approved context."
        : "Add only the private context you want your Assistant to remember.",
      actionPath: "/assistant?settings=context",
    },
    {
      id: "context-sources",
      label: "Context sources",
      status: sources.length > 0 ? "ready" : "optional",
      detail: "Public profile, private memory, plugin tables, and local sources stay inventoried here.",
      actionPath: "/assistant?settings=context",
    },
    {
      id: "daemon",
      label: "Local files and repos",
      status: daemon.connected ? "ready" : "optional",
      detail: daemon.connected
        ? "A local daemon bridge is paired."
        : "Optional. Pair a local daemon only when you want approved local file or repo access.",
      actionPath: null,
    },
    {
      id: "local-executor",
      label: "Local Executor",
      status: localExecutor.ready
        ? "ready"
        : localExecutor.pluginEnabled
          ? "setup_required"
          : "optional",
      detail: localExecutor.ready
        ? "A local runner and project policy are ready for bounded coding runs."
        : localExecutor.pluginEnabled
          ? "Pair a local runner and add a project policy before coding runs can start."
          : "Optional. Enable Local Executor when you want approved coding runs on a local computer.",
      actionPath: localExecutor.pluginEnabled
        ? "/account?section=plugins"
        : "/account?section=plugins&blocked=me3.local-executor",
    },
  ];

  return {
    aiConfigured,
    memoryCount: memory.length,
    contextSourceCount: sources.length,
    daemonConnected: daemon.connected,
    localExecutorReady: localExecutor.ready,
    items,
  };
}

export async function getMissionDaemonStatus(env: Env, userId: string) {
  const [pairings, allowlist, audit] = await Promise.all([
    env.DB.prepare(
      `SELECT id, runner_id, display_name, status, version, platform, last_seen_at,
              health_json, paired_at, created_at, updated_at
       FROM mission_daemon_pairings
       WHERE user_id = ? AND status != 'revoked'
       ORDER BY COALESCE(last_seen_at, created_at) DESC
       LIMIT 5`,
    )
      .bind(userId)
      .all<MissionDaemonPairingRow>(),
    env.DB.prepare(
      `SELECT a.id, a.pairing_id, a.label, a.path_hint, a.resource_kind,
              a.permission_tier, a.shell_policy_json, a.status, a.last_checked_at,
              a.created_at, a.updated_at
       FROM mission_daemon_allowlist_entries a
       JOIN mission_daemon_pairings p ON p.id = a.pairing_id
       WHERE p.user_id = ? AND a.status != 'revoked'
       ORDER BY a.created_at DESC
       LIMIT 20`,
    )
      .bind(userId)
      .all<MissionDaemonAllowlistRow>(),
    env.DB.prepare(
      `SELECT dae.id, dae.pairing_id, dae.allowlist_entry_id, dae.run_id,
              dae.approval_id, dae.event_type, dae.actor, dae.summary,
              dae.payload_json, dae.created_at
       FROM mission_daemon_audit_events dae
       LEFT JOIN mission_daemon_pairings p ON p.id = dae.pairing_id
       WHERE p.user_id = ? OR dae.pairing_id IS NULL
       ORDER BY dae.created_at DESC
       LIMIT 10`,
    )
      .bind(userId)
      .all<MissionDaemonAuditRow>(),
  ]);

  const serializedPairings = (pairings.results || []).map(serializeDaemonPairing);
  return {
    enabled: serializedPairings.length > 0,
    connected: serializedPairings.some((pairing) => pairing.status === "active"),
    pairings: serializedPairings,
    allowlist: (allowlist.results || []).map(serializeDaemonAllowlistEntry),
    audit: (audit.results || []).map(serializeDaemonAuditEvent),
  };
}

export async function startMissionDaemonPairing(env: Env, userId: string, input: unknown) {
  const body = isRecord(input) ? input : {};
  const runnerId = normalizeNullableText(body.runnerId) || `runner-${crypto.randomUUID()}`;
  const displayName = normalizeNullableText(body.displayName) || "Local daemon";
  const pairingId = crypto.randomUUID();
  const code = crypto.randomUUID().slice(0, 8).toUpperCase();
  const tokenHash = await sha256Text(`pending:${code}`);

  await env.DB.prepare(
    `INSERT INTO mission_daemon_pairings
       (id, user_id, runner_id, display_name, token_hash, status, health_json)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
  )
    .bind(
      pairingId,
      userId,
      runnerId,
      displayName,
      tokenHash,
      JSON.stringify({ pairingCodeExpiresInMinutes: 10 }),
    )
    .run();
  await appendMissionDaemonAudit(env, {
    pairingId,
    eventType: "pair_requested",
    actor: "owner",
    summary: `Pairing started for ${displayName}`,
  });

  return {
    ok: true,
    pairing: {
      id: pairingId,
      runnerId,
      displayName,
      status: "pending",
    },
    code,
    installCommand: `me3-daemon pair --core <core-url> --code ${code}`,
  };
}

export async function listMissionDaemonAudit(env: Env, userId: string) {
  const daemon = await getMissionDaemonStatus(env, userId);
  return { audit: daemon.audit };
}

async function getMissionProject(env: Env, userId: string, projectId: string) {
  return env.DB.prepare(
    `SELECT id, user_id, name, slug, description, status, color, icon, source_kind,
            source_ref, metadata_json, created_at, updated_at
     FROM mission_projects
     WHERE id = ? AND user_id = ?`,
  )
    .bind(projectId, userId)
    .first<MissionProjectRow>();
}

async function serializeProjectWithColumns(
  env: Env,
  userId: string,
  row: MissionProjectRow,
) {
  return serializeProject(row, await listMissionProjectColumns(env, userId, row.id));
}

async function listMissionProjectColumns(
  env: Env,
  userId: string,
  projectId: string,
) {
  const columns = await listMissionProjectColumnRows(env, userId, projectId);
  if (columns.length) return columns.map(serializeProjectColumn);
  return defaultMissionProjectColumns(userId, projectId);
}

async function listMissionProjectColumnsForProjects(
  env: Env,
  userId: string,
  projectIds: string[],
) {
  if (!projectIds.length) {
    return new Map<string, ReturnType<typeof serializeProjectColumn>[]>();
  }
  const rows = await env.DB.prepare(
    `SELECT id, user_id, project_id, name, status, position, archived_at,
            created_at, updated_at
     FROM mission_project_columns
     WHERE user_id = ? AND project_id IN (${projectIds.map(() => "?").join(", ")})
       AND archived_at IS NULL
     ORDER BY project_id ASC, position ASC, id ASC`,
  )
    .bind(userId, ...projectIds)
    .all<MissionProjectColumnRow>();
  const columnsByProject = new Map<
    string,
    ReturnType<typeof serializeProjectColumn>[]
  >();
  for (const row of rows.results || []) {
    const columns = columnsByProject.get(row.project_id) || [];
    columns.push(serializeProjectColumn(row));
    columnsByProject.set(row.project_id, columns);
  }
  return columnsByProject;
}

function defaultMissionProjectColumns(userId: string, projectId: string) {
  return DEFAULT_PROJECT_COLUMNS.map((column) =>
    serializeProjectColumn({
      id: `${projectId}:${column.status}`,
      user_id: userId,
      project_id: projectId,
      name: column.name,
      status: column.status,
      position: column.position,
      archived_at: null,
      created_at: "",
      updated_at: "",
    }),
  );
}

async function listMissionProjectColumnRows(
  env: Env,
  userId: string,
  projectId: string,
) {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, project_id, name, status, position, archived_at,
            created_at, updated_at
     FROM mission_project_columns
     WHERE user_id = ? AND project_id = ? AND archived_at IS NULL
     ORDER BY position ASC, id ASC`,
  )
    .bind(userId, projectId)
    .all<MissionProjectColumnRow>()
    .catch(() => ({ results: [] as MissionProjectColumnRow[] }));
  return rows.results || [];
}

async function ensureDefaultProjectColumns(
  env: Env,
  userId: string,
  projectId: string,
) {
  for (const column of DEFAULT_PROJECT_COLUMNS) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO mission_project_columns
         (id, user_id, project_id, name, status, position)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        `${projectId}:${column.status}`,
        userId,
        projectId,
        column.name,
        column.status,
        column.position,
      )
      .run()
      .catch(() => null);
  }
}

async function getMissionProjectColumn(
  env: Env,
  userId: string,
  projectId: string,
  columnId: string,
) {
  await ensureDefaultProjectColumns(env, userId, projectId);
  return env.DB.prepare(
    `SELECT id, user_id, project_id, name, status, position, archived_at,
            created_at, updated_at
     FROM mission_project_columns
     WHERE id = ? AND user_id = ? AND project_id = ? AND archived_at IS NULL`,
  )
    .bind(columnId, userId, projectId)
    .first<MissionProjectColumnRow>();
}

async function resolveMissionTaskColumn(
  env: Env,
  userId: string,
  projectId: string,
  options: {
    columnId?: unknown;
    fallbackColumnId?: string | null;
    status: MissionTaskStatus;
  },
) {
  if (options.status === "cancelled") {
    throw new MissionControlInputError("Column status is invalid");
  }
  const requestedColumnId = normalizeNullableText(options.columnId);
  if (requestedColumnId) {
    const column = await getMissionProjectColumn(
      env,
      userId,
      projectId,
      requestedColumnId,
    );
    if (!column) throw new MissionControlInputError("Project column not found", 404);
    return column;
  }

  if (options.fallbackColumnId) {
    const column = await getMissionProjectColumn(
      env,
      userId,
      projectId,
      options.fallbackColumnId,
    );
    if (column) return column;
  }

  const columns = await listMissionProjectColumnRows(env, userId, projectId);
  const matching = columns.find((column) => column.status === options.status);
  const fallback = columns[0];
  if (!matching && !fallback) {
    throw new MissionControlInputError("Project column not found", 404);
  }
  return matching || fallback;
}

async function getMissionTask(env: Env, userId: string, taskId: string) {
  return env.DB.prepare(
    `SELECT id, user_id, project_id, column_id, title, description, status, priority, position, pinned_at,
            due_at, scheduled_for, source_kind, source_ref, approval_id,
            metadata_json, created_at, updated_at, archived_at
     FROM mission_tasks
     WHERE id = ? AND user_id = ?`,
  )
    .bind(taskId, userId)
    .first<MissionTaskRow>();
}

async function getJournalProjectLink(env: Env, userId: string, linkId: string) {
  const row = await env.DB.prepare(
    `SELECT l.id, l.user_id, l.journal_entry_id, l.project_id, l.source_text,
            l.created_task_id, l.created_reminder_id, l.created_at,
            e.entry_date, e.title AS entry_title, t.title AS task_title
     FROM journal_project_links l
     INNER JOIN journal_entries e
       ON e.id = l.journal_entry_id AND e.user_id = l.user_id
     LEFT JOIN mission_tasks t
       ON t.id = l.created_task_id AND t.user_id = l.user_id
     WHERE l.id = ? AND l.user_id = ?`,
  )
    .bind(linkId, userId)
    .first<JournalProjectLinkRow>();
  if (!row) throw new MissionControlInputError("Journal link not found", 404);
  return serializeJournalProjectLink(row);
}

async function ensureJournalEntryExists(env: Env, userId: string, journalEntryId: string) {
  const entry = await env.DB.prepare(
    `SELECT id
     FROM journal_entries
     WHERE id = ? AND user_id = ? AND archived_at IS NULL`,
  )
    .bind(journalEntryId, userId)
    .first<{ id: string }>();
  if (!entry) throw new MissionControlInputError("Journal entry not found", 404);
}

async function getMissionMemory(env: Env, userId: string, memoryId: string) {
  return env.DB.prepare(
    `SELECT id, user_id, memory_kind, scope_kind, scope_id, title, body, confidence,
            source_kind, source_ref, review_status, created_at, updated_at
     FROM mission_private_memory
     WHERE id = ? AND user_id = ?`,
  )
    .bind(memoryId, userId)
    .first<MissionMemoryRow>();
}

async function getMissionContextSource(env: Env, userId: string, sourceId: string) {
  return env.DB.prepare(
    `SELECT id, user_id, source_kind, label, description, visibility, status,
            source_ref, last_indexed_at, grants_json, metadata_json, created_at, updated_at
     FROM mission_context_sources
     WHERE id = ? AND user_id = ?`,
  )
    .bind(sourceId, userId)
    .first<MissionContextSourceRow>();
}

async function getOrCreateMissionDashboardSettingsRow(env: Env, userId: string) {
  const existing = await env.DB.prepare(
    `SELECT user_id, cards_json, quick_links_json, settings_json,
            mission_statement, created_at, updated_at
     FROM mission_dashboard_settings
     WHERE user_id = ?`,
  )
    .bind(userId)
    .first<MissionDashboardSettingsRow>();
  if (existing) return existing;

  const pluginRecords = await listCorePluginRecords(env);
  const enabledPluginIds = pluginRecords
    .filter((plugin) => plugin.enabled && plugin.status === "installed")
    .map((plugin) => plugin.id);
  const enabledPlugins = new Set(enabledPluginIds);
  const allCardContributions = dashboardCardContributionsFromPlugins(pluginRecords);
  const allQuickActionContributions =
    dashboardQuickActionContributionsFromPlugins(pluginRecords);
  const cards = resolveDashboardCards(
    [],
    allCardContributions,
    availableDashboardCardContributions(allCardContributions, enabledPlugins),
  );
  const quickLinks = resolveDashboardQuickLinks(
    [],
    allQuickActionContributions,
    availableDashboardQuickActionContributions(
      allQuickActionContributions,
      enabledPlugins,
    ),
  );
  const settings = normalizeDashboardSettings({});

  await env.DB.prepare(
    `INSERT INTO mission_dashboard_settings
       (user_id, cards_json, quick_links_json, settings_json, mission_statement)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO NOTHING`,
  )
    .bind(
      userId,
      JSON.stringify(cards),
      JSON.stringify(quickLinks),
      JSON.stringify({
        kanbanEnabled: settings.kanbanEnabled,
        goals: settings.goals,
        setupChecklistDismissed: settings.setupChecklistDismissed,
      }),
      DEFAULT_MISSION_STATEMENT,
    )
    .run();

  return (await env.DB.prepare(
    `SELECT user_id, cards_json, quick_links_json, settings_json,
            mission_statement, created_at, updated_at
     FROM mission_dashboard_settings
     WHERE user_id = ?`,
  )
    .bind(userId)
    .first<MissionDashboardSettingsRow>()) as MissionDashboardSettingsRow;
}

async function getMissionWheelSettingsRow(env: Env, userId: string) {
  return env.DB.prepare(
    `SELECT user_id, segments_json, schema_version, created_at, updated_at
     FROM mission_wheel_settings
     WHERE user_id = ?`,
  )
    .bind(userId)
    .first<MissionWheelSettingsRow>();
}

async function getOrCreateMissionWheelSettingsRow(env: Env, userId: string) {
  const existing = await getMissionWheelSettingsRow(env, userId);
  if (existing) return existing;

  await env.DB.prepare(
    `INSERT INTO mission_wheel_settings
       (user_id, segments_json, schema_version)
     VALUES (?, ?, 1)
     ON CONFLICT(user_id) DO NOTHING`,
  )
    .bind(userId, JSON.stringify(DEFAULT_MISSION_WHEEL_SEGMENTS))
    .run();

  return (await getMissionWheelSettingsRow(env, userId)) as MissionWheelSettingsRow;
}

async function listMissionWheelSnapshotRows(
  env: Env,
  userId: string,
  limit: number,
) {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, segments_json, notes_json, created_at
     FROM mission_wheel_snapshots
     WHERE user_id = ?
     ORDER BY created_at DESC, id ASC
     LIMIT ?`,
  )
    .bind(userId, limit)
    .all<MissionWheelSnapshotRow>()
    .catch(() => ({ results: [] as MissionWheelSnapshotRow[] }));
  return rows.results || [];
}

async function getMissionWheelSnapshotRow(
  env: Env,
  userId: string,
  snapshotId: string,
) {
  return env.DB.prepare(
    `SELECT id, user_id, segments_json, notes_json, created_at
     FROM mission_wheel_snapshots
     WHERE id = ? AND user_id = ?`,
  )
    .bind(snapshotId, userId)
    .first<MissionWheelSnapshotRow>();
}

async function getLatestMissionWheelSnapshot(env: Env, userId: string) {
  const rows = await listMissionWheelSnapshotRows(env, userId, 1);
  return rows[0] ? serializeMissionWheelSnapshot(rows[0]) : null;
}

async function ensurePersonalProject(env: Env, userId: string) {
  const existing = await env.DB.prepare(
    `SELECT id, user_id, name, slug, description, status, color, icon, source_kind,
            source_ref, metadata_json, created_at, updated_at
     FROM mission_projects
     WHERE user_id = ? AND slug = 'personal'`,
  )
    .bind(userId)
    .first<MissionProjectRow>();
  if (existing) {
    return existing;
  }

  await env.DB.prepare(
    `INSERT INTO mission_projects
       (id, user_id, name, slug, description, color, icon, source_kind)
     VALUES (?, ?, 'Personal', 'personal', 'Default personal project.', 'teal', 'sparkles', 'manual')
     ON CONFLICT(user_id, slug) DO NOTHING`,
  )
    .bind(userId === "owner" ? PERSONAL_PROJECT_ID : crypto.randomUUID(), userId)
    .run();

  const created = (await env.DB.prepare(
    `SELECT id, user_id, name, slug, description, status, color, icon, source_kind,
            source_ref, metadata_json, created_at, updated_at
     FROM mission_projects
     WHERE user_id = ? AND slug = 'personal'`,
  )
    .bind(userId)
    .first<MissionProjectRow>()) as MissionProjectRow;
  await ensureDefaultProjectColumns(env, userId, created.id);
  return created;
}

async function ensureProjectExists(env: Env, userId: string, projectId: string) {
  const project = await getMissionProject(env, userId, projectId);
  if (!project) throw new MissionControlInputError("Project not found", 404);
  await ensureDefaultProjectColumns(env, userId, projectId);
}

async function ensureBaselineContextSources(env: Env, userId: string) {
  const [dashboardRow, latestWheelSnapshot, profileSnapshot] = await Promise.all([
    getOrCreateMissionDashboardSettingsRow(env, userId).catch(() => null),
    getLatestMissionWheelSnapshot(env, userId).catch(() => null),
    loadMissionProfileSnapshot(env, userId).catch(() => null),
  ]);
  const missionStatement = profileSnapshot
    ? profileSnapshot.missionStatement
    : normalizeContextMissionStatement(dashboardRow?.mission_statement || null);
  const dashboardSettings = normalizeDashboardSettings(
    parseJsonRecord(dashboardRow?.settings_json || "{}"),
  );
  const hasMissionContext = Boolean(
    missionStatement || dashboardSettings.goals.length,
  );
  const baselines = [
    {
      id: `mission-source-mission-statement-${userId}`,
      kind: "mission_statement",
      label: "Mission",
      description: hasMissionContext
        ? "The owner's Mission and active goals for assistant help."
        : "Missing: define a Mission or active goal so ME3 understands the owner's direction.",
      visibility: "private",
      status: hasMissionContext ? "active" : "setup_required",
      sourceRef: "/create?step=mission",
    },
    {
      id: `mission-source-wheel-of-life-${userId}`,
      kind: "wheel_of_life",
      label: "Wheel of Life",
      description: latestWheelSnapshot
        ? "Latest Wheel of Life snapshot, used as a current lightweight life check-in."
        : "Missing: save a Wheel of Life snapshot so ME3 can see the owner's current balance.",
      visibility: "private",
      status: latestWheelSnapshot ? "active" : "setup_required",
      sourceRef: "/create?step=wheel-of-life",
    },
    {
      id: `mission-source-public-profile-${userId}`,
      kind: "public_me_json",
      label: "Public me.json",
      description: "Public profile facts ME3 can use for identity and public-facing help.",
      visibility: "public",
      status: "active",
      sourceRef: "/.well-known/me.json",
    },
    {
      id: `mission-source-private-memory-${userId}`,
      kind: "private_memory",
      label: "Private memory",
      description:
        "During Weekly Review, you can save important details for ME3 to remember and use when relevant.",
      visibility: "private",
      status: "active",
      sourceRef: "/mission-control?settings=context",
    },
  ] as const;

  for (const source of baselines) {
    await env.DB.prepare(
      `INSERT INTO mission_context_sources
         (id, user_id, source_kind, label, description, visibility, status, source_ref, grants_json, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', '{}')
       ON CONFLICT(id) DO UPDATE SET
         source_kind = excluded.source_kind,
         label = excluded.label,
         description = excluded.description,
         visibility = excluded.visibility,
         status = excluded.status,
         source_ref = excluded.source_ref,
         updated_at = datetime('now')`,
    )
      .bind(
        source.id,
        userId,
        source.kind,
        source.label,
        source.description,
        source.visibility,
        source.status,
        source.sourceRef,
      )
      .run();
  }
}

async function getOwnerTimezone(env: Env, userId: string): Promise<string> {
  const row = await env.DB.prepare("SELECT timezone FROM owner_profile WHERE id = ?")
    .bind(userId)
    .first<OwnerTimezoneRow>();
  return normalizeTimeZone(row?.timezone) || DEFAULT_OWNER_TIMEZONE;
}

async function appendMissionPluginActivity(
  env: Env,
  userId: string,
  input: {
    pluginId: string;
    activityType: string;
    title: string;
    summary?: string | null;
    status?: string | null;
    relatedId?: string | null;
  },
) {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO mission_plugin_activity
       (id, user_id, plugin_id, activity_type, title, summary, status, related_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
  )
    .bind(
      crypto.randomUUID(),
      userId,
      input.pluginId,
      input.activityType,
      input.title,
      input.summary || null,
      input.status || null,
      input.relatedId || null,
      now,
    )
    .run();
}

async function appendMissionDaemonAudit(
  env: Env,
  input: {
    pairingId?: string | null;
    allowlistEntryId?: string | null;
    runId?: string | null;
    approvalId?: string | null;
    eventType: string;
    actor: string;
    summary: string;
    payload?: Record<string, unknown>;
  },
) {
  await env.DB.prepare(
    `INSERT INTO mission_daemon_audit_events
       (id, pairing_id, allowlist_entry_id, run_id, approval_id, event_type, actor, summary, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      input.pairingId || null,
      input.allowlistEntryId || null,
      input.runId || null,
      input.approvalId || null,
      input.eventType,
      input.actor,
      input.summary,
      JSON.stringify(input.payload || {}),
    )
    .run();
}

async function getEnabledDashboardPluginIds(env: Env): Promise<string[]> {
  const enabled = ["me3.core", "me3.mission-control"];
  for (const pluginId of ["me3.journal", "me3.social-publishing", "me3.landing-pages", "me3.accounts"]) {
    if (await isCorePluginEnabled(env, pluginId).catch(() => false)) {
      enabled.push(pluginId);
    }
  }
  return enabled;
}

async function getLatestMissionDailyBriefing(env: Env, userId: string) {
  const rows = await env.DB.prepare(
    `SELECT id, user_id, plugin_id, activity_type, title, summary, status,
            related_id, metadata_json, created_at
     FROM mission_plugin_activity
     WHERE user_id = ?
       AND activity_type = 'assistant_job.review_packet'
     ORDER BY created_at DESC
     LIMIT 20`,
  )
    .bind(userId)
    .all<MissionPluginActivityRow>()
    .catch(() => ({ results: [] as MissionPluginActivityRow[] }));

  for (const row of rows.results || []) {
    const briefing = serializeDailyBriefing(row);
    if (briefing) return briefing;
  }

  return null;
}

function serializeDailyBriefing(row: MissionPluginActivityRow) {
  const activity = serializePluginActivity(row);
  const briefing = parseDailyBriefingMetadata(activity.metadata);
  if (!briefing) return null;
  return {
    id: activity.id,
    title: activity.title,
    version: briefing.version,
    message: briefing.plainText,
    plainText: briefing.plainText,
    date: briefing.date,
    sections: briefing.sections,
    createdAt: activity.createdAt,
    status: activity.status,
    relatedId: activity.relatedId,
  };
}

function availableDashboardCardContributions(
  contributions: DashboardCardContribution[],
  enabledPlugins: Set<string>,
): DashboardCardContribution[] {
  return contributions.filter((card) =>
    enabledPlugins.has(card.pluginId) &&
    dashboardRequirementsMet(card.requiresPluginIds, enabledPlugins),
  );
}

function availableDashboardQuickActionContributions(
  contributions: DashboardQuickActionContribution[],
  enabledPlugins: Set<string>,
): DashboardQuickActionContribution[] {
  return contributions.filter((action) =>
    enabledPlugins.has(action.pluginId) &&
    dashboardRequirementsMet(action.requiresPluginIds, enabledPlugins),
  );
}

function dashboardCardContributionsFromPlugins(
  pluginRecords: DashboardPluginRecord[],
): DashboardCardContribution[] {
  const contributions = new Map<string, DashboardCardContribution>();
  for (const plugin of pluginRecords) {
    for (const card of plugin.dashboardCards || []) {
      if (!DASHBOARD_CARD_COMPONENT_KEYS.has(card.componentKey)) continue;
      if (contributions.has(card.id)) continue;
      contributions.set(card.id, { ...card, pluginId: plugin.id });
    }
  }
  return sortDashboardContributions(Array.from(contributions.values()));
}

function dashboardQuickActionContributionsFromPlugins(
  pluginRecords: DashboardPluginRecord[],
): DashboardQuickActionContribution[] {
  const contributions = new Map<string, DashboardQuickActionContribution>();
  for (const plugin of pluginRecords) {
    for (const action of plugin.dashboardQuickActions || []) {
      if (!DASHBOARD_DESTINATIONS[action.destinationId]) continue;
      if (contributions.has(action.id)) continue;
      contributions.set(action.id, { ...action, pluginId: plugin.id });
    }
  }
  return sortDashboardContributions(Array.from(contributions.values()));
}

function sortDashboardContributions<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      dashboardContributionOrder(a.id) - dashboardContributionOrder(b.id) ||
      a.id.localeCompare(b.id),
  );
}

function dashboardContributionOrder(id: string) {
  const index = DASHBOARD_CONTRIBUTION_ORDER.indexOf(id);
  return index < 0 ? 999 : index;
}

function dashboardCardContributionsFromDashboard(dashboard: {
  availableCards: DashboardCardContribution[];
  cards: DashboardCardInstance[];
}) {
  const byId = new Map(dashboard.availableCards.map((card) => [card.id, card]));
  for (const card of dashboard.cards) {
    if (byId.has(card.cardId)) continue;
    byId.set(card.cardId, {
      id: card.cardId,
      pluginId: card.pluginId,
      label: card.cardId,
      componentKey: "UnavailableCard",
      defaultEnabled: false,
      defaultSize: card.size,
    });
  }
  return Array.from(byId.values());
}

function dashboardQuickActionContributionsFromDashboard(dashboard: {
  availableQuickActions: DashboardQuickActionContribution[];
  quickLinks: DashboardQuickLink[];
}) {
  const byId = new Map(dashboard.availableQuickActions.map((action) => [action.id, action]));
  for (const link of dashboard.quickLinks) {
    if (byId.has(link.id)) continue;
    byId.set(link.id, {
      id: link.id,
      pluginId: link.requiresPluginId || "me3.core",
      label: link.label,
      icon: link.icon,
      defaultEnabled: false,
      destinationId: link.destinationId,
    });
  }
  return Array.from(byId.values());
}

function dashboardRequirementsMet(
  pluginIds: string[] | undefined,
  enabledPlugins: Set<string>,
) {
  return (pluginIds || []).every((pluginId) => enabledPlugins.has(pluginId));
}

function resolveDashboardCards(
  stored: unknown[],
  contributions: DashboardCardContribution[],
  availableContributions: DashboardCardContribution[] = contributions,
  options: { includeMissingDefaults?: boolean } = {},
): DashboardCardInstance[] {
  const includeMissingDefaults = options.includeMissingDefaults !== false;
  const contributionById = new Map(contributions.map((item) => [item.id, item]));
  const availableContributionIds = new Set(availableContributions.map((item) => item.id));
  const cards: DashboardCardInstance[] = [];
  const seen = new Set<string>();

  for (const item of stored) {
    const card = normalizeDashboardCardInstance(item, contributionById, availableContributionIds);
    if (!card || seen.has(card.cardId)) continue;
    seen.add(card.cardId);
    cards.push(card);
  }

  if (includeMissingDefaults) {
    for (const contribution of availableContributions) {
      if (seen.has(contribution.id)) continue;
      cards.push(defaultDashboardCardInstance(contribution, cards.length));
    }
  }

  return cards
    .sort((a, b) => a.sortOrder - b.sortOrder || a.cardId.localeCompare(b.cardId))
    .map((card, index) => ({ ...card, sortOrder: index }));
}

function normalizeDashboardCardInstance(
  value: unknown,
  contributionById: Map<string, DashboardCardContribution>,
  availableContributionIds: Set<string>,
): DashboardCardInstance | null {
  if (!isRecord(value)) return null;
  const cardId = normalizeNullableText(value.cardId);
  if (!cardId) return null;
  const contribution = contributionById.get(cardId);
  if (!contribution) return null;
  const sortOrder = normalizeSortOrder(value.sortOrder);
  return {
    instanceId:
      normalizeNullableText(value.instanceId) ||
      `dashboard-card-${cardId}`,
    cardId,
    pluginId: contribution.pluginId,
    enabled: value.enabled === undefined ? contribution.defaultEnabled : value.enabled === true,
    available: availableContributionIds.has(cardId),
    size: normalizeDashboardCardSize(value.size) || contribution.defaultSize,
    sortOrder,
    config: isRecord(value.config) ? value.config : undefined,
  };
}

function defaultDashboardCardInstance(
  contribution: DashboardCardContribution,
  sortOrder: number,
): DashboardCardInstance {
  return {
    instanceId: `dashboard-card-${contribution.id}`,
    cardId: contribution.id,
    pluginId: contribution.pluginId,
    enabled: contribution.defaultEnabled,
    available: true,
    size: contribution.defaultSize,
    sortOrder,
  };
}

function resolveDashboardQuickLinks(
  stored: unknown[],
  contributions: DashboardQuickActionContribution[],
  availableContributions: DashboardQuickActionContribution[] = contributions,
  options: { includeMissingDefaults?: boolean } = {},
): DashboardQuickLink[] {
  const includeMissingDefaults = options.includeMissingDefaults !== false;
  const contributionById = new Map(contributions.map((item) => [item.id, item]));
  const availableContributionIds = new Set(availableContributions.map((item) => item.id));
  const links: DashboardQuickLink[] = [];
  const seen = new Set<string>();

  for (const item of stored) {
    const link = normalizeDashboardQuickLink(item, contributionById, availableContributionIds);
    if (!link || seen.has(link.id)) continue;
    seen.add(link.id);
    links.push(link);
  }

  if (includeMissingDefaults) {
    for (const contribution of availableContributions) {
      if (seen.has(contribution.id)) continue;
      links.push(defaultDashboardQuickLink(contribution, links.length));
    }
  }

  return links
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map((link, index) => ({ ...link, sortOrder: index }));
}

function normalizeDashboardQuickLink(
  value: unknown,
  contributionById: Map<string, DashboardQuickActionContribution>,
  availableContributionIds: Set<string>,
): DashboardQuickLink | null {
  if (!isRecord(value)) return null;
  const id = normalizeNullableText(value.id);
  if (!id) return null;
  const contribution = contributionById.get(id);
  const destinationId = normalizeNullableText(value.destinationId) || contribution?.destinationId;
  if (!destinationId || !DASHBOARD_DESTINATIONS[destinationId]) return null;
  const destination = DASHBOARD_DESTINATIONS[destinationId];
  return {
    id,
    label: normalizeNullableText(value.label) || contribution?.label || id,
    icon: normalizeDashboardIcon(value.icon) || contribution?.icon || "Circle",
    enabled: value.enabled === undefined ? contribution?.defaultEnabled === true : value.enabled === true,
    sortOrder: normalizeSortOrder(value.sortOrder),
    destinationId,
    requiresPluginId: destination.requiresPluginId,
    available: availableContributionIds.has(id),
  };
}

function defaultDashboardQuickLink(
  contribution: DashboardQuickActionContribution,
  sortOrder: number,
): DashboardQuickLink {
  const destination = DASHBOARD_DESTINATIONS[contribution.destinationId];
  return {
    id: contribution.id,
    label: contribution.label,
    icon: contribution.icon,
    enabled: contribution.defaultEnabled,
    sortOrder,
    destinationId: contribution.destinationId,
    requiresPluginId: destination?.requiresPluginId,
    available: true,
  };
}

function serializeProject(row: MissionProjectRow, columns: ReturnType<typeof serializeProjectColumn>[] = []) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    color: row.color,
    icon: row.icon,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    metadata: parseJsonRecord(row.metadata_json),
    columns,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeProjectColumn(row: MissionProjectColumnRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    status: row.status,
    position: row.position,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeTask(row: MissionTaskRow) {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    columnId: row.column_id || null,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    position: row.position,
    pinnedAt: row.pinned_at,
    dueAt: row.due_at,
    scheduledFor: row.scheduled_for,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    approvalId: row.approval_id,
    metadata: parseJsonRecord(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function serializeJournalProjectLink(row: JournalProjectLinkRow) {
  return {
    id: row.id,
    journalEntryId: row.journal_entry_id,
    projectId: row.project_id,
    sourceText: row.source_text,
    createdTaskId: row.created_task_id,
    createdReminderId: row.created_reminder_id,
    createdAt: row.created_at,
    entryDate: row.entry_date,
    entryTitle: row.entry_title,
    taskTitle: row.task_title,
  };
}

function serializeApproval(row: MissionApprovalRow) {
  return {
    id: row.id,
    userId: row.user_id,
    pluginId: row.plugin_id,
    actionId: row.action_id,
    title: row.title,
    summary: row.summary,
    payload: parseJsonRecord(row.payload_json),
    riskLevel: row.risk_level,
    status: row.status,
    requestedBy: row.requested_by,
    resolvedBy: row.resolved_by,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
    expiresAt: row.expires_at,
  };
}

function serializeAgentRun(row: MissionAgentRunRow) {
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source,
    projectId: row.project_id,
    taskId: row.task_id,
    approvalId: row.approval_id,
    title: row.title,
    promptSummary: row.prompt_summary,
    status: row.status,
    model: row.model,
    runnerId: row.runner_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    cost: parseJsonRecord(row.cost_json),
    result: parseJsonRecord(row.result_json),
    artifacts: parseJsonArray(row.artifact_manifest_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializePluginActivity(row: MissionPluginActivityRow) {
  return {
    id: row.id,
    userId: row.user_id,
    pluginId: row.plugin_id,
    activityType: row.activity_type,
    title: row.title,
    summary: row.summary,
    status: row.status,
    relatedId: row.related_id,
    metadata: parseJsonRecord(row.metadata_json),
    createdAt: normalizeDbDateTime(row.created_at),
  };
}

function serializeMissionWheelSettings(row: MissionWheelSettingsRow) {
  return {
    userId: row.user_id,
    schemaVersion: row.schema_version,
    segments: sanitizeMissionWheelSegments(parseJsonArray(row.segments_json)),
    createdAt: normalizeDbDateTime(row.created_at),
    updatedAt: normalizeDbDateTime(row.updated_at),
  };
}

function serializeMissionWheelSnapshot(row: MissionWheelSnapshotRow) {
  const notes = parseJsonRecord(row.notes_json);
  return {
    id: row.id,
    userId: row.user_id,
    createdAt: normalizeDbDateTime(row.created_at) || row.created_at,
    segments: sanitizeMissionWheelSegments(parseJsonArray(row.segments_json)).map(
      (segment) => ({
        ...segment,
        notes:
          typeof notes[segment.id] === "string"
            ? String(notes[segment.id]).slice(0, 600)
            : "",
      }),
    ),
  };
}

function serializeMemory(row: MissionMemoryRow) {
  return {
    id: row.id,
    userId: row.user_id,
    memoryKind: row.memory_kind,
    scopeKind: row.scope_kind,
    scopeId: row.scope_id,
    title: row.title,
    body: row.body,
    confidence: row.confidence,
    sourceKind: row.source_kind,
    sourceRef: row.source_ref,
    reviewStatus: row.review_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeContextSource(row: MissionContextSourceRow) {
  return {
    id: row.id,
    userId: row.user_id,
    sourceKind: row.source_kind,
    label: row.label,
    description: row.description,
    visibility: row.visibility,
    status: row.status,
    sourceRef: row.source_ref,
    lastIndexedAt: row.last_indexed_at,
    grants: parseJsonArray(row.grants_json),
    metadata: parseJsonRecord(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeDaemonPairing(row: MissionDaemonPairingRow) {
  return {
    id: row.id,
    runnerId: row.runner_id,
    displayName: row.display_name,
    status: row.status,
    version: row.version,
    platform: row.platform,
    lastSeenAt: row.last_seen_at,
    health: parseJsonRecord(row.health_json),
    pairedAt: row.paired_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeDaemonAllowlistEntry(row: MissionDaemonAllowlistRow) {
  return {
    id: row.id,
    pairingId: row.pairing_id,
    label: row.label,
    pathHint: row.path_hint,
    resourceKind: row.resource_kind,
    permissionTier: row.permission_tier,
    shellPolicy: parseJsonRecord(row.shell_policy_json),
    status: row.status,
    lastCheckedAt: row.last_checked_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeDaemonAuditEvent(row: MissionDaemonAuditRow) {
  return {
    id: row.id,
    pairingId: row.pairing_id,
    allowlistEntryId: row.allowlist_entry_id,
    runId: row.run_id,
    approvalId: row.approval_id,
    eventType: row.event_type,
    actor: row.actor,
    summary: row.summary,
    payload: parseJsonRecord(row.payload_json),
    createdAt: row.created_at,
  };
}

function parseTemporalHint(text: string, selectedDate: string, timezone: string): TemporalHint | null {
  const date = resolveMentionedDate(text, selectedDate);
  const time = resolveMentionedTime(text);
  if (!time && !date.explicit) return null;
  return buildTemporalHint(date.value, time || { hour: 9, minute: 0 }, timezone);
}

function parseManualTemporalHint(
  dateInput: unknown,
  timeInput: unknown,
  timezone: string,
): TemporalHint | null {
  const date = normalizeMissionDateKey(dateInput);
  const time = normalizeClockInput(timeInput);
  if (!date || !time) return null;
  return buildTemporalHint(date, time, timezone);
}

function buildTemporalHint(
  date: string,
  time: { hour: number; minute: number },
  timezone: string,
): TemporalHint {
  const [year, month, day] = date.split("-").map(Number);
  const startsAt = new Date(
    getUtcMsForLocalTime(
      {
        year,
        month,
        day,
        hour: time.hour,
        minute: time.minute,
      },
      timezone,
    ),
  ).toISOString();
  const endsAt = new Date(new Date(startsAt).getTime() + 60 * 60 * 1000).toISOString();
  return { startsAt, endsAt, timezone };
}

function resolveMentionedDate(text: string, selectedDate: string): { value: string; explicit: boolean } {
  const normalized = text.toLowerCase();
  if (normalized.includes("tomorrow")) return { value: addDays(selectedDate, 1), explicit: true };
  if (normalized.includes("today")) return { value: selectedDate, explicit: true };
  const isoDate = normalized.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (isoDate?.[1] && normalizeMissionDateKey(isoDate[1])) {
    return { value: isoDate[1], explicit: true };
  }
  const monthDate = normalized.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/,
  );
  if (monthDate) {
    const month = monthIndex(monthDate[1]);
    const day = Number(monthDate[2]);
    if (month !== null && day >= 1 && day <= 31) {
      const year = Number(selectedDate.slice(0, 4));
      const candidate = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      return { value: normalizeMissionDateKey(candidate) || selectedDate, explicit: true };
    }
  }
  return { value: selectedDate, explicit: false };
}

function resolveMentionedTime(text: string): { hour: number; minute: number } | null {
  const timeMatch =
    text.match(/\b(?:at|from)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i) ||
    text.match(/\b(\d{1,2})(?::(\d{2}))\s*(am|pm)\b/i) ||
    text.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (!timeMatch) return null;
  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2] || 0);
  const meridiem = timeMatch[3]?.toLowerCase();
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23) return null;
  return { hour, minute };
}

function normalizeClockInput(value: unknown): { hour: number; minute: number } | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function cleanupReminderTitle(text: string): string {
  return text.replace(/^remind\s+me\s+(to|that|about)?\s*/i, "").trim() || text;
}

function requireDateKey(value: unknown): string {
  const date = normalizeMissionDateKey(value);
  if (!date) throw new MissionControlInputError("Date must be in YYYY-MM-DD format");
  return date;
}

function normalizeNullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizePriority(value: unknown, fallback = 3): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(5, Math.round(parsed)));
}

function normalizeTaskPosition(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1_000_000, Math.round(parsed)));
}

function normalizeListLimit(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(100, Math.round(parsed)));
}

function normalizeSortOrder(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(999, Math.round(parsed)));
}

function normalizeDashboardCardSize(value: unknown): DashboardCardSize | null {
  return value === "small" || value === "medium" || value === "wide" ? value : null;
}

function normalizeDashboardIcon(value: unknown): string | null {
  const text = normalizeNullableText(value);
  if (!text || !/^[A-Za-z][A-Za-z0-9-]{0,40}$/.test(text)) return null;
  return text;
}

function normalizeMainGoal(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 600);
}

function normalizeMissionGoals(value: unknown, legacyMainGoal: string) {
  const incoming = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const goals = incoming.slice(0, 20).flatMap((item, index) => {
    const input: Record<string, unknown> = isRecord(item)
      ? item
      : { title: item };
    const title = normalizeMainGoal(input.title);
    if (!title) return [];
    const candidateId = normalizeNullableText(input.id) || `goal-${index + 1}`;
    const baseId = candidateId
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || `goal-${index + 1}`;
    let id = baseId;
    let suffix = 2;
    while (seen.has(id)) {
      const suffixText = `-${suffix}`;
      id = `${baseId.slice(0, 80 - suffixText.length)}${suffixText}`;
      suffix += 1;
    }
    seen.add(id);
    return [
      {
        id,
        title,
        status: input.status === "completed" ? ("completed" as const) : ("active" as const),
      },
    ];
  });

  if (!Array.isArray(value) && goals.length === 0 && legacyMainGoal) {
    goals.push({
      id: "legacy-main-goal",
      title: legacyMainGoal,
      status: "active",
    });
  }
  return goals;
}

function normalizeContextMissionStatement(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === DEFAULT_MISSION_STATEMENT) return null;
  return trimmed.slice(0, 2000);
}

function sanitizeMissionWheelSegment(
  value: unknown,
  index: number,
): MissionWheelSegment {
  const input = isRecord(value) ? value : {};
  const fallback =
    DEFAULT_MISSION_WHEEL_SEGMENTS[index] || DEFAULT_MISSION_WHEEL_SEGMENTS[0];
  const id = normalizeNullableText(input.id) || fallback.id;
  const rawValue = Number(input.value);
  return {
    id,
    label: (normalizeNullableText(input.label) || fallback.label).slice(0, 36),
    helper: (normalizeNullableText(input.helper) || fallback.helper).slice(0, 180),
    color:
      typeof input.color === "string" && /^#[0-9a-fA-F]{6}$/.test(input.color)
        ? input.color
        : fallback.color,
    emoji: (normalizeNullableText(input.emoji) || fallback.emoji).slice(0, 40),
    value:
      Number.isInteger(rawValue) && rawValue >= 1 && rawValue <= 10
        ? rawValue
        : null,
  };
}

function sanitizeMissionWheelSegments(value: unknown): MissionWheelSegment[] {
  const incoming = Array.isArray(value) ? value : [];
  const segments = incoming
    .slice(0, MISSION_WHEEL_MAX_SEGMENTS)
    .map((segment, index) => sanitizeMissionWheelSegment(segment, index));
  const seen = new Set(segments.map((segment) => segment.id));
  for (const segment of DEFAULT_MISSION_WHEEL_SEGMENTS) {
    if (segments.length >= MISSION_WHEEL_MIN_SEGMENTS) break;
    if (seen.has(segment.id)) continue;
    segments.push({ ...segment });
  }
  return segments.length >= MISSION_WHEEL_MIN_SEGMENTS
    ? segments
    : DEFAULT_MISSION_WHEEL_SEGMENTS.map((segment) => ({ ...segment }));
}

function normalizeMissionWheelNotes(
  value: unknown,
  segments: MissionWheelSegment[],
): Record<string, string> {
  const input = isRecord(value) ? value : {};
  return Object.fromEntries(
    segments.map((segment) => [
      segment.id,
      typeof input[segment.id] === "string"
        ? String(input[segment.id]).trim().slice(0, 600)
        : "",
    ]),
  );
}

function normalizeIsoDateTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeDashboardSettings(value: Record<string, unknown>) {
  const legacyMainGoal = normalizeMainGoal(value.mainGoal);
  const goals = normalizeMissionGoals(value.goals, legacyMainGoal);
  return {
    kanbanEnabled: value.kanbanEnabled === true,
    mainGoal: goals.find((goal) => goal.status === "active")?.title || "",
    goals,
    setupChecklistDismissed:
      value.setupChecklistDismissed === undefined
        ? DEFAULT_SETUP_CHECKLIST_DISMISSED
        : value.setupChecklistDismissed === true,
  };
}

function activeTaskSortValue(row: MissionTaskRow): string {
  return row.due_at || row.scheduled_for || row.created_at;
}

function encodeMissionTaskCursor(row: MissionTaskRow, order: "active" | "archived"): string {
  const cursor: MissionTaskCursor =
    order === "archived"
      ? {
          order,
          archivedAt: row.archived_at || row.updated_at,
          updatedAt: row.updated_at,
          id: row.id,
        }
      : {
          order,
          pinnedRank: row.pinned_at ? 0 : 1,
          pinnedAt: row.pinned_at || "",
          position: row.position,
          priority: row.priority,
          sortValue: activeTaskSortValue(row),
          id: row.id,
        };
  const encoded = btoa(JSON.stringify(cursor));
  return encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeMissionTaskCursor(
  value: unknown,
  expectedOrder: "active" | "archived",
): MissionTaskCursor | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new MissionControlInputError("Task cursor is invalid");
  }

  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const parsed = JSON.parse(atob(padded)) as unknown;
    if (!isRecord(parsed) || parsed.order !== expectedOrder) {
      throw new Error("Cursor order mismatch");
    }
    if (
      parsed.order === "active" &&
      typeof parsed.priority === "number" &&
      typeof parsed.sortValue === "string" &&
      typeof parsed.id === "string"
    ) {
      return {
        order: "active",
        pinnedRank:
          typeof parsed.pinnedRank === "number" ? parsed.pinnedRank : 1,
        pinnedAt:
          typeof parsed.pinnedAt === "string" ? parsed.pinnedAt : "",
        position: typeof parsed.position === "number" ? parsed.position : 0,
        priority: parsed.priority,
        sortValue: parsed.sortValue,
        id: parsed.id,
      };
    }
    if (
      parsed.order === "archived" &&
      typeof parsed.archivedAt === "string" &&
      typeof parsed.updatedAt === "string" &&
      typeof parsed.id === "string"
    ) {
      return {
        order: "archived",
        archivedAt: parsed.archivedAt,
        updatedAt: parsed.updatedAt,
        id: parsed.id,
      };
    }
  } catch {
    throw new MissionControlInputError("Task cursor is invalid");
  }

  throw new MissionControlInputError("Task cursor is invalid");
}

function normalizeConfidence(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(0, Math.min(1, parsed));
}

function normalizeMemoryKind(value: unknown): MissionMemoryRow["memory_kind"] | null {
  if (
    value === "owner_note" ||
    value === "project_context" ||
    value === "preference" ||
    value === "relationship_note" ||
    value === "correction" ||
    value === "learning"
  ) {
    return value;
  }
  return null;
}

function normalizeScopeKind(value: unknown): MissionMemoryRow["scope_kind"] | null {
  if (value === "owner" || value === "project" || value === "contact" || value === "plugin") {
    return value;
  }
  return null;
}

function normalizeMemoryReviewStatus(value: unknown): MissionMemoryRow["review_status"] | null {
  if (value === "active" || value === "needs_review" || value === "archived") return value;
  return null;
}

function normalizeMemorySourceKind(value: unknown): MissionMemoryRow["source_kind"] | null {
  if (value === "manual" || value === "agent" || value === "import" || value === "daemon") {
    return value;
  }
  return null;
}

function normalizeSourceKind(value: unknown): MissionContextSourceRow["source_kind"] | null {
  if (
    value === "public_me_json" ||
    value === "mission_statement" ||
    value === "wheel_of_life" ||
    value === "private_memory" ||
    value === "core_table" ||
    value === "plugin_table" ||
    value === "daemon_directory" ||
    value === "daemon_repo" ||
    value === "provider" ||
    value === "upload" ||
    value === "url"
  ) {
    return value;
  }
  return null;
}

function normalizeSourceStatus(value: unknown): MissionContextSourceRow["status"] | null {
  if (
    value === "active" ||
    value === "setup_required" ||
    value === "paused" ||
    value === "failed" ||
    value === "archived"
  ) {
    return value;
  }
  return null;
}

function normalizeDbDateTime(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return `${value.replace(" ", "T")}Z`;
  }
  return value;
}

function parseJsonRecord(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseDailyBriefingMetadata(metadata: Record<string, unknown>) {
  const dailyBriefing = metadata.dailyBriefing;
  if (!isRecord(dailyBriefing)) return null;
  const message = typeof dailyBriefing.plainText === "string"
    ? dailyBriefing.plainText
    : typeof dailyBriefing.message === "string"
      ? dailyBriefing.message
      : null;
  const date = typeof dailyBriefing.date === "string" ? dailyBriefing.date : null;
  if (!message || !date) return null;
  const sections = Array.isArray(dailyBriefing.sections)
    ? dailyBriefing.sections.filter(isRecord).map((section) => ({
        kind: typeof section.kind === "string" ? section.kind : "summary",
        title: typeof section.title === "string" ? section.title : "",
        summary: typeof section.summary === "string" ? section.summary : "",
        items: Array.isArray(section.items)
          ? section.items.filter(isRecord).map((item, index) => ({
              id: typeof item.id === "string" ? item.id : `item-${index}`,
              title: typeof item.title === "string" ? item.title : "",
              detail: typeof item.detail === "string" ? item.detail : null,
            }))
          : [],
      }))
    : [];
  return {
    version: typeof dailyBriefing.version === "number" ? dailyBriefing.version : 1,
    plainText: message,
    date,
    sections,
  };
}

function parseWeeklyReviewResult(value: unknown) {
  if (!isRecord(value)) return null;
  const reviewDate = typeof value.reviewDate === "string" ? value.reviewDate : null;
  if (!reviewDate) return null;
  return {
    kind: "weekly_review",
    version: typeof value.version === "number" ? value.version : 1,
    reviewDate,
    weekStart: typeof value.weekStart === "string" ? value.weekStart : reviewDate,
    weekEnd: typeof value.weekEnd === "string" ? value.weekEnd : reviewDate,
    weekLabel: typeof value.weekLabel === "string" ? value.weekLabel : reviewDate,
    openTasks: normalizeWeeklyReviewArray(value.openTasks),
    completedTasks: normalizeWeeklyReviewArray(value.completedTasks),
    reminders: normalizeWeeklyReviewArray(value.reminders),
    journalSummary:
      typeof value.journalSummary === "string" && value.journalSummary.trim()
        ? value.journalSummary.trim()
        : "Weekly journal summary is not available.",
    memorySuggestions: normalizeWeeklyReviewArray(value.memorySuggestions),
  };
}

function normalizeWeeklyReviewArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function parseJsonArray(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day + days, 12, 0, 0));
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
}

function monthIndex(value: string): number | null {
  const normalized = value.toLowerCase().slice(0, 3);
  const index = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(normalized);
  return index >= 0 ? index : null;
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
