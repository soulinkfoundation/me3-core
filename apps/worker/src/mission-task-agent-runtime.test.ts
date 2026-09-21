import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runCoreAgentToolTurn,
  type AgentToolMessage,
} from "@me3-core/plugin-agent-chat";

type ProjectRow = {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
};

type TaskRow = {
  id: string;
  user_id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  due_at: string | null;
  scheduled_for: string | null;
  source_ref: string | null;
  archived_at: string | null;
};

type ExecutionRow = {
  id: string;
  user_id: string;
  request_id: string;
  tool_call_id: string;
  tool_name: string;
  status: "running" | "succeeded" | "failed";
  result_json: string | null;
  error_message: string | null;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Mission Control Agent Runtime v2", () => {
  it.each(["workers-ai", "openai", "anthropic"] as const)(
    "creates a task in a named project through %s",
    async (providerId) => {
      const database = createMissionDb({
        projects: [
          projectRow("project-personal", "Personal", "personal"),
          projectRow("project-launch", "ME3 Launch", "me3-launch"),
        ],
      });
      const route = providerRoute(providerId, [
        providerToolCall(providerId, "create-1", "core_mission_task_create", {
          title: "Follow up with Sam",
          description: "Confirm the launch checklist is ready.",
          projectName: "mE3 lAuNcH",
          dueAt: "2026-07-15",
          priority: 1,
        }),
        providerText(providerId, "Added Follow up with Sam to ME3 Launch."),
      ]);

      const response = await runCoreAgentToolTurn({
        db: database.db,
        userId: "owner",
        requestId: `create-${providerId}`,
        turnId: `turn-${providerId}`,
        ownerTimezone: "Europe/Dublin",
        route: route as never,
        messages: baseMessages(
          "Add a task to ME3 Launch to follow up with Sam by 15 July.",
        ),
      });

      expect(response).toMatchObject({
        source: providerId,
        specialist: "core.mission.task.create",
        actionCards: [
          expect.objectContaining({
            kind: "mission.task_created",
            capabilityId: "core.mission.task.create",
            summary: "Follow up with Sam",
          }),
        ],
      });
      expect(database.tasks).toHaveLength(1);
      expect(database.tasks[0]).toMatchObject({
        title: "Follow up with Sam",
        project_id: "project-launch",
        due_at: "2026-07-15",
        status: "backlog",
        priority: 1,
      });
      expect(database.executions.map((row) => row.status)).toEqual(["succeeded"]);
    },
  );

  it("moves a task to a named project", async () => {
    const database = createMissionDb({
      projects: [
        projectRow("project-personal", "Personal", "personal"),
        projectRow("project-me3", "ME3", "me3"),
      ],
      tasks: [taskRow("task-1", "Write the release notes", "project-personal")],
    });
    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "move-to-named-project",
      turnId: "turn-move-to-named-project",
      ownerTimezone: "Europe/Dublin",
      route: providerRoute("workers-ai", [
        providerToolCall("workers-ai", "move-1", "core_mission_task_update", {
          taskId: "task-1",
          projectName: "ME3",
        }),
        providerText("workers-ai", "Moved Write the release notes to ME3."),
      ]) as never,
      messages: baseMessages("Update task task-1 and move it to ME3."),
    });

    expect(response).toMatchObject({
      specialist: "core.mission.task.update",
      actionCards: [expect.objectContaining({ kind: "mission.task_updated" })],
    });
    expect(database.tasks[0]?.project_id).toBe("project-me3");
  });

  it("updates only the stable task ID selected after listing", async () => {
    const database = createMissionDb({
      projects: [projectRow("project-launch", "ME3 Launch", "me3-launch")],
      tasks: [
        {
          ...taskRow("task-1", "Follow up with Sam", "project-launch"),
          description: "Old notes",
          due_at: "2026-07-15",
        },
        taskRow("task-2", "Follow up with Sam later", "project-launch"),
      ],
    });
    const route = providerRoute("workers-ai", [
      providerToolCall("workers-ai", "list-1", "core_mission_task_list", {
        projectId: "project-launch",
      }),
      providerToolCall("workers-ai", "update-1", "core_mission_task_update", {
        taskId: "task-1",
        status: "done",
        priority: 1,
        clearDescription: true,
        clearDueAt: true,
      }),
      { response: "Marked the selected task done." },
    ]);

    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "update-task",
      turnId: "turn-update",
      ownerTimezone: "Europe/Dublin",
      route: route as never,
      messages: baseMessages("Mark Follow up with Sam as done"),
    });

    expect(response).toMatchObject({
      specialist: "core.mission.task.update",
      actionCards: [expect.objectContaining({ kind: "mission.task_updated" })],
    });
    expect(database.tasks.find((task) => task.id === "task-1")?.status).toBe("done");
    expect(database.tasks.find((task) => task.id === "task-1")?.priority).toBe(1);
    expect(database.tasks.find((task) => task.id === "task-1")?.description).toBeNull();
    expect(database.tasks.find((task) => task.id === "task-1")?.due_at).toBeNull();
    expect(database.tasks.find((task) => task.id === "task-2")?.status).toBe("backlog");
  });

  it("lists tasks by an exact project name without requiring its stable ID", async () => {
    const database = createMissionDb({
      projects: [
        projectRow("project-me3", "ME3", "me3"),
        projectRow("project-personal", "Personal", "personal"),
      ],
      tasks: [
        { ...taskRow("task-me3", "Ship runtime fix", "project-me3"), status: "in_progress" },
        { ...taskRow("task-personal", "Wash car", "project-personal"), status: "in_progress" },
      ],
    });
    const route = providerRoute("workers-ai", [
      providerToolCall("workers-ai", "list-me3", "core_mission_task_list", {
        projectName: "ME3",
        status: "in_progress",
      }),
      { response: "Ship runtime fix" },
    ]);

    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "list-project-name",
      turnId: "turn-list-project-name",
      ownerTimezone: "Europe/Dublin",
      route: route as never,
      messages: baseMessages("List in-progress tasks in the ME3 project"),
    });

    expect(response).toMatchObject({
      specialist: "core.mission.task.list",
      replyText: "Ship runtime fix",
    });
    expect(database.executions[0]?.result_json).toContain("Ship runtime fix");
    expect(database.executions[0]?.result_json).not.toContain("Wash car");
  });

  it("uses owner-content search to recover a mistyped task title", async () => {
    const database = createMissionDb({
      projects: [projectRow("project-me3", "ME3", "me3")],
      tasks: [
        ...Array.from({ length: 125 }, (_, index) =>
          taskRow(`task-${index}`, `Routine backlog item ${index}`, "project-me3")
        ),
        {
          ...taskRow("task-cooking", "Eating our own AI cooking", "project-me3"),
          description: "Use ME3 on real ME3 work.",
        },
      ],
    });
    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "search-mistyped-title",
      turnId: "turn-search-mistyped-title",
      ownerTimezone: "Europe/Dublin",
      route: providerRoute("workers-ai", [
        providerToolCall("workers-ai", "search-1", "core_owner_content_search", {
          query: "Eting our own AI cooking",
          sourceType: "mission_task",
        }),
        { response: "I found the task Eating our own AI cooking." },
      ]) as never,
      messages: baseMessages("Find the Eting our own AI cooking task."),
    });

    expect(response).toMatchObject({
      specialist: "core.owner_content.search",
      replyText: "I found the task Eating our own AI cooking.",
    });
    expect(database.executions[0]?.result_json).toContain("task-cooking");
    expect(database.executions[0]?.result_json).not.toContain("Use ME3 on real ME3 work.");
  });

  it("clarifies ambiguous task names without mutating either task", async () => {
    const database = createMissionDb({
      projects: [projectRow("project-launch", "ME3 Launch", "me3-launch")],
      tasks: [
        taskRow("task-1", "Launch checklist", "project-launch"),
        taskRow("task-2", "Launch checklist", "project-launch"),
      ],
    });
    const route = providerRoute("workers-ai", [
      providerToolCall("workers-ai", "list-1", "core_mission_task_list", {}),
      { response: "I found two Launch checklist tasks. Which one should I archive?" },
    ]);

    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "ambiguous-task",
      turnId: "turn-ambiguous",
      ownerTimezone: "Europe/Dublin",
      route: route as never,
      messages: baseMessages("Archive the Launch checklist task"),
    });

    expect(response.replyText).toContain("Which one");
    expect(response.specialist).toBe("core.mission.task.list");
    expect(database.tasks.every((task) => task.archived_at === null)).toBe(true);
  });

  it("reads full task details and archives only by stable ID", async () => {
    const description = "Include provider parity, ambiguity, and replay evidence.";
    const database = createMissionDb({
      projects: [projectRow("project-launch", "ME3 Launch", "me3-launch")],
      tasks: [
        { ...taskRow("task-1", "Prepare launch checklist", "project-launch"), description },
      ],
    });
    const route = providerRoute("workers-ai", [
      providerToolCall("workers-ai", "read-1", "core_mission_task_read", {
        taskId: "task-1",
      }),
      providerToolCall("workers-ai", "archive-1", "core_mission_task_archive", {
        taskId: "task-1",
      }),
      { response: "Archived Prepare launch checklist." },
    ]);

    const response = await runCoreAgentToolTurn({
      db: database.db,
      userId: "owner",
      requestId: "archive-task",
      turnId: "turn-archive",
      ownerTimezone: "Europe/Dublin",
      route: route as never,
      messages: baseMessages("Read task task-1, then archive it"),
    });

    expect(response).toMatchObject({
      specialist: "core.mission.task.archive",
      actionCards: [expect.objectContaining({ kind: "mission.task_archived" })],
    });
    expect(database.executions[0]?.result_json).toContain(description);
    expect(database.tasks[0]?.archived_at).not.toBeNull();
  });

  it("replays a completed task create without duplicating it", async () => {
    const database = createMissionDb({
      projects: [projectRow("project-personal", "Personal", "personal")],
    });
    const run = () =>
      runCoreAgentToolTurn({
        db: database.db,
        userId: "owner",
        requestId: "replay-task",
        turnId: "turn-replay-task",
        ownerTimezone: "Europe/Dublin",
        route: providerRoute("workers-ai", [
          providerToolCall("workers-ai", "create-1", "core_mission_task_create", {
            title: "Call Sam",
            projectId: "project-personal",
          }),
          { response: "Task created." },
        ]) as never,
        messages: baseMessages("Add Call Sam to Personal"),
      });

    const first = await run();
    const replay = await run();

    expect(first.actionCards).toEqual(replay.actionCards);
    expect(database.tasks).toHaveLength(1);
    expect(database.executions).toHaveLength(1);
  });
});

