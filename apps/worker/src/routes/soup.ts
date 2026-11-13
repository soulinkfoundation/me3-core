import { JournalInputError } from "../journal";
import { isCorePluginEnabled } from "../plugins";
import { actOnSoupServing, getSoupServing, listOpenSoupServings, serveSoupNow } from "../soup-servings";
import { SOUP_PLUGIN_ID, getSoupTaste, updateSoupTaste } from "../soup-taste";
import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";

// News (me3-6ptk), on the Soup code from me3-ydf4. Topics and papers stay in ME3; these routes only ever
// talk to the owner's own install. The web app uses /api/news/*; /api/soup/* answers the same way for the
// iOS and Android apps already released with the Soup card.
export function registerSoupRoutes(app: AppHono, deps: OwnerRouteDeps) {
  for (const base of ["/api/news", "/api/soup"]) registerUnder(app, deps, base, base === "/api/news" ? "settings" : "taste");
}

function registerUnder(app: AppHono, deps: OwnerRouteDeps, base: string, settings: string) {
  app.use(`${base}/*`, async (c, next) => {
    const owner = await deps.requireOwner(c); if (!owner) return deps.unauthorized(c);
    if (!await isCorePluginEnabled(c.env, SOUP_PLUGIN_ID)) return c.json({ error: "News is disabled" }, 403);
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
  app.get(`${base}/today`, c => run(c, async () => {
    const ownerId = await owner(c);
    const [taste, servings] = await Promise.all([getSoupTaste(c.env, ownerId), listOpenSoupServings(c.env, ownerId)]);
    return { setUp: taste.setUp, servings: taste.setUp ? servings : [], servingSpecs: taste.taste.servings };
  }));
  app.get(`${base}/${settings}`, c => run(c, async () => getSoupTaste(c.env, await owner(c))));
  app.patch(`${base}/${settings}`, c => run(c, async () => updateSoupTaste(c.env, await owner(c), await body(c))));
  app.get(`${base}/servings/:id`, c => run(c, async () => {
    const serving = await getSoupServing(c.env, await owner(c), c.req.param("id"));
    if (!serving) throw new JournalInputError("Serving not found", 404);
    return { serving };
  }));
  app.post(`${base}/servings/:id/act`, c => run(c, async () => ({ serving: await actOnSoupServing(c.env, await owner(c), c.req.param("id"), await body(c)) })));
  // Serve one of the chosen servings now (the ⋯ menu's "Serve now", and local testing without waiting for the morning).
  app.post(`${base}/serve`, c => run(c, async () => {
    const input = await body(c);
    const servingId = typeof input?.servingId === "string" && input.servingId ? input.servingId : "morning";
    const serving = await serveSoupNow(c.env, await owner(c), servingId);
    if (!serving) throw new JournalInputError("Nothing new turned up just now. Try again in a while.", 404);
    return { serving };
  }));
}
