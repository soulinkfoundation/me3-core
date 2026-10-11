import { describe, expect, it } from "vitest";
import { LOCAL_EXECUTOR_PLUGIN_ID } from "@me3-core/plugin-local-executor";
import {
  authenticateLocalExecutorDaemon,
  cancelLocalExecutorRun,
  claimLocalExecutorRun,
  completeLocalExecutorPairing,
  completeLocalExecutorRun,
  createLocalExecutorPolicy,
  createLocalExecutorRun,
  getLocalExecutorSetupState,
  retryLocalExecutorRun,
  startLocalExecutorPairing,
} from "./local-executor";
import type { Env } from "./types";

type PairingRow = Record<string, unknown> & {
  id: string;
  user_id: string;
  runner_id: string;
  display_name: string;
  token_hash: string;
  status: string;
};
type PolicyRow = Record<string, unknown> & { id: string; user_id: string; status: string };
type RunRow = Record<string, unknown> & {
  id: string;
  user_id: string;
  status: string;
  runner_id: string | null;
  approval_id: string | null;
};

type LocalExecutorDbState = {
  pairings: PairingRow[];
  policies: PolicyRow[];
  runs: RunRow[];
  missionTasks: Record<string, unknown>[];
  runEvents: Record<string, unknown>[];
  audit: Record<string, unknown>[];
  approvals: Record<string, unknown>[];
  missionRuns: Record<string, unknown>[];
  missionEvents: Record<string, unknown>[];
  pluginActivities: Record<string, unknown>[];
  pluginInstallations: Array<{ plugin_id: string; enabled: number; status: string }>;
};

