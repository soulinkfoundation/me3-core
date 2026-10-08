import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OPENAI_IMAGE_GENERATION_MODEL,
  DEFAULT_WORKERS_AI_IMAGE_GENERATION_MODEL,
  classifyAssistantImageIntent,
  dispatchAgentSandboxTurn,
  modelSupportsCapability,
  modelSupportsImageInput,
} from "./agent-chat";

type FakeDbState = {
  owner: Record<string, unknown> | null;
  recentMessages: Array<Record<string, unknown>>;
  pluginInstallations: Array<Record<string, unknown>>;
  sites: Array<Record<string, unknown>>;
  siteFiles: Array<Record<string, unknown>>;
  assistantJobs: Array<Record<string, unknown>>;
  contacts: Array<Record<string, unknown>>;
  mailboxAliases: Array<Record<string, unknown>>;
  mailboxMessages: Array<Record<string, unknown>>;
  calendarSources: Array<Record<string, unknown>>;
  channelConnections: Array<Record<string, unknown>>;
  localExecutorPairings: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  calendarEvents: Array<Record<string, unknown>>;
  memory: Array<Record<string, unknown>>;
  missionDashboardSettings: Record<string, unknown> | null;
  wheelSnapshots: Array<Record<string, unknown>>;
  reminders: Array<Record<string, unknown>>;
  bookings: Array<Record<string, unknown>>;
  aiDefaults: Array<Record<string, unknown>>;
  aiCredentials: Array<Record<string, unknown>>;
  assistantAttachments: Array<Record<string, unknown>>;
  assistantMessageAssets: Array<Record<string, unknown>>;
  driveFolders: Array<Record<string, unknown>>;
  driveFiles: Array<Record<string, unknown>>;
  aiUsageEvents: Array<Record<string, unknown>>;
  managedAiPolicy: string | null;
  agentToolExecutions: Array<Record<string, unknown>>;
  queries: string[];
  persistedMessages: Array<{
    id: string;
    ownerId: string;
    role: string;
    content: string;
    metadata_json?: string | null;
  }>;
  failContextLookup?: boolean;
};

function createStorage() {
  const values = new Map<string, unknown>();
  return {
    values,
    async get<T = unknown>(key: string): Promise<T | undefined> {
      return values.get(key) as T | undefined;
    },
    async put<T = unknown>(key: string, value: T): Promise<void> {
      values.set(key, value);
    },
    async delete(key: string | string[]): Promise<void> {
      for (const item of Array.isArray(key) ? key : [key]) values.delete(item);
    },
  };
}

async function encryptStoredProviderKey(
  apiKey: string,
  installKey: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(installKey),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = new Uint8Array(12).fill(7);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(apiKey),
    ),
  );
  const encode = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `v1.${encode(iv)}.${encode(ciphertext)}`;
}

function createR2Bucket() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string | null }>();
  return {
    objects,
    bucket: {
      async get(key: string) {
        const object = objects.get(key);
        if (!object) return null;
        return {
          size: object.bytes.byteLength,
          httpMetadata: { contentType: object.contentType || undefined },
          async arrayBuffer() {
            return object.bytes.buffer.slice(
              object.bytes.byteOffset,
              object.bytes.byteOffset + object.bytes.byteLength,
            );
          },
        };
      },
      async put(
        key: string,
        value: ArrayBuffer | ArrayBufferView | string | null,
        options?: { httpMetadata?: { contentType?: string } },
      ) {
        const bytes =
          typeof value === "string"
            ? new TextEncoder().encode(value)
            : value instanceof ArrayBuffer
              ? new Uint8Array(value)
              : ArrayBuffer.isView(value)
                ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
                : new Uint8Array();
        objects.set(key, {
          bytes,
          contentType: options?.httpMetadata?.contentType || null,
        });
      },
      async delete(key: string | string[]) {
        for (const item of Array.isArray(key) ? key : [key]) {
          objects.delete(item);
        }
      },
    },
  };
}

function createEnv(state: Partial<FakeDbState> = {}) {
  const dbState: FakeDbState = {
    owner: {
      id: "owner",
      email: "owner@example.com",
      name: "Kieran",
      username: "kieran",
      bio: "Builds useful agentic products.",
      timezone: "Europe/Dublin",
    },
    recentMessages: [],
    pluginInstallations: [],
    sites: [],
    siteFiles: [],
    assistantJobs: [],
    contacts: [],
    mailboxAliases: [],
    mailboxMessages: [],
    calendarSources: [],
    channelConnections: [],
    localExecutorPairings: [],
    projects: [],
    tasks: [],
    calendarEvents: [],
    memory: [],
    missionDashboardSettings: null,
    wheelSnapshots: [],
    reminders: [],
    bookings: [],
    aiDefaults: [],
    aiCredentials: [],
    assistantAttachments: [],
    assistantMessageAssets: [],
    driveFolders: [],
    driveFiles: [],
    aiUsageEvents: [],
    managedAiPolicy: null,
    agentToolExecutions: [],
    queries: [],
    persistedMessages: [],
    ...state,
  };

  const db = {
    prepare(sql: string) {
      dbState.queries.push(sql);
      const boundStatement = (values: unknown[]) => ({
        async first<T>() {
          if (sql.includes("FROM owner_profile")) {
            return values[0] === dbState.owner?.id ? (dbState.owner as T) : null;
          }
          if (sql.includes("FROM ai_model_defaults")) {
            const useCase = sql.includes("use_case = 'image_generation'")
              ? "image_generation"
              : sql.includes("use_case = 'reasoning'")
                ? "reasoning"
              : "chat";
            return (dbState.aiDefaults.find(
              (row) => row.user_id === values[0] && row.use_case === useCase,
            ) || null) as T;
          }
          if (sql.includes("FROM ai_provider_credentials")) {
            return (dbState.aiCredentials.find(
              (row) =>
                row.user_id === values[0] && row.provider_id === values[1],
            ) || null) as T;
          }
          if (sql.includes("FROM install_secrets")) {
            return dbState.managedAiPolicy
              ? ({ value: dbState.managedAiPolicy } as T)
              : null;
          }
          if (sql.includes("FROM drive_folders")) {
            return (dbState.driveFolders.find(
              (folder) =>
                folder.owner_id === values[0] &&
                folder.name === values[1] &&
                folder.parent_id === null &&
                folder.status === "active",
            ) || null) as T;
          }
          if (sql.includes("FROM ai_usage_events") && sql.includes("SUM")) {
            return {
              total: dbState.aiUsageEvents.reduce(
                (total, event) =>
                  total + Number(event.estimated_cost_usd || 0),
                0,
              ),
            } as T;
          }
          if (sql.includes("FROM mailbox_aliases")) {
            return (dbState.mailboxAliases.find((alias) => alias.user_id === values[0]) || null) as T;
          }
          if (sql.includes("JOIN site_files")) {
            const site = dbState.sites.find(
              (item) =>
                item.user_id === values[0] &&
                (!item.site_type || item.site_type === "profile"),
            );
            const preferredPaths = sql.includes(
              "sf.path IN ('src/me.json', 'me.json')",
            )
              ? ["src/me.json", "me.json"]
              : ["public/me.json", "src/me.json", "me.json"];
            for (const path of preferredPaths) {
              const file = dbState.siteFiles.find(
                (candidate) =>
                  candidate.site_id === site?.id && candidate.path === path,
              );
              if (file) return file as T;
            }
            return null as T;
          }
          if (sql.includes("FROM site_files")) {
            return (dbState.siteFiles.find(
              (file) => file.site_id === values[0] && file.path === values[1],
            ) || null) as T;
          }
          if (sql.includes("FROM sites")) {
            return (dbState.sites.find(
              (site) =>
                site.user_id === values[0] &&
                (!site.site_type || site.site_type === "profile"),
            ) || null) as T;
          }
          if (sql.includes("FROM calendar_sources")) {
            return (dbState.calendarSources.find(
              (source) => source.user_id === values[0] && source.status === "active",
            ) || null) as T;
          }
          if (sql.includes("FROM agent_channel_connections")) {
            const requestedChannel = sql.includes("channel = 'telegram'")
              ? "telegram"
              : sql.includes("channel = 'soulink'")
                ? "soulink"
                : null;
            return (dbState.channelConnections.find(
              (connection) =>
                connection.user_id === values[0] &&
                (!requestedChannel || connection.channel === requestedChannel) &&
                connection.status === "active",
            ) || null) as T;
          }
          if (sql.includes("FROM local_executor_pairings")) {
            return (dbState.localExecutorPairings.find(
              (pairing) => pairing.user_id === values[0] && pairing.status === "active",
            ) || null) as T;
          }
          if (sql.includes("FROM mission_dashboard_settings")) {
            return values[0] === "owner" ? (dbState.missionDashboardSettings as T) : null;
          }
          if (sql.includes("FROM mission_wheel_snapshots")) {
            return (dbState.wheelSnapshots.find((snapshot) => snapshot.user_id === values[0]) || null) as T;
          }
          if (sql.includes("FROM mailbox_messages")) {
            if (sql.includes("agent_idempotency_key = ?")) {
              return (dbState.mailboxMessages.find(
                (message) =>
                  message.mailbox_id === values[0] &&
                  message.agent_idempotency_key === values[1],
              ) || null) as T;
            }
            if (sql.includes("WHERE id = ? AND mailbox_id = ?")) {
              return (dbState.mailboxMessages.find(
                (message) => message.id === values[0] && message.mailbox_id === values[1],
              ) || null) as T;
            }
            return (dbState.mailboxMessages.find(
              (message) => message.mailbox_id === values[0],
            ) || null) as T;
          }
          if (sql.includes("FROM user_reminders")) {
            if (sql.includes("WHERE id = ? AND user_id = ?")) {
              return (dbState.reminders.find(
                (reminder) =>
                  reminder.id === values[0] &&
                  reminder.user_id === values[1] &&
                  (reminder.status === "pending" || reminder.status === "failed"),
              ) || null) as T;
            }
            return (dbState.reminders.find(
              (reminder) =>
                reminder.user_id === values[0] &&
                reminder.source_dispatch_id === values[1],
            ) || null) as T;
          }
          if (sql.includes("FROM mission_tasks t")) {
            const task = sql.includes("t.source_ref = ?")
              ? dbState.tasks.find(
                  (item) =>
                    item.user_id === values[0] &&
                    item.source_ref === values[1] &&
                    !item.archived_at,
                )
              : sql.includes("WHERE t.user_id = ? AND t.id = ?")
                ? dbState.tasks.find(
                    (item) =>
                      item.user_id === values[0] &&
                      item.id === values[1] &&
                      !item.archived_at,
                  )
              : dbState.tasks.find(
                  (item) =>
                    item.id === values[0] &&
                    item.user_id === values[1] &&
                    !item.archived_at,
                );
            return (task
              ? {
                  ...task,
                  project_name:
                    dbState.projects.find((project) => project.id === task.project_id)
                      ?.name || null,
                }
              : null) as T;
          }
          if (sql.includes("FROM agent_tool_executions")) {
            return (dbState.agentToolExecutions.find(
              (execution) =>
                execution.user_id === values[0] &&
                execution.request_id === values[1] &&
                execution.tool_call_id === values[2],
            ) || null) as T;
          }
          return null;
        },
        async all<T>() {
          if (dbState.failContextLookup && sql.includes("FROM mission_projects")) {
            throw new Error("owner snapshot unavailable");
          }
          if (sql.includes("FROM assistant_messages")) {
            return { results: dbState.recentMessages as T[] };
          }
          if (sql.includes("FROM plugin_installations")) {
            return { results: dbState.pluginInstallations as T[] };
          }
          if (sql.includes("FROM assistant_jobs")) {
            return { results: dbState.assistantJobs as T[] };
          }
          if (sql.includes("FROM contacts")) {
            return { results: dbState.contacts as T[] };
          }
          if (sql.includes("FROM mailbox_messages")) {
            return { results: dbState.mailboxMessages as T[] };
          }
          if (sql.includes("FROM mission_projects")) {
            return {
              results: dbState.projects.map((project) => ({
                ...project,
                open_task_count: dbState.tasks.filter(
                  (task) =>
                    task.project_id === project.id &&
                    !task.archived_at &&
                    task.status !== "done" &&
                    task.status !== "cancelled",
                ).length,
              })) as T[],
            };
          }
          if (sql.includes("FROM mission_tasks")) {
            if (sql.includes("LEFT JOIN mission_projects")) {
              return {
                results: dbState.tasks
                  .filter((task) => !task.archived_at)
                  .map((task) => ({
                    ...task,
                    project_name:
                      dbState.projects.find((project) => project.id === task.project_id)
                        ?.name || null,
                  })) as T[],
              };
            }
            return { results: dbState.tasks as T[] };
          }
          if (sql.includes("FROM user_calendar_events")) {
            return { results: dbState.calendarEvents as T[] };
          }
          if (sql.includes("FROM user_reminders")) {
            const minimumRemindAt = sql.includes("remind_at >= ?")
              ? String(values[1])
              : null;
            return {
              results: dbState.reminders.filter(
                (reminder) =>
                  !minimumRemindAt || String(reminder.remind_at) >= minimumRemindAt,
              ) as T[],
            };
          }
          if (sql.includes("FROM bookings b")) {
            return { results: dbState.bookings as T[] };
          }
          if (sql.includes("FROM sites")) {
            return {
              results: dbState.sites.filter(
                (site) =>
                  site.user_id === values[0] &&
                  (!site.site_type || site.site_type === "profile"),
              ) as T[],
            };
          }
          if (sql.includes("FROM mission_private_memory")) {
            return { results: dbState.memory as T[] };
          }
          return { results: [] as T[] };
        },
        async run() {
          if (sql.includes("INSERT INTO assistant_messages")) {
            const hasThreadId = sql.includes("thread_id");
            const hasMetadata = sql.includes("metadata_json");
            dbState.persistedMessages.push({
              id: values[0] as string,
              ownerId: values[1] as string,
              role: values[2] as string,
              content: values[3] as string,
              metadata_json: hasMetadata ? (values[hasThreadId ? 5 : 4] as string) : null,
            });
          }
          if (sql.includes("INSERT INTO assistant_attachments")) {
            dbState.assistantAttachments.push({
              id: values[0],
              owner_id: values[1],
              thread_id: values[2],
              filename: values[3],
              mime_type: values[4],
              size: values[5],
              storage_key: values[6],
              metadata_json: values[7],
            });
          }
          if (sql.includes("INSERT INTO assistant_message_assets")) {
            dbState.assistantMessageAssets.push({
              id: values[0],
              owner_id: values[1],
              thread_id: values[2],
              message_id: values[3],
              attachment_id: values[4],
              role: values[5],
              display_order: values[6],
              metadata_json: values[7],
            });
          }
          if (sql.includes("INSERT INTO drive_folders")) {
            dbState.driveFolders.push({
              id: values[0],
              owner_id: values[1],
              parent_id: null,
              name: values[2],
              path: values[3],
              status: "active",
            });
          }
          if (sql.includes("INSERT INTO drive_files")) {
            dbState.driveFiles.push({
              id: values[0],
              owner_id: values[1],
              folder_id: values[2],
              filename: values[3],
              mime_type: values[4],
              size: values[5],
              storage_key: values[6],
              sha256: values[7],
              status: "ready",
              preview_kind: "image",
              metadata_json: values[8],
            });
          }
          if (sql.includes("INSERT INTO ai_usage_events")) {
            dbState.aiUsageEvents.push({
              id: values[0],
              user_id: values[1],
              provider: values[2],
              model: values[3],
              tokens_in: values[4],
              tokens_out: values[5],
              estimated_cost_usd: values[6],
              metadata_json: values[7],
              created_at: values[8],
            });
          }
          if (sql.includes("INTO user_reminders")) {
            const duplicate = dbState.reminders.some(
              (reminder) =>
                values[7] &&
                reminder.user_id === values[1] &&
                reminder.source_dispatch_id === values[7],
            );
            if (!duplicate) dbState.reminders.push({
              id: values[0],
              user_id: values[1],
              title: values[2],
              notes: values[3],
              remind_at: values[4],
              timezone: values[5],
              recurrence_rule: values[6],
              source_dispatch_id: values[7],
              status: "pending",
              created_at: new Date().toISOString(),
            });
          }
          if (sql.includes("INSERT OR IGNORE INTO agent_tool_executions")) {
            const duplicate = dbState.agentToolExecutions.some(
              (execution) =>
                execution.user_id === values[1] &&
                execution.request_id === values[2] &&
                execution.tool_call_id === values[3],
            );
            if (!duplicate) {
              dbState.agentToolExecutions.push({
                id: values[0],
                user_id: values[1],
                request_id: values[2],
                tool_call_id: values[3],
                tool_name: values[4],
                status: "running",
                result_json: null,
                error_message: null,
              });
            }
          }
          if (sql.includes("UPDATE agent_tool_executions")) {
            const execution = dbState.agentToolExecutions.find(
              (item) => item.id === values[1],
            );
            if (execution && sql.includes("status = 'succeeded'")) {
              execution.status = "succeeded";
              execution.result_json = values[0];
              execution.error_message = null;
            }
            if (execution && sql.includes("status = 'failed'")) {
              execution.status = "failed";
              execution.error_message = values[0];
            }
          }
          if (sql.includes("UPDATE user_reminders") && sql.includes("SET title = ?")) {
            const reminder = dbState.reminders.find(
              (item) =>
                item.id === values[5] &&
                item.user_id === values[6] &&
                (item.status === "pending" || item.status === "failed"),
            );
            if (reminder) {
              reminder.title = values[0];
              reminder.notes = values[1];
              reminder.remind_at = values[2];
              reminder.timezone = values[3];
              reminder.recurrence_rule = values[4];
              reminder.status = "pending";
            }
            return { meta: { changes: reminder ? 1 : 0 } };
          }
          if (sql.includes("UPDATE user_reminders") && sql.includes("status = 'cancelled'")) {
            const reminder = dbState.reminders.find(
              (item) =>
                item.id === values[0] &&
                item.user_id === values[1] &&
                (item.status === "pending" || item.status === "failed"),
            );
            if (reminder) reminder.status = "cancelled";
            return { meta: { changes: reminder ? 1 : 0 } };
          }
          if (sql.includes("INTO mailbox_messages")) {
            const duplicate = dbState.mailboxMessages.some(
              (message) =>
                values[9] &&
                message.mailbox_id === values[1] &&
                message.agent_idempotency_key === values[9],
            );
            if (!duplicate) dbState.mailboxMessages.push({
              id: values[0],
              mailbox_id: values[1],
              direction: "outbound",
              message_kind: "draft",
              status: "pending_approval",
              thread_key: values[2],
              provider_id: null,
              provider_message_id: null,
              from_address: values[3],
              to_address: values[4],
              subject: values[5],
              text_body: values[6],
              html_body: values[7],
              raw_headers_json: null,
              raw_message: null,
              metadata_json: values[8],
              agent_idempotency_key: values[9],
              source_id: values[10],
              folder: "drafts",
              read_at: null,
              agent_summary: null,
              agent_labels_json: null,
              forwarded_to: null,
              error_message: null,
              created_by: values[11],
              approved_by_user_id: null,
              received_at: null,
              approved_at: null,
              sent_at: null,
              created_at: values[12],
            });
          }
          if (sql.includes("INTO mission_tasks")) {
            const duplicate = dbState.tasks.some(
              (task) =>
                values[8] &&
                task.user_id === values[1] &&
                task.source_ref === values[8],
            );
            if (!duplicate) dbState.tasks.push({
              id: values[0],
              user_id: values[1],
              project_id: values[2],
              column_id: values[3],
              title: values[4],
              description: values[5],
              status: "backlog",
              priority: values[6],
              due_at: values[7],
              scheduled_for: null,
              source_kind: "agent",
              source_ref: values[8],
              approval_id: null,
              metadata_json: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              archived_at: null,
            });
          }
          if (sql.includes("UPDATE mission_tasks") && sql.includes("SET project_id = ?")) {
            const task = dbState.tasks.find(
              (item) => item.id === values[7] && item.user_id === values[8],
            );
            if (task) {
              task.project_id = values[0];
              task.column_id = values[1];
              task.title = values[2];
              task.description = values[3];
              task.status = values[4];
              task.priority = values[5];
              task.due_at = values[6];
              task.updated_at = new Date().toISOString();
            }
          }
          if (sql.includes("UPDATE mission_tasks") && sql.includes("archived_at = datetime")) {
            const task = dbState.tasks.find(
              (item) => item.id === values[0] && item.user_id === values[1],
            );
            if (task) {
              task.archived_at = new Date().toISOString();
              task.updated_at = new Date().toISOString();
            }
          }
          if (sql.includes("INSERT INTO site_files")) {
            const content = toSiteFileBytes(values[2]);
            const file = {
              site_id: values[0],
              path: values[1],
              content,
              content_type: values[3],
              size: values[4],
              sha256: values[5],
              updated_at: new Date().toISOString(),
            };
            const existingIndex = dbState.siteFiles.findIndex(
              (entry) => entry.site_id === file.site_id && entry.path === file.path,
            );
            if (existingIndex >= 0) dbState.siteFiles[existingIndex] = file;
            else dbState.siteFiles.push(file);
          }
          if (sql.includes("DELETE FROM site_files")) {
            dbState.siteFiles = dbState.siteFiles.filter(
              (file) => !(file.site_id === values[0] && file.path === values[1]),
            );
          }
          return { meta: { changes: 1 } };
        },
      });

      return {
        bind(...values: unknown[]) {
          return boundStatement(values);
        },
        first<T>() {
          return boundStatement([]).first<T>();
        },
        all<T>() {
          return boundStatement([]).all<T>();
        },
      };
    },
  };

  return {
    DB: db,
    CORE_API_ORIGIN: "https://core.example.com",
    ME3_DEPLOYMENT_MODE: "self_hosted",
    state: dbState,
  };
}

function toSiteFileBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new TextEncoder().encode(String(value ?? ""));
}

function siteFileText(files: Array<Record<string, unknown>>, path: string): string | null {
  const file = files.find((entry) => entry.path === path);
  const content = file?.content;
  if (typeof content === "string") return content;
  if (content instanceof Uint8Array) return new TextDecoder().decode(content);
  if (content instanceof ArrayBuffer) return new TextDecoder().decode(content);
  if (ArrayBuffer.isView(content)) return new TextDecoder().decode(content);
  return null;
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function dispatchInput(messageText: string) {
  return {
    userId: "owner",
    requestId: crypto.randomUUID(),
    connectionId: "connection-1",
    sourceEventId: "event-1",
    turnId: crypto.randomUUID(),
    messageText,
  };
}

function workersAiSequence(...responses: unknown[]) {
  const pending = [...responses];
  return vi.fn(async () => pending.shift());
}

describe("Core chat native context", () => {
  it("keeps only the 32 most recent turn results in Durable Object storage", async () => {
    const storage = createStorage();
    const env = createEnv();

    for (let index = 0; index < 33; index += 1) {
      await dispatchAgentSandboxTurn(
        env,
        storage,
        {
          ...dispatchInput(`Turn ${index}`),
          requestId: `request-${index}`,
        },
      );
    }

    const resultKeys = [...storage.values.keys()].filter((key) =>
      key.startsWith("agent-chat:sandbox:result:"),
    );
    expect(resultKeys).toHaveLength(32);
    expect(resultKeys).not.toContain("agent-chat:sandbox:result:request-0");
    expect(resultKeys).toContain("agent-chat:sandbox:result:request-32");
  });

  it("adds only the compact owner snapshot to model prompts", async () => {
    const aiRun = vi.fn(async (_model: string, _input: unknown) => ({
      response: "Context-aware reply.",
    }));
    const env = createEnv({
      recentMessages: [
        {
          role: "user",
          content: "Previous note about Ada.",
        },
      ],
      contacts: [
        contactRow("contact-ada", "Ada Lovelace", "ada@example.com", "client"),
        contactRow("contact-grace", "Grace Hopper", "grace@example.com", "contact"),
      ],
      mailboxMessages: [
        mailboxRow({
          id: "message-ada",
          threadKey: "thread-ada",
          from: "ada@example.com",
          subject: "Workflow notes",
          body: "Ada asked for a crisp update on the analytics workflow.",
          metadata: { projectId: "project-analytics" },
        }),
      ],
      sites: [profileSiteRow("site-profile", "kieran", { published: true })],
      missionDashboardSettings: {
        ...missionDashboardSettingsRow("Legacy Mission"),
        settings_json: JSON.stringify({
          goals: [
            { id: "goal-active", title: "Ship the calm workflow", status: "active" },
            { id: "goal-done", title: "Finished already", status: "completed" },
          ],
        }),
      },
      siteFiles: [
        siteMeJsonRow("site-profile", {
          business: {
            audience: "Founders building calmer agent products",
          },
        }),
        siteMeJsonRow(
          "site-profile",
          {
            business: {
              audience: "founders building agent products",
              primaryProblem: "overwhelming workflows",
              solution: "designing calmer systems",
            },
          },
          "src/me.json",
        ),
      ],
      projects: [
        projectRow("project-analytics", "Analytics Workflow", "analytics-workflow"),
        projectRow("project-compiler", "Compiler Notes", "compiler-notes"),
      ],
      tasks: [
        taskRow("task-ada", "Send Ada workflow update", "project-analytics"),
        taskRow("task-grace", "Review compiler paper", "project-compiler"),
      ],
      memory: [
        memoryRow(
          "memory-ada",
          "relationship_note",
          "Ada likes short, practical email replies.",
          "contact",
          "contact-ada",
        ),
      ],
    });

    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun }, ME3_ASSISTANT_DEBUG_TRACE: "true" } as never,
      createStorage(),
      dispatchInput("Help me reply to Ada about the workflow notes."),
    );

    expect(response.replyText).toBe("Context-aware reply.");
    expect(response.contextPacketId).toBe("agent-context:owner:chat_reply");
    expect(response.contextSummary).toContain("Used context from:");
    expect(response.contextManifest?.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "owner", kind: "owner_profile" }),
        expect.objectContaining({
          id: "project-analytics",
          kind: "project",
          reason: "Project metadata; 1 open task.",
        }),
        expect.objectContaining({ id: "owner-me-json", kind: "public_me_json" }),
      ]),
    );
    const modelInput = aiRun.mock.calls[0]?.[1] as unknown as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = modelInput.messages[0]?.content || "";

    expect(system).toContain("ME3 owner snapshot:");
    expect(system).toContain(
      "Mission statement:\n- I help founders building agent products with overwhelming workflows by designing calmer systems.",
    );
    expect(system).toContain("Goals:\n- Ship the calm workflow");
    expect(system).not.toContain("Finished already");
    expect(system).toContain('"audience":"Founders building calmer agent products"');
    expect(system).toContain(
      "Analytics Workflow: Analytics Workflow project context. Open tasks: 1.",
    );
    expect(system).toContain(
      "Compiler Notes: Compiler Notes project context. Open tasks: 1.",
    );
    expect(system).not.toContain("Ada Lovelace");
    expect(system).not.toContain("Workflow notes");
    expect(system).not.toContain("Send Ada workflow update");
    expect(system).not.toContain("relationship_note");
    expect(response.contextManifest?.sources).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "assistant_message" }),
        expect.objectContaining({ kind: "contact" }),
        expect.objectContaining({ kind: "email_thread" }),
        expect.objectContaining({ kind: "task" }),
      ]),
    );
    expect(response.trace?.context).toMatchObject({
      status: "loaded",
      characterCount: expect.any(Number),
      loadDurationMs: expect.any(Number),
    });
    expect(response.trace?.context.characterCount).toBeGreaterThan(0);
    expect(env.state.queries.some((sql) => sql.includes("FROM assistant_jobs"))).toBe(false);
    expect(env.state.queries.some((sql) => sql.includes("FROM calendar_sources"))).toBe(false);
    expect(env.state.queries.some((sql) => sql.includes("FROM plugin_installations"))).toBe(false);
  });

  it("falls back to current chat behavior when context lookup fails", async () => {
    const aiRun = vi.fn(async (_model: string, _input: unknown) => ({
      response: "Plain reply.",
    }));
    const env = createEnv({
      failContextLookup: true,
      contacts: [contactRow("contact-ada", "Ada Lovelace", "ada@example.com", "client")],
    });

    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun } } as never,
      createStorage(),
      dispatchInput("Help me reply to Ada."),
    );

    expect(response.replyText).toBe("Plain reply.");
    expect(response.contextPacketId).toBeNull();
    expect(response.contextManifest).toBeNull();
    expect(response.contextSummary).toBeNull();
    const modelInput = aiRun.mock.calls[0]?.[1] as unknown as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(modelInput.messages[0]?.content).toContain(
      'Your assistant display name is "ME3".',
    );
    expect(modelInput.messages[0]?.content).not.toContain("ME3 agent context packet:");
  });

  it("places the stable ME3 character before dynamic owner instructions", async () => {
    const aiRun = vi.fn(async (_model: string, _input: unknown) => ({
      response: "I am ME3.",
    }));
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun } } as never,
      createStorage(),
      dispatchInput("What are you?"),
    );

    expect(response.replyText).toBe("I am ME3.");
    const modelInput = aiRun.mock.calls[0]?.[1] as unknown as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = modelInput.messages[0]?.content || "";

    expect(system).toContain("ME3 base character:");
    expect(system).toContain("super-intelligent search-and-rescue working dog");
    expect(system).toContain("ME3 has no authority over the owner's inner life.");
    expect(system).toContain(
      "ME3 is not a recommended source for it",
    );
    expect(system).toContain(
      "Never claim consciousness, feelings, a soul, human identity, or a reciprocal emotional relationship",
    );
    expect(system.indexOf("ME3 base character:")).toBeLessThan(
      system.indexOf('Your assistant display name is "ME3".'),
    );
  });

  it("uses the owner's custom assistant name in model instructions", async () => {
    const aiRun = vi.fn(async (_model: string, _input: unknown) => ({
      response: "Named reply.",
    }));
    const env = createEnv({
      owner: {
        id: "owner",
        email: "owner@example.com",
        name: "Kieran",
        username: "kieran",
        bio: "Builds useful agentic products.",
        timezone: "Europe/Dublin",
        assistant_name: "Atlas",
      },
    });

    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun } } as never,
      createStorage(),
      dispatchInput("What's your name?"),
    );

    expect(response.replyText).toBe("Named reply.");
    const modelInput = aiRun.mock.calls[0]?.[1] as unknown as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(modelInput.messages[0]?.content).toContain(
      'Your assistant display name is "Atlas".',
    );
    expect(modelInput.messages[0]?.content).toContain(
      "If asked who you are or what your name is, use the assistant display name.",
    );
  });

  it("answers model identity from runtime configuration without asking the model", async () => {
    const aiRun = vi.fn(async () => ({ response: "This should not be used." }));
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        ME3_AI_CHAT_MODEL: "moonshotai/kimi-k3",
        ME3_AI_CHAT_BACKUP_MODEL: "zai-org/glm-4.7-flash",
      } as never,
      createStorage(),
      dispatchInput("What model are we using?"),
    );

    expect(response).toMatchObject({
      source: "tool",
      specialist: "core.agent-chat.conversation",
      model: null,
    });
    expect(response.replyText).toContain("moonshotai/kimi-k3");
    expect(response.replyText).toContain("zai-org/glm-4.7-flash");
    expect(aiRun).not.toHaveBeenCalled();
  });

  it("does not preload the contact directory outside the owner snapshot", async () => {
    const aiRun = vi.fn(async (_model: string, _input: unknown) => ({
      response: "Contacts require a dedicated read.",
    }));
    const env = createEnv({
      contacts: [
        contactRow("contact-ada", "Ada Lovelace", "ada@example.com", "client"),
        contactRow("contact-grace", "Grace Hopper", "grace@example.com", "contact"),
        contactRow("contact-mina", "Mina Murray", "mina@example.com", "prospect"),
      ],
    });

    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun } } as never,
      createStorage(),
      dispatchInput("Can you list the contacts I have?"),
    );

    expect(response.replyText).toBe("Contacts require a dedicated read.");
    expect(response.contextSummary).toContain("1 owner profile");
    expect(response.contextManifest?.sources).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "contact" })]),
    );
    const modelInput = aiRun.mock.calls[0]?.[1] as unknown as {
      messages: Array<{ role: string; content: string }>;
    };
    const system = modelInput.messages[0]?.content || "";

    expect(system).not.toContain("Ada Lovelace");
    expect(system).not.toContain("Grace Hopper");
    expect(system).not.toContain("Mina Murray");
  });

  it("extracts Workers AI chat-completion shaped replies", async () => {
    const aiRun = vi.fn(async () => ({
      choices: [{ message: { content: "Choice-shaped reply." } }],
    }));
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun } } as never,
      createStorage(),
      dispatchInput("Are you working?"),
    );

    expect(response).toMatchObject({
      mode: "everyday",
      replyText: "Choice-shaped reply.",
      model: "@cf/zai-org/glm-4.7-flash",
      source: "workers-ai",
    });
  });

  it("resolves everyday through the configured chat route", async () => {
    const aiRun = vi.fn(async () => ({ response: "Everyday reply." }));
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        ME3_AI_CHAT_MODEL: "@cf/example/everyday-model",
        ME3_AI_REASONING_MODEL: "@cf/example/advanced-model",
      } as never,
      createStorage(),
      { ...dispatchInput("Use Everyday."), mode: "everyday" },
    );

    expect(response).toMatchObject({
      mode: "everyday",
      model: "@cf/example/everyday-model",
      replyText: "Everyday reply.",
    });
    expect(aiRun).toHaveBeenCalledWith(
      "@cf/example/everyday-model",
      expect.any(Object),
      expect.objectContaining({ gateway: expect.objectContaining({ id: "default" }) }),
    );
  });

  it("resolves advanced through the configured reasoning route", async () => {
    const aiRun = vi.fn(async () => ({ response: "Advanced reply." }));
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        ME3_AI_CHAT_MODEL: "@cf/example/everyday-model",
        ME3_AI_REASONING_MODEL: "@cf/example/advanced-model",
      } as never,
      createStorage(),
      { ...dispatchInput("Use Advanced."), mode: "advanced" },
    );

    expect(response).toMatchObject({
      mode: "advanced",
      model: "@cf/example/advanced-model",
      replyText: "Advanced reply.",
    });
    expect(aiRun).toHaveBeenCalledWith(
      "@cf/example/advanced-model",
      expect.any(Object),
      expect.objectContaining({ gateway: expect.objectContaining({ id: "default" }) }),
    );
  });

  it("uses the selected Workers AI model when provided", async () => {
    const aiRun = vi.fn(async () => ({
      response: "Selected model reply.",
    }));
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        ME3_DEPLOYMENT_MODE: "self_hosted",
      } as never,
      createStorage(),
      {
        ...dispatchInput("Use this model."),
        mode: "everyday",
        selectedModel: {
          providerId: "workers-ai",
          model: "@cf/example/selected-model",
          optionId: "workers-selected",
        },
      },
    );

    expect(response).toMatchObject({
      mode: "everyday",
      replyText: "Selected model reply.",
      model: "@cf/example/selected-model",
      source: "workers-ai",
    });
    expect(aiRun).toHaveBeenCalledWith(
      "@cf/example/selected-model",
      expect.any(Object),
      expect.objectContaining({ gateway: expect.objectContaining({ id: "default" }) }),
    );
  });

  it("ignores owner-controlled model choices for managed everyday turns", async () => {
    const aiRun = vi.fn(async () => ({ response: "Managed Everyday reply." }));
    const env = createEnv({
      aiDefaults: [
        {
          user_id: "owner",
          use_case: "chat",
          provider_id: "workers-ai",
          model: "@cf/example/stored-owner-model",
        },
      ],
    });

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        ME3_DEPLOYMENT_MODE: "managed",
        ME3_AI_CHAT_PROVIDER: "workers-ai",
        ME3_AI_CHAT_MODEL: "@cf/example/managed-everyday-model",
      } as never,
      createStorage(),
      {
        ...dispatchInput("Use managed Everyday."),
        mode: "everyday",
        selectedModel: {
          providerId: "workers-ai",
          model: "@cf/example/raw-client-model",
        },
      },
    );

    expect(response.model).toBe("openai/gpt-5.4-mini");
    expect(aiRun).toHaveBeenCalledWith(
      "openai/gpt-5.4-mini",
      expect.objectContaining({ reasoning_effort: "none" }),
      {
        gateway: {
          id: "default",
          metadata: expect.objectContaining({
            me3_request_id: expect.any(String),
            me3_turn_id: expect.any(String),
            me3_mode: "everyday",
            me3_tool_count: expect.any(Number),
            me3_input_chars: expect.any(Number),
          }),
          requestTimeoutMs: 6_000,
          retries: { maxAttempts: 1 },
        },
      },
    );
  });

  it("uses the managed default model cached from the control plane", async () => {
    const aiRun = vi.fn(async () => ({
      content: [{ type: "text", text: "Managed Claude reply." }],
    }));
    const env = createEnv({
      managedAiPolicy: JSON.stringify({
        defaultModel: "anthropic/claude-sonnet-4.6",
        overagesEnabled: false,
        monthlyMaximumCents: 500,
      }),
    });

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        ME3_DEPLOYMENT_MODE: "managed",
      } as never,
      createStorage(),
      { ...dispatchInput("Use my managed default."), mode: "everyday" },
    );

    expect(response.model).toBe("anthropic/claude-sonnet-4.6");
    expect(aiRun).toHaveBeenCalledWith(
      "anthropic/claude-sonnet-4.6",
      expect.objectContaining({ max_tokens: 800 }),
      {
        gateway: {
          id: "default",
          metadata: expect.objectContaining({
            me3_request_id: expect.any(String),
            me3_turn_id: expect.any(String),
            me3_mode: "everyday",
            me3_tool_count: expect.any(Number),
            me3_input_chars: expect.any(Number),
          }),
          requestTimeoutMs: 6_000,
          retries: { maxAttempts: 1 },
        },
      },
    );
  });

  it("maps the normalized managed GLM choice to its Workers AI runtime ID", async () => {
    const aiRun = vi.fn(async () => ({ response: "Managed GLM reply." }));
    const env = createEnv({
      managedAiPolicy: JSON.stringify({
        defaultModel: "zai-org/glm-4.7-flash",
        overagesEnabled: false,
        monthlyMaximumCents: 500,
      }),
    });

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        ME3_DEPLOYMENT_MODE: "managed",
        CLOUDFLARE_ACCOUNT_ID: "managed-account",
        CLOUDFLARE_AI_GATEWAY_ID: "managed-gateway",
        CLOUDFLARE_API_TOKEN: "managed-gateway-token",
      } as never,
      createStorage(),
      { ...dispatchInput("Use my managed default."), mode: "everyday" },
    );

    expect(response.model).toBe("@cf/zai-org/glm-4.7-flash");
    expect(aiRun).toHaveBeenCalledWith(
      "@cf/zai-org/glm-4.7-flash",
      expect.any(Object),
      {
        gateway: {
          id: "managed-gateway",
          metadata: expect.objectContaining({
            me3_request_id: expect.any(String),
            me3_turn_id: expect.any(String),
            me3_mode: "everyday",
            me3_tool_count: expect.any(Number),
            me3_input_chars: expect.any(Number),
          }),
          requestTimeoutMs: 6_000,
          retries: { maxAttempts: 1 },
        },
      },
    );
  });

  it("switches the managed default to the backup after the included allowance", async () => {
    const aiRun = vi.fn(async () => ({ response: "Allowance fallback reply." }));
    const env = createEnv({
      aiUsageEvents: [{ estimated_cost_usd: 5 }],
    });

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        ME3_DEPLOYMENT_MODE: "managed",
        ME3_AI_CHAT_PROVIDER: "workers-ai",
        ME3_AI_CHAT_MODEL: "moonshotai/kimi-k3",
        ME3_AI_CHAT_BACKUP_MODEL: "@cf/zai-org/glm-4.7-flash",
      } as never,
      createStorage(),
      { ...dispatchInput("Use managed Everyday."), mode: "everyday" },
    );

    expect(response).toMatchObject({
      model: "@cf/zai-org/glm-4.7-flash",
      replyText: "Allowance fallback reply.",
    });
    expect(aiRun).toHaveBeenCalledWith(
      "@cf/zai-org/glm-4.7-flash",
      expect.any(Object),
      {
        gateway: {
          id: "default",
          metadata: expect.objectContaining({
            me3_request_id: expect.any(String),
            me3_turn_id: expect.any(String),
            me3_mode: "everyday",
            me3_tool_count: expect.any(Number),
            me3_input_chars: expect.any(Number),
          }),
          requestTimeoutMs: 6_000,
          retries: { maxAttempts: 1 },
        },
      },
    );
  });

  it("routes owner mode through the install's Cloudflare binding", async () => {
    const installKey = "owner-mode-install-key";
    const ownerApiKey = "sk-owner-stored";
    const fetchMock = vi.fn();
    const aiRun = vi.fn(async () => ({ choices: [{ message: { content: "Owner AI reply." } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const env = createEnv({
      aiDefaults: [
        {
          user_id: "owner",
          use_case: "chat",
          provider_id: "openai",
          model: "gpt-owner-model",
        },
      ],
      aiCredentials: [
        {
          user_id: "owner",
          provider_id: "openai",
          encrypted_api_key: await encryptStoredProviderKey(ownerApiKey, installKey),
        },
      ],
    });

    try {
      const response = await dispatchAgentSandboxTurn(
        {
          ...env,
          AI: { run: aiRun },
          TOKEN_ENCRYPTION_KEY: installKey,
          OPENAI_API_KEY: "sk-managed-platform",
          CLOUDFLARE_ACCOUNT_ID: "managed-account",
          CLOUDFLARE_AI_GATEWAY_ID: "managed-gateway",
          CLOUDFLARE_API_TOKEN: "managed-gateway-token",
          ME3_DEPLOYMENT_MODE: "managed",
        } as never,
        createStorage(),
        { ...dispatchInput("Use my AI."), mode: "owner" },
      );
      expect(response).toMatchObject({
        mode: "owner",
        model: "openai/gpt-owner-model",
        source: "workers-ai",
        replyText: "Owner AI reply.",
      });
      expect(aiRun).toHaveBeenCalledWith("openai/gpt-owner-model", expect.any(Object),
        expect.objectContaining({ gateway: expect.objectContaining({ id: "managed-gateway" }) }));
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not treat an environment provider key as owner BYOK", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const env = createEnv({
      aiDefaults: [
        {
          user_id: "owner",
          use_case: "chat",
          provider_id: "openai",
          model: "gpt-owner-model",
        },
      ],
    });

    try {
      const response = await dispatchAgentSandboxTurn(
        { ...env, OPENAI_API_KEY: "sk-managed-platform" } as never,
        createStorage(),
        { ...dispatchInput("Use my AI."), mode: "owner" },
      );

      expect(response).toMatchObject({
        mode: "owner",
        source: "fallback",
        fallbackReason: "AI provider setup required",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("passes ready image attachments to selected Workers AI vision models", async () => {
    const imageStorageKey = "assistant/owner/thread-1/image.png";
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const r2 = createR2Bucket();
    await r2.bucket.put(imageStorageKey, imageBytes, {
      httpMetadata: { contentType: "image/png" },
    });
    const aiRun = vi.fn(async (_model: string, _input: unknown) => ({
      response: "Image reply.",
    }));
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        SITE_ASSETS: r2.bucket,
      } as never,
      createStorage(),
      {
        ...dispatchInput("What is in this image?"),
        selectedModel: {
          providerId: "workers-ai",
          model: "@cf/moonshotai/kimi-k2.7-code",
          optionId: "workers-kimi-k2-7",
        },
        attachments: [
          {
            id: "attachment-image",
            name: "image.png",
            mimeType: "image/png",
            size: imageBytes.byteLength,
            kind: "image",
            status: "ready",
            storageKey: imageStorageKey,
            hasText: false,
            textTruncated: false,
          },
        ],
      },
    );

    expect(modelSupportsImageInput("workers-ai", "@cf/moonshotai/kimi-k2.7-code")).toBe(
      true,
    );
    expect(response).toMatchObject({
      replyText: "Image reply.",
      model: "@cf/moonshotai/kimi-k2.7-code",
      source: "workers-ai",
    });
    expect(aiRun).toHaveBeenCalledWith(
      "@cf/moonshotai/kimi-k2.7-code",
      expect.objectContaining({
        image: "data:image/png;base64,iVBORw==",
        messages: expect.any(Array),
      }),
      expect.objectContaining({ gateway: expect.objectContaining({ id: "default" }) }),
    );
    const modelInput = aiRun.mock.calls[0]?.[1] as {
      messages: Array<{ role: string; content: string }>;
      image?: string;
    };
    expect(modelInput.messages.at(-1)?.content).toContain(
      "Assistant attachment references",
    );
    expect(modelInput.messages.at(-1)?.content).toContain("image.png");
  });

  it("passes managed Kimi K3 images as Chat Completions content parts", async () => {
    const imageStorageKey = "assistant/owner/thread-1/kimi-image.png";
    const imageBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const r2 = createR2Bucket();
    await r2.bucket.put(imageStorageKey, imageBytes, {
      httpMetadata: { contentType: "image/png" },
    });
    const aiRun = vi.fn(async (_model: string, _input: unknown) => ({
      response: "Kimi can see the image.",
    }));
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        SITE_ASSETS: r2.bucket,
      } as never,
      createStorage(),
      {
        ...dispatchInput("Describe this image."),
        selectedModel: {
          providerId: "workers-ai",
          model: "moonshotai/kimi-k3",
          optionId: "managed-kimi-k3",
        },
        attachments: [
          {
            id: "attachment-kimi-image",
            name: "kimi-image.png",
            mimeType: "image/png",
            size: imageBytes.byteLength,
            kind: "image",
            status: "ready",
            storageKey: imageStorageKey,
            hasText: false,
            textTruncated: false,
          },
        ],
      },
    );

    expect(response).toMatchObject({
      replyText: "Kimi can see the image.",
      model: "moonshotai/kimi-k3",
      source: "workers-ai",
    });
    expect(aiRun).toHaveBeenCalledWith(
      "moonshotai/kimi-k3",
      expect.objectContaining({ messages: expect.any(Array) }),
      expect.objectContaining({ gateway: expect.objectContaining({ id: "default" }) }),
    );
    const modelInput = aiRun.mock.calls[0]?.[1] as {
      messages: Array<{ role: string; content: unknown }>;
      image?: string;
    };
    const userContent = modelInput.messages.at(-1)?.content as Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;
    expect(userContent).toEqual([
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("kimi-image.png"),
      }),
      {
        type: "image_url",
        image_url: { url: "data:image/png;base64,iVBORw==" },
      },
    ]);
    expect(modelInput.image).toBeUndefined();
  });

  it("classifies image generation without treating prompt drafting or image analysis as generation", () => {
    expect(
      modelSupportsCapability(
        "openai",
        DEFAULT_OPENAI_IMAGE_GENERATION_MODEL,
        "image_generation",
      ),
    ).toBe(true);
    expect(
      modelSupportsCapability(
        "workers-ai",
        DEFAULT_WORKERS_AI_IMAGE_GENERATION_MODEL,
        "image_generation",
      ),
    ).toBe(true);
    expect(
      modelSupportsCapability("workers-ai", "@cf/qwen/qwen3-30b-a3b-fp8", "image_generation"),
    ).toBe(false);
    expect(classifyAssistantImageIntent("Generate an image of a sunrise.")).toMatchObject({
      kind: "generate",
      capability: "image_generation",
    });
    expect(classifyAssistantImageIntent("Write a prompt for an image of a sunrise.")).toEqual({
      kind: "none",
      capability: null,
    });
    expect(
      classifyAssistantImageIntent("Analyze this image.", [
        { kind: "image", mimeType: "image/png" },
      ]),
    ).toEqual({
      kind: "none",
      capability: null,
    });
  });

  it("blocks image generation before provider work when storage is missing", async () => {
    const aiRun = vi.fn(async () => ({
      response: "Text model should not answer image requests.",
    }));
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun } } as never,
      createStorage(),
      {
        ...dispatchInput("Generate an image of a quiet writing desk."),
        selectedModel: {
          providerId: "workers-ai",
          model: "@cf/qwen/qwen3-30b-a3b-fp8",
          optionId: "workers-qwen3-30b",
        },
      },
    );

    expect(aiRun).not.toHaveBeenCalled();
    expect(response.replyText).toContain("SITE_ASSETS R2 binding");
    expect(response.imageAction).toMatchObject({
      kind: "generated",
      status: "failed",
      providerId: "workers-ai",
      model: DEFAULT_WORKERS_AI_IMAGE_GENERATION_MODEL,
      reason: "image_generation_storage_unavailable",
    });
  });

  it("routes image generation through Workers AI and stores the generated asset", async () => {
    const tinyPngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzvKswAAAABJRU5ErkJggg==";
    const aiRun = vi.fn(async () => ({
      image: tinyPngBase64,
      revisedPrompt: "A quiet writing desk at sunrise.",
    }));
    const env = createEnv();
    const r2 = createR2Bucket();

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        SITE_ASSETS: r2.bucket,
        CLOUDFLARE_ACCOUNT_ID: "cf-account",
        CLOUDFLARE_API_TOKEN: "cf-token",
      } as never,
      createStorage(),
      {
        ...dispatchInput("Generate an image of a quiet writing desk."),
        threadId: "thread-1",
        selectedModel: {
          providerId: "workers-ai",
          model: "@cf/qwen/qwen3-30b-a3b-fp8",
          optionId: "workers-qwen3-30b",
        },
      },
    );

    expect(aiRun).toHaveBeenCalledOnce();
    expect(aiRun).toHaveBeenCalledWith(
      DEFAULT_WORKERS_AI_IMAGE_GENERATION_MODEL,
      expect.objectContaining({
        multipart: expect.objectContaining({
          contentType: expect.stringContaining("multipart/form-data"),
        }),
      }),
      expect.objectContaining({ gateway: expect.objectContaining({ id: "default" }) }),
    );
    expect(aiRun.mock.calls[0]).toHaveLength(3);
    expect(response.replyText).toContain("Generated an image");
    expect(response.imageAction).toMatchObject({
      kind: "generated",
      status: "complete",
      providerId: "workers-ai",
      model: DEFAULT_WORKERS_AI_IMAGE_GENERATION_MODEL,
    });
    expect(response.imageAction?.assets).toHaveLength(1);
    expect(response.imageAction?.assets[0]).toMatchObject({
      mimeType: "image/png",
      url: expect.stringContaining("/api/assistant/attachments/"),
    });
    expect(env.state.assistantAttachments).toHaveLength(1);
    expect(env.state.assistantMessageAssets).toHaveLength(1);
    expect(env.state.driveFolders).toEqual([
      expect.objectContaining({
        name: "Generated Images",
        path: "Generated-Images",
        status: "active",
      }),
    ]);
    expect(env.state.driveFiles).toEqual([
      expect.objectContaining({
        folder_id: env.state.driveFolders[0]?.id,
        filename: expect.stringMatching(/^generated-image-.+\.png$/),
        mime_type: "image/png",
        storage_key: response.imageAction?.assets[0]?.storageKey,
        status: "ready",
        preview_kind: "image",
      }),
    ]);
    expect(JSON.parse(String(env.state.driveFiles[0]?.metadata_json))).toMatchObject({
      source: "assistant-image-generation",
      assistantAttachmentId: response.imageAction?.assets[0]?.attachmentId,
      threadId: "thread-1",
      sharedStorage: true,
    });
    expect(env.state.aiUsageEvents).toHaveLength(1);
    expect(env.state.aiUsageEvents[0]).toMatchObject({
      user_id: "owner",
      provider: "workers-ai",
      model: DEFAULT_WORKERS_AI_IMAGE_GENERATION_MODEL,
    });
    expect(Number(env.state.aiUsageEvents[0].estimated_cost_usd)).toBeCloseTo(
      0.001148,
    );
    expect(JSON.parse(String(env.state.aiUsageEvents[0].metadata_json))).toMatchObject({
      estimated: true,
      outputTiles: 4,
      pricing: "workers-ai-flux-2-klein-4b-output-tiles",
    });
    expect(r2.objects.size).toBe(1);
    expect([...r2.objects.keys()]).toEqual([
      response.imageAction?.assets[0]?.storageKey,
    ]);
    const assistantMessage = env.state.persistedMessages.find(
      (message) => message.role === "assistant",
    );
    expect(JSON.parse(assistantMessage?.metadata_json || "{}")).toMatchObject({
      imageAction: {
        status: "complete",
        assets: [expect.objectContaining({ mimeType: "image/png" })],
      },
    });
  });

  it("uses GPT Image 2 through Cloudflare and stores the generated image", async () => {
    const tinyPngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lzvKswAAAABJRU5ErkJggg==";
    const imageBytes = Uint8Array.from(atob(tinyPngBase64), (character) => character.charCodeAt(0));
    const fetchMock = vi.fn(async () => new Response(imageBytes, { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);
    const aiRun = vi.fn(async () => ({
      result: { image: "https://example.r2.dev/generated.png" },
      usage: { input_tokens: 7, output_tokens: 1_800, total_tokens: 1_807 },
    }));
    const env = createEnv();
    const r2 = createR2Bucket();

    try {
      const response = await dispatchAgentSandboxTurn(
        { ...env, AI: { run: aiRun }, SITE_ASSETS: r2.bucket, ME3_DEPLOYMENT_MODE: "managed" } as never,
        createStorage(),
        { ...dispatchInput("Generate an image of a quiet writing desk."), threadId: "thread-1", selectedModel: { providerId: "workers-ai", model: DEFAULT_WORKERS_AI_IMAGE_GENERATION_MODEL } },
      );
      expect(aiRun).toHaveBeenCalledWith(
        "openai/gpt-image-2",
        { prompt: expect.any(String), size: "1024x1024", quality: "medium" },
        expect.objectContaining({ gateway: expect.objectContaining({ id: "default" }) }),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        new URL("https://example.r2.dev/generated.png"),
        { redirect: "error" },
      );
      expect(response.imageAction).toMatchObject({
        status: "complete",
        providerId: "workers-ai",
        model: "openai/gpt-image-2",
        assets: [{ mimeType: "image/png", url: expect.stringContaining("/api/assistant/attachments/") }],
      });
      expect(env.state.aiUsageEvents).toEqual([
        expect.objectContaining({ model: "openai/gpt-image-2", tokens_in: 7, tokens_out: 1_800 }),
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("explains provider moderation failures without blaming asset storage", async () => {
    const aiRun = vi.fn(async () => {
      throw new Error(
        "3030: Your output has been flagged. Please choose another prompt / input image combination",
      );
    });
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        SITE_ASSETS: createR2Bucket().bucket,
      } as never,
      createStorage(),
      {
        ...dispatchInput("Generate an image of an international football tournament."),
        threadId: "thread-1",
        selectedModel: {
          providerId: "workers-ai",
          model: "@cf/qwen/qwen3-30b-a3b-fp8",
          optionId: "workers-qwen3-30b",
        },
      },
    );

    expect(aiRun).toHaveBeenCalledOnce();
    expect(response.replyText).toContain("image provider blocked");
    expect(response.replyText).not.toContain("asset storage");
    expect(response.imageAction).toMatchObject({
      status: "failed",
      reason: "image_generation_provider_moderation",
    });
  });

  it("blocks image generation before provider work when no compatible route exists", async () => {
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      env as never,
      createStorage(),
      {
        ...dispatchInput("Generate an image of a launch banner."),
        selectedModel: {
          providerId: "workers-ai",
          model: "@cf/qwen/qwen3-30b-a3b-fp8",
          optionId: "workers-qwen3-30b",
        },
      },
    );

    expect(response.replyText).toContain("Image generation needs a compatible image route");
    expect(response.imageAction).toMatchObject({
      kind: "blocked",
      status: "blocked",
      providerId: null,
      model: null,
      reason: "image_generation_route_unavailable",
    });
  });

  it("routes Workers AI chat through AI Gateway when configured", async () => {
    const aiRun = vi.fn(async () => ({
      response: "Gateway model reply.",
    }));
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        CLOUDFLARE_ACCOUNT_ID: "cf-account",
        CLOUDFLARE_AI_GATEWAY_ID: "friend-one",
        CLOUDFLARE_API_TOKEN: "cf-token",
      } as never,
      createStorage(),
      dispatchInput("Use gateway accounting."),
    );

    expect(response.replyText).toBe("Gateway model reply.");
    expect(aiRun).toHaveBeenCalledWith(
      "@cf/zai-org/glm-4.7-flash",
      expect.any(Object),
      {
        gateway: {
          id: "friend-one",
          metadata: expect.objectContaining({
            me3_request_id: expect.any(String),
            me3_turn_id: expect.any(String),
            me3_mode: "everyday",
            me3_tool_count: expect.any(Number),
            me3_input_chars: expect.any(Number),
          }),
        },
      },
    );
  });

  it("routes selected OpenAI reasoning through Cloudflare without sampling controls", async () => {
    const aiRun = vi.fn(async (_model: string, _input: unknown) => ({ choices: [{ message: { content: "Selected OpenAI reply." } }] }));
    const env = createEnv();
    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun }, OPENAI_API_KEY: "ignored-provider-key" } as never,
      createStorage(),
      { ...dispatchInput("Say hello."), selectedModel: { providerId: "openai", model: "gpt-5.5" } },
    );
    expect(response).toMatchObject({ replyText: "Selected OpenAI reply.", model: "openai/gpt-5.5", source: "workers-ai" });
    expect(aiRun).toHaveBeenCalledWith("openai/gpt-5.5", expect.any(Object),
      expect.objectContaining({ gateway: expect.objectContaining({ id: "default" }) }));
    expect(aiRun.mock.calls[0]?.[1]).not.toHaveProperty("temperature");
  });

  it("routes selected OpenAI chat through the configured Cloudflare gateway", async () => {
    const aiRun = vi.fn(async () => ({ choices: [{ message: { content: "Gateway OpenAI reply." } }] }));
    const env = createEnv();
    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun }, CLOUDFLARE_AI_GATEWAY_ID: "me3" } as never,
      createStorage(),
      { ...dispatchInput("Say hello."), selectedModel: { providerId: "openai", model: "gpt-4.1-mini" } },
    );
    expect(response.replyText).toBe("Gateway OpenAI reply.");
    expect(aiRun).toHaveBeenCalledWith("openai/gpt-4.1-mini", expect.any(Object),
      expect.objectContaining({ gateway: expect.objectContaining({ id: "me3" }) }));
  });

  it("routes selected Anthropic chat through the configured Cloudflare gateway", async () => {
    const aiRun = vi.fn(async () => ({ content: [{ type: "text", text: "Gateway Anthropic reply." }] }));
    const env = createEnv();
    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun }, CLOUDFLARE_AI_GATEWAY_ID: "me3" } as never,
      createStorage(),
      { ...dispatchInput("Say hello."), selectedModel: { providerId: "anthropic", model: "claude-3-5-haiku-latest" } },
    );
    expect(response.replyText).toBe("Gateway Anthropic reply.");
    expect(aiRun).toHaveBeenCalledWith("anthropic/claude-3-5-haiku-latest", expect.any(Object),
      expect.objectContaining({ gateway: expect.objectContaining({ id: "me3" }) }));
  });

  it("does not feed old provider setup fallbacks back into the model", async () => {
    const aiRun = vi.fn(async (_model: string, _input: unknown) => ({
      response: "Yes, I am working through Qwen now.",
    }));
    const env = createEnv({
      recentMessages: [
        {
          role: "assistant",
          content:
            "ME3 chat is connected for your ME3 installation. Add an AI provider in Account settings or bind Workers AI to turn this into a live model response.",
        },
      ],
    });

    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun } } as never,
      createStorage(),
      dispatchInput("Are you working now?"),
    );

    const modelInput = aiRun.mock.calls[0]?.[1] as unknown as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(response.replyText).toBe("Yes, I am working through Qwen now.");
    expect(modelInput.messages).not.toContainEqual(
      expect.objectContaining({
        role: "assistant",
        content: expect.stringContaining("Add an AI provider"),
      }),
    );
  });

  it("persists a selected source privately and restores it into the next turn", async () => {
    const aiRun = workersAiSequence(
      {
        tool_calls: [{
          id: "read-private-source",
          name: "core_social_source_read",
          arguments: {
            sourceType: "mission_task",
            sourceId: "task-hidden",
          },
        }],
      },
      { response: "I found task-hidden." },
      { response: "I can use the selected task for the next draft." },
    );
    const env = createEnv({
      projects: [projectRow("project-writing", "Writing", "writing")],
      tasks: [taskRow("task-hidden", "Useful source title", "project-writing")],
    });
    const runtimeEnv = { ...env, AI: { run: aiRun } };
    const storage = createStorage();
    const threadId = "thread-private-source";

    const selected = await dispatchAgentSandboxTurn(
      runtimeEnv as never,
      storage,
      { ...dispatchInput("Read Useful source title for a LinkedIn post."), threadId },
    );

    expect(selected.replyText).toBe("Read the social post source: Useful source title.");
    expect(selected.replyText).not.toContain("task-hidden");
    expect(selected).not.toHaveProperty("sourceReference");
    const savedAssistantMessage = env.state.persistedMessages.find(
      (message) => message.role === "assistant",
    );
    expect(JSON.parse(savedAssistantMessage?.metadata_json || "{}")).toMatchObject({
      sourceReference: {
        sourceType: "mission_task",
        sourceId: "task-hidden",
      },
    });

    env.state.recentMessages = env.state.persistedMessages.map((message) => ({
      role: message.role,
      content: message.content,
      metadata_json: message.metadata_json,
    }));
    const followUp = await dispatchAgentSandboxTurn(
      runtimeEnv as never,
      storage,
      { ...dispatchInput("Create a LinkedIn post from that source."), threadId },
    );

    expect(followUp.replyText).toBe("I can use the selected task for the next draft.");
    expect(followUp).not.toHaveProperty("sourceReference");
    const modelInput = (aiRun.mock.calls as unknown[][])[2]?.[1] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(modelInput.messages[0]?.content).toContain(
      "sourceType=mission_task; sourceId=task-hidden",
    );
    expect(modelInput.messages).toContainEqual({
      role: "assistant",
      content: "Read the social post source: Useful source title.",
    });
  });

  it("uses the default Workers AI backup when a configured model is empty", async () => {
    const aiRun = vi.fn(async (model: string) =>
      model === "@cf/qwen/qwen3-30b-a3b-fp8"
        ? { response: "" }
        : { response: "Backup model reply." },
    );
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        ME3_AI_CHAT_MODEL: "@cf/qwen/qwen3-30b-a3b-fp8",
        ME3_ASSISTANT_DEBUG_TRACE: "true",
      } as never,
      createStorage(),
      dispatchInput("Are you working?"),
    );

    expect(aiRun.mock.calls.map(([model]) => model)).toEqual([
      "@cf/qwen/qwen3-30b-a3b-fp8",
      "@cf/zai-org/glm-5.2",
    ]);
    expect(response).toMatchObject({
      replyText: "Backup model reply.",
      model: "@cf/zai-org/glm-5.2",
      source: "workers-ai",
    });
    expect(response.trace?.modelCall).toMatchObject({
      status: "succeeded",
      providerId: "workers-ai",
      model: "@cf/zai-org/glm-5.2",
      attempts: [
        {
          providerId: "workers-ai",
          model: "@cf/qwen/qwen3-30b-a3b-fp8",
          status: "empty",
          error: "Model returned an empty reply.",
        },
        {
          providerId: "workers-ai",
          model: "@cf/zai-org/glm-5.2",
          status: "succeeded",
          error: null,
        },
      ],
    });
    expect(response).not.toHaveProperty("modelAttempts");
  });

  it("falls back helpfully when configured model attempts return empty replies", async () => {
    const aiRun = vi.fn(async (_model: string) => ({ response: "" }));
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        ME3_AI_CHAT_MODEL: "@cf/qwen/qwen3-30b-a3b-fp8",
        ME3_ASSISTANT_DEBUG_TRACE: "true",
      } as never,
      createStorage(),
      dispatchInput("Are you working?"),
    );

    expect(aiRun.mock.calls.map(([model]) => model)).toEqual([
      "@cf/qwen/qwen3-30b-a3b-fp8",
      "@cf/zai-org/glm-5.2",
    ]);
    expect(response).toMatchObject({
      source: "fallback",
      fallbackReason: "Model returned empty response",
      debugError: expect.stringContaining("returned an empty reply"),
    });
    expect(response.replyText).toContain("returned an empty reply");
    expect(response.replyText).toContain("backup model");
    expect(response.trace?.modelCall).toMatchObject({
      status: "failed",
      attempts: [
        { model: "@cf/qwen/qwen3-30b-a3b-fp8", status: "empty" },
        { model: "@cf/zai-org/glm-5.2", status: "empty" },
      ],
    });
    expect(env.state.persistedMessages.map((message) => message.role)).toEqual(["user"]);
    expect(response).not.toHaveProperty("modelAttempts");
  });

  it("falls back helpfully when configured model attempts fail", async () => {
    const aiRun = vi.fn(async (_model: string) => {
      throw new Error("Workers AI unavailable");
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        ME3_AI_CHAT_MODEL: "@cf/qwen/qwen3-30b-a3b-fp8",
        ME3_ASSISTANT_DEBUG_TRACE: "true",
      } as never,
      createStorage(),
      dispatchInput("Are you working?"),
    );

    expect(response).toMatchObject({
      source: "fallback",
      fallbackReason: "Model request failed",
      debugError: "Workers AI unavailable",
    });
    expect(response.replyText).toContain("model provider failed");
    expect(response.replyText).toContain("backup model");
    expect(response.trace?.modelCall).toMatchObject({
      status: "failed",
      attempts: [
        {
          model: "@cf/qwen/qwen3-30b-a3b-fp8",
          status: "failed",
          error: "Workers AI unavailable",
        },
        {
          model: "@cf/zai-org/glm-5.2",
          status: "failed",
          error: "Workers AI unavailable",
        },
      ],
    });
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "ME3_MODEL_ATTEMPT_FAILURE",
        providerId: "workers-ai",
        status: "failed",
        error: "Workers AI unavailable",
      }),
    );
    expect(env.state.persistedMessages.map((message) => message.role)).toEqual(["user"]);
  });

  it.each([
    "Create a task called Finish setup in Personal.",
    "This is a fresh-install test. Add a task called Check setup to Personal.",
    "Can you create a task to review first time onboarding?",
  ])("keeps task tools available for setup actions: %s", async (messageText) => {
    const aiRun = vi.fn(async (_model: string, _input: unknown) => ({ response: "Ready to help." }));
    await dispatchAgentSandboxTurn(
      { ...createEnv(), AI: { run: aiRun } } as never,
      createStorage(),
      dispatchInput(messageText),
    );
    const modelInput = aiRun.mock.calls[0]?.[1] as {
      messages: Array<{ role: string; content: string }>;
      tools?: Array<{ function: { name: string } }>;
    };
    expect(modelInput.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ function: expect.objectContaining({ name: "core_mission_task_create" }) }),
    ]));
    expect(modelInput.messages[0]?.content).not.toContain("ME3 first-run/setup orientation mode:");
  });

  it("keeps setup and capability exploration prompts in the model path", async () => {
    const aiRun = vi.fn(async (_model: string, _input: unknown) => ({
      response:
        "Yes, that makes sense. I can help you explore ME3, inspect context, and turn useful gaps into code improvements.",
    }));
    const env = createEnv({
      missionDashboardSettings: missionDashboardSettingsRow(
        "Help builders steer their work with calm, useful systems.",
      ),
      wheelSnapshots: [wheelSnapshotRow()],
      reminders: [
        {
          id: "reminder-existing",
          user_id: "owner",
          title: "Ship ME3",
          notes: null,
          remind_at: "2026-06-07T09:00:00.000Z",
          timezone: "Europe/Dublin",
          recurrence_rule: null,
          status: "pending",
          delivered_at: null,
          dismissed_at: null,
          created_at: "2026-06-01T09:00:00.000Z",
        },
      ],
    });

    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun } } as never,
      createStorage(),
      dispatchInput(
        "I am setting up ME3 for the first time. I want to explore what you can do, ie the tools you can access here: profile, setting calendar reminders/events, updating mission control, tasks projects, what context you have available. Make sense?",
      ),
    );

    expect(response).toMatchObject({
      source: "workers-ai",
      specialist: "core.agent-chat",
      reminderAction: null,
    });
    expect(response.replyText).toContain("Yes, that makes sense");
    expect(aiRun).toHaveBeenCalledOnce();
    const modelInput = aiRun.mock.calls[0]?.[1] as unknown as {
      messages: Array<{ role: string; content: string }>;
      tools?: unknown[];
    };
    expect(modelInput.tools).toBeUndefined();
    expect(modelInput.messages[0]?.content).toContain(
      "When the owner is setting up ME3, testing the assistant, or asking what you can do",
    );
    expect(modelInput.messages[0]?.content).toContain("owner's private ME3 installation");
    expect(modelInput.messages[0]?.content).toContain("your ME3 installation");
    expect(modelInput.messages[0]?.content).toContain("Do not mention me.json");
    expect(modelInput.messages[0]?.content).toContain(
      "ME3 first-run/setup orientation mode:",
    );
    expect(modelInput.messages[0]?.content).toContain("ME3 setup readiness summary:");
    expect(modelInput.messages[0]?.content).toContain("AI provider: ready");
    expect(modelInput.messages[0]?.content).toContain(
      "Public site/profile: no profile site found yet",
    );
    expect(modelInput.messages[0]?.content).toContain(
      "Soulink/Telegram: neither Soulink nor Telegram is connected yet",
    );
    expect(modelInput.messages[0]?.content).toContain("Mailbox: needs setup");
    expect(modelInput.messages[0]?.content).toContain(
      "Plugins: no optional plugin installs are recorded yet",
    );
    expect(modelInput.messages[0]?.content).toContain(
      "Jobs: no scheduled assistant jobs created yet",
    );
    expect(modelInput.messages[0]?.content).toContain("Local daemon: not paired");
    expect(modelInput.messages[0]?.content).toContain(
      "Mission statement:\n- Help builders steer their work with calm, useful systems.",
    );
    expect(modelInput.messages[0]?.content).toContain("Goals:\n- Not set");
    expect(modelInput.messages[0]?.content).toContain(
      "Work: 8/10 — Keep useful systems calm and practical.",
    );
    expect(modelInput.messages[0]?.content).not.toContain("Wheel of Life snapshot:");
    expect(modelInput.messages[0]?.content).toContain("Offer 2-4 useful test prompts");
    expect(
      env.state.queries.filter((sql) => sql.includes("FROM plugin_installations")),
    ).toHaveLength(1);
  });

  it("orients first-run setup prompts even before an AI provider is configured", async () => {
    const env = createEnv({
      sites: [profileSiteRow("site-kieran", "kieran", { published: true })],
      pluginInstallations: [
        pluginInstallationRow("me3.calendar", "installed"),
        pluginInstallationRow("me3.telegram", "setup_required"),
        pluginInstallationRow("me3.local-executor", "disabled", 0),
      ],
      assistantJobs: [
        assistantJobRow("job-active", "active"),
        assistantJobRow("job-needs-setup", "needs_setup"),
        assistantJobRow("job-paused", "paused"),
        assistantJobRow("job-draft", "draft"),
      ],
      mailboxAliases: [mailboxAliasRow("mailbox-owner", "owner")],
      calendarSources: [calendarSourceRow("calendar-source")],
      channelConnections: [
        soulinkConnectionRow("soulink-connection"),
        telegramConnectionRow("telegram-connection"),
      ],
      localExecutorPairings: [localExecutorPairingRow("local-pairing")],
    });

    const response = await dispatchAgentSandboxTurn(
      env as never,
      createStorage(),
      dispatchInput("I'm setting up ME3 for the first time. What can you do here?"),
    );

    expect(response).toMatchObject({
      source: "fallback",
      specialist: "core.agent-chat",
      fallbackReason: "AI provider setup required",
      reminderAction: null,
      emailAction: null,
    });
    expect(response.replyText).toContain("ME3 chat is connected for your ME3 installation");
    expect(response.replyText).toContain("AI provider: needs setup");
    expect(response.replyText).toContain("Public site/profile: @kieran is published");
    expect(response.replyText).toContain("Calendar/reminders: Core native reminders");
    expect(response.replyText).toContain("Soulink/Telegram: Soulink and Telegram are connected");
    expect(response.replyText).toContain("Mailbox: active alias configured");
    expect(response.replyText).toContain("Plugins: 1 enabled, 1 need setup, 1 disabled");
    expect(response.replyText).toContain(
      "Jobs: 1 active, 1 need setup or attention, 1 paused, 1 draft",
    );
    expect(response.replyText).toContain("Updates: release/version metadata is available");
    expect(response.replyText).toContain("Local daemon: paired");
    expect(response.replyText).toContain("Good test prompts");
    expect(env.state.persistedMessages.map((message) => message.role)).toEqual(["user"]);
  });

  it("attaches a development trace for model-first turns when enabled", async () => {
    const aiRun = vi.fn(async (_model: string, _input: unknown) => ({
      response: "Here is what I can help with.",
    }));
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        ME3_ASSISTANT_DEBUG_TRACE: "true",
      } as never,
      createStorage(),
      dispatchInput("What tools can you access here?"),
    );

    expect(response.trace).toMatchObject({
      planner: {
        kind: "conversation",
        capabilityId: "core.agent-chat.conversation",
      },
      route: {
        path: "model",
        capabilityId: "core.agent-chat.conversation",
      },
      selectedModel: {
        providerId: "workers-ai",
        configured: true,
        responseModel: "@cf/zai-org/glm-4.7-flash",
      },
      context: {
        status: "loaded",
        characterCount: expect.any(Number),
        loadDurationMs: expect.any(Number),
        packetId: "agent-context:owner:chat_reply",
      },
      modelCall: {
        status: "succeeded",
      },
      toolResult: {
        status: "not_attempted",
      },
    });
  });

  it("attaches a development trace for Runtime v2 reminder turns", async () => {
    const aiRun = workersAiSequence(
      {
        tool_calls: [
          { id: "list-1", name: "core_reminders_list", arguments: {} },
        ],
      },
      { response: "You have one reminder: Ship ME3." },
    );
    const env = createEnv({
      reminders: [
        {
          id: "reminder-existing",
          user_id: "owner",
          title: "Ship ME3",
          notes: null,
          remind_at: "2026-06-07T09:00:00.000Z",
          timezone: "Europe/Dublin",
          recurrence_rule: null,
          status: "pending",
          delivered_at: null,
          dismissed_at: null,
          created_at: "2026-06-01T09:00:00.000Z",
        },
      ],
    });

    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun }, ME3_ASSISTANT_DEBUG_TRACE: "true" } as never,
      createStorage(),
      dispatchInput("Using the reminder tool, tell me how many pending reminders I have."),
    );

    expect(response.trace).toMatchObject({
      planner: {
        kind: "conversation",
        capabilityId: "core.agent-chat.conversation",
      },
      route: {
        path: "model",
        capabilityId: "core.reminders.list",
      },
      selectedModel: {
        providerId: "workers-ai",
        configured: true,
      },
      context: {
        status: "loaded",
        characterCount: expect.any(Number),
        loadDurationMs: expect.any(Number),
      },
      modelCall: {
        status: "succeeded",
      },
      toolResult: {
        status: "succeeded",
        specialist: "core.reminders.list",
      },
    });
  });

  it("does not treat an explicit Journal tool request as capability exploration", async () => {
    const aiRun = workersAiSequence(
      {
        tool_calls: [
          {
            id: "journal-list-1",
            name: "core_journal_read",
            arguments: { mode: "latest", limit: 7 },
          },
        ],
      },
      { response: "I found no stored Journal entries." },
    );
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        ME3_ASSISTANT_DEBUG_TRACE: "true",
      } as never,
      createStorage(),
      dispatchInput(
        "Read my latest 7 journal entries. Use only the journal read tool data and do not invent entries or dates.",
      ),
    );

    expect(response.trace).toMatchObject({
      route: {
        path: "model",
        capabilityId: "core.journal.read",
      },
      modelCall: {
        status: "succeeded",
      },
      toolResult: {
        status: "succeeded",
        specialist: "core.journal.read",
      },
    });
    const firstModelInput = (aiRun.mock.calls as unknown[][])[0]?.[1];
    expect(firstModelInput).toMatchObject({
      tool_choice: {
        type: "function",
        function: { name: "core_journal_read" },
      },
      tools: [
        {
          function: { name: "core_journal_read" },
        },
      ],
    });
  });

  it("shows failed context lookup details in development trace", async () => {
    const aiRun = vi.fn(async (_model: string, _input: unknown) => ({
      response: "Plain reply.",
    }));
    const env = createEnv({
      failContextLookup: true,
      contacts: [contactRow("contact-ada", "Ada Lovelace", "ada@example.com", "client")],
    });

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        ME3_ASSISTANT_DEBUG_TRACE: "true",
      } as never,
      createStorage(),
      dispatchInput("Help me reply to Ada."),
    );

    expect(response.contextManifest).toBeNull();
    expect(response.trace).toMatchObject({
      context: {
        status: "failed",
        packetId: null,
        error: "owner snapshot unavailable",
      },
      modelCall: {
        status: "succeeded",
      },
    });
  });

  it("lists reminders through the configured model tool loop", async () => {
    const aiRun = workersAiSequence(
      {
        tool_calls: [
          { id: "list-1", name: "core_reminders_list", arguments: {} },
        ],
      },
      { response: "You have one reminder: Ship ME3." },
    );
    const env = createEnv({
      reminders: [
        {
          id: "reminder-existing",
          user_id: "owner",
          title: "Ship ME3",
          notes: null,
          remind_at: "2026-06-07T09:00:00.000Z",
          timezone: "Europe/Dublin",
          recurrence_rule: null,
          status: "pending",
          delivered_at: null,
          dismissed_at: null,
          created_at: "2026-06-01T09:00:00.000Z",
        },
      ],
    });

    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun } } as never,
      createStorage(),
      dispatchInput("Do I have any pending reminders?"),
    );

    expect(response).toMatchObject({
      source: "workers-ai",
      specialist: "core.reminders.list",
      reminderAction: { kind: "listed" },
    });
    expect(response.replyText).toContain("Ship ME3");
  });

  it("does not give past reminders to the agent reminder list tool", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-07T08:00:00.000Z"));
    let modelCall = 0;
    const aiRun = vi.fn(async (_model: string, input: { messages?: Array<{ role?: string; content?: unknown }> }) => {
      modelCall += 1;
      if (modelCall === 1) {
        return {
          tool_calls: [
            { id: "list-1", name: "core_reminders_list", arguments: {} },
          ],
        };
      }

      const toolMessage = input.messages?.find((message) => message.role === "tool");
      expect(String(toolMessage?.content)).toContain("Future reminder");
      expect(String(toolMessage?.content)).not.toContain("Past reminder");
      return { response: "You have one upcoming reminder: Future reminder." };
    });
    const env = createEnv({
      reminders: [
        reminderRow("reminder-past", "Past reminder", "2026-06-07T07:00:00.000Z"),
        reminderRow("reminder-future", "Future reminder", "2026-06-07T09:00:00.000Z"),
      ],
    });

    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun } } as never,
      createStorage(),
      dispatchInput("Do I have any reminders coming up?"),
    );

    expect(response.replyText).toContain("Future reminder");
    expect(response.replyText).not.toContain("Past reminder");
  });

  it("does not route reminder writes through the removed regex fallback", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T12:00:00Z"));
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      env as never,
      createStorage(),
      dispatchInput("Remind me to follow up with Sam tomorrow at 9am"),
    );

    expect(response).toMatchObject({
      source: "fallback",
      specialist: "core.agent-chat",
      fallbackReason: "AI provider setup required",
      reminderAction: null,
    });
    expect(env.state.reminders).toHaveLength(0);
  });

  it("does not route Mission task writes through the removed regex fallback", async () => {
    const env = createEnv({
      projects: [projectRow("project-launch", "ME3 Launch", "me3-launch")],
    });

    const response = await dispatchAgentSandboxTurn(
      env as never,
      createStorage(),
      dispatchInput("Add Follow up with Sam to the ME3 Launch project"),
    );

    expect(response).toMatchObject({
      source: "fallback",
      specialist: "core.agent-chat",
      fallbackReason: "AI provider setup required",
      actionCards: null,
    });
    expect(env.state.tasks).toHaveLength(0);
  });

  it("creates reminders through the configured model tool loop", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T12:00:00Z"));
    const aiRun = workersAiSequence(
      {
        tool_calls: [
          {
            id: "create-1",
            name: "core_reminders_create",
            arguments: {
              title: "follow up with Sam",
              date: "2026-06-01",
              time: "09:00",
              timezone: "Europe/Dublin",
            },
          },
        ],
      },
      { response: "Done. I set a reminder to follow up with Sam." },
    );
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun } } as never,
      createStorage(),
      dispatchInput("Remind me to follow up with Sam tomorrow at 9am"),
    );

    expect(response).toMatchObject({
      source: "workers-ai",
      specialist: "core.reminders.create",
      reminderAction: {
        kind: "created",
        title: "follow up with Sam",
      },
      actionCards: [
        {
          kind: "reminder.created",
          capabilityId: "core.reminders.create",
          title: "Reminder created",
          status: "complete",
          statusLabel: "Complete",
          primaryAction: { label: "Open calendar", href: "/calendar" },
        },
      ],
    });
    expect(response.replyText).toContain("Done. I set a reminder");
    expect(env.state.reminders).toHaveLength(1);
    expect(env.state.reminders[0]).toMatchObject({
      title: "follow up with Sam",
      remind_at: "2026-06-01T08:00:00.000Z",
      timezone: "Europe/Dublin",
      status: "pending",
    });
    expect(response.actionCards?.[0]?.records).toEqual([
      { kind: "reminder", id: env.state.reminders[0].id },
    ]);
    expect(env.state.persistedMessages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(
      JSON.parse(
        env.state.persistedMessages.find((message) => message.role === "assistant")
          ?.metadata_json || "{}",
      ),
    ).toMatchObject({
      actionCards: [
        {
          kind: "reminder.created",
          records: [{ kind: "reminder", id: env.state.reminders[0].id }],
        },
      ],
    });
  });

  it("creates tasks through the shared configured model loop", async () => {
    const aiRun = workersAiSequence(
      {
        tool_calls: [
          { id: "task-list-1", name: "core_mission_task_list", arguments: {} },
        ],
      },
      {
        tool_calls: [
          {
            id: "task-create-1",
            name: "core_mission_task_create",
            arguments: {
              title: "Follow up with Sam",
              projectId: "project-launch",
              dueAt: "2026-07-15",
            },
          },
        ],
      },
      { response: "Added Follow up with Sam to ME3 Launch." },
    );
    const env = createEnv({
      projects: [projectRow("project-launch", "ME3 Launch", "me3-launch")],
    });

    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun }, ME3_ASSISTANT_DEBUG_TRACE: "true" } as never,
      createStorage(),
      dispatchInput("Add a task called Follow up with Sam to the ME3 Launch project by 15 July"),
    );

    expect(response).toMatchObject({
      source: "workers-ai",
      specialist: "core.mission.task.create",
      actionCards: [
        {
          kind: "mission.task_created",
          summary: "Follow up with Sam",
        },
      ],
      trace: {
        context: {
          status: "loaded",
          characterCount: expect.any(Number),
          loadDurationMs: expect.any(Number),
        },
        route: { path: "model", capabilityId: "core.mission.task.create" },
        modelCall: { status: "succeeded" },
        toolResult: {
          status: "succeeded",
          specialist: "core.mission.task.create",
        },
      },
    });
    expect(env.state.tasks).toHaveLength(1);
    expect(env.state.tasks[0]).toMatchObject({
      title: "Follow up with Sam",
      project_id: "project-launch",
      due_at: "2026-07-15",
    });
    expect(env.state.queries.some((sql) => sql.includes("FROM contacts"))).toBe(false);
    expect(env.state.queries.some((sql) => sql.includes("FROM assistant_jobs"))).toBe(false);
  });

  it("saves structured mailbox drafts through the shared model loop", async () => {
    const body = "Hi Ada,\n\nThe launch checklist is ready.\n\nBest,\nKieran";
    const aiRun = workersAiSequence(
      {
        tool_calls: [
          {
            id: "draft-1",
            name: "core_mailbox_draft",
            arguments: {
              to: "ada@example.com",
              subject: "Launch checklist",
              body,
            },
          },
        ],
      },
      { response: "I saved the draft for review. It has not been sent." },
    );
    const env = createEnv({
      mailboxAliases: [mailboxAliasRow("mailbox-owner", "owner")],
    });

    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun }, ME3_ASSISTANT_DEBUG_TRACE: "true" } as never,
      createStorage(),
      dispatchInput("Draft an email to Ada saying the launch checklist is ready"),
    );

    expect(response).toMatchObject({
      source: "workers-ai",
      specialist: "core.mailbox.draft",
      emailAction: { kind: "drafted" },
      actionCards: [
        expect.objectContaining({
          kind: "mailbox.draft_saved",
          status: "pending_approval",
        }),
      ],
      trace: {
        route: { path: "model", capabilityId: "core.mailbox.draft" },
        toolResult: { status: "succeeded", specialist: "core.mailbox.draft" },
      },
    });
    expect(countMailboxDrafts(env.state.mailboxMessages)).toBe(1);
    expect(env.state.mailboxMessages[0]).toMatchObject({
      to_address: "ada@example.com",
      subject: "Launch checklist",
      text_body: body,
      status: "pending_approval",
      created_by: "agent",
    });
    expect(response.replyText).toContain("not been sent");
  });

  it("does not create mailbox drafts without a configured model", async () => {
    const env = createEnv({
      mailboxAliases: [mailboxAliasRow("mailbox-owner", "owner")],
    });
    const response = await dispatchAgentSandboxTurn(
      env as never,
      createStorage(),
      dispatchInput("Save an email draft to ada@example.com"),
    );

    expect(response).toMatchObject({
      source: "fallback",
      fallbackReason: "AI provider setup required",
      emailAction: null,
    });
    expect(countMailboxDrafts(env.state.mailboxMessages)).toBe(0);
  });

  it("clarifies an incomplete reminder and creates it from the follow-up", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00Z"));

    const aiRun = vi.fn(async () => {
      if (aiRun.mock.calls.length === 1) {
        return { response: "What date and time should I remind you?" };
      }
      if (aiRun.mock.calls.length === 2) {
        return {
          tool_calls: [
            {
              id: "reminder-create-1",
              name: "core_reminders_create",
              arguments: {
                title: "tell erum about soulink",
                date: "2026-07-06",
                time: "09:00",
                timezone: "Europe/Dublin",
              },
            },
          ],
        };
      }
      return { response: "Done. I set that reminder for tomorrow at 9:00." };
    });
    const env = createEnv();
    const storage = createStorage();
    const runtimeEnv = {
      ...env,
      AI: { run: aiRun },
      ME3_ASSISTANT_DEBUG_TRACE: "true",
    };

    const clarify = await dispatchAgentSandboxTurn(
      runtimeEnv as never,
      storage,
      dispatchInput("Reminder me to tell erum about soulink"),
    );

    expect(clarify).toMatchObject({
      source: "workers-ai",
      specialist: "core.agent-chat",
      fallbackReason: null,
      reminderAction: null,
    });
    expect(clarify.replyText).toContain("What date and time");
    expect(env.state.reminders).toHaveLength(0);
    env.state.recentMessages = [...env.state.persistedMessages]
      .reverse()
      .map(({ role, content, metadata_json }) => ({
        role,
        content,
        metadata_json,
      }));

    const created = await dispatchAgentSandboxTurn(
      runtimeEnv as never,
      storage,
      dispatchInput("tomorrow at 9am"),
    );

    expect(created).toMatchObject({
      source: "workers-ai",
      specialist: "core.reminders.create",
      reminderAction: {
        kind: "created",
        title: "tell erum about soulink",
      },
    });
    expect(created.trace).toMatchObject({
      modelCall: { status: "succeeded", providerId: "workers-ai" },
      toolResult: {
        status: "succeeded",
        specialist: "core.reminders.create",
      },
    });
    expect(env.state.reminders).toHaveLength(1);
    expect(env.state.reminders[0]).toMatchObject({
      title: "tell erum about soulink",
      remind_at: "2026-07-06T08:00:00.000Z",
      timezone: "Europe/Dublin",
    });
    expect(aiRun).toHaveBeenCalledTimes(3);
  });

  it("keeps the no-provider fallback working", async () => {
    const env = createEnv({
      contacts: [contactRow("contact-ada", "Ada Lovelace", "ada@example.com", "client")],
    });

    const response = await dispatchAgentSandboxTurn(
      env as never,
      createStorage(),
      dispatchInput("Hello agent"),
    );

    expect(response).toMatchObject({
      ok: true,
      source: "fallback",
      fallbackReason: "AI provider setup required",
    });
    expect(response.trace).toBeUndefined();
    expect(response.performance).toMatchObject({
      version: 1,
      resultSource: "fresh",
      ownerProfileMs: expect.any(Number),
      toolPlanMs: expect.any(Number),
      routeResolutionMs: expect.any(Number),
      setupAndContextMs: expect.any(Number),
      beforeResultPersistenceMs: expect.any(Number),
    });
    expect(env.state.persistedMessages.map((message) => message.role)).toEqual(["user"]);
  });

  it("keeps content-free stream metrics when development traces are disabled", async () => {
    const aiRun = vi.fn(async (_model: string, _input: unknown) => ({
      response: "A short reply.",
    }));
    const env = createEnv();

    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun } } as never,
      createStorage(),
      dispatchInput("Give me a short reply."),
      { onEvent: vi.fn() },
    );

    expect(response.trace).toBeUndefined();
    expect(response.streamMetrics).toMatchObject({
      totalDurationMs: expect.any(Number),
      modelRequestCount: 1,
      modelRequestDurationMs: expect.any(Number),
      toolCallCount: 0,
      toolExecutionDurationMs: 0,
    });
    expect(response.performance).toMatchObject({
      version: 1,
      executionMs: expect.any(Number),
      contextLoadMs: expect.any(Number),
    });
  });

  it("skips owner context and recent history for a bounded literal response", async () => {
    const aiRun = vi.fn(async (_model: string, _input: unknown) => ({
      response: "PONG",
    }));
    const env = createEnv({
      recentMessages: [{ role: "assistant", content: "Private previous context." }],
      projects: [projectRow("project-private", "Private project", "private-project")],
    });

    const response = await dispatchAgentSandboxTurn(
      {
        ...env,
        AI: { run: aiRun },
        ME3_ASSISTANT_DEBUG_TRACE: "true",
      } as never,
      createStorage(),
      dispatchInput("Reply with exactly PONG"),
      { onEvent: vi.fn() },
    );

    expect(response.replyText).toBe("PONG");
    expect(response.contextManifest).toBeNull();
    expect(response.contextSummary).toBeNull();
    expect(response.performance?.contextLoadMs).toBe(0);
    expect(response.trace?.context.status).toBe("not_attempted");
    expect(response.streamMetrics).toMatchObject({
      availableToolCount: 0,
      toolSchemaCharacterCount: 0,
    });
    expect(response.streamMetrics?.inputCharacterCount).toBeLessThan(5_000);
    const modelInput = aiRun.mock.calls[0]?.[1] as {
      messages: Array<{ role: string; content: string }>;
      tools: unknown[];
    };
    expect(modelInput.messages).toHaveLength(2);
    expect(modelInput.messages[0]?.content).not.toContain("ME3 owner snapshot:");
    expect(modelInput.messages[0]?.content).not.toContain("tool rules:");
    expect(modelInput.tools).toEqual([]);
  });

  it("trims an oversized owner snapshot before model calls", async () => {
    const aiRun = vi.fn(async (_model: string, _input: unknown) => ({
      response: "Trimmed reply.",
    }));
    const env = createEnv({
      projects: Array.from({ length: 30 }, (_, index) => ({
        ...projectRow(`project-${index}`, `Project ${index}`, `project-${index}`),
        description: `Project context ${"very long ".repeat(120)}`,
      })),
    });

    const response = await dispatchAgentSandboxTurn(
      { ...env, AI: { run: aiRun } } as never,
      createStorage(),
      dispatchInput("Use the budget context."),
    );

    const modelInput = aiRun.mock.calls[0]?.[1] as unknown as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(modelInput.messages[0]?.content).toContain(
      "[Owner snapshot trimmed to prompt budget]",
    );
    expect(response.contextManifest?.budget).toMatchObject({
      wasTrimmed: true,
      trimReason: "maxPromptChars",
    });
    expect(response.contextSummary).toContain("prompt trimmed");
  });
});

