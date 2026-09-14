import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";
import { getAiGatewayUsageSummary } from "../ai-gateway";
import { getLiveDailyBriefing } from "../assistant-jobs";
import {
  MissionControlInputError,
  archiveMissionProject,
  approveMissionMemory,
  archiveMissionTask,
  clearMissionActivity,
  createMissionContextSource,
  createMissionMemory,
  createMissionProject,
  createMissionTask,
  createMissionTaskFromJournal,
  deleteMissionContextSource,
  deleteMissionMemory,
  getMissionDaemonStatus,
  getMissionDashboard,
  getMissionDailyBriefing,
  getMissionProjectsSummary,
  getMissionSetup,
  getMissionTaskDetail,
  listMissionAgentRuns,
  listMissionApprovals,
  listMissionContextSources,
  listJournalEntryLinks,
  listMissionMemory,
  listMissionPluginActivity,
  listMissionProjects,
  listMissionTaskPage,
  listMissionDaemonAudit,
  resolveMissionApproval,
  startMissionDaemonPairing,
  submitMissionWeeklyReview,
  submitMissionWeeklyReviewTask,
  suggestMissionMemory,
  updateMissionContextSource,
  updateMissionDashboard,
  updateMissionMemory,
  updateMissionProject,
  updateMissionTask,
} from "../mission-control";
import { isCorePluginEnabled } from "../plugins";

