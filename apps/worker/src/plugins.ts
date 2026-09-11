import type { Env } from "./types";
import { AGENT_CHAT_RUNTIME } from "./agent-chat";
import { CALENDAR_RUNTIME } from "./calendar";
import { ACCOUNTS_PLUGIN_ID } from "./accounts";
import { JOURNAL_PLUGIN_ID, JOURNAL_RUNTIME } from "@me3-core/plugin-journal";
import {
  EMAIL_CAMPAIGNS_PLUGIN_ID,
  EMAIL_CAMPAIGNS_PLUGIN_VERSION,
  EMAIL_CAMPAIGNS_RUNTIME,
} from "@me3-core/plugin-email-campaigns";
import {
  LANDING_PAGES_PLUGIN_ID,
  LANDING_PAGES_PLUGIN_VERSION,
  LANDING_PAGES_RUNTIME,
} from "@me3-core/plugin-landing-pages";
import { LOCAL_EXECUTOR_PLUGIN_ID, LOCAL_EXECUTOR_RUNTIME } from "@me3-core/plugin-local-executor";
import { MISSION_CONTROL_RUNTIME } from "@me3-core/plugin-mission-control";
import { SOCIAL_PUBLISHING_RUNTIME } from "./social-publishing";
import {
  defineMe3AgentCapabilityContract,
  ME3_EMPTY_AGENT_CAPABILITY_SCHEMA,
  validateMe3AgentCapabilityContract,
  type Me3AgentCapabilityApprovalMode,
  type Me3AgentCapabilityCategory,
  type Me3AgentCapabilityContract,
  type Me3AgentCapabilitySideEffect,
} from "@me3/knowledge";

export const CORE_PLUGIN_CATALOG_VERSION = "2026-08-28.v1";
const PUBLIC_BASELINE_MIGRATION_PATH =
  "./apps/worker/migrations/0001_initial_public_schema.sql";

function publicBaselineMigration(id: string, description: string) {
  return {
    id,
    path: PUBLIC_BASELINE_MIGRATION_PATH,
    destructive: false,
    description,
  };
}

function agentTool(
  input: Omit<CorePluginAgentTool, "auditEventKind" | "examples"> &
    Partial<Pick<CorePluginAgentTool, "auditEventKind" | "examples">>,
): CorePluginAgentTool {
  return {
    ...input,
    auditEventKind:
      input.auditEventKind || `${input.id.replace(/[^a-z0-9]+/gi, "_")}_requested`,
    examples: input.examples || {
      positive: [`Use ${input.label.toLowerCase()}.`],
      negative: ["What can this plugin do?"],
    },
  };
}

export type CorePluginStatus =
  | "available"
  | "installed"
  | "setup_required"
  | "disabled"
  | "coming_soon";

export type CorePluginSetupRequirement = {
  id: string;
  label: string;
  kind: "package" | "secret" | "binding" | "migration" | "queue" | "cron";
  required: boolean;
  configured: boolean;
  note?: string;
};

export type CorePluginAgentTool = {
  id: string;
  label: string;
  sideEffect: Me3AgentCapabilitySideEffect;
  approvalMode: Me3AgentCapabilityApprovalMode;
  auditEventKind: string;
  examples: {
    positive: readonly string[];
    negative: readonly string[];
  };
};

export type CorePluginManifestSummary = {
  schemaVersion: string;
  id: string;
  name: string;
  version: string;
  description: string;
  trustTier: "first_party" | "third_party";
  distribution: "workspace_package" | "npm_package" | "remote_bundle";
  installMode: "enabled_by_owner_config";
  defaultEnabled?: boolean;
  showInPluginList?: boolean;
  releaseStage?: "available" | "coming_soon";
  activationAllowed?: boolean;
  implementationStatus: "catalog_only" | "bundled";
  capabilityIds: string[];
  permissions: { id: string; label: string }[];
  routes: { id: string; path: string; methods: string[]; auth: string }[];
  uiSlots: { id: string; slot: string; label: string }[];
  dashboardCards?: {
    id: string;
    label: string;
    componentKey: string;
    defaultEnabled: boolean;
    defaultSize: "small" | "medium" | "wide";
    dataEndpoint?: string;
    requiresPluginIds?: string[];
    requiresCapabilityIds?: string[];
  }[];
  dashboardQuickActions?: {
    id: string;
    label: string;
    icon: string;
    defaultEnabled: boolean;
    destinationId: string;
    requiresPluginIds?: string[];
  }[];
  agentTools: CorePluginAgentTool[];
  secrets: { name: string; label: string; required: boolean }[];
  migrations: { id: string; path: string; destructive: boolean; description?: string }[];
  queuesAndCrons: {
    id: string;
    kind: "queue" | "cron";
    binding?: string;
    queueName?: string;
    schedule?: string;
    producerEntrypoint?: string;
    consumerEntrypoint?: string;
    maxRetries?: number;
  }[];
  notes: string[];
};

export type DbPluginInstallation = {
  plugin_id: string;
  version: string;
  enabled: number;
  status: "installed" | "setup_required" | "disabled";
  granted_permissions_json: string;
  setup_state_json: string;
  installed_at: string;
  updated_at: string;
};

export type CorePluginRecord = CorePluginManifestSummary & {
  showInPluginList: boolean;
  status: CorePluginStatus;
  statusLabel: string;
  installed: boolean;
  enabled: boolean;
  grantedPermissions: string[];
  setupRequirements: CorePluginSetupRequirement[];
  installedAt: string | null;
  updatedAt: string | null;
};

export class PluginInstallInputError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404,
  ) {
    super(message);
  }
}

