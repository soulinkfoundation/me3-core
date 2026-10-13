import type { AppContext, AppHono } from "../http/types";
import { searchLocationQuery } from "../location-search";

type LocationsRouteDeps = {
  requireOwner(c: AppContext): Promise<string | null>;
  unauthorized(c: AppContext): Response;
};

export function registerLocationsRoutes(app: AppHono, deps: LocationsRouteDeps) {
  const { requireOwner, unauthorized } = deps;

  app.get("/api/locations/search", async (c) => {
    const ownerId = await requireOwner(c);
    if (!ownerId) return unauthorized(c);

    const result = await searchLocationQuery(
      c.env,
      c.req.query("q"),
      c.req.query("limit"),
    );
    if (!result.ok) {
      return c.json({ ok: false, error: result.error }, result.status as any);
    }
    return c.json(result);
  });
}