type GoldenTranscriptScenario = {
  name: string;
  messageText: string;
  aiReply?: string;
  withAi?: boolean;
  envState?: Partial<FakeDbState>;
  expected: {
    source: "workers-ai" | "tool" | "fallback";
    routePath: "model" | "tool" | "fallback";
    plannerKind: "conversation" | "read_action" | "write_action" | "clarify";
    capabilityId:
      | "core.agent-chat.conversation"
      | "core.mailbox.draft"
      | "core.reminders.list"
      | "core.reminders.create"
      | "core.bookings.lookup"
      | "core.mission.task.create"
      | "core.mission.task.list"
      | "core.mission.task.read"
      | "core.mission.task.update"
      | "core.mission.task.archive"
      | "core.sites.blog_post.read";
    toolResultStatus: "not_attempted" | "succeeded" | "failed" | "clarified";
    modelCallStatus: "not_attempted" | "succeeded" | "failed" | "fallback";
    specialist?: string;
    replyIncludes?: string[];
    contextSummary?: "present" | "absent";
    reminderActionKind?: "created" | "listed" | null;
    emailActionKind?: "drafted" | null;
    reminderDelta?: number;
    mailboxDraftDelta?: number;
    missionTaskDelta?: number;
    missionTaskStatus?: string;
    missionTaskDescription?: string | null;
    missionTaskArchived?: boolean;
    siteFileContains?: Array<{ path: string; text: string }>;
    siteFileMissing?: string[];
    sitePostCount?: number;
    aiCalled?: boolean;
    fallbackReason?: string;
  };
};