const SOCIAL_PUBLISHING_PLUGIN: CorePluginManifestSummary = {
  schemaVersion: CORE_PLUGIN_CATALOG_VERSION,
  id: "me3.social-publishing",
  name: "Social publishing",
  version: "0.1.0",
  description:
    "Turn human-authored Sources into reusable Posts, exact account Versions, and independently audited Publications.",
  trustTier: "first_party",
  distribution: "workspace_package",
  installMode: "enabled_by_owner_config",
  showInPluginList: true,
  implementationStatus: SOCIAL_PUBLISHING_RUNTIME.bundled ? "bundled" : "catalog_only",
  capabilityIds: ["content.social_publishing"],
  permissions: [
    {
      id: "content.social.publish",
      label: "Publish approved social content",
    },
    {
      id: "content.social.accounts.manage",
      label: "Connect social provider accounts",
    },
  ],
  routes: [
    {
      id: "social.status.api",
      path: "/api/social/status",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "social.accounts.read.api",
      path: "/api/social/accounts",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "social.posts.api",
      path: "/api/social/posts",
      methods: ["GET", "POST"],
      auth: "owner",
    },
    {
      id: "social.library.api",
      path: "/api/social/library",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "social.suggestions.api",
      path: "/api/social/suggestions",
      methods: ["GET", "POST"],
      auth: "owner",
    },
    {
      id: "social.suggestion.api",
      path: "/api/social/suggestions/:id",
      methods: ["PATCH", "DELETE"],
      auth: "owner",
    },
    {
      id: "social.suggestion.post.api",
      path: "/api/social/suggestions/:id/post",
      methods: ["POST"],
      auth: "owner",
    },
    {
      id: "social.post.api",
      path: "/api/social/posts/:id",
      methods: ["GET", "PATCH"],
      auth: "owner",
    },
    {
      id: "social.carousel.media.api",
      path: "/api/social/carousels/media",
      methods: ["GET", "POST"],
      auth: "owner",
    },
    {
      id: "social.carousel.media-item.api",
      path: "/api/social/carousels/media/:mediaId",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "social.carousel.content-addressed-media.api",
      path: "/api/social/media/sha256/:fileName",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "social.carousel.render.api",
      path: "/api/social/carousels/render",
      methods: ["POST"],
      auth: "owner",
    },
    {
      id: "social.carousel.render-set.api",
      path: "/api/social/carousels/render-sets/:renderSetId",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "social.carousel.asset.api",
      path: "/api/social/carousels/assets/:assetId",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "social.account.preferred-posting-times.api",
      path: "/api/social/accounts/:id/preferred-posting-times",
      methods: ["GET", "PUT"],
      auth: "owner",
    },
    {
      id: "social.posting-plans.api",
      path: "/api/social/posting-plans",
      methods: ["POST"],
      auth: "owner",
    },
    {
      id: "social.posting-plan.api",
      path: "/api/social/posting-plans/:id",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "social.posting-plan.confirm.api",
      path: "/api/social/posting-plans/:id/confirm",
      methods: ["POST"],
      auth: "owner",
    },
    {
      id: "social.version.api",
      path: "/api/social/versions/:id",
      methods: ["PATCH"],
      auth: "owner",
    },
    {
      id: "social.scheduling.approved-versions.api",
      path: "/api/social/scheduling/approved-versions",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "social.version.publications.api",
      path: "/api/social/versions/:id/publications",
      methods: ["GET", "POST"],
      auth: "owner",
    },
    {
      id: "social.version.publish.api",
      path: "/api/social/versions/:id/publish",
      methods: ["POST"],
      auth: "owner",
    },
    {
      id: "social.publication.api",
      path: "/api/social/publications/:id",
      methods: ["PATCH", "DELETE"],
      auth: "owner",
    },
    {
      id: "social.publication.resolve.api",
      path: "/api/social/publications/:id/resolve",
      methods: ["POST"],
      auth: "owner",
    },
    {
      id: "social.oauth.start.api",
      path: "/api/social/:platform/authorize",
      methods: ["POST"],
      auth: "owner",
    },
    {
      id: "social.oauth.callback.api",
      path: "/api/social/:platform/callback",
      methods: ["GET"],
      auth: "public",
    },
  ],
  uiSlots: [
    {
      id: "social.dashboard.nav",
      slot: "dashboard.nav",
      label: "Social Publishing",
    },
    {
      id: "social.accounts.panel",
      slot: "dashboard.panel",
      label: "Social accounts",
    },
    {
      id: "social.article-share",
      slot: "site.editor",
      label: "Share article",
    },
  ],
  dashboardCards: [
    {
      id: "social.queue-summary",
      label: "Social Queue",
      componentKey: "SocialQueueSummaryCard",
      defaultEnabled: false,
      defaultSize: "medium",
      requiresPluginIds: ["me3.social-publishing"],
    },
  ],
  dashboardQuickActions: [
    {
      id: "social.schedule",
      label: "Schedule a post",
      icon: "Send",
      defaultEnabled: false,
      destinationId: "social.schedule",
      requiresPluginIds: ["me3.social-publishing"],
    },
  ],
  agentTools: [
    agentTool({
      id: "social.post.suggest",
      label: "Create grounded Suggestions from a Source",
      sideEffect: "write_internal_draft",
      approvalMode: "none",
    }),
    agentTool({
      id: "social.library.search",
      label: "Search the Social Post library",
      sideEffect: "read_private",
      approvalMode: "none",
    }),
    agentTool({
      id: "social.posting-plan.create",
      label: "Propose a reviewable Posting plan",
      sideEffect: "write_internal_draft",
      approvalMode: "none",
    }),
    agentTool({
      id: "social.posting-plan.confirm",
      label: "Confirm a reviewed Posting plan",
      sideEffect: "write_internal_active",
      approvalMode: "approval_required",
    }),
    agentTool({
      id: "social.version.publish",
      label: "Publish an approved Version",
      sideEffect: "external_write",
      approvalMode: "approval_required",
    }),
  ],
  secrets: [],
  migrations: [
    publicBaselineMigration(
      "social.public-baseline",
      "Social accounts, OAuth state, Source-backed Posts, account Versions, Publications, and audit history are included in the initial public schema.",
    ),
    {
      id: "social.source-first-packages",
      path: "./apps/worker/migrations/0016_social_content_packages.sql",
      destructive: false,
      description:
        "Adds stable Source references and snapshots, account targets, and explicit Version approval metadata.",
    },
    {
      id: "social.canonical-posts",
      path: "./apps/worker/migrations/0022_social_posts_canonical.sql",
      destructive: false,
      description:
        "Adds visible Source text and safely bridges legacy owner data into canonical Posts and Versions.",
    },
    {
      id: "social.reusable-publications",
      path: "./apps/worker/migrations/0023_social_publications_reusable.sql",
      destructive: false,
      description:
        "Moves schedules and immutable delivery snapshots into independently audited Publications while preserving existing history.",
    },
    {
      id: "social.grounded-suggestions",
      path: "./apps/worker/migrations/0024_social_suggestions.sql",
      destructive: false,
      description:
        "Stores editable, discardable, Source-grounded Suggestions and their chosen Post links.",
    },
    {
      id: "social.posting-plans",
      path: "./apps/worker/migrations/0025_social_posting_plans.sql",
      destructive: false,
      description:
        "Adds owner tags, Preferred posting times, reviewable Posting plans, confirmation snapshots, and account-time reservations.",
    },
    {
      id: "social.deterministic-carousels",
      path: "./apps/worker/migrations/0026_social_carousels.sql",
      destructive: false,
      description:
        "Stores owner-scoped raster media, immutable deterministic Carousel render sets, and exact Version attachments.",
    },
  ],
  queuesAndCrons: [...SOCIAL_PUBLISHING_RUNTIME.queuesAndCrons],
  notes: [
    "Bundled through @me3-core/plugin-social-publishing as a first-party Core package.",
    "The canonical owner path is Source-backed Posts, exact account Versions, and independently audited immutable Publications.",
    "Grounded Suggestions retain visible Source text and only become Posts when the owner chooses them.",
    "LinkedIn supports draft, schedule, and publish; X and Instagram remain draft-only until their delivery paths work end to end.",
    "ME3-hosted provider OAuth should supply social app credentials; Core installs should only connect their own social accounts.",
    "External publishing workers and cron dispatch remain gated by plugin readiness, exact Version approval, and account state.",
  ],
};

