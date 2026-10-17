import { getHomeLayout, saveHomeLayout } from "../home-layout";
import { JournalInputError } from "../journal";
import type { AppHono, OwnerRouteDeps } from "../http/types";

export function registerHomeRoutes(app: AppHono, deps: OwnerRouteDeps) {
  app.use("/api/home/*", async (c, next) => {
    const owner = await deps.requireOwner(c); if (!owner) return deps.unauthorized(c);
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  app.get("/api/home/layout", async c => c.json(await getHomeLayout(c.env, (await deps.requireOwner(c))!)));
  app.put("/api/home/layout", async c => {
    try { return c.json(await saveHomeLayout(c.env, (await deps.requireOwner(c))!, await c.req.json().catch(() => null))); }
    catch (error) { if (error instanceof JournalInputError) return c.json({ error: error.message }, error.status); throw error; }
  });
}