describe("Local Executor worker runtime", () => {
  it("reports setup-missing until the plugin, pairing, and policy are ready", async () => {
    const env = createLocalExecutorEnv();

    expect(await getLocalExecutorSetupState(env, "owner")).toMatchObject({
      pluginEnabled: false,
      paired: false,
      hasProjectPolicy: false,
      ready: false,
    });
    await expect(createLocalExecutorRun(env, "owner", { prompt: "Fix it" })).rejects.toMatchObject({
      message: "Local Executor plugin is disabled",
      status: 403,
    });
  });

  it("rejects bad daemon tokens and accepts paired daemon tokens", async () => {
    const env = createReadyPluginEnv();
    const started = await startLocalExecutorPairing(env, "owner", { runnerId: "desktop" }, {
      apiBase: "https://core.test/api/local-executor",
    });
    const paired = await completeLocalExecutorPairing(env, {
      code: started.code,
      runnerId: "desktop",
      displayName: "Desktop",
    });

    await expect(
      authenticateLocalExecutorDaemon(env, "Bearer not-a-real-token"),
    ).rejects.toMatchObject({
      message: "Daemon token was not accepted",
      status: 401,
    });

    await expect(
      authenticateLocalExecutorDaemon(env, `Bearer ${paired.token.token}`),
    ).resolves.toMatchObject({
      pairing: expect.objectContaining({ runner_id: "desktop", status: "active" }),
    });
  });

  it("lets a manual owner-directed run be claimed and recorded in Mission Control", async () => {
    const env = createReadyPluginEnv();
    const paired = await pairRunner(env);
    const auth = await authenticateLocalExecutorDaemon(env, `Bearer ${paired.token.token}`);
    const policy = await createLocalExecutorPolicy(env, "owner", {
      projectLabel: "ME3",
      pathHint: "/Users/kieranbutler/Coding/me3",
    });
    const created = await createLocalExecutorRun(env, "owner", {
      projectPolicyId: policy.policy.id,
      prompt: "Implement the smallest useful fix.",
    });

    expect(created.run.status).toBe("queued");
    const claimed = await claimLocalExecutorRun(env, auth, {});
    expect(claimed.run).toMatchObject({
      id: created.run.id,
      status: "running",
      prompt: "Implement the smallest useful fix.",
      policy: expect.objectContaining({
        landingPolicy: "report_only",
        providerPreset: "opencode",
      }),
    });

    const completed = await completeLocalExecutorRun(env, auth, created.run.id, {
      status: "succeeded",
      summary: "Changed two files and pnpm build passed.",
      changedFiles: ["apps/worker/src/local-executor.ts", "packages/local-executor/src/index.ts"],
      qualityGates: [{ command: "pnpm build", status: "passed" }],
      artifacts: [{ kind: "local_log", path: "run.log", bytes: 100 }],
    });

    expect(completed.run.status).toBe("succeeded");
    expect(env.__state.missionRuns[0]).toMatchObject({
      source: "daemon",
      status: "succeeded",
      runner_id: "desktop",
    });
    expect(JSON.parse(env.__state.missionRuns[0]?.result_json as string)).toMatchObject({
      localExecutorRunId: created.run.id,
      status: "succeeded",
    });
  });

  it("links Mission Control tasks, dedupes active task runs, and moves successes to done", async () => {
    const env = createReadyPluginEnv();
    env.__state.missionTasks.push({
      id: "task-1",
      user_id: "owner",
      status: "in_progress",
      archived_at: null,
    });
    const paired = await pairRunner(env);
    const auth = await authenticateLocalExecutorDaemon(env, `Bearer ${paired.token.token}`);
    const policy = await createLocalExecutorPolicy(env, "owner", {
      projectLabel: "ME3",
      pathHint: "/Users/kieranbutler/Coding/me3",
    });

    const created = await createLocalExecutorRun(env, "owner", {
      projectPolicyId: policy.policy.id,
      prompt: "Implement the smallest useful fix.",
      missionProjectId: "project-1",
      missionTaskId: "task-1",
    });
    const duplicate = await createLocalExecutorRun(env, "owner", {
      projectPolicyId: policy.policy.id,
      prompt: "Implement the smallest useful fix again.",
      missionProjectId: "project-1",
      missionTaskId: "task-1",
    });

    expect(duplicate.run.id).toBe(created.run.id);
    expect(env.__state.runs).toHaveLength(1);
    expect(env.__state.missionRuns[0]).toMatchObject({
      project_id: "project-1",
      task_id: "task-1",
    });
    expect(JSON.parse(env.__state.missionRuns[0]?.result_json as string)).toMatchObject({
      localExecutorRunId: created.run.id,
      localExecutorTaskId: "task-1",
    });

    await claimLocalExecutorRun(env, auth, {});
    await completeLocalExecutorRun(env, auth, created.run.id, {
      status: "succeeded",
      summary: "Changed two files and pnpm build passed.",
    });

    expect(env.__state.missionTasks[0]).toMatchObject({
      id: "task-1",
      status: "done",
    });
    expect(env.__state.missionRuns[0]).toMatchObject({
      task_id: "task-1",
      status: "succeeded",
    });
  });

  it("requires approval before scheduled or event runs can be claimed", async () => {
    const env = createReadyPluginEnv();
    const paired = await pairRunner(env);
    const auth = await authenticateLocalExecutorDaemon(env, `Bearer ${paired.token.token}`);
    const policy = await createLocalExecutorPolicy(env, "owner", {
      projectLabel: "ME3",
      pathHint: "/Users/kieranbutler/Coding/me3",
    });

    const created = await createLocalExecutorRun(env, "owner", {
      projectPolicyId: policy.policy.id,
      prompt: "Run scheduled checks.",
      sourceKind: "event",
      ownerDirected: false,
    });

    expect(created.run.status).toBe("waiting_for_approval");
    expect(created.approvalId).toEqual(expect.any(String));
    expect(await claimLocalExecutorRun(env, auth, {})).toEqual({ ok: true, run: null });

    env.__state.approvals[0]!.status = "approved";
    expect(await claimLocalExecutorRun(env, auth, {})).toMatchObject({
      ok: true,
      run: expect.objectContaining({ id: created.run.id, status: "running" }),
    });
  });

  it("lets the owner cancel and retry a stuck local run", async () => {
    const env = createReadyPluginEnv();
    const paired = await pairRunner(env);
    const auth = await authenticateLocalExecutorDaemon(env, `Bearer ${paired.token.token}`);
    const policy = await createLocalExecutorPolicy(env, "owner", {
      projectLabel: "ME3",
      pathHint: "/Users/kieranbutler/Coding/me3",
    });
    const created = await createLocalExecutorRun(env, "owner", {
      projectPolicyId: policy.policy.id,
      prompt: "Fix the stuck run path.",
    });
    await claimLocalExecutorRun(env, auth, {});

    const cancelled = await cancelLocalExecutorRun(env, "owner", created.run.id, {
      reason: "Runner was stopped locally.",
    });
    expect(cancelled.run).toMatchObject({
      id: created.run.id,
      status: "cancelled",
      errorCode: "owner_cancelled",
    });

    const retried = await retryLocalExecutorRun(env, "owner", created.run.id, {});
    expect(retried.run).toMatchObject({
      id: created.run.id,
      status: "queued",
      runnerId: null,
      startedAt: null,
      finishedAt: null,
      errorCode: null,
    });
    expect(env.__state.runEvents.map((event) => event.event_type)).toEqual(
      expect.arrayContaining(["cancelled", "retried"]),
    );
    expect(env.__state.missionRuns.at(-1)).toMatchObject({
      status: "queued",
      runner_id: null,
    });
  });
});