const MISSION_CONTROL_PLUGIN: CorePluginManifestSummary = {
  schemaVersion: CORE_PLUGIN_CATALOG_VERSION,
  id: "me3.mission-control",
  name: "ME3 Tasks and Projects",
  version: "0.1.0",
  description:
    "Focused owner workspace for organising projects and tasks across Now, Backlog, Review, and Completed.",
  trustTier: "first_party",
  distribution: "workspace_package",
  installMode: "enabled_by_owner_config",
  defaultEnabled: true,
  showInPluginList: false,
  implementationStatus: MISSION_CONTROL_RUNTIME.bundled ? "bundled" : "catalog_only",
  capabilityIds: [
    "workspace.mission_control",
    "workspace.tasks",
    "workspace.approvals",
    "workspace.private_memory",
    "workspace.context_sources",
    "workspace.agent_runs",
    "workspace.local_daemon_bridge",
  ],
  permissions: [
    {
      id: "mission.tasks.manage",
      label: "Create and manage tasks and projects",
    },
    {
      id: "mission.approvals.manage",
      label: "Review and resolve assistant approvals",
    },
    {
      id: "mission.memory.manage",
      label: "Store and manage private owner memory",
    },
    {
      id: "mission.context_sources.manage",
      label: "Manage private context source inventory",
    },
    {
      id: "mission.agent_runs.read",
      label: "Read agent run history and plugin activity",
    },
    {
      id: "mission.daemon.pair",
      label: "Pair optional local daemon bridges",
    },
  ],
  routes: [
    {
      id: "mission.projects.api",
      path: "/api/mission-control/projects",
      methods: ["GET", "POST"],
      auth: "owner",
    },
    {
      id: "mission.dashboard.api",
      path: "/api/mission-control/dashboard",
      methods: ["GET", "PATCH"],
      auth: "owner",
    },
    {
      id: "mission.dashboard.ai_usage.api",
      path: "/api/mission-control/dashboard/cards/mission.ai-usage",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "mission.wheel.api",
      path: "/api/mission-control/wheel",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "mission.wheel.settings.api",
      path: "/api/mission-control/wheel/settings",
      methods: ["PATCH"],
      auth: "owner",
    },
    {
      id: "mission.wheel.snapshots.api",
      path: "/api/mission-control/wheel/snapshots",
      methods: ["GET", "POST"],
      auth: "owner",
    },
    {
      id: "mission.tasks.api",
      path: "/api/mission-control/tasks",
      methods: ["GET", "POST"],
      auth: "owner",
    },
    {
      id: "mission.task.api",
      path: "/api/mission-control/tasks/:id",
      methods: ["PATCH", "DELETE"],
      auth: "owner",
    },
    {
      id: "mission.approvals.api",
      path: "/api/mission-control/approvals",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "mission.approval.api",
      path: "/api/mission-control/approvals/:id",
      methods: ["POST"],
      auth: "owner",
    },
    {
      id: "mission.runs.api",
      path: "/api/mission-control/agent-runs",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "mission.memory.api",
      path: "/api/mission-control/memory",
      methods: ["GET", "POST"],
      auth: "owner",
    },
    {
      id: "mission.memory.item.api",
      path: "/api/mission-control/memory/:id",
      methods: ["PATCH", "DELETE"],
      auth: "owner",
    },
    {
      id: "mission.context-sources.api",
      path: "/api/mission-control/context-sources",
      methods: ["GET", "POST"],
      auth: "owner",
    },
    {
      id: "mission.context-source.api",
      path: "/api/mission-control/context-sources/:id",
      methods: ["PATCH", "DELETE"],
      auth: "owner",
    },
    {
      id: "mission.plugin-activity.api",
      path: "/api/mission-control/plugin-activity",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "mission.setup.api",
      path: "/api/mission-control/setup",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "mission.daemon.api",
      path: "/api/mission-control/daemon/*",
      methods: ["GET", "POST", "PATCH"],
      auth: "owner",
    },
  ],
  uiSlots: [
    {
      id: "mission.dashboard.nav",
      slot: "dashboard.nav",
      label: "Tasks",
    },
    {
      id: "mission.workspace.page",
      slot: "dashboard.page",
      label: "Tasks and Projects",
    },
    {
      id: "mission.setup.panel",
      slot: "account.plugins.setup",
      label: "Task and project setup",
    },
    {
      id: "mission.approvals.panel",
      slot: "app.shell.alerts",
      label: "Pending approvals",
    },
  ],
  dashboardCards: [
    {
      id: "mission.daily-briefing",
      label: "Daily Briefing",
      componentKey: "DailyBriefingCard",
      defaultEnabled: true,
      defaultSize: "medium",
      dataEndpoint: "/api/mission-control/dashboard/cards/mission.daily-briefing",
    },
    {
      id: "mission.mission-statement",
      label: "Mission",
      componentKey: "MissionStatementCard",
      defaultEnabled: true,
      defaultSize: "medium",
    },
    {
      id: "mission.goals",
      label: "Goals",
      componentKey: "GoalsCard",
      defaultEnabled: true,
      defaultSize: "medium",
    },
    {
      id: "mission.wheel-latest-snapshot",
      label: "Wheel of Life Snapshot",
      componentKey: "WheelSnapshotCard",
      defaultEnabled: true,
      defaultSize: "medium",
      dataEndpoint: "/api/mission-control/dashboard/cards/mission.wheel-latest-snapshot",
    },
    {
      id: "mission.me3-profile",
      label: "ME3 Profile",
      componentKey: "Me3ProfileCard",
      defaultEnabled: true,
      defaultSize: "medium",
    },
    {
      id: "mission.quick-task-add",
      label: "Quick Task Add",
      componentKey: "QuickProjectTaskCard",
      defaultEnabled: false,
      defaultSize: "medium",
    },
    {
      id: "mission.projects-summary",
      label: "Projects Summary",
      componentKey: "ProjectsSummaryCard",
      defaultEnabled: false,
      defaultSize: "medium",
    },
    {
      id: "mission.ai-usage",
      label: "AI Usage",
      componentKey: "AiUsageCard",
      defaultEnabled: false,
      defaultSize: "medium",
      dataEndpoint: "/api/mission-control/dashboard/cards/mission.ai-usage",
    },
  ],
  dashboardQuickActions: [
    {
      id: "mission.projects",
      label: "View Tasks",
      icon: "ListChecks",
      defaultEnabled: false,
      destinationId: "mission.projects",
    },
  ],
  agentTools: [
    agentTool({
      id: "mission.task.create",
      label: "Create task",
      sideEffect: "internal_write",
      approvalMode: "approval_required",
    }),
    agentTool({
      id: "mission.memory.write",
      label: "Write private memory",
      sideEffect: "internal_write",
      approvalMode: "approval_required",
    }),
    agentTool({
      id: "mission.approval.request",
      label: "Request owner approval",
      sideEffect: "internal_write",
      approvalMode: "none",
    }),
    agentTool({
      id: "mission.daemon.read",
      label: "Read approved local context through paired daemon",
      sideEffect: "local_read",
      approvalMode: "approval_required",
    }),
    agentTool({
      id: "mission.daemon.write",
      label: "Write approved local files through paired daemon",
      sideEffect: "local_write",
      approvalMode: "approval_required",
    }),
    agentTool({
      id: "mission.daemon.shell",
      label: "Run approved local shell command through paired daemon",
      sideEffect: "local_shell",
      approvalMode: "approval_required",
    }),
  ],
  secrets: [],
  migrations: [
    publicBaselineMigration(
      "mission.public-baseline",
      "Mission projects, tasks, approvals, agent runs, plugin activity, private memory, context sources, daemon pairing, and dashboard tables are included in the initial public schema.",
    ),
  ],
  queuesAndCrons: [],
  notes: [
    "Tasks and Projects is bundled as a first-party package and enabled by default.",
    "Public me.json remains Core-owned and separate from plugin private memory.",
    "Local daemon access is optional, owner-paired, path-scoped, and approval-gated.",
  ],
};

