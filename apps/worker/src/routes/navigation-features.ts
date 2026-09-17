import {
  NavigationFeatureInputError,
  dismissFeatureDiscovery,
  listNavigationFeatures,
  shouldShowFeatureDiscovery,
  updateNavigationFeature,
} from "../navigation-features";
import type { AppHono, OwnerRouteDeps } from "../http/types";

export function registerNavigationFeatureRoutes(
  app: AppHono,
  deps: OwnerRouteDeps,
): void {
  app.get("/api/navigation-features", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    return c.json({ features: await listNavigationFeatures(c.env, ownerId) });
  });

  app.get("/api/feature-discovery", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    return c.json({ show: await shouldShowFeatureDiscovery(c.env, ownerId) });
  });

  app.post("/api/feature-discovery/dismiss", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    await dismissFeatureDiscovery(c.env, ownerId);
    return c.json({ ok: true });
  });

  app.put("/api/navigation-features/:featureId", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json<{ visible?: unknown }>().catch(() => null);
    try {
      return c.json({
        feature: await updateNavigationFeature(
          c.env,
          ownerId,
          c.req.param("featureId"),
          body?.visible,
        ),
      });
    } catch (error) {
      if (error instanceof NavigationFeatureInputError) {
        return c.json({ error: error.message }, error.status);
      }
      throw error;
    }
  });
}