export function registerMissionControlRoutes(app: AppHono, deps: OwnerRouteDeps) {
  app.get("/api/mission-control/projects", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json({ projects: await listMissionProjects(c.env, ownerId) });
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.get("/api/mission-control/dashboard", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await getMissionDashboard(c.env, ownerId));
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.get("/api/mission-control/briefings/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await getMissionDailyBriefing(c.env, ownerId, c.req.param("id")));
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.patch("/api/mission-control/dashboard", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await updateMissionDashboard(
          c.env,
          ownerId,
          await c.req.json().catch(() => ({})),
        ),
      );
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.get("/api/mission-control/dashboard/cards/mission.ai-usage", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await getAiGatewayUsageSummary(c.env, ownerId));
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.get(
    "/api/mission-control/dashboard/cards/mission.daily-briefing",
    async (c) => {
      const ownerId = await deps.requireOwner(c);
      if (!ownerId) return deps.unauthorized(c);
      const blocked = await requireMissionControlPlugin(c);
      if (blocked) return blocked;

      try {
        return c.json(await getLiveDailyBriefing(c.env, ownerId));
      } catch (error) {
        return missionControlErrorResponse(c, error);
      }
    },
  );

  app.get(
    "/api/mission-control/dashboard/cards/mission.projects-summary",
    async (c) => {
      const ownerId = await deps.requireOwner(c);
      if (!ownerId) return deps.unauthorized(c);
      const blocked = await requireMissionControlPlugin(c);
      if (blocked) return blocked;

      try {
        return c.json(await getMissionProjectsSummary(c.env, ownerId));
      } catch (error) {
        return missionControlErrorResponse(c, error);
      }
    },
  );

  app.post("/api/mission-control/projects", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await createMissionProject(c.env, ownerId, await c.req.json().catch(() => ({}))),
        201,
      );
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.patch("/api/mission-control/projects/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await updateMissionProject(
          c.env,
          ownerId,
          c.req.param("id"),
          await c.req.json().catch(() => ({})),
        ),
      );
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.delete("/api/mission-control/projects/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await archiveMissionProject(c.env, ownerId, c.req.param("id")),
      );
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.post("/api/mission-control/journal/tasks", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await createMissionTaskFromJournal(
          c.env,
          ownerId,
          await c.req.json().catch(() => ({})),
        ),
        201,
      );
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.get("/api/mission-control/journal/entries/:id/links", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await listJournalEntryLinks(c.env, ownerId, c.req.param("id")),
      );
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.get("/api/mission-control/tasks", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await listMissionTaskPage(c.env, ownerId, {
          status: c.req.query("status"),
          dueDate: c.req.query("date"),
          activeOnly: c.req.query("active") === "1",
          archived: c.req.query("archived") === "1",
          projectId: c.req.query("projectId"),
          limit: c.req.query("limit"),
          cursor: c.req.query("cursor"),
        }),
      );
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.post("/api/mission-control/tasks", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await createMissionTask(c.env, ownerId, await c.req.json().catch(() => ({}))),
        201,
      );
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.get("/api/mission-control/tasks/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await getMissionTaskDetail(c.env, ownerId, c.req.param("id")));
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.post("/api/mission-control/tasks/:id/weekly-review/submit", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await submitMissionWeeklyReviewTask(
          c.env,
          ownerId,
          c.req.param("id"),
          await c.req.json().catch(() => ({})),
        ),
      );
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.patch("/api/mission-control/tasks/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await updateMissionTask(
          c.env,
          ownerId,
          c.req.param("id"),
          await c.req.json().catch(() => ({})),
        ),
      );
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.delete("/api/mission-control/tasks/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await archiveMissionTask(c.env, ownerId, c.req.param("id")));
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.post("/api/mission-control/weekly-review/:runId/submit", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await submitMissionWeeklyReview(
          c.env,
          ownerId,
          c.req.param("runId"),
          await c.req.json().catch(() => ({})),
        ),
      );
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.get("/api/mission-control/approvals", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json({
        approvals: await listMissionApprovals(c.env, ownerId, c.req.query("status")),
      });
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.post("/api/mission-control/approvals/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await resolveMissionApproval(
          c.env,
          ownerId,
          c.req.param("id"),
          await c.req.json().catch(() => ({})),
        ),
      );
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.get("/api/mission-control/agent-runs", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json({ runs: await listMissionAgentRuns(c.env, ownerId) });
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.get("/api/mission-control/plugin-activity", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json({ activity: await listMissionPluginActivity(c.env, ownerId) });
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.delete("/api/mission-control/activity", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await clearMissionActivity(c.env, ownerId));
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.get("/api/mission-control/memory", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json({ memory: await listMissionMemory(c.env, ownerId) });
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.post("/api/mission-control/memory", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await createMissionMemory(c.env, ownerId, await c.req.json().catch(() => ({}))),
        201,
      );
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.post("/api/mission-control/memory/suggestions", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await suggestMissionMemory(c.env, ownerId, await c.req.json().catch(() => ({}))),
        201,
      );
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.post("/api/mission-control/memory/:id/approve", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await approveMissionMemory(c.env, ownerId, c.req.param("id")));
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.patch("/api/mission-control/memory/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await updateMissionMemory(
          c.env,
          ownerId,
          c.req.param("id"),
          await c.req.json().catch(() => ({})),
        ),
      );
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.delete("/api/mission-control/memory/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await deleteMissionMemory(c.env, ownerId, c.req.param("id")));
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.get("/api/mission-control/context-sources", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json({ sources: await listMissionContextSources(c.env, ownerId) });
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.post("/api/mission-control/context-sources", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await createMissionContextSource(
          c.env,
          ownerId,
          await c.req.json().catch(() => ({})),
        ),
        201,
      );
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.patch("/api/mission-control/context-sources/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await updateMissionContextSource(
          c.env,
          ownerId,
          c.req.param("id"),
          await c.req.json().catch(() => ({})),
        ),
      );
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.delete("/api/mission-control/context-sources/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await deleteMissionContextSource(c.env, ownerId, c.req.param("id")));
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.get("/api/mission-control/setup", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json({ setup: await getMissionSetup(c.env, ownerId) });
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.get("/api/mission-control/daemon/status", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json({ daemon: await getMissionDaemonStatus(c.env, ownerId) });
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.post("/api/mission-control/daemon/pairing/start", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await startMissionDaemonPairing(c.env, ownerId, await c.req.json().catch(() => ({}))),
        201,
      );
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });

  app.get("/api/mission-control/daemon/audit", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireMissionControlPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await listMissionDaemonAudit(c.env, ownerId));
    } catch (error) {
      return missionControlErrorResponse(c, error);
    }
  });
}

async function requireMissionControlPlugin(c: AppContext) {
  if (await isCorePluginEnabled(c.env, "me3.mission-control")) return null;
  return c.json({ ok: false, error: "Tasks and Projects are disabled" }, 403);
}

function missionControlErrorResponse(c: AppContext, error: unknown) {
  if (error instanceof MissionControlInputError) {
    return c.json({ ok: false, error: error.message }, error.status as any);
  }
  throw error;
}