const CALENDAR_PLUGIN: CorePluginManifestSummary = {
  schemaVersion: CORE_PLUGIN_CATALOG_VERSION,
  id: "me3.calendar",
  name: "ME3 Calendar",
  version: "0.1.0",
  description:
    "First-party calendar workspace for bookings, reminders, personal events, birthdays, imported calendars, and recurring event expansion.",
  trustTier: "first_party",
  distribution: "workspace_package",
  installMode: "enabled_by_owner_config",
  defaultEnabled: true,
  showInPluginList: false,
  implementationStatus: CALENDAR_RUNTIME.bundled ? "bundled" : "catalog_only",
  capabilityIds: [
    "workspace.calendar",
    "calendar.events.read",
    "calendar.events.manage",
  ],
  permissions: [
    {
      id: "calendar.events.read",
      label: "Read personal and imported calendar events",
    },
    {
      id: "calendar.events.manage",
      label: "Create and manage personal calendar events",
    },
    {
      id: "calendar.reminders.manage",
      label: "Create and manage owner reminders",
    },
  ],
  routes: [
    {
      id: "calendar.feed.api",
      path: "/api/calendar/feed",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "calendar.events.api",
      path: "/api/calendar/events",
      methods: ["POST"],
      auth: "owner",
    },
    {
      id: "calendar.event.api",
      path: "/api/calendar/events/:id",
      methods: ["PUT", "DELETE"],
      auth: "owner",
    },
    {
      id: "calendar.reminders.api",
      path: "/api/agent/reminders",
      methods: ["POST"],
      auth: "owner",
    },
    {
      id: "calendar.reminder.api",
      path: "/api/agent/reminders/:id",
      methods: ["PUT"],
      auth: "owner",
    },
    {
      id: "calendar.reminder.cancel.api",
      path: "/api/agent/reminders/:id/cancel",
      methods: ["PUT"],
      auth: "owner",
    },
  ],
  uiSlots: [
    {
      id: "calendar.dashboard.nav",
      slot: "dashboard.nav",
      label: "Calendar",
    },
    {
      id: "calendar.workspace.panel",
      slot: "dashboard.panel",
      label: "Calendar",
    },
  ],
  dashboardCards: [
    {
      id: "calendar.today",
      label: "Calendar Today",
      componentKey: "CalendarTodayCard",
      defaultEnabled: false,
      defaultSize: "medium",
      requiresPluginIds: ["me3.calendar"],
    },
  ],
  agentTools: [
    agentTool({
      id: "calendar.events.read",
      label: "Read calendar events",
      sideEffect: "read_private",
      approvalMode: "none",
      auditEventKind: "calendar_events_read",
      examples: {
        positive: [
          "What is on my calendar today?",
          "Show my calendar events for next week.",
        ],
        negative: ["Remind me tomorrow to call Sam."],
      },
    }),
    agentTool({
      id: "calendar.event.create",
      label: "Create calendar event",
      sideEffect: "internal_write",
      approvalMode: "approval_required",
    }),
    agentTool({
      id: "calendar.reminder.create",
      label: "Create reminder",
      sideEffect: "internal_write",
      approvalMode: "approval_required",
    }),
  ],
  secrets: [],
  migrations: [
    publicBaselineMigration(
      "calendar.public-baseline",
      "Calendar events, sources, reminders, bookings, and recurrence-capable event fields are included in the initial public schema.",
    ),
  ],
  queuesAndCrons: [],
  notes: [
    "Bundled through @me3-core/plugin-calendar as a first-party Core package.",
    "Calendar is currently a default workspace surface while plugin install state becomes the long-term owner configuration surface.",
    "Recurring event normalization and feed expansion live in the plugin package so hosted ME3 can mirror the same behavior.",
    "Assistant reads and private event creation use explicit owner-scoped Core chat capabilities.",
  ],
};

const ACCOUNTS_PLUGIN: CorePluginManifestSummary = {
  schemaVersion: CORE_PLUGIN_CATALOG_VERSION,
  id: ACCOUNTS_PLUGIN_ID,
  name: "Accounts",
  version: "0.1.0",
  description: "Manage your accounts and customers in one place.",
  trustTier: "first_party",
  distribution: "workspace_package",
  installMode: "enabled_by_owner_config",
  defaultEnabled: false,
  implementationStatus: "bundled",
  capabilityIds: ["workspace.accounts", "finance.ledger", "finance.invoice_receipt_triage_context"],
  permissions: [
    {
      id: "accounts.entries.manage",
      label: "Create and manage account ledger entries",
    },
    {
      id: "accounts.csv.import_export",
      label: "Import and export account CSV files",
    },
    {
      id: "accounts.stripe.sync",
      label: "Sync Stripe charges using the owner-stored Stripe key",
    },
  ],
  routes: [
    {
      id: "accounts.customers.api",
      path: "/api/accounts/customers",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "accounts.entries.api",
      path: "/api/accounts/entries",
      methods: ["GET", "POST"],
      auth: "owner",
    },
    {
      id: "accounts.entry.api",
      path: "/api/accounts/entries/:id",
      methods: ["PUT", "DELETE"],
      auth: "owner",
    },
    {
      id: "accounts.categories.api",
      path: "/api/accounts/categories",
      methods: ["GET", "POST"],
      auth: "owner",
    },
    {
      id: "accounts.category.api",
      path: "/api/accounts/categories/:id",
      methods: ["DELETE"],
      auth: "owner",
    },
    {
      id: "accounts.csv.api",
      path: "/api/accounts/import",
      methods: ["POST"],
      auth: "owner",
    },
    {
      id: "accounts.export.api",
      path: "/api/accounts/export",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "accounts.stripe.api",
      path: "/api/accounts/stripe/*",
      methods: ["GET", "POST"],
      auth: "owner",
    },
  ],
  uiSlots: [
    {
      id: "accounts.ledger.page",
      slot: "app.page",
      label: "Accounts",
    },
    {
      id: "accounts.setup.panel",
      slot: "account.plugins.setup",
      label: "Accounts setup",
    },
  ],
  dashboardCards: [
    {
      id: "accounts.summary",
      label: "Accounts Summary",
      componentKey: "AccountsSummaryCard",
      defaultEnabled: false,
      defaultSize: "medium",
      requiresPluginIds: [ACCOUNTS_PLUGIN_ID],
    },
  ],
  dashboardQuickActions: [
    {
      id: "accounts.ledger",
      label: "Open Accounts",
      icon: "WalletCards",
      defaultEnabled: false,
      destinationId: "accounts.ledger",
      requiresPluginIds: [ACCOUNTS_PLUGIN_ID],
    },
  ],
  agentTools: [
    agentTool({
      id: "accounts.entry.create",
      label: "Create account entry",
      sideEffect: "money_or_account",
      approvalMode: "approval_required",
    }),
    agentTool({
      id: "accounts.entry.review",
      label: "Mark account entry for review",
      sideEffect: "internal_write",
      approvalMode: "approval_required",
    }),
  ],
  secrets: [],
  migrations: [
    publicBaselineMigration(
      "accounts.public-baseline",
      "Financial categories and ledger entries are included in the initial public schema.",
    ),
    {
      id: "accounts.financial-entry-projects",
      path: "./apps/worker/migrations/0011_financial_entry_projects.sql",
      destructive: false,
      description: "Adds optional project links to financial entries.",
    },
  ],
  queuesAndCrons: [],
  notes: [
    "Accounts is optional because not every Core owner wants finance records in their install.",
    "The plugin stores only owner-scoped ledger and category rows; Stripe secrets stay in Account commerce settings.",
    "Invoice and receipt triage jobs should write low-confidence items as needs_review entries.",
  ],
};

