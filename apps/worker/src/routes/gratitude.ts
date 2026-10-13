import { getGratitudeState, updateGratitudeLines, updateGratitudeSettings } from "../gratitude";
import { JournalInputError } from "../journal";
import { isCorePluginEnabled } from "../plugins";
import type { AppHono, OwnerRouteDeps } from "../http/types";

export function registerGratitudeRoutes(app: AppHono, deps: OwnerRouteDeps) {
  app.use("/api/gratitude*", async (c, next) => {
    const owner = await deps.requireOwner(c); if (!owner) return deps.unauthorized(c);
    if (!await isCorePluginEnabled(c.env, "me3.journal")) return c.json({ error: "ME3 Journal is disabled" }, 403);
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  app.get("/api/gratitude", async c => c.json(await getGratitudeState(c.env, (await deps.requireOwner(c))!)));
  app.patch("/api/gratitude/lines", async c => {
    try { return c.json(await updateGratitudeLines(c.env, (await deps.requireOwner(c))!, await c.req.json().catch(() => null))); }
    catch (error) { if (error instanceof JournalInputError) return c.json({ error: error.message }, error.status); throw error; }
  });
  app.patch("/api/gratitude/settings", async c => {
    try { return c.json(await updateGratitudeSettings(c.env, (await deps.requireOwner(c))!, await c.req.json().catch(() => null))); }
    catch (error) { if (error instanceof JournalInputError) return c.json({ error: error.message }, error.status); throw error; }
  });
}
