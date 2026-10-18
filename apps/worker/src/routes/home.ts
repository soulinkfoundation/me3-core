import { getHomeLayout, saveHomeLayout } from "../home-layout";
import { actOnHomeCard, createHomeCard, deleteHomeCard, getHomeCard, listHomeCards, rollbackHomeCard, updateHomeCard } from "../home-cards";
import { JournalInputError } from "../journal";
import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";

export function registerHomeRoutes(app: AppHono, deps: OwnerRouteDeps) {
  app.use("/api/home/*", async (c, next) => {
    const owner = await deps.requireOwner(c); if (!owner) return deps.unauthorized(c);
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  const owner = async (c: AppContext) => (await deps.requireOwner(c))!;
  const body = (c: AppContext) => c.req.json().catch(() => null);
  const run = async (c: AppContext, work: () => Promise<unknown>) => {
    try { return c.json(await work()); }
    catch (error) { if (error instanceof JournalInputError) return c.json({ error: error.message }, error.status); throw error; }
  };
  app.get("/api/home/layout", async c => c.json(await getHomeLayout(c.env, await owner(c))));
  app.put("/api/home/layout", c => run(c, async () => saveHomeLayout(c.env, await owner(c), await body(c))));
  // Custom cards: built by ME3 from chat or by the owner; drawn natively by every client.
  app.get("/api/home/cards", async c => c.json(await listHomeCards(c.env, await owner(c))));
  app.post("/api/home/cards", c => run(c, async () => createHomeCard(c.env, await owner(c), await body(c), "owner")));
  app.get("/api/home/cards/:id", c => run(c, async () => getHomeCard(c.env, await owner(c), c.req.param("id"))));
  app.patch("/api/home/cards/:id", c => run(c, async () => { const input = await body(c); return updateHomeCard(c.env, await owner(c), c.req.param("id"), input, input?.summary ?? "Changed by you"); }));
  app.post("/api/home/cards/:id/act", c => run(c, async () => actOnHomeCard(c.env, await owner(c), c.req.param("id"), await body(c))));
  app.post("/api/home/cards/:id/rollback", c => run(c, async () => rollbackHomeCard(c.env, await owner(c), c.req.param("id"), (await body(c))?.version)));
  app.delete("/api/home/cards/:id", c => run(c, async () => deleteHomeCard(c.env, await owner(c), c.req.param("id"))));
}