const AGENT_CHAT_PLUGIN: CorePluginManifestSummary = {
  schemaVersion: CORE_PLUGIN_CATALOG_VERSION,
  id: "me3.agent-chat",
  name: "ME3 Agent Chat",
  version: "0.1.0",
  description:
    "Chat with your ME3 assistant in the full AI chat workspace.",
  trustTier: "first_party",
  distribution: "workspace_package",
  installMode: "enabled_by_owner_config",
  defaultEnabled: true,
  showInPluginList: false,
  implementationStatus: AGENT_CHAT_RUNTIME.bundled ? "bundled" : "catalog_only",
  capabilityIds: ["chat.core_reply"],
  permissions: [
    {
      id: "agent.chat.reply",
      label: "Respond to owner chat messages",
    },
  ],
  routes: [
    {
      id: "assistant.chat.turn.api",
      path: "/api/assistant/chat/turn",
      methods: ["POST"],
      auth: "owner",
    },
    {
      id: "assistant.voice.transcribe.api",
      path: "/api/assistant/voice/transcribe",
      methods: ["POST"],
      auth: "owner",
    },
    {
      id: "agent.sandbox.api",
      path: "/api/agent/sandbox",
      methods: ["POST"],
      auth: "owner",
    },
  ],
  uiSlots: [
    {
      id: "agent.chat.launcher",
      slot: "app.shell",
      label: "Agent chat launcher",
    },
  ],
  dashboardQuickActions: [
    {
      id: "assistant.chat",
      label: "Chat with ME3",
      icon: "MessageCircle",
      defaultEnabled: false,
      destinationId: "assistant.chat",
    },
  ],
  agentTools: [
    agentTool({
      id: "chat.core_reply",
      label: "Core chat reply",
      sideEffect: "none",
      approvalMode: "none",
    }),
  ],
  secrets: [
    {
      name: "OPENAI_API_KEY",
      label: "OpenAI API key",
      required: false,
    },
    {
      name: "ANTHROPIC_API_KEY",
      label: "Anthropic API key",
      required: false,
    },
  ],
  migrations: [
    publicBaselineMigration(
      "agent-chat.public-baseline",
      "Owner profile, assistant messages, threads, attachments, AI provider settings, mailbox, contacts, and agent channel tables are included in the initial public schema.",
    ),
  ],
  queuesAndCrons: [],
  notes: [
    "Bundled through @me3-core/plugin-agent-chat as a first-party Core package.",
    "Enabled by default because chat is part of the baseline ME3 experience, while plugin packaging keeps future tools portable.",
    "Current runtime supports general chat through configured Core AI routes; richer tool actions should be added behind this package boundary.",
  ],
};

const EMAIL_CAMPAIGNS_PLUGIN: CorePluginManifestSummary = {
  schemaVersion: CORE_PLUGIN_CATALOG_VERSION,
  id: EMAIL_CAMPAIGNS_PLUGIN_ID,
  name: "Email Campaigns",
  version: EMAIL_CAMPAIGNS_PLUGIN_VERSION,
  description:
    "Create, schedule, and review permission-based email campaigns for Site newsletter lists.",
  trustTier: "first_party",
  distribution: "workspace_package",
  installMode: "enabled_by_owner_config",
  showInPluginList: true,
  defaultEnabled: false,
  releaseStage: "available",
  activationAllowed: true,
  implementationStatus: EMAIL_CAMPAIGNS_RUNTIME.bundled ? "bundled" : "catalog_only",
  capabilityIds: ["email.campaigns"],
  permissions: [
    {
      id: "email.campaigns.manage",
      label: "Manage campaign drafts, audiences, and schedules",
    },
    {
      id: "email.campaigns.send",
      label: "Send approved campaigns through a configured provider",
    },
  ],
  routes: [
    {
      id: "email.campaigns.ui",
      path: "/email/campaigns",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "email.campaigns.api",
      path: "/api/email/campaigns/*",
      methods: ["GET", "POST", "PUT"],
      auth: "owner",
    },
  ],
  uiSlots: [
    {
      id: "email.campaigns.workspace",
      slot: "email.nav",
      label: "Campaigns",
    },
  ],
  agentTools: [],
  secrets: [],
  migrations: [
    {
      id: "email-campaigns.foundations-v1",
      path: "./apps/worker/migrations/0041_email_campaign_foundations.sql",
      destructive: false,
      description: "Campaign drafts, immutable revisions, consent, and audience snapshots.",
    },
    {
      id: "email-campaigns.assets-v1",
      path: "./apps/worker/migrations/0042_email_campaign_assets.sql",
      destructive: false,
      description: "Portable campaign image metadata and content-addressed storage.",
    },
    {
      id: "email-campaigns.delivery-v1",
      path: "./apps/worker/migrations/0043_email_campaign_delivery.sql",
      destructive: false,
      description: "Durable recipient jobs, delivery events, and transport state.",
    },
  ],
  queuesAndCrons: [],
  notes: [...EMAIL_CAMPAIGNS_RUNTIME.notes],
};

