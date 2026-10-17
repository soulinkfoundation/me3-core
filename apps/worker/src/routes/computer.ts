import { ComputerRequestError, getComputerJob, getComputerSettings, listComputerJobViews, saveComputerSettings } from "../agent-computer";
import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";

/** Owner-facing agent computer: availability, limits, jobs and cancel. Live browser sessions stay in ME3_AGENT. */
export function registerComputerRoutes(app: AppHono, deps: OwnerRouteDeps) {
  for (const path of ["/api/computer", "/api/computer/*"]) app.use(path, async (c, next) => {
    const owner = await deps.requireOwner(c); if (!owner) return deps.unauthorized(c);
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  const owner = async (c: AppContext) => (await deps.requireOwner(c))!;
  const handle = async (c: AppContext, work: () => Promise<unknown>) => {
    try { return c.json(await work()); }
    catch (error) { if (error instanceof ComputerRequestError) return c.json({ error: error.message }, error.status); throw error; }
  };
  app.get("/api/computer", c => handle(c, async () => {
    const ownerId = await owner(c);
    return { ...await getComputerSettings(c.env, ownerId), jobs: await listComputerJobViews(c.env, ownerId, { limit: 10 }) };
  }));
  app.put("/api/computer/settings", c => handle(c, async () => saveComputerSettings(c.env, await owner(c), await c.req.json().catch(() => null))));
  app.get("/api/computer/jobs", c => handle(c, async () => ({ jobs: await listComputerJobViews(c.env, await owner(c), { threadId: c.req.query("threadId") || undefined, limit: Number(c.req.query("limit")) || 10 }) })));
  app.get("/api/computer/jobs/:id", c => handle(c, async () => ({ job: await getComputerJob(c.env, await owner(c), c.req.param("id")) })));
  app.post("/api/computer/jobs/:id/cancel", c => handle(c, async () => {
    const ownerId = await owner(c), jobId = c.req.param("id");
    await getComputerJob(c.env, ownerId, jobId);
    const namespace = c.env.ME3_AGENT;
    if (!namespace) throw new ComputerRequestError("Agent runtime is unavailable", 503);
    const response = await namespace.get(namespace.idFromName(ownerId)).fetch("https://me3-agent/computer/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: ownerId, jobId }) });
    if (!response.ok) throw new ComputerRequestError("The job could not be cancelled", 409);
    return { job: await getComputerJob(c.env, ownerId, jobId) };
  }));
}