const launchGoldenTranscriptScenarios: GoldenTranscriptScenario[] = [
  {
    name: "first-run setup and capability exploration gives orientation, not reminders",
    messageText:
      "I am setting up ME3 for the first time. I want to explore what you can do, ie profile, calendar reminders/events, mission control, tasks, projects, and what context you have available. Make sense?",
    aiReply:
      "Yes. Available now: chat, reminders, contacts, and context summaries. Needs setup: calendar sync and mailbox. Try asking what context I have, listing reminders, or drafting a reply.",
    withAi: true,
    envState: {
      reminders: [
        reminderRow("reminder-existing", "Ship ME3", "2026-06-07T09:00:00.000Z"),
      ],
      projects: [projectRow("project-launch", "ME3 Launch", "me3-launch")],
      tasks: [taskRow("task-launch", "Prepare launch checklist", "project-launch")],
    },
    expected: {
      source: "workers-ai",
      routePath: "model",
      plannerKind: "conversation",
      capabilityId: "core.agent-chat.conversation",
      toolResultStatus: "not_attempted",
      modelCallStatus: "succeeded",
      replyIncludes: ["Available now", "Needs setup", "Try asking"],
      contextSummary: "present",
      reminderActionKind: null,
      emailActionKind: null,
      reminderDelta: 0,
      mailboxDraftDelta: 0,
      aiCalled: true,
    },
  },
  {
    name: "tool access question stays model-first",
    messageText: "What tools can you access here?",
    aiReply:
      "I can talk through ME3 capabilities and, when you ask directly, use safe tools like reminders, bookings, and mailbox drafts.",
    withAi: true,
    expected: {
      source: "workers-ai",
      routePath: "model",
      plannerKind: "conversation",
      capabilityId: "core.agent-chat.conversation",
      toolResultStatus: "not_attempted",
      modelCallStatus: "succeeded",
      replyIncludes: ["ME3 capabilities"],
      contextSummary: "present",
      reminderActionKind: null,
      emailActionKind: null,
      reminderDelta: 0,
      mailboxDraftDelta: 0,
      aiCalled: true,
    },
  },
  {
    name: "context question stays model-first and includes context evidence",
    messageText: "What context do you know about me?",
    aiReply:
      "I can see your owner profile, timezone, recent assistant history, and relevant ME3 context when it matches your request.",
    withAi: true,
    envState: {
      memory: [
        memoryRow(
          "memory-owner-focus",
          "owner_note",
          "The owner wants ME3 to feel dependable during setup.",
          "owner",
          null,
        ),
      ],
    },
    expected: {
      source: "workers-ai",
      routePath: "model",
      plannerKind: "conversation",
      capabilityId: "core.agent-chat.conversation",
      toolResultStatus: "not_attempted",
      modelCallStatus: "succeeded",
      replyIncludes: ["owner profile", "timezone"],
      contextSummary: "present",
      reminderActionKind: null,
      emailActionKind: null,
      reminderDelta: 0,
      mailboxDraftDelta: 0,
      aiCalled: true,
    },
  },
  {
    name: "calendar exploration with reminders mentioned does not list reminders",
    messageText:
      "I want to explore calendar events, reminders, and availability, but don't create or list anything yet.",
    aiReply:
      "We can explore how calendar events, reminders, and availability fit together without taking action yet.",
    withAi: true,
    envState: {
      reminders: [
        reminderRow("reminder-existing", "Ship ME3", "2026-06-07T09:00:00.000Z"),
      ],
      calendarEvents: [
        calendarEventRow(
          "event-planning",
          "Planning call",
          "2026-06-02T10:00:00.000Z",
          "2026-06-02T10:30:00.000Z",
        ),
      ],
    },
    expected: {
      source: "workers-ai",
      routePath: "model",
      plannerKind: "conversation",
      capabilityId: "core.agent-chat.conversation",
      toolResultStatus: "not_attempted",
      modelCallStatus: "succeeded",
      replyIncludes: ["without taking action"],
      contextSummary: "present",
      reminderActionKind: null,
      emailActionKind: null,
      reminderDelta: 0,
      mailboxDraftDelta: 0,
      aiCalled: true,
    },
  },
  {
    name: "Task exploration stays model-first",
    messageText:
      "I want to explore tasks and projects. What would you use there?",
    aiReply:
      "I would use projects, tasks, and private memory as context before suggesting next steps.",
    withAi: true,
    envState: {
      projects: [projectRow("project-launch", "ME3 Launch", "me3-launch")],
      tasks: [taskRow("task-launch", "Prepare launch checklist", "project-launch")],
    },
    expected: {
      source: "workers-ai",
      routePath: "model",
      plannerKind: "conversation",
      capabilityId: "core.agent-chat.conversation",
      toolResultStatus: "not_attempted",
      modelCallStatus: "succeeded",
      replyIncludes: ["projects", "tasks"],
      contextSummary: "present",
      reminderActionKind: null,
      emailActionKind: null,
      reminderDelta: 0,
      mailboxDraftDelta: 0,
      aiCalled: true,
    },
  },
  {
    name: "Task prioritisation stays model-first with context",
    messageText: "Help me prioritise my tasks based on my goals.",
    aiReply:
      "Start with Prepare launch checklist because it supports the launch goal, then review lower-priority backlog items.",
    withAi: true,
    envState: {
      missionDashboardSettings: {
        user_id: "owner",
        mission_statement: "Launch ME3 with a dependable assistant.",
        settings_json: JSON.stringify({ mainGoal: "Ship the launch checklist" }),
      },
      projects: [projectRow("project-launch", "ME3 Launch", "me3-launch")],
      tasks: [taskRow("task-launch", "Prepare launch checklist", "project-launch")],
    },
    expected: {
      source: "workers-ai",
      routePath: "model",
      plannerKind: "conversation",
      capabilityId: "core.agent-chat.conversation",
      toolResultStatus: "not_attempted",
      modelCallStatus: "succeeded",
      replyIncludes: ["Prepare launch checklist"],
      contextSummary: "present",
      reminderActionKind: null,
      emailActionKind: null,
      reminderDelta: 0,
      mailboxDraftDelta: 0,
      missionTaskDelta: 0,
      aiCalled: true,
    },
  },
  {
    name: "mailbox draft request writes no mailbox state until save is requested",
    messageText: "Can you draft a reply to Ada about the workflow notes?",
    aiReply:
      "Subject: Workflow notes\n\nHi Ada,\n\nHere is a concise update on the workflow notes.\n\nBest,\nKieran",
    withAi: true,
    envState: {
      contacts: [contactRow("contact-ada", "Ada Lovelace", "ada@example.com", "client")],
      mailboxMessages: [
        mailboxRow({
          id: "message-ada",
          threadKey: "thread-ada",
          from: "ada@example.com",
          subject: "Workflow notes",
          body: "Ada asked for a crisp workflow update.",
        }),
      ],
    },
    expected: {
      source: "workers-ai",
      routePath: "model",
      plannerKind: "conversation",
      capabilityId: "core.agent-chat.conversation",
      toolResultStatus: "not_attempted",
      modelCallStatus: "succeeded",
      replyIncludes: ["Subject: Workflow notes"],
      contextSummary: "present",
      reminderActionKind: null,
      emailActionKind: null,
      reminderDelta: 0,
      mailboxDraftDelta: 0,
      aiCalled: true,
    },
  },
  {
    name: "booking confirmation email rewrite stays model-first",
    messageText:
      "This is my confirmation email for one of my offerings to set up me3. See can we trim it a little bit: 'Yesss {{ guestName }}! Let's get you set up with ME3. Buy a domain name on GoDaddy.com (or any other provider). Then join my call room on {{ bookingTime }}. Kind regards, Kieran'",
    aiReply:
      "Yesss {{ guestName }}! Let's get you set up with ME3. Please have GitHub, Cloudflare, and a domain ready before our call: {{ bookingTime }}. Kind regards, Kieran",
    withAi: true,
    envState: {
      bookings: [
        {
          id: "booking-1",
          site_id: "site-1",
          site_username: "kieran",
          offer_id: "setup",
          booking_type: "one_to_one",
          guest_name: "Sarah Test",
          guest_email: "sarah@example.com",
          starts_at: "2026-06-02T10:00:00.000Z",
          ends_at: "2026-06-02T10:30:00.000Z",
          duration_minutes: 30,
          status: "confirmed",
          notes: null,
          payment_status: "not_required",
          is_free_booking: 1,
          created_at: "2026-05-30T10:00:00.000Z",
        },
      ],
    },
    expected: {
      source: "workers-ai",
      routePath: "model",
      plannerKind: "conversation",
      capabilityId: "core.agent-chat.conversation",
      toolResultStatus: "not_attempted",
      modelCallStatus: "succeeded",
      replyIncludes: ["Yesss {{ guestName }}", "{{ bookingTime }}"],
      contextSummary: "present",
      reminderActionKind: null,
      emailActionKind: null,
      reminderDelta: 0,
      mailboxDraftDelta: 0,
      aiCalled: true,
    },
  },
  {
    name: "missing AI provider falls back without claiming action",
    messageText: "Hello, are you working?",
    expected: {
      source: "fallback",
      routePath: "fallback",
      plannerKind: "conversation",
      capabilityId: "core.agent-chat.conversation",
      toolResultStatus: "not_attempted",
      modelCallStatus: "not_attempted",
      replyIncludes: ["ME3 chat is connected for your ME3 installation"],
      contextSummary: "present",
      reminderActionKind: null,
      emailActionKind: null,
      reminderDelta: 0,
      mailboxDraftDelta: 0,
      aiCalled: false,
      fallbackReason: "AI provider setup required",
    },
  },
];