const LANDING_PAGES_PLUGIN: CorePluginManifestSummary = {
  schemaVersion: CORE_PLUGIN_CATALOG_VERSION,
  id: LANDING_PAGES_PLUGIN_ID,
  name: "ME3 Landing Pages",
  version: LANDING_PAGES_PLUGIN_VERSION,
  description: "Create custom landing pages for offerings, events, and more.",
  trustTier: "first_party",
  distribution: "workspace_package",
  installMode: "enabled_by_owner_config",
  showInPluginList: false,
  defaultEnabled: false,
  releaseStage: "available",
  activationAllowed: true,
  implementationStatus: LANDING_PAGES_RUNTIME.bundled ? "bundled" : "catalog_only",
  capabilityIds: ["sites.landing_pages", "agent.landing_page_generation"],
  permissions: [
    {
      id: "sites.landing_pages.manage",
      label: "Create and manage landing-page drafts",
    },
    {
      id: "agent.landing_pages.generate",
      label: "Generate landing-page copy and structure",
    },
  ],
  routes: [
    {
      id: "sites.landing-page.read.api",
      path: "/api/sites/:username/landing-page",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "sites.landing-page.save.api",
      path: "/api/sites/:username/landing-page",
      methods: ["PUT"],
      auth: "owner",
    },
    {
      id: "sites.pages.api",
      path: "/api/sites/:username/pages/*",
      methods: ["GET", "POST", "PUT", "DELETE"],
      auth: "owner",
    },
    {
      id: "agent.landing-page.generate.api",
      path: "/api/agent/landing-pages/generate",
      methods: ["POST"],
      auth: "owner",
    },
  ],
  uiSlots: [
    {
      id: "sites.landing-pages.tab",
      slot: "sites.nav",
      label: "Landing pages",
    },
    {
      id: "sites.landing-pages.builder",
      slot: "sites.builder",
      label: "Landing page builder",
    },
  ],
  dashboardCards: [
    {
      id: "sites.blog-summary",
      label: "Blog",
      componentKey: "SitesBlogSummaryCard",
      defaultEnabled: false,
      defaultSize: "medium",
      requiresPluginIds: ["me3.landing-pages"],
    },
  ],
  dashboardQuickActions: [
    {
      id: "sites.blog",
      label: "Write a blog",
      icon: "FileText",
      defaultEnabled: false,
      destinationId: "sites.blog",
      requiresPluginIds: ["me3.landing-pages"],
    },
  ],
  agentTools: [
    agentTool({
      id: "landing_pages.generate_draft",
      label: "Generate landing page draft",
      sideEffect: "internal_write",
      approvalMode: "approval_required",
    }),
  ],
  secrets: [],
  migrations: [
    {
      id: "landing-pages.site-pages-v3",
      path: "./apps/worker/migrations/0017_site_pages_and_commerce.sql",
      destructive: false,
      description:
        "Versioned site pages, conversion attribution, and owner-scoped commerce orders.",
    },
  ],
  queuesAndCrons: [],
  notes: [
    "Bundled through @me3-core/plugin-landing-pages as a first-party optional Core package.",
    "The package owns page document v3, v1/v2 upgrades, recipes, validation, action widgets, and HTML rendering.",
    "Worker routes retain owner auth, page revisions, resource validation, file persistence, and publish behavior.",
    "ME3 Cloud may provide managed AI, domains, quotas, and a Stripe Connect bridge without storing owner page content.",
  ],
};

const LOCAL_EXECUTOR_PLUGIN: CorePluginManifestSummary = {
  schemaVersion: CORE_PLUGIN_CATALOG_VERSION,
  id: LOCAL_EXECUTOR_PLUGIN_ID,
  name: "Local Executor",
  version: "0.1.0",
  description:
    "Connect ME3 to your local computer to run tasks there. Setup required.",
  trustTier: "first_party",
  distribution: "workspace_package",
  installMode: "enabled_by_owner_config",
  showInPluginList: false,
  defaultEnabled: false,
  implementationStatus: LOCAL_EXECUTOR_RUNTIME.bundled ? "bundled" : "catalog_only",
  capabilityIds: ["local_executor.run"],
  permissions: [
    {
      id: "local_executor.pair",
      label: "Pair local runners",
    },
    {
      id: "local_executor.policies.manage",
      label: "Manage local project policies",
    },
    {
      id: "local_executor.runs.manage",
      label: "Queue and review local runner jobs",
    },
  ],
  routes: [
    {
      id: "local-executor.status.api",
      path: "/api/local-executor/status",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "local-executor.pairing.api",
      path: "/api/local-executor/pairing/start",
      methods: ["POST"],
      auth: "owner",
    },
    {
      id: "local-executor.policies.api",
      path: "/api/local-executor/policies",
      methods: ["GET", "POST"],
      auth: "owner",
    },
    {
      id: "local-executor.policy.api",
      path: "/api/local-executor/policies/:id",
      methods: ["PATCH", "DELETE"],
      auth: "owner",
    },
    {
      id: "local-executor.runs.api",
      path: "/api/local-executor/runs",
      methods: ["POST"],
      auth: "owner",
    },
    {
      id: "local-executor.run.api",
      path: "/api/local-executor/runs/:id",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "local-executor.audit.api",
      path: "/api/local-executor/audit",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "local-executor.daemon.api",
      path: "/api/local-executor/daemon/*",
      methods: ["POST"],
      auth: "daemon_token",
    },
  ],
  uiSlots: [
    {
      id: "local-executor.account.setup",
      slot: "account.plugins.setup",
      label: "Local Executor setup",
    },
  ],
  agentTools: [
    agentTool({
      id: "local_executor.run",
      label: "Queue a bounded local runner job",
      sideEffect: "local_shell",
      approvalMode: "approval_required",
    }),
  ],
  secrets: [],
  migrations: [
    publicBaselineMigration(
      "local-executor.public-baseline",
      "Local runner pairings, project policies, runs, run events, and audit events are included in the initial public schema.",
    ),
  ],
  queuesAndCrons: [],
  notes: [
    "Bundled through @me3-core/plugin-local-executor as an optional first-party Core package.",
    "The plugin owns runner pairing, project policies, queued local runs, daemon token auth, and audit.",
    "Assistant activity remains the canonical owner-facing approval, result, and run-history surface.",
    "OpenCode is the default provider preset, with Codex and Claude presets available for local CLI users.",
  ],
};

