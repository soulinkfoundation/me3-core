import type { AppHono, OwnerRouteDeps } from "../http/types";
import { getGoals, updateGoals } from "../goals";
import { isCorePluginEnabled } from "../plugins";
import { MissionControlInputError } from "../workspace-input";

export function registerGoalRoutes(app: AppHono, deps: OwnerRouteDeps) {
  app.get("/api/tasks/goals", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    if (!(await isCorePluginEnabled(c.env, "me3.mission-control"))) {
      return c.json({ ok: false, error: "Tasks and Projects are disabled" }, 403);
    }
    return c.json(await getGoals(c.env, ownerId));
  });
  app.patch("/api/tasks/goals", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    if (!(await isCorePluginEnabled(c.env, "me3.mission-control"))) {
      return c.json({ ok: false, error: "Tasks and Projects are disabled" }, 403);
    }
    try {
      return c.json(await updateGoals(c.env, ownerId, await c.req.json().catch(() => null)));
    } catch (error) {
      if (error instanceof MissionControlInputError) {
        return c.json({ ok: false, error: error.message }, error.status);
      }
      throw error;
    }
  });
}