describe("Core chat golden transcript evals", () => {
  it.each(launchGoldenTranscriptScenarios)("$name", async (scenario) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-31T12:00:00Z"));

    const aiRun = vi.fn(async () => ({
      response: scenario.aiReply || "Model-backed launch eval reply.",
    }));
    const env = createEnv(scenario.envState);
    const initialReminderCount = env.state.reminders.length;
    const initialMailboxDraftCount = countMailboxDrafts(env.state.mailboxMessages);
    const initialMissionTaskCount = env.state.tasks.length;
    const runtimeEnv = {
      ...env,
      ME3_ASSISTANT_DEBUG_TRACE: "true",
      ...(scenario.withAi ? { AI: { run: aiRun } } : {}),
    };

    const response = await dispatchAgentSandboxTurn(
      runtimeEnv as never,
      createStorage(),
      dispatchInput(scenario.messageText),
    );

    expect(response).toMatchObject({
      source: scenario.expected.source,
      specialist: scenario.expected.specialist || expect.any(String),
      fallbackReason: scenario.expected.fallbackReason ?? null,
    });
    expect(response.trace).toMatchObject({
      planner: {
        kind: scenario.expected.plannerKind,
        capabilityId: scenario.expected.capabilityId,
      },
      route: {
        path: scenario.expected.routePath,
        capabilityId: scenario.expected.capabilityId,
      },
      modelCall: {
        status: scenario.expected.modelCallStatus,
      },
      toolResult: {
        status: scenario.expected.toolResultStatus,
      },
    });

    for (const snippet of scenario.expected.replyIncludes || []) {
      expect(response.replyText).toContain(snippet);
    }

    if (scenario.expected.contextSummary === "present") {
      expect(response.contextSummary).toEqual(expect.any(String));
    } else if (scenario.expected.contextSummary === "absent") {
      expect(response.contextSummary ?? null).toBeNull();
    }

    expect(response.reminderAction?.kind ?? null).toBe(
      scenario.expected.reminderActionKind ?? null,
    );
    expect(response.emailAction?.kind ?? null).toBe(
      scenario.expected.emailActionKind ?? null,
    );
    if (response.source !== "tool") {
      expect(response.reminderAction).toBeNull();
      expect(response.emailAction).toBeNull();
      expect(response.replyText).not.toContain("Done. I set a reminder");
      expect(response.replyText).not.toContain("saved that email as a draft");
    }
    expect(env.state.reminders).toHaveLength(
      initialReminderCount + (scenario.expected.reminderDelta ?? 0),
    );
    expect(countMailboxDrafts(env.state.mailboxMessages)).toBe(
      initialMailboxDraftCount + (scenario.expected.mailboxDraftDelta ?? 0),
    );
    expect(env.state.tasks).toHaveLength(
      initialMissionTaskCount + (scenario.expected.missionTaskDelta ?? 0),
    );
    if (scenario.expected.missionTaskStatus) {
      expect(env.state.tasks.at(-1)?.status).toBe(scenario.expected.missionTaskStatus);
    }
    if ("missionTaskDescription" in scenario.expected) {
      expect(env.state.tasks.at(-1)?.description ?? null).toBe(
        scenario.expected.missionTaskDescription ?? null,
      );
    }
    if (scenario.expected.missionTaskArchived) {
      expect(env.state.tasks.at(-1)?.archived_at).toEqual(expect.any(String));
    }
    for (const expectedFile of scenario.expected.siteFileContains || []) {
      expect(siteFileText(env.state.siteFiles, expectedFile.path)).toContain(expectedFile.text);
    }
    for (const missingPath of scenario.expected.siteFileMissing || []) {
      expect(siteFileText(env.state.siteFiles, missingPath)).toBeNull();
    }
    if (scenario.expected.sitePostCount !== undefined) {
      const profile = JSON.parse(siteFileText(env.state.siteFiles, "src/me.json") || "{}") as {
        posts?: unknown[];
      };
      expect(profile.posts || []).toHaveLength(scenario.expected.sitePostCount);
    }
    if (
      scenario.expected.capabilityId === "core.mission.task.create" ||
      scenario.expected.capabilityId === "core.mission.task.update" ||
      scenario.expected.capabilityId === "core.mission.task.archive"
    ) {
      const expectedKind =
        scenario.expected.capabilityId === "core.mission.task.create"
          ? "mission.task_created"
          : scenario.expected.capabilityId === "core.mission.task.update"
            ? "mission.task_updated"
            : "mission.task_archived";
      expect(response.actionCards).toEqual([
        expect.objectContaining({
          kind: expectedKind,
          capabilityId: scenario.expected.capabilityId,
          records: [{ kind: "mission_task", id: env.state.tasks.at(-1)?.id }],
          primaryAction: { label: "Open Tasks", href: "/tasks" },
        }),
      ]);
    }
    if (scenario.expected.aiCalled) {
      expect(aiRun).toHaveBeenCalledOnce();
    } else {
      expect(aiRun).not.toHaveBeenCalled();
    }
  });
});