function baseMessages(message: string): AgentToolMessage[] {
  return [
    { role: "system", content: "You are ME3." },
    { role: "user", content: message },
  ];
}

function providerRoute(providerId: "workers-ai" | "openai" | "anthropic", payloads: unknown[]) {
  const next = vi.fn(async () => payloads.shift());
  if (providerId === "workers-ai") {
    return {
      providerId,
      model: "workers-test-model",
      backupModel: null,
      apiKey: null,
      ai: { run: next },
      aiGateway: null,
      configured: true,
    };
  }
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(await next())));
  return {
    providerId,
    model: `${providerId}-test-model`,
    backupModel: null,
    apiKey: "test-key",
    ai: null,
    aiGateway: null,
    configured: true,
  };
}

function providerToolCall(
  providerId: "workers-ai" | "openai" | "anthropic",
  id: string,
  name: string,
  args: Record<string, unknown>,
) {
  if (providerId === "openai") {
    return {
      choices: [{ message: { tool_calls: [{ id, function: { name, arguments: JSON.stringify(args) } }] } }],
    };
  }
  if (providerId === "anthropic") {
    return { content: [{ type: "tool_use", id, name, input: args }] };
  }
  return { tool_calls: [{ id, name, arguments: args }] };
}

function providerText(providerId: "workers-ai" | "openai" | "anthropic", text: string) {
  if (providerId === "openai") return { choices: [{ message: { content: text } }] };
  if (providerId === "anthropic") return { content: [{ type: "text", text }] };
  return { response: text };
}