const JOURNAL_PLUGIN: CorePluginManifestSummary = {
  schemaVersion: CORE_PLUGIN_CATALOG_VERSION,
  id: JOURNAL_PLUGIN_ID,
  name: "ME3 Journal",
  version: "0.1.0",
  description:
    "Private daily writing workspace for notes, braindumps, drafts, and longer-form capture.",
  trustTier: "first_party",
  distribution: "workspace_package",
  installMode: "enabled_by_owner_config",
  defaultEnabled: true,
  showInPluginList: false,
  implementationStatus: JOURNAL_RUNTIME.bundled ? "bundled" : "catalog_only",
  capabilityIds: [
    "workspace.journal",
    "journal.entries.manage",
    "journal.entries.read",
  ],
  permissions: [
    {
      id: "journal.entries.manage",
      label: "Create and manage private journal entries",
    },
  ],
  routes: [
    {
      id: "journal.day.read.api",
      path: "/api/journal/days/:date",
      methods: ["GET"],
      auth: "owner",
    },
    {
      id: "journal.day.save.api",
      path: "/api/journal/days/:date",
      methods: ["PATCH"],
      auth: "owner",
    },
    {
      id: "journal.archive.api",
      path: "/api/journal/archive",
      methods: ["GET"],
      auth: "owner",
    },
  ],
  uiSlots: [
    {
      id: "journal.nav",
      slot: "dashboard.nav",
      label: "Journal",
    },
  ],
  dashboardCards: [
    {
      id: "journal.latest-entry",
      label: "Latest Journal Entry",
      componentKey: "JournalLatestEntryCard",
      defaultEnabled: false,
      defaultSize: "medium",
      requiresPluginIds: [JOURNAL_PLUGIN_ID],
    },
  ],
  dashboardQuickActions: [
    {
      id: "journal.today",
      label: "Add Journal Entry",
      icon: "BookOpen",
      defaultEnabled: false,
      destinationId: "journal.today",
      requiresPluginIds: [JOURNAL_PLUGIN_ID],
    },
  ],
  agentTools: [
    agentTool({
      id: "journal.entries.read",
      label: "Read private Journal entries",
      sideEffect: "read_private",
      approvalMode: "none",
      auditEventKind: "journal_entries_read",
      examples: {
        positive: [
          "Read today's Journal entry.",
          "Show my latest seven Journal entries.",
        ],
        negative: ["Write a Journal entry for today."],
      },
    }),
  ],
  secrets: [],
  migrations: [
    publicBaselineMigration(
      "journal.public-baseline",
      "Journal entries are included in the initial public schema.",
    ),
  ],
  queuesAndCrons: [],
  notes: [
    "Bundled through @me3-core/plugin-journal as a first-party Core package.",
    "Journal owns private owner-scoped writing entries and connects with task and project workflows.",
    "Assistant reads use the explicit owner-scoped core.journal.read capability; Journal writes remain owner-controlled.",
  ],
};

export const CORE_PLUGIN_CATALOG: readonly CorePluginManifestSummary[] = [
  AGENT_CHAT_PLUGIN,
  MISSION_CONTROL_PLUGIN,
  JOURNAL_PLUGIN,
  ACCOUNTS_PLUGIN,
  CALENDAR_PLUGIN,
  LOCAL_EXECUTOR_PLUGIN,
  LANDING_PAGES_PLUGIN,
  EMAIL_CAMPAIGNS_PLUGIN,
  SOCIAL_PUBLISHING_PLUGIN,
];

export function listCorePluginAgentToolContracts(
  plugins: readonly CorePluginManifestSummary[] = CORE_PLUGIN_CATALOG,
): Me3AgentCapabilityContract[] {
  return plugins.flatMap((plugin) =>
    plugin.agentTools.map((tool) => corePluginAgentToolToContract(plugin, tool)),
  );
}

export function validateCorePluginAgentToolContracts(
  plugins: readonly CorePluginManifestSummary[] = CORE_PLUGIN_CATALOG,
) {
  return listCorePluginAgentToolContracts(plugins).flatMap((capability) =>
    validateMe3AgentCapabilityContract(capability),
  );
}

function corePluginAgentToolToContract(
  plugin: CorePluginManifestSummary,
  tool: CorePluginAgentTool,
): Me3AgentCapabilityContract {
  return defineMe3AgentCapabilityContract({
    id: tool.id,
    owner: "plugin",
    pluginId: plugin.id,
    version: plugin.version,
    ownerFacingLabel: tool.label,
    summary: `${plugin.name}: ${tool.label}.`,
    category: categoryForPlugin(plugin.id),
    handler: {
      surface: "plugin_tool",
      route: tool.id,
    },
    sideEffect: tool.sideEffect,
    approvalMode: tool.approvalMode,
    requiresSetup: setupRequirementIdsForPluginContract(plugin),
    inputSchema: ME3_EMPTY_AGENT_CAPABILITY_SCHEMA,
    outputSchema: ME3_EMPTY_AGENT_CAPABILITY_SCHEMA,
    auditEventKind: tool.auditEventKind,
    examples: tool.examples,
  });
}

function categoryForPlugin(pluginId: string): Me3AgentCapabilityCategory {
  if (pluginId === "me3.agent-chat") return "assistant";
  if (pluginId === "me3.mission-control") return "mission_control";
  if (pluginId === "me3.calendar") return "calendar";
  if (pluginId === "me3.social-publishing") return "content";
  if (pluginId === EMAIL_CAMPAIGNS_PLUGIN_ID) return "content";
  if (pluginId === "me3.accounts") return "accounts";
  if (pluginId === "me3.landing-pages") return "sites";
  if (pluginId === "me3.local-executor") return "local";
  return "provider";
}

function setupRequirementIdsForPluginContract(
  plugin: CorePluginManifestSummary,
): string[] {
  return [
    ...plugin.secrets
      .filter((secret) => secret.required)
      .map((secret) => `secret:${secret.name}`),
    ...plugin.migrations.map((migration) => `migration:${migration.id}`),
  ];
}

export async function activateCorePlugin(
  env: Env,
  pluginId: string,
): Promise<CorePluginRecord> {
  const plugin = getCorePluginManifest(pluginId);
  if (!isPluginActivationAllowed(plugin)) {
    throw new PluginInstallInputError(
      `${plugin.name} is coming soon and cannot be activated yet`,
      400,
    );
  }
  const now = new Date().toISOString();
  const setupRequirements = getSetupRequirements(env, plugin, {
    plugin_id: plugin.id,
    version: plugin.version,
    enabled: 1,
    status: "installed",
    granted_permissions_json: "[]",
    setup_state_json: "{}",
    installed_at: now,
    updated_at: now,
  });
  const setupBlocked = setupRequirements.some(
    (requirement) => requirement.required && !requirement.configured,
  );
  const status = setupBlocked ? "setup_required" : "installed";

  await env.DB.prepare(
    `INSERT INTO plugin_installations (
       plugin_id, version, enabled, status, granted_permissions_json,
       setup_state_json, installed_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(plugin_id) DO UPDATE SET
       version = excluded.version,
       enabled = excluded.enabled,
       status = excluded.status,
       granted_permissions_json = excluded.granted_permissions_json,
       setup_state_json = excluded.setup_state_json,
       updated_at = excluded.updated_at`,
  )
    .bind(
      plugin.id,
      plugin.version,
      1,
      status,
      JSON.stringify(plugin.permissions.map((permission) => permission.id)),
      JSON.stringify({ activatedFromCatalogVersion: CORE_PLUGIN_CATALOG_VERSION }),
      now,
      now,
    )
    .run();

  return serializePluginRecord(env, plugin, await getPluginInstallation(env, plugin.id));
}