function contactRow(
  id: string,
  name: string,
  email: string,
  relationship: string,
): Record<string, unknown> {
  return {
    id,
    user_id: "owner",
    name,
    email,
    phone: null,
    source: "manual",
    source_ref: null,
    relationship,
    status: "active",
    notes: `${name} is relevant context.`,
    tags: "[]",
    last_interaction_at: "2026-05-15T10:00:00Z",
    next_followup_at: null,
    outreach_status: null,
    social_handles: "{}",
    metadata: "{}",
    created_at: "2026-05-15T09:00:00Z",
    updated_at: "2026-05-15T10:00:00Z",
  };
}

function mailboxAliasRow(id: string, aliasLocalPart: string): Record<string, unknown> {
  return {
    id,
    user_id: "owner",
    alias_local_part: aliasLocalPart,
    forwarding_email: "owner@example.com",
    forwarding_status: "verified",
    forwarding_enabled: 1,
    forwarding_mode: "forward",
    status: "active",
    approval_policy: "manual",
    daily_inbound_limit: 200,
    daily_outbound_limit: 200,
    activated_at: "2026-05-15T09:00:00Z",
    cf_destination_id: null,
    cf_destination_verified_at: null,
    cf_rule_id: null,
    cf_last_synced_at: null,
    cf_last_error: null,
    created_at: "2026-05-15T09:00:00Z",
    updated_at: "2026-05-15T09:00:00Z",
  };
}