function projectRow(id: string, name: string, slug: string): ProjectRow {
  return {
    id,
    user_id: "owner",
    name,
    slug,
    description: null,
    status: "active",
  };
}

function taskRow(id: string, title: string, projectId: string): TaskRow {
  return {
    id,
    user_id: "owner",
    project_id: projectId,
    title,
    description: null,
    status: "backlog",
    priority: 3,
    due_at: null,
    scheduled_for: null,
    source_ref: null,
    archived_at: null,
  };
}

function createMissionDb(input: { projects?: ProjectRow[]; tasks?: TaskRow[] } = {}) {
  const projects = (input.projects || []).map((row) => ({ ...row }));
  const tasks = (input.tasks || []).map((row) => ({ ...row }));
  const executions: ExecutionRow[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes("FROM agent_tool_executions")) {
                return (executions.find(
                  (row) =>
                    row.user_id === values[0] &&
                    row.request_id === values[1] &&
                    row.tool_call_id === values[2],
                ) || null) as T;
              }
              if (sql.includes("FROM mission_tasks t")) {
                const task = sql.includes("t.source_ref = ?")
                  ? tasks.find(
                      (row) =>
                        row.user_id === values[0] &&
                        row.source_ref === values[1] &&
                        row.archived_at === null,
                    )
                  : tasks.find(
                      (row) =>
                        row.id === values[0] &&
                        row.user_id === values[1] &&
                        row.archived_at === null,
                    );
                return (task ? taskResult(task, projects) : null) as T;
              }
              return null as T;
            },
            async all<T>() {
              if (sql.includes("FROM owner_content_search")) {
                if (sql.includes("MATCH")) return { results: [] as T[] };
                return {
                  results: tasks
                    .filter((row) => row.user_id === values[0] && row.archived_at === null)
                    .map((row) => ({
                      source_type: "mission_task",
                      source_id: row.id,
                      title: row.title,
                      snippet: null,
                      project_id: row.project_id,
                      project_name: projects.find((project) => project.id === row.project_id)?.name || null,
                      status: row.status,
                      source_date: row.due_at,
                      updated_at: "2026-07-15T10:00:00Z",
                    })) as T[],
                };
              }
              if (sql.includes("FROM mission_projects")) {
                return {
                  results: projects.filter(
                    (row) => row.user_id === values[0] && row.status !== "archived",
                  ) as T[],
                };
              }
              if (sql.includes("FROM mission_tasks t")) {
                return {
                  results: tasks
                    .filter((row) => row.user_id === values[0] && row.archived_at === null)
                    .map((row) => taskResult(row, projects)) as T[],
                };
              }
              return { results: [] as T[] };
            },
            async run() {
              if (sql.includes("INSERT OR IGNORE INTO agent_tool_executions")) {
                if (!executions.some(
                  (row) =>
                    row.user_id === values[1] &&
                    row.request_id === values[2] &&
                    row.tool_call_id === values[3],
                )) {
                  executions.push({
                    id: values[0] as string,
                    user_id: values[1] as string,
                    request_id: values[2] as string,
                    tool_call_id: values[3] as string,
                    tool_name: values[4] as string,
                    status: "running",
                    result_json: null,
                    error_message: null,
                  });
                }
              }
              if (sql.includes("UPDATE agent_tool_executions")) {
                const execution = executions.find((row) => row.id === values[1]);
                if (execution && sql.includes("status = 'succeeded'")) {
                  execution.status = "succeeded";
                  execution.result_json = values[0] as string;
                  execution.error_message = null;
                }
                if (execution && sql.includes("status = 'failed'")) {
                  execution.status = "failed";
                  execution.error_message = values[0] as string;
                }
              }
              if (sql.includes("INTO mission_tasks")) {
                if (!tasks.some((row) => row.source_ref && row.source_ref === values[8])) {
                  tasks.push({
                    id: values[0] as string,
                    user_id: values[1] as string,
                    project_id: values[2] as string,
                    title: values[4] as string,
                    description: values[5] as string | null,
                    status: "backlog",
                    priority: values[6] as number,
                    due_at: values[7] as string | null,
                    scheduled_for: null,
                    source_ref: values[8] as string | null,
                    archived_at: null,
                  });
                }
              }
              if (sql.includes("UPDATE mission_tasks") && sql.includes("SET project_id = ?")) {
                const task = tasks.find(
                  (row) => row.id === values[7] && row.user_id === values[8] && !row.archived_at,
                );
                if (task) {
                  task.project_id = values[0] as string;
                  task.title = values[2] as string;
                  task.description = values[3] as string | null;
                  task.status = values[4] as string;
                  task.priority = values[5] as number;
                  task.due_at = values[6] as string | null;
                }
                return { meta: { changes: task ? 1 : 0 } };
              }
              if (sql.includes("UPDATE mission_tasks") && sql.includes("archived_at = datetime")) {
                const task = tasks.find(
                  (row) => row.id === values[0] && row.user_id === values[1] && !row.archived_at,
                );
                if (task) task.archived_at = new Date().toISOString();
                return { meta: { changes: task ? 1 : 0 } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
  return { db, projects, tasks, executions };
}

function taskResult(task: TaskRow, projects: ProjectRow[]) {
  return {
    ...task,
    project_name: projects.find((project) => project.id === task.project_id)?.name || null,
  };
}