export async function deactivateCorePlugin(
  env: Env,
  pluginId: string,
): Promise<CorePluginRecord> {
  const plugin = getCorePluginManifest(pluginId);
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO plugin_installations (
       plugin_id, version, enabled, status, granted_permissions_json,
       setup_state_json, installed_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(plugin_id) DO UPDATE SET
       version = excluded.version,
       enabled = excluded.enabled,
       status = excluded.status,
       setup_state_json = excluded.setup_state_json,
       updated_at = excluded.updated_at`,
  )
    .bind(
      plugin.id,
      plugin.version,
      0,
      "disabled",
      JSON.stringify([]),
      JSON.stringify({ deactivatedAt: now }),
      now,
      now,
    )
    .run();

  return serializePluginRecord(env, plugin, await getPluginInstallation(env, plugin.id));
}

export async function listCorePluginRecords(env: Env): Promise<CorePluginRecord[]> {
  const installations = await listPluginInstallations(env);
  return CORE_PLUGIN_CATALOG.map((plugin) =>
    serializePluginRecord(env, plugin, installations.get(plugin.id) || null),
  );
}

export async function isCorePluginEnabled(
  env: Env,
  pluginId: string,
): Promise<boolean> {
  const plugin = getCorePluginManifest(pluginId);
  const record = serializePluginRecord(
    env,
    plugin,
    await getPluginInstallation(env, plugin.id),
  );
  return record.enabled && record.status === "installed";
}

function getCorePluginManifest(pluginId: string): CorePluginManifestSummary {
  const plugin = CORE_PLUGIN_CATALOG.find((candidate) => candidate.id === pluginId);
  if (!plugin) {
    throw new PluginInstallInputError("Plugin is not in the Core catalog", 404);
  }
  return plugin;
}

async function listPluginInstallations(env: Env): Promise<Map<string, DbPluginInstallation>> {
  const rows = await env.DB.prepare(
    `SELECT plugin_id, version, enabled, status, granted_permissions_json,
            setup_state_json, installed_at, updated_at
     FROM plugin_installations
     ORDER BY plugin_id`,
  ).all<DbPluginInstallation>();

  return new Map((rows.results || []).map((row) => [row.plugin_id, row]));
}

async function getPluginInstallation(
  env: Env,
  pluginId: string,
): Promise<DbPluginInstallation | null> {
  return env.DB.prepare(
    `SELECT plugin_id, version, enabled, status, granted_permissions_json,
            setup_state_json, installed_at, updated_at
     FROM plugin_installations
     WHERE plugin_id = ?`,
  )
    .bind(pluginId)
    .first<DbPluginInstallation>();
}

function serializePluginRecord(
  env: Env,
  plugin: CorePluginManifestSummary,
  installation: DbPluginInstallation | null,
): CorePluginRecord {
  const setupRequirements = getSetupRequirements(env, plugin, installation);
  const activationAllowed = isPluginActivationAllowed(plugin);
  const alwaysEnabled = plugin.id === JOURNAL_PLUGIN_ID && plugin.defaultEnabled === true;
  const defaultInstalled = !installation && plugin.defaultEnabled === true;
  const installed = Boolean(installation) || defaultInstalled;
  const enabled =
    activationAllowed &&
    installed &&
    (alwaysEnabled ||
      ((defaultInstalled || installation?.enabled !== 0) &&
        installation?.status !== "disabled"));
  const setupBlocked = setupRequirements.some(
    (requirement) => requirement.required && !requirement.configured,
  );
  let status: CorePluginStatus = "installed";
  if (!activationAllowed) {
    status = "coming_soon";
  } else if (!installed) {
    status = "available";
  } else if (!enabled) {
    status = "disabled";
  } else if (setupBlocked || installation?.status === "setup_required") {
    status = "setup_required";
  }

  return {
    ...plugin,
    showInPluginList: plugin.showInPluginList !== false,
    releaseStage: plugin.releaseStage || "available",
    activationAllowed,
    status,
    statusLabel: statusToLabel(status),
    installed,
    enabled,
    grantedPermissions: alwaysEnabled
      ? plugin.permissions.map((permission) => permission.id)
      : installation
        ? parseJsonStringArray(installation.granted_permissions_json || null)
        : defaultInstalled
          ? plugin.permissions.map((permission) => permission.id)
          : [],
    setupRequirements,
    installedAt: installation?.installed_at || null,
    updatedAt: installation?.updated_at || null,
  };
}

function isPluginActivationAllowed(plugin: CorePluginManifestSummary): boolean {
  return plugin.activationAllowed !== false && plugin.releaseStage !== "coming_soon";
}

function getSetupRequirements(
  env: Env,
  plugin: CorePluginManifestSummary,
  installation: DbPluginInstallation | null,
): CorePluginSetupRequirement[] {
  const envRecord = env as unknown as Record<string, unknown>;
  const requirements: CorePluginSetupRequirement[] = [
    {
      id: `${plugin.id}.package`,
      label: "Implementation package",
      kind: "package",
      required: true,
      configured: plugin.implementationStatus === "bundled",
      note:
        plugin.implementationStatus === "bundled"
          ? "Bundled into this Core build."
          : "Not bundled in this Core build yet.",
    },
  ];

  for (const secret of plugin.secrets) {
    requirements.push({
      id: `${plugin.id}.secret.${secret.name}`,
      label: secret.label,
      kind: "secret",
      required: secret.required,
      configured: Boolean(envRecord[secret.name]),
      note: secret.required ? undefined : "Optional provider setup.",
    });
  }

  for (const item of plugin.queuesAndCrons) {
    requirements.push({
      id: `${plugin.id}.${item.kind}.${item.id}`,
      label: item.kind === "queue" ? item.binding || item.id : `Cron ${item.schedule}`,
      kind: item.kind,
      required: false,
      configured: item.kind === "queue" ? Boolean(item.binding && envRecord[item.binding]) : true,
      note:
        item.kind === "queue"
          ? "Optional until the publishing worker is extracted."
          : "Declared schedule.",
    });
  }

  requirements.push({
    id: `${plugin.id}.migrations`,
    label: `${plugin.migrations.length} plugin migration${plugin.migrations.length === 1 ? "" : "s"}`,
    kind: "migration",
    required: true,
    configured: Boolean(installation) || plugin.defaultEnabled === true,
    note:
      installation
        ? "Tracked by install state."
        : plugin.defaultEnabled === true
          ? "Enabled by default in this Core build."
        : "Pending until install.",
  });

  return requirements;
}

function statusToLabel(status: CorePluginStatus): string {
  switch (status) {
    case "installed":
      return "Installed";
    case "setup_required":
      return "Setup required";
    case "disabled":
      return "Disabled";
    case "coming_soon":
      return "Coming soon";
    default:
      return "Available";
  }
}

function parseJsonStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    return [];
  }
}
