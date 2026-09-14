import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";
import { isCorePluginEnabled } from "../plugins";
import { MissionControlInputError } from "../workspace-input";
import {
  getMissionWheel,
  updateMissionWheelSettings,
  createMissionWheelSnapshot,
  listMissionWheelSnapshots,
} from "../wheel-of-life";

export function registerWheelOfLifeRoutes(app: AppHono, deps: OwnerRouteDeps) {
  app.on("GET", ["/api/journal/wheel", "/api/mission-control/wheel"], async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireJournalPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await getMissionWheel(c.env, ownerId));
    } catch (error) {
      return wheelErrorResponse(c, error);
    }
  });

  app.on("PATCH", ["/api/journal/wheel/settings", "/api/mission-control/wheel/settings"], async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireJournalPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await updateMissionWheelSettings(
          c.env,
          ownerId,
          await c.req.json().catch(() => ({})),
        ),
      );
    } catch (error) {
      return wheelErrorResponse(c, error);
    }
  });

  app.on("GET", ["/api/journal/wheel/snapshots", "/api/mission-control/wheel/snapshots"], async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireJournalPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await listMissionWheelSnapshots(c.env, ownerId, c.req.query("limit")),
      );
    } catch (error) {
      return wheelErrorResponse(c, error);
    }
  });

  app.on("POST", ["/api/journal/wheel/snapshots", "/api/mission-control/wheel/snapshots"], async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireJournalPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(
        await createMissionWheelSnapshot(
          c.env,
          ownerId,
          await c.req.json().catch(() => ({})),
        ),
        201,
      );
    } catch (error) {
      return wheelErrorResponse(c, error);
    }
  });

}

async function requireJournalPlugin(c: AppContext) {
  if (await isCorePluginEnabled(c.env, "me3.journal")) return null;
  return c.json({ ok: false, error: "Journal is disabled" }, 403);
}

function wheelErrorResponse(c: AppContext, error: unknown) {
  if (error instanceof MissionControlInputError) {
    return c.json({ ok: false, error: error.message }, error.status);
  }
  throw error;
}