function mailboxRow(input: {
  id: string;
  threadKey: string;
  from: string;
  subject: string;
  body: string;
  metadata?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    id: input.id,
    mailbox_id: "mailbox-owner",
    direction: "inbound",
    message_kind: "email",
    status: "received",
    thread_key: input.threadKey,
    provider_id: "test",
    provider_message_id: input.id,
    from_address: input.from,
    to_address: "owner@example.com",
    subject: input.subject,
    text_body: input.body,
    html_body: null,
    raw_headers_json: null,
    raw_message: null,
    metadata_json: input.metadata ? JSON.stringify(input.metadata) : null,
    source_id: null,
    folder: "inbox",
    read_at: null,
    agent_summary: null,
    agent_labels_json: null,
    forwarded_to: null,
    error_message: null,
    created_by: "system",
    approved_by_user_id: null,
    received_at: "2026-05-15T11:00:00Z",
    approved_at: null,
    sent_at: null,
    created_at: "2026-05-15T11:00:00Z",
  };
}

function reminderRow(id: string, title: string, remindAt: string): Record<string, unknown> {
  return {
    id,
    user_id: "owner",
    title,
    notes: null,
    remind_at: remindAt,
    timezone: "Europe/Dublin",
    recurrence_rule: null,
    status: "pending",
    delivered_at: null,
    dismissed_at: null,
    created_at: "2026-06-01T09:00:00.000Z",
  };
}

