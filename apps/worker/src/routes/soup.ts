import { JournalInputError } from "../journal";
import { isCorePluginEnabled } from "../plugins";
import { actOnSoupServing, getSoupServing, listOpenSoupServings, serveSoupNow } from "../soup-servings";
import { SOUP_PLUGIN_ID, getSoupTaste, updateSoupTaste } from "../soup-taste";
import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";

// The Human Soup (me3-ydf4). Taste and servings stay in ME3; these routes only ever talk to the owner's own install.
export function registerSoupRoutes(app: AppHono, deps: OwnerRouteDeps) {
  app.use("/api/soup/*", async (c, next) => {
    const owner = await deps.requireOwner(c); if (!owner) return deps.unauthorized(c);
    if (!await isCorePluginEnabled(c.env, SOUP_PLUGIN_ID)) return c.json({ error: "The Human Soup is disabled" }, 403);
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  const owner = async (c: AppContext) => (await deps.requireOwner(c))!;
  const body = (c: AppContext) => c.req.json().catch(() => null);
  const run = async (c: AppContext, work: () => Promise<unknown>) => {
    try { return c.json(await work()); }
    catch (error) { if (error instanceof JournalInputError) return c.json({ error: error.message }, error.status); throw error; }
  };
  // What Home shows: the intro until taste is set up, then only servings that are open right now.
  app.get("/api/soup/today", c => run(c, async () => {
    const ownerId = await owner(c);
    const [taste, servings] = await Promise.all([getSoupTaste(c.env, ownerId), listOpenSoupServings(c.env, ownerId)]);
    return { setUp: taste.setUp, servings: taste.setUp ? servings : [], servingSpecs: taste.taste.servings };
  }));
  app.get("/api/soup/taste", c => run(c, async () => getSoupTaste(c.env, await owner(c))));
  app.patch("/api/soup/taste", c => run(c, async () => updateSoupTaste(c.env, await owner(c), await body(c))));
  app.get("/api/soup/servings/:id", c => run(c, async () => {
    const serving = await getSoupServing(c.env, await owner(c), c.req.param("id"));
    if (!serving) throw new JournalInputError("Serving not found", 404);
    return { serving };
  }));
  app.post("/api/soup/servings/:id/act", c => run(c, async () => ({ serving: await actOnSoupServing(c.env, await owner(c), c.req.param("id"), await body(c)) })));
  // Serve one of the chosen servings now (the ⋯ menu's "Serve now", and local testing without waiting for the morning).
  app.post("/api/soup/serve", c => run(c, async () => {
    const input = await body(c);
    const servingId = typeof input?.servingId === "string" && input.servingId ? input.servingId : "morning";
    const serving = await serveSoupNow(c.env, await owner(c), servingId);
    if (!serving) throw new JournalInputError("The Human Soup had nothing to serve just now. Try again in a while.", 404);
    return { serving };
  }));
}