async function pairRunner(env: LocalExecutorTestEnv) {
  const started = await startLocalExecutorPairing(env, "owner", { runnerId: "desktop" }, {
    apiBase: "https://core.test/api/local-executor",
  });
  return completeLocalExecutorPairing(env, {
    code: started.code,
    runnerId: "desktop",
    displayName: "Desktop",
  });
}

function createReadyPluginEnv() {
  return createLocalExecutorEnv({
    pluginInstallations: [
      {
        plugin_id: LOCAL_EXECUTOR_PLUGIN_ID,
        enabled: 1,
        status: "installed",
      },
    ],
  });
}

type LocalExecutorTestEnv = Env & { __state: LocalExecutorDbState };

function createLocalExecutorEnv(overrides: Partial<LocalExecutorDbState> = {}): LocalExecutorTestEnv {
  const state: LocalExecutorDbState = {
    pairings: [],
    policies: [],
    runs: [],
    missionTasks: [],
    runEvents: [],
    audit: [],
    approvals: [],
    missionRuns: [],
    missionEvents: [],
    pluginActivities: [],
    pluginInstallations: [],
    ...overrides,
  };

  const db = {
    prepare(sql: string) {
      return new FakeLocalExecutorStatement(state, sql);
    },
  };

  return { DB: db as unknown as D1Database, __state: state };
}

class FakeLocalExecutorStatement {
  private values: unknown[] = [];

