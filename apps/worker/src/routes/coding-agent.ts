import type { AppHono, OwnerRouteDeps } from "../http/types";
import { CodingAgentError, connectCodingAgent, disconnectCodingAgent, getCodingAgentConnection, listCodingTasks } from "../coding-agent";

export function registerCodingAgentRoutes(app: AppHono, deps: OwnerRouteDeps) {
  const handle = async (run: () => Promise<unknown>, c: Parameters<OwnerRouteDeps["requireOwner"]>[0]) => {
    try {
      return c.json(await run());
    } catch (error) {
      if (error instanceof CodingAgentError) return c.json({ ok: false, error: error.message }, error.status);
      throw error;
    }
  };
  app.get("/api/coding-agent", async (c) => {
    if (!(await deps.requireOwner(c))) return deps.unauthorized(c);
    return c.json(await getCodingAgentConnection(c.env));
  });
  app.put("/api/coding-agent", async (c) => {
    if (!(await deps.requireOwner(c))) return deps.unauthorized(c);
    const body = await c.req.json<{ token?: unknown }>().catch(() => ({} as { token?: unknown }));
    return handle(() => connectCodingAgent(c.env, body.token), c);
  });
  app.delete("/api/coding-agent", async (c) => {
    if (!(await deps.requireOwner(c))) return deps.unauthorized(c);
    return c.json(await disconnectCodingAgent(c.env));
  });
  app.get("/api/coding-agent/tasks", async (c) => {
    if (!(await deps.requireOwner(c))) return deps.unauthorized(c);
    return handle(() => listCodingTasks(c.env, c.req.query("repository") || undefined), c);
  });
}
