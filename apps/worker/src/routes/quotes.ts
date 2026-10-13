import { getTodayQuote, listMyQuotes, QuoteInputError, saveOwnerQuote, setQuoteSaved } from "../quotes";
import type { AppHono, OwnerRouteDeps } from "../http/types";

export function registerQuoteRoutes(app: AppHono, deps: OwnerRouteDeps) {
  app.use("/api/quotes/*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  app.get("/api/quotes/today", async c => {
    const owner = await deps.requireOwner(c); if (!owner) return deps.unauthorized(c);
    return c.json({ quote: await getTodayQuote(c.env, owner) });
  });
  app.post("/api/quotes/another", async c => {
    const owner = await deps.requireOwner(c); if (!owner) return deps.unauthorized(c);
    return c.json({ quote: await getTodayQuote(c.env, owner, new Date(), true) });
  });
  app.get("/api/quotes/mine", async c => {
    const owner = await deps.requireOwner(c); if (!owner) return deps.unauthorized(c);
    return c.json(await listMyQuotes(c.env, owner));
  });
  app.post("/api/quotes", async c => {
    const owner = await deps.requireOwner(c); if (!owner) return deps.unauthorized(c);
    try { return c.json({ quote: await saveOwnerQuote(c.env, owner, await c.req.json().catch(() => null), "owner") }, 201); }
    catch (error) { if (error instanceof QuoteInputError) return c.json({ error: error.message }, error.status); throw error; }
  });
  app.on(["PUT", "DELETE"], "/api/quotes/:id/save", async c => {
    const owner = await deps.requireOwner(c); if (!owner) return deps.unauthorized(c);
    try { return c.json({ quote: await setQuoteSaved(c.env, owner, c.req.param("id"), c.req.method === "PUT") }); }
    catch (error) { if (error instanceof QuoteInputError) return c.json({ error: error.message }, error.status); throw error; }
  });
}
