import { describe, expect, it } from "vitest";
import {
  createMissionWheelSnapshot,
  getMissionDailyBriefing,
  getMissionDashboard,
  getMissionProjectsSummary,
  getMissionWheel,
  listMissionContextSources,
  updateMissionDashboard,
  updateMissionWheelSettings,
} from "./mission-control";
import type { Env } from "./types";

type DashboardSettingsRow = {
  user_id: string;
  cards_json: string;
  quick_links_json: string;
  settings_json: string;
  mission_statement: string | null;
  created_at: string;
  updated_at: string;
};

type PluginInstallationRow = {
  plugin_id: string;
  version: string;
  enabled: number;
  status: string;
  granted_permissions_json: string;
  setup_state_json: string;
  installed_at: string;
  updated_at: string;
};

type WheelSettingsRow = {
  user_id: string;
  segments_json: string;
  schema_version: number;
  created_at: string;
  updated_at: string;
};

type WheelSnapshotRow = {
  id: string;
  user_id: string;
  segments_json: string;
  notes_json: string;
  created_at: string;
};

type ContextSourceRow = {
  id: string;
  user_id: string;
  source_kind: string;
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

describe("Mission Control dashboard settings", () => {
  it("creates stable defaults for a new owner", async () => {
    const env = createDashboardEnv({
      enabledPlugins: ["me3.journal", "me3.social-publishing"],
      activity: [
        {
          id: "activity-1",
          user_id: "owner",
          plugin_id: "me3.assistant-jobs",
          activity_type: "assistant_job.review_packet",
          title: "Daily Briefing",
          summary: null,
          status: "succeeded",
          related_id: "run-1",
          metadata_json: JSON.stringify({
            dailyBriefing: {
              version: 1,
              date: "2026-06-04",
              message: "A calm operational day.",
              plainText: "A calm operational day.",
              sections: [
                {
                  kind: "calendar",
                  title: "Calendar",
                  summary: "Your calendar is clear.",
                  items: [],
                },
              ],
            },
          }),
          created_at: "2026-06-04 08:15:00",
        },
      ],
    });

    const dashboard = await getMissionDashboard(env, "owner");

    expect(
      dashboard.cards.filter((card) => card.enabled).map((card) => card.cardId),
    ).toEqual([
      "mission.daily-briefing",
      "mission.me3-profile",
      "mission.mission-statement",
      "mission.goals",
      "mission.wheel-latest-snapshot",
    ]);
    expect(dashboard.availableCards.map((card) => card.id)).toEqual(
      expect.arrayContaining([
        "mission.projects-summary",
        "journal.latest-entry",
        "social.queue-summary",
      ]),
    );
    expect(dashboard.quickLinks.filter((link) => link.enabled)).toEqual([]);
    expect(dashboard.quickLinks.map((link) => link.destinationId)).toEqual(
      expect.arrayContaining([
        "mission.projects",
        "assistant.chat",
        "journal.today",
        "social.schedule",
      ]),
    );
    expect(dashboard.settings).toEqual({
      kanbanEnabled: false,
      mainGoal: "",
      goals: [],
      setupChecklistDismissed: true,
    });
    expect(dashboard.mainGoal).toBe("");
    expect(dashboard.missionStatement).toContain("I am here to help");
    expect(dashboard.data["mission.daily-briefing"]).toMatchObject({
      message: "A calm operational day.",
      plainText: "A calm operational day.",
      sections: [expect.objectContaining({ kind: "calendar" })],
      createdAt: "2026-06-04T08:15:00Z",
    });

    await expect(getMissionDailyBriefing(env, "owner", "activity-1")).resolves.toEqual({
      briefing: expect.objectContaining({
        id: "activity-1",
        plainText: "A calm operational day.",
        sections: [expect.objectContaining({ kind: "calendar" })],
      }),
    });
  });

  it("derives Mission from the canonical private profile answers", async () => {
    const env = createDashboardEnv({
      profile: {
        name: "Kieran",
        handle: "kieran",
        business: {
          audience: "conscious change-makers",
          primaryProblem: "having impact without burning out",
          solution: "building calm, useful systems",
        },
      },
      dashboardSettings: {
        mission_statement: "Legacy Mission that should not win.",
      },
    });

    const dashboard = await getMissionDashboard(env, "owner");

    expect(dashboard.missionStatement).toBe(
      "I help conscious change-makers with having impact without burning out by building calm, useful systems.",
    );
    expect(dashboard.data["mission.mission-statement"]).toMatchObject({
      source: "profile",
    });
    expect(dashboard.data["mission.me3-profile"]).toMatchObject({
      name: "Kieran",
      handle: "kieran",
    });
  });

  it("does not resurrect legacy Mission after the canonical profile clears it", async () => {
    const env = createDashboardEnv({
      profile: {
        name: "Kieran",
        handle: "kieran",
        business: {},
      },
      dashboardSettings: {
        mission_statement: "Legacy Mission that has been cleared.",
      },
    });

    const dashboard = await getMissionDashboard(env, "owner");

    expect(dashboard.missionStatement).not.toContain("Legacy Mission");
    expect(dashboard.data["mission.mission-statement"]).toMatchObject({
      source: "profile",
    });
  });

  it("does not let legacy mainGoal updates replace structured Goals", async () => {
    const longId = "g".repeat(80);
    const env = createDashboardEnv({
      dashboardSettings: {
        settings_json: JSON.stringify({
          goals: [
            { id: longId, title: "Keep this goal", status: "active" },
            { id: longId, title: "Keep this one too", status: "completed" },
          ],
        }),
      },
    });

    const dashboard = await updateMissionDashboard(env, "owner", {
      mainGoal: "Legacy client overwrite",
    });

    expect(dashboard.settings.goals.map((goal) => goal.title)).toEqual([
      "Keep this goal",
      "Keep this one too",
    ]);
    expect(new Set(dashboard.settings.goals.map((goal) => goal.id)).size).toBe(2);
  });

  it("normalizes dashboard updates through curated cards and destinations", async () => {
    const env = createDashboardEnv({ enabledPlugins: ["me3.journal"] });

    const dashboard = await updateMissionDashboard(env, "owner", {
      missionStatement: "  Help owners steer the day.  ",
      mainGoal: "  Finish the onboarding polish.  ",
      kanbanEnabled: true,
      settings: { setupChecklistDismissed: true },
      cards: [
        {
          cardId: "mission.wheel-latest-snapshot",
          enabled: false,
          size: "wide",
          sortOrder: 0,
        },
        {
          cardId: "unknown.card",
          enabled: true,
          size: "wide",
          sortOrder: 1,
        },
      ],
      quickLinks: [
        {
          id: "mission.projects",
          label: "Projects",
          icon: "ListChecks",
          enabled: true,
          sortOrder: 0,
          destinationId: "mission.projects",
        },
        {
          id: "bad",
          label: "Bad route",
          icon: "AlertTriangle",
          enabled: true,
          sortOrder: 1,
          destinationId: "https://example.test",
        },
      ],
    });

    expect(dashboard.missionStatement).toContain("I am here to help");
    expect(dashboard.mainGoal).toBe("Finish the onboarding polish.");
    expect(dashboard.settings).toEqual({
      kanbanEnabled: true,
      mainGoal: "Finish the onboarding polish.",
      goals: [
        {
          id: "legacy-main-goal",
          title: "Finish the onboarding polish.",
          status: "active",
        },
      ],
      setupChecklistDismissed: true,
    });
    expect(dashboard.cards.find((card) => card.cardId === "unknown.card")).toBeUndefined();
    expect(
      dashboard.cards.find((card) => card.cardId === "mission.wheel-latest-snapshot"),
    ).toMatchObject({
      enabled: false,
      size: "wide",
      sortOrder: 0,
    });
    expect(dashboard.quickLinks.map((link) => link.id)).toEqual([
      "mission.projects",
      "assistant.chat",
      "journal.today",
    ]);
    expect(dashboard.quickLinks[0]).toMatchObject({
      label: "Projects",
      destinationId: "mission.projects",
    });
  });

  it("persists Wheel settings and snapshots for the dashboard card", async () => {
    const env = createDashboardEnv();
    const segments = [
      "health",
      "spirituality",
      "work",
      "finances",
      "home",
      "joy",
    ].map((id, index) => ({
      id,
      label: id,
      helper: `${id} helper`,
      color: "#26806f",
      emoji: "Circle",
      value: index + 1,
    }));

    await updateMissionWheelSettings(env, "owner", { segments });
    const wheel = await getMissionWheel(env, "owner");
    expect(wheel.settings.segments.map((segment) => segment.value)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);

    await createMissionWheelSnapshot(env, "owner", {
      id: "snapshot-1",
      createdAt: "2026-06-04T09:30:00.000Z",
      segments,
      notes: { health: "Slept well." },
    });

    const dashboard = await getMissionDashboard(env, "owner");
    expect(dashboard.data["mission.wheel-latest-snapshot"]).toMatchObject({
      source: "server",
      snapshot: {
        id: "snapshot-1",
        createdAt: "2026-06-04T09:30:00.000Z",
      },
    });
    expect(
      dashboard.data["mission.wheel-latest-snapshot"]?.snapshot?.segments[0],
    ).toMatchObject({ id: "health", notes: "Slept well." });
    expect(dashboard.mainGoal).toBe("");
    expect(dashboard.data["mission.goals"]).toEqual({ goals: [] });
  });

  it("returns the four busiest active project summaries from one aggregate", async () => {
    const env = createDashboardEnv({
      projectSummaryRows: [
        {
          project_id: "project-a",
          project_name: "Alpha",
          status: "backlog",
          count: 2,
        },
        {
          project_id: "project-a",
          project_name: "Alpha",
          status: "in_progress",
          count: 1,
        },
        {
          project_id: null,
          project_name: "Personal",
          status: "backlog",
          count: 4,
        },
      ],
      projectTaskRows: [
        {
          id: "task-now",
          project_id: "project-a",
          project_name: "Alpha",
          title: "Ship the focused dashboard",
          status: "in_progress",
          priority: 1,
          pinned_at: "2026-07-10 09:00:00",
          due_at: "2026-07-11",
          scheduled_for: null,
        },
      ],
    });

    await expect(getMissionProjectsSummary(env, "owner")).resolves.toEqual({
      summaries: [
        {
          id: "personal",
          label: "Personal",
          total: 4,
          counts: { backlog: 4, in_progress: 0, done: 0 },
        },
        {
          id: "project-a",
          label: "Alpha",
          total: 3,
          counts: { backlog: 2, in_progress: 1, done: 0 },
        },
      ],
      tasks: [
        {
          id: "task-now",
          projectId: "project-a",
          projectName: "Alpha",
          title: "Ship the focused dashboard",
          status: "in_progress",
          priority: 1,
          pinnedAt: "2026-07-10T09:00:00Z",
          dueAt: "2026-07-11",
          scheduledFor: null,
        },
      ],
    });
  });

  it("preserves inactive plugin dashboard settings while marking them unavailable", async () => {
    const env = createDashboardEnv({
      dashboardSettings: {
        cards_json: JSON.stringify([
          {
            cardId: "social.queue-summary",
            enabled: true,
            size: "medium",
            sortOrder: 0,
          },
        ]),
        quick_links_json: JSON.stringify([
          {
            id: "social.schedule",
            label: "Social",
            icon: "Send",
            enabled: true,
            sortOrder: 0,
            destinationId: "social.schedule",
          },
        ]),
      },
    });

    const dashboard = await getMissionDashboard(env, "owner");

    expect(dashboard.availableCards.map((card) => card.id)).not.toContain(
      "social.queue-summary",
    );
    expect(dashboard.cards.find((card) => card.cardId === "social.queue-summary"))
      .toMatchObject({ enabled: true, available: false });
    expect(dashboard.quickLinks.find((link) => link.id === "social.schedule"))
      .toMatchObject({ enabled: true, available: false });
  });

  it("lists priority context sources with missing essentials highlighted", async () => {
    const env = createDashboardEnv();

    let sources = await listMissionContextSources(env, "owner");

    expect(sources.map((source) => source.sourceKind)).toEqual([
      "mission_statement",
      "wheel_of_life",
      "public_me_json",
      "private_memory",
    ]);
    expect(sources[0]).toMatchObject({
      label: "Mission",
      status: "setup_required",
      sourceRef: "/create?step=mission",
    });
    expect(sources[1]).toMatchObject({
      label: "Wheel of Life",
      status: "setup_required",
      sourceRef: "/journal/wheel-of-life",
    });

    await updateMissionDashboard(env, "owner", {
      goals: [
        {
          id: "goal-1",
          title: "Help builders steer their work with calm, useful systems.",
          status: "active",
        },
      ],
    });
    await createMissionWheelSnapshot(env, "owner", {
      id: "snapshot-1",
      createdAt: "2026-06-04T09:00:00.000Z",
      segments: [
        { id: "health", label: "Health", value: 6 },
        { id: "spirituality", label: "Spirituality", value: 7 },
        { id: "work", label: "Work", value: 8 },
        { id: "finances", label: "Finances", value: 5 },
        { id: "relationships", label: "Relationships", value: 7 },
        { id: "home", label: "Home", value: 6 },
      ],
      notes: {},
    });

    sources = await listMissionContextSources(env, "owner");

    expect(sources.find((source) => source.sourceKind === "mission_statement"))
      .toMatchObject({ status: "active" });
    expect(sources.find((source) => source.sourceKind === "wheel_of_life"))
      .toMatchObject({ status: "active" });
  });
});

function createDashboardEnv(options: {
  enabledPlugins?: string[];
  activity?: Array<Record<string, unknown> & { id: string; user_id: string }>;
  projectSummaryRows?: Array<{
    project_id: string | null;
    project_name: string;
    status: "backlog" | "in_progress";
    count: number;
  }>;
  projectTaskRows?: Array<{
    id: string;
    project_id: string | null;
    project_name: string;
    title: string;
    status: "backlog" | "in_progress";
    priority: number;
    pinned_at: string | null;
    due_at: string | null;
    scheduled_for: string | null;
  }>;
  dashboardSettings?: Partial<DashboardSettingsRow>;
  profile?: Record<string, unknown>;
} = {}) {
  const settings = new Map<string, DashboardSettingsRow>();
  const wheelSettings = new Map<string, WheelSettingsRow>();
  const wheelSnapshots = new Map<string, WheelSnapshotRow>();
  const contextSources = new Map<string, ContextSourceRow>();
  const enabledPlugins = new Set(options.enabledPlugins || []);
  const activity = options.activity || [];
  const projectSummaryRows = options.projectSummaryRows || [];
  const projectTaskRows = options.projectTaskRows || [];
  const pluginInstallations = new Map<string, PluginInstallationRow>(
    Array.from(enabledPlugins).map((pluginId) => [
      pluginId,
      {
        plugin_id: pluginId,
        version: "0.1.0",
        enabled: 1,
        status: "installed",
        granted_permissions_json: "[]",
        setup_state_json: "{}",
        installed_at: "2026-06-04 08:00:00",
        updated_at: "2026-06-04 08:00:00",
      },
    ]),
  );
  if (options.dashboardSettings) {
    settings.set("owner", {
      user_id: "owner",
      cards_json: options.dashboardSettings.cards_json || "[]",
      quick_links_json: options.dashboardSettings.quick_links_json || "[]",
      settings_json: options.dashboardSettings.settings_json || "{}",
      mission_statement: options.dashboardSettings.mission_statement || null,
      created_at: "2026-06-04 08:00:00",
      updated_at: "2026-06-04 08:00:00",
    });
  }

  const db = {
    prepare(sql: string) {
      return {
        async all<T>() {
          if (sql.includes("plugin_installations")) {
            return {
              results: Array.from(pluginInstallations.values()) as T[],
            };
          }
          return { results: [] as T[] };
        },
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes("FROM sites")) {
                return (options.profile
                  ? { id: "profile-site", username: "kieran" }
                  : null) as T | null;
              }
              if (sql.includes("FROM site_files")) {
                return (options.profile && values[1] === "src/me.json"
                  ? {
                      site_id: "profile-site",
                      path: "src/me.json",
                      content: Array.from(
                        new TextEncoder().encode(JSON.stringify(options.profile)),
                      ),
                      content_type: "application/json",
                      size: 0,
                      sha256: null,
                      updated_at: "2026-06-04 08:00:00",
                    }
                  : null) as T | null;
              }
              if (sql.includes("mission_dashboard_settings")) {
                return (settings.get(String(values[0])) || null) as T | null;
              }
              if (sql.includes("mission_wheel_settings")) {
                return (wheelSettings.get(String(values[0])) || null) as T | null;
              }
              if (sql.includes("mission_wheel_snapshots")) {
                if (sql.includes("WHERE id = ?")) {
                  return (wheelSnapshots.get(String(values[0])) || null) as T | null;
                }
                return null;
              }
              if (sql.includes("plugin_installations")) {
                return (pluginInstallations.get(String(values[0])) || null) as T | null;
              }
              if (sql.includes("mission_plugin_activity")) {
                return (activity.find(
                  (row) => row.id === values[0] && row.user_id === values[1],
                ) || null) as T | null;
              }
              return null;
            },
            async all<T>() {
              if (
                sql.includes("COUNT(*) AS count") &&
                sql.includes("FROM mission_tasks t")
              ) {
                return { results: projectSummaryRows as T[] };
              }
              if (
                sql.includes("t.title, t.status, t.priority") &&
                sql.includes("FROM mission_tasks t")
              ) {
                return { results: projectTaskRows as T[] };
              }
              if (sql.includes("plugin_installations")) {
                return {
                  results: Array.from(pluginInstallations.values()) as T[],
                };
              }
              if (sql.includes("mission_wheel_snapshots")) {
                const userId = String(values[0]);
                const limit = Number(values[1] || 50);
                return {
                  results: Array.from(wheelSnapshots.values())
                    .filter((row) => row.user_id === userId)
                    .sort((a, b) =>
                      String(b.created_at).localeCompare(String(a.created_at)),
                    )
                    .slice(0, limit) as T[],
                };
              }
              if (sql.includes("mission_plugin_activity")) {
                return {
                  results: activity
                    .filter((row) => row.user_id === values[0])
                    .sort((a, b) =>
                      String(b.created_at).localeCompare(String(a.created_at)),
                    ) as T[],
                };
              }
              if (sql.includes("mission_context_sources")) {
                const userId = String(values[0]);
                const limit = Number(values[1] || 50);
                const rank = (sourceKind: string) =>
                  sourceKind === "mission_statement"
                    ? 0
                    : sourceKind === "wheel_of_life"
                      ? 1
                      : sourceKind === "public_me_json"
                        ? 2
                        : sourceKind === "private_memory"
                          ? 3
                          : 4;
                return {
                  results: Array.from(contextSources.values())
                    .filter(
                      (row) => row.user_id === userId && row.status !== "archived",
                    )
                    .sort(
                      (a, b) =>
                        rank(a.source_kind) - rank(b.source_kind) ||
                        a.label.localeCompare(b.label),
                    )
                    .slice(0, limit) as T[],
                };
              }
              return { results: [] as T[] };
            },
            async run() {
              if (sql.includes("mission_dashboard_settings")) {
                const userId = String(values[0]);
                settings.set(userId, {
                  user_id: userId,
                  cards_json: String(values[1]),
                  quick_links_json: String(values[2]),
                  settings_json: String(values[3]),
                  mission_statement:
                    values[4] === null || values[4] === undefined
                      ? null
                      : String(values[4]),
                  created_at: "2026-06-04 08:00:00",
                  updated_at: "2026-06-04 08:00:00",
                });
              }
              if (sql.includes("mission_wheel_settings")) {
                const userId = String(values[0]);
                wheelSettings.set(userId, {
                  user_id: userId,
                  segments_json: String(values[1]),
                  schema_version: 1,
                  created_at: "2026-06-04 08:00:00",
                  updated_at: "2026-06-04 08:00:00",
                });
              }
              if (sql.includes("mission_wheel_snapshots")) {
                const id = String(values[0]);
                wheelSnapshots.set(id, {
                  id,
                  user_id: String(values[1]),
                  segments_json: String(values[2]),
                  notes_json: String(values[3]),
                  created_at: String(values[4]),
                });
              }
              if (sql.includes("mission_context_sources")) {
                const [
                  id,
                  userId,
                  sourceKind,
                  label,
                  description,
                  visibility,
                  status,
                  sourceRef,
                ] = values;
                const existing = contextSources.get(String(id));
                contextSources.set(String(id), {
                  id: String(id),
                  user_id: String(userId),
                  source_kind: String(sourceKind),
                  label: String(label),
                  description:
                    description === null || description === undefined
                      ? null
                      : String(description),
                  visibility: visibility === "public" ? "public" : "private",
                  status: status as ContextSourceRow["status"],
                  source_ref:
                    sourceRef === null || sourceRef === undefined
                      ? null
                      : String(sourceRef),
                  last_indexed_at: existing?.last_indexed_at || null,
                  grants_json: existing?.grants_json || "[]",
                  metadata_json: existing?.metadata_json || "{}",
                  created_at: existing?.created_at || "2026-06-04 08:00:00",
                  updated_at: "2026-06-04 08:00:00",
                });
              }
              return { success: true, meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };

  return { DB: db as unknown as D1Database } as Env;
}
