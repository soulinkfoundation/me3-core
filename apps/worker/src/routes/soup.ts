import { JournalInputError } from "../journal";
import { actOnNewsPaper, buildNewsNow, getNewsPaper, getNewsToday } from "../news-paper";
import { getNewsSettings, updateNewsSettings } from "../news-settings";
import { isCorePluginEnabled } from "../plugins";
import { actOnSoupServing, getSoupServing, listOpenSoupServings, serveSoupNow } from "../soup-servings";
import { SOUP_PLUGIN_ID, getSoupTaste, updateSoupTaste } from "../soup-taste";
import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";

// News (me3-6ptk), on the Soup code from me3-ydf4. Topics and papers stay in ME3; these routes only
// ever talk to the owner's own install.
//   /api/news/*  the web app: settings, today's paper, and the pick ME3 finds when asked in chat.
//   /api/soup/*  the Soup card in iOS and Android apps already released; kept answering until
//                they move to News (me3-6ptk.6).
export function registerSoupRoutes(app: AppHono, deps: OwnerRouteDeps) {
  const owner = async (c: AppContext) => (await deps.requireOwner(c))!;
  const body = (c: AppContext) => c.req.json().catch(() => null);
  const run = async (c: AppContext, work: () => Promise<unknown>) => {
    try { return c.json(await work()); }
    catch (error) { if (error instanceof JournalInputError) return c.json({ error: error.message }, error.status); throw error; }
  };
  for (const base of ["/api/news", "/api/soup"]) {
    app.use(`${base}/*`, async (c, next) => {
      const ownerId = await deps.requireOwner(c); if (!ownerId) return deps.unauthorized(c);
      if (!await isCorePluginEnabled(c.env, SOUP_PLUGIN_ID)) return c.json({ error: "News is disabled" }, 403);
      c.header("Cache-Control", "private, no-store");
      await next();
    });
    // A pick asked for in chat (core_news_serve) is drawn from its stored serving.
    app.get(`${base}/servings/:id`, c => run(c, async () => {
      const serving = await getSoupServing(c.env, await owner(c), c.req.param("id"));
      if (!serving) throw new JournalInputError("Not found", 404);
      return { serving };
    }));
    app.post(`${base}/servings/:id/act`, c => run(c, async () => ({ serving: await actOnSoupServing(c.env, await owner(c), c.req.param("id"), await body(c)) })));
  }

  // ── News ──
  // What Home shows: the intro until News is set up, then today's paper once it is ready.
  app.get("/api/news/today", c => run(c, async () => getNewsToday(c.env, await owner(c))));
  app.get("/api/news/settings", c => run(c, async () => getNewsSettings(c.env, await owner(c))));
  app.patch("/api/news/settings", c => run(c, async () => (await updateNewsSettings(c.env, await owner(c), await body(c))).settings));
  // Build today's paper now: after setup, when News is added back to Home, and for local testing.
  app.post("/api/news/build", c => run(c, async () => {
    const input = await body(c);
    const paper = await buildNewsNow(c.env, await owner(c), { fresh: input?.fresh === true });
    if (!paper) throw new JournalInputError("Today's news could not be put together just now. Try again in a while.", 502);
    return { paper };
  }));
  app.get("/api/news/papers/:id", c => run(c, async () => {
    const paper = await getNewsPaper(c.env, await owner(c), c.req.param("id"));
    if (!paper) throw new JournalInputError("Paper not found", 404);
    return { paper };
  }));
  app.post("/api/news/papers/:id/act", c => run(c, async () => ({ paper: await actOnNewsPaper(c.env, await owner(c), c.req.param("id"), await body(c)) })));

  // ── Released native Soup cards ──
  app.get("/api/soup/today", c => run(c, async () => {
    const ownerId = await owner(c);
    const [taste, servings] = await Promise.all([getSoupTaste(c.env, ownerId), listOpenSoupServings(c.env, ownerId)]);
    return { setUp: taste.setUp, servings: taste.setUp ? servings : [], servingSpecs: taste.taste.servings };
  }));
  app.get("/api/soup/taste", c => run(c, async () => getSoupTaste(c.env, await owner(c))));
  app.patch("/api/soup/taste", c => run(c, async () => updateSoupTaste(c.env, await owner(c), await body(c))));
  app.post("/api/soup/serve", c => run(c, async () => {
    const input = await body(c);
    const servingId = typeof input?.servingId === "string" && input.servingId ? input.servingId : "morning";
    const serving = await serveSoupNow(c.env, await owner(c), servingId);
    if (!serving) throw new JournalInputError("Nothing new turned up just now. Try again in a while.", 404);
    return { serving };
  }));
}