function calendarEventRow(
  id: string,
  title: string,
  startsAt: string,
  endsAt: string,
): Record<string, unknown> {
  return {
    id,
    title,
    notes: null,
    starts_at: startsAt,
    ends_at: endsAt,
    timezone: "Europe/Dublin",
    created_at: "2026-05-15T09:00:00Z",
    updated_at: "2026-05-15T09:00:00Z",
  };
}

function missionDashboardSettingsRow(statement: string): Record<string, unknown> {
  return {
    user_id: "owner",
    mission_statement: statement,
    timeframe: "weekly",
    updated_at: "2026-05-15T09:00:00Z",
  };
}

function wheelSnapshotRow(): Record<string, unknown> {
  return {
    id: "wheel-snapshot",
    user_id: "owner",
    segments_json: JSON.stringify([
      { id: "health", label: "Health", value: 7 },
      { id: "work", label: "Work", value: 8 },
      { id: "relationships", label: "Relationships", value: 6 },
    ]),
    notes_json: JSON.stringify({
      work: "Keep useful systems calm and practical.",
    }),
    created_at: "2026-05-15T09:00:00Z",
  };
}

function calendarSourceRow(id: string): Record<string, unknown> {
  return {
    id,
    user_id: "owner",
    provider: "google",
    status: "active",
    created_at: "2026-05-15T09:00:00Z",
  };
}

function profileSiteRow(
  id: string,
  username: string,
  options: { published?: boolean; customDomain?: string | null; customDomainStatus?: string | null } = {},
): Record<string, unknown> {
  return {
    id,
    user_id: "owner",
    username,
    site_type: "profile",
    site_role: "profile",
    custom_domain: options.customDomain || null,
    custom_domain_status: options.customDomainStatus || null,
    published_at: options.published ? "2026-05-15T09:00:00Z" : null,
    created_at: "2026-05-15T09:00:00Z",
    updated_at: "2026-05-15T09:00:00Z",
  };
}

function siteMeJsonRow(
  siteId: string,
  profile: Record<string, unknown>,
  path = "public/me.json",
): Record<string, unknown> {
  return {
    site_id: siteId,
    path,
    content: Array.from(new TextEncoder().encode(JSON.stringify(profile))),
    content_type: "application/json",
    updated_at: "2026-05-15T09:00:00Z",
  };
}

function siteFileRow(
  siteId: string,
  path: string,
  text: string,
  contentType = "text/markdown",
): Record<string, unknown> {
  return {
    site_id: siteId,
    path,
    content: text,
    content_type: contentType,
    updated_at: "2026-05-15T09:00:00Z",
  };
}

function pluginInstallationRow(
  pluginId: string,
  status: string,
  enabled = 1,
): Record<string, unknown> {
  return {
    plugin_id: pluginId,
    version: "0.1.0",
    enabled,
    status,
    installed_at: "2026-05-15T09:00:00Z",
    updated_at: "2026-05-15T09:00:00Z",
  };
}

function assistantJobRow(id: string, status: string): Record<string, unknown> {
  return {
    id,
    user_id: "owner",
    name: id,
    purpose: "Test setup readiness.",
    status,
    archived_at: null,
    created_at: "2026-05-15T09:00:00Z",
    updated_at: "2026-05-15T09:00:00Z",
  };
}

function soulinkConnectionRow(id: string): Record<string, unknown> {
  return {
    id,
    user_id: "owner",
    channel: "soulink",
    status: "active",
    created_at: "2026-05-15T09:00:00Z",
  };
}

function telegramConnectionRow(id: string): Record<string, unknown> {
  return {
    id,
    user_id: "owner",
    channel: "telegram",
    status: "active",
    telegram_user_id: "123",
    telegram_chat_id: "456",
    telegram_username: "owner",
    created_at: "2026-05-15T09:00:00Z",
  };
}

function localExecutorPairingRow(id: string): Record<string, unknown> {
  return {
    id,
    user_id: "owner",
    status: "active",
    created_at: "2026-05-15T09:00:00Z",
  };
}

function countMailboxDrafts(messages: Array<Record<string, unknown>>): number {
  return messages.filter((message) => message.message_kind === "draft").length;
}

function projectRow(id: string, name: string, slug: string): Record<string, unknown> {
  return {
    id,
    name,
    slug,
    description: `${name} project context.`,
    status: "active",
    source_ref: null,
    updated_at: "2026-05-15T12:00:00Z",
  };
}

function taskRow(id: string, title: string, projectId: string): Record<string, unknown> {
  return {
    id,
    user_id: "owner",
    project_id: projectId,
    column_id: `${projectId}:in_progress`,
    title,
    description: null,
    status: "in_progress",
    priority: 3,
    due_at: "2026-05-20",
    scheduled_for: null,
    source_kind: "manual",
    source_ref: null,
    metadata_json: null,
    created_at: "2026-05-15T12:30:00Z",
    updated_at: "2026-05-15T12:30:00Z",
    archived_at: null,
  };
}

function memoryRow(
  id: string,
  kind: string,
  body: string,
  scopeKind: string,
  scopeId: string | null,
): Record<string, unknown> {
  return {
    id,
    memory_kind: kind,
    scope_kind: scopeKind,
    scope_id: scopeId,
    title: kind,
    body,
    confidence: 1,
    source_ref: null,
    updated_at: "2026-05-15T13:00:00Z",
  };
}