  constructor(
    private readonly state: LocalExecutorDbState,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async run() {
    const { sql, values } = this;

    if (sql.includes("INSERT INTO local_executor_pairings")) {
      this.state.pairings.push({
        id: values[0] as string,
        user_id: values[1] as string,
        runner_id: values[2] as string,
        display_name: values[3] as string,
        public_key: null,
        token_hash: values[4] as string,
        status: "pending",
        version: null,
        platform: null,
        last_seen_at: null,
        health_json: values[5] as string,
        paired_at: null,
        revoked_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      return { success: true };
    }

    if (sql.includes("UPDATE local_executor_pairings") && sql.includes("paired_at")) {
      const pairing = this.state.pairings.find((candidate) => candidate.id === values[9]);
      if (pairing) {
        pairing.runner_id = values[0] as string;
        pairing.display_name = values[1] as string;
        pairing.token_hash = values[2] as string;
        pairing.status = "active";
        pairing.version = values[3] as string | null;
        pairing.platform = values[4] as string | null;
        pairing.paired_at = values[5] as string;
        pairing.last_seen_at = values[6] as string;
        pairing.health_json = values[7] as string;
        pairing.updated_at = values[8] as string;
      }
      return { success: true };
    }

    if (sql.includes("UPDATE local_executor_pairings")) {
      const pairing = this.state.pairings.find((candidate) => candidate.id === values[5]);
      if (pairing) {
        pairing.version = (values[0] as string | null) || (pairing.version as string | null);
        pairing.platform = (values[1] as string | null) || (pairing.platform as string | null);
        pairing.last_seen_at = values[2] as string;
        pairing.health_json = values[3] as string;
        pairing.updated_at = values[4] as string;
      }
      return { success: true };
    }

    if (sql.includes("INSERT INTO local_executor_project_policies")) {
      this.state.policies.push({
        id: values[0] as string,
        user_id: values[1] as string,
        project_label: values[2] as string,
        path_hint: values[3] as string,
        resource_kind: values[4] as string,
        status: "active",
        provider_preset: values[5] as string,
        model_hint: values[6] as string | null,
        default_branch: values[7] as string,
        allowed_git_target: values[8] as string,
        landing_policy: values[9] as string,
        direct_main: values[10] as number,
        command_policy_json: values[11] as string,
        quality_gates_json: values[12] as string,
        caps_json: values[13] as string,
        dirty_repo: values[14] as string,
        created_at: values[15] as string,
        updated_at: values[16] as string,
      });
      return { success: true };
    }

    if (sql.includes("INSERT INTO local_executor_runs")) {
      this.state.runs.push({
        id: values[0] as string,
        user_id: values[1] as string,
        project_policy_id: values[2] as string,
        prompt_summary: values[3] as string,
        prompt_text: values[4] as string,
        source_kind: values[5] as string,
        status: values[6] as string,
        provider: values[7] as string,
        runner_id: null,
        approval_id: values[8] as string | null,
        mission_agent_run_id: values[9] as string,
        started_at: null,
        finished_at: null,
        result_summary: null,
        output_preview: null,
        artifact_manifest_json: "[]",
        changed_files_json: "[]",
        quality_gates_json: "[]",
        error_code: null,
        error_message: null,
        created_at: values[10] as string,
        updated_at: values[11] as string,
      });
      return { success: true };
    }

    if (sql.includes("INSERT INTO mission_approvals")) {
      this.state.approvals.push({
        id: values[0],
        user_id: values[1],
        plugin_id: values[2],
        action_id: values[3],
        title: values[4],
        summary: values[5],
        payload_json: values[6],
        status: "pending",
      });
      return { success: true };
    }

    if (sql.includes("INSERT INTO local_executor_run_events")) {
      this.state.runEvents.push({
        id: values[0],
        run_id: values[1],
        event_type: values[2],
        actor: values[3],
        message: values[4],
        payload_json: values[5],
      });
      return { success: true };
    }

    if (sql.includes("INSERT INTO local_executor_audit_events")) {
      this.state.audit.push({
        id: values[0],
        user_id: values[1],
        pairing_id: values[2],
        project_policy_id: values[3],
        run_id: values[4],
        approval_id: values[5],
        event_type: values[6],
        actor: values[7],
        summary: values[8],
        payload_json: values[9],
      });
      return { success: true };
    }

    if (sql.includes("UPDATE local_executor_runs") && sql.includes("status = 'cancelled'")) {
      const run = this.state.runs.find(
        (candidate) => candidate.id === values[5] && candidate.user_id === values[6],
      );
      if (run) {
        run.status = "cancelled";
        run.finished_at = values[0] as string;
        run.result_summary = values[1] as string;
        run.error_code = values[2] as string;
        run.error_message = values[3] as string | null;
        run.updated_at = values[4] as string;
      }
      return { success: true };
    }

    if (sql.includes("UPDATE local_executor_runs") && sql.includes("status = 'queued'")) {
      const run = this.state.runs.find(
        (candidate) => candidate.id === values[1] && candidate.user_id === values[2],
      );
      if (run) {
        run.status = "queued";
        run.runner_id = null;
        run.started_at = null;
        run.finished_at = null;
        run.result_summary = null;
        run.output_preview = null;
        run.artifact_manifest_json = "[]";
        run.changed_files_json = "[]";
        run.quality_gates_json = "[]";
        run.error_code = null;
        run.error_message = null;
        run.updated_at = values[0] as string;
      }
      return { success: true };
    }

    if (sql.includes("UPDATE local_executor_runs") && sql.includes("status = 'running'")) {
      const run = this.state.runs.find(
        (candidate) => candidate.id === values[3] && candidate.user_id === values[4],
      );
      if (run) {
        run.status = "running";
        run.runner_id = values[0] as string;
        run.started_at = values[1] as string;
        run.updated_at = values[2] as string;
      }
      return { success: true };
    }

    if (sql.includes("UPDATE local_executor_runs")) {
      const run = this.state.runs.find(
        (candidate) => candidate.id === values[10] && candidate.user_id === values[11],
      );
      if (run) {
        run.status = values[0] as string;
        run.finished_at = values[1] as string;
        run.result_summary = values[2] as string;
        run.output_preview = values[3] as string | null;
        run.artifact_manifest_json = values[4] as string;
        run.changed_files_json = values[5] as string;
        run.quality_gates_json = values[6] as string;
        run.error_code = values[7] as string | null;
        run.error_message = values[8] as string | null;
        run.updated_at = values[9] as string;
      }
      return { success: true };
    }

    if (sql.includes("INSERT INTO mission_agent_runs")) {
      const existing = this.state.missionRuns.find((run) => run.id === values[0]);
      const row = {
        id: values[0],
        user_id: values[1],
        source: "daemon",
        project_id: values[2],
        task_id: values[3],
        approval_id: values[4],
        title: values[5],
        prompt_summary: values[6],
        status: values[7],
        model: values[8],
        runner_id: values[9],
        started_at: values[10],
        finished_at: values[11],
        result_json: values[12],
        artifact_manifest_json: values[13],
      };
      if (existing) {
        Object.assign(existing, {
          ...row,
          project_id: row.project_id || existing.project_id,
          task_id: row.task_id || existing.task_id,
        });
      } else {
        this.state.missionRuns.push(row);
      }
      return { success: true };
    }

    if (sql.includes("UPDATE mission_tasks")) {
      const task = this.state.missionTasks.find(
        (candidate) => candidate.id === values[0] && candidate.user_id === values[1],
      );
      if (
        task &&
        task.archived_at === null &&
        task.status !== "done" &&
        task.status !== "cancelled"
      ) {
        task.status = "done";
        task.updated_at = new Date().toISOString();
      }
      return { success: true };
    }

    if (sql.includes("INSERT INTO mission_agent_run_events")) {
      this.state.missionEvents.push({
        id: values[0],
        run_id: values[1],
        event_type: values[2],
        message: values[3],
        payload_json: values[4],
      });
      return { success: true };
    }

    if (sql.includes("INSERT INTO mission_plugin_activity")) {
      this.state.pluginActivities.push({
        id: values[0],
        user_id: values[1],
        plugin_id: values[2],
        title: values[3],
        summary: values[4],
        status: values[5],
        related_id: values[6],
      });
      return { success: true };
    }

    throw new Error(`Unhandled SQL run: ${sql}`);
  }

  async first<T>() {
    const { sql, values } = this;

    if (sql.includes("FROM plugin_installations")) {
      return (
        this.state.pluginInstallations.find((plugin) => plugin.plugin_id === values[0]) || null
      ) as T | null;
    }

    if (sql.includes("FROM local_executor_pairings") && sql.includes("token_hash")) {
      return (
        this.state.pairings.find((pairing) => pairing.token_hash === values[0] && pairing.status === "pending") ||
        null
      ) as T | null;
    }

    if (sql.includes("FROM local_executor_pairings") && sql.includes("WHERE id = ?")) {
      return (this.state.pairings.find((pairing) => pairing.id === values[0]) || null) as T | null;
    }

    if (sql.includes("FROM local_executor_pairings")) {
      return (
        this.state.pairings.find(
          (pairing) => pairing.user_id === values[0] && pairing.status === "active",
        ) || null
      ) as T | null;
    }

    if (sql.includes("FROM local_executor_project_policies") && sql.includes("WHERE id = ?")) {
      return (
        this.state.policies.find(
          (policy) => policy.id === values[0] && policy.user_id === values[1],
        ) || null
      ) as T | null;
    }

    if (sql.includes("FROM local_executor_project_policies")) {
      return (
        this.state.policies.find(
          (policy) => policy.user_id === values[0] && policy.status === "active",
        ) || null
      ) as T | null;
    }

    if (sql.includes("FROM mission_agent_runs") && sql.includes("task_id = ?")) {
      return (
        this.state.missionRuns.find(
          (run) =>
            run.user_id === values[0] &&
            run.task_id === values[1] &&
            run.source === "daemon" &&
            (run.status === "queued" || run.status === "running"),
        ) || null
      ) as T | null;
    }

    if (sql.includes("FROM mission_agent_runs")) {
      return (
        this.state.missionRuns.find((run) => run.id === values[0] && run.user_id === values[1]) ||
        null
      ) as T | null;
    }

    if (sql.includes("FROM local_executor_runs r")) {
      return (
        this.state.runs.find((run) => {
          if (run.user_id !== values[0]) return false;
          if (run.status === "queued") return true;
          if (run.status !== "waiting_for_approval") return false;
          return this.state.approvals.some(
            (approval) => approval.id === run.approval_id && approval.status === "approved",
          );
        }) || null
      ) as T | null;
    }

    if (sql.includes("FROM local_executor_runs")) {
      return (
        this.state.runs.find((run) => run.id === values[0] && run.user_id === values[1]) || null
      ) as T | null;
    }

    throw new Error(`Unhandled SQL first: ${sql}`);
  }

  async all<T>() {
    const { sql, values } = this;

    if (sql.includes("FROM local_executor_pairings")) {
      return {
        results: this.state.pairings.filter(
          (pairing) => pairing.user_id === values[0] && pairing.status !== "revoked",
        ) as T[],
      };
    }
    if (sql.includes("FROM local_executor_project_policies")) {
      return {
        results: this.state.policies.filter(
          (policy) => policy.user_id === values[0] && policy.status !== "revoked",
        ) as T[],
      };
    }
    if (sql.includes("FROM local_executor_runs")) {
      return {
        results: this.state.runs.filter((run) => run.user_id === values[0]) as T[],
      };
    }
    if (sql.includes("FROM local_executor_audit_events")) {
      return {
        results: this.state.audit.filter((event) => event.user_id === values[0]) as T[],
      };
    }
    if (sql.includes("FROM local_executor_run_events")) {
      return {
        results: this.state.runEvents.filter((event) => event.run_id === values[0]) as T[],
      };
    }
    throw new Error(`Unhandled SQL all: ${sql}`);
  }
}
