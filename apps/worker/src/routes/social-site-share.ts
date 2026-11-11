import {
  SitePostShareError,
  SocialPostInputError,
  SocialPublishingGateError,
  getSocialPublishingRuntimeStatus,
} from "../social-publishing";
import { findOwnerSitePostShare, shareOwnerSitePost } from "../social-site-share";
import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";

/** Share a published site blog post to the owner's connected social accounts. */
export function registerSocialSiteShareRoutes(app: AppHono, deps: OwnerRouteDeps) {
  app.get("/api/social/site-posts/share", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    try {
      await requireSocialPublishing(c);
      const post = await findOwnerSitePostShare(c.env, ownerId, { siteId: c.req.query("siteId"), slug: c.req.query("slug") });
      return c.json({ post });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post("/api/social/site-posts/share", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json<{ siteId?: unknown; slug?: unknown }>().catch(() => ({}) as { siteId?: unknown; slug?: unknown });
    try {
      await requireSocialPublishing(c);
      const result = await shareOwnerSitePost(c.env, ownerId, body);
      return c.json(result, result.created ? 201 : 200);
    } catch (error) {
      return errorResponse(c, error);
    }
  });
}

async function requireSocialPublishing(c: AppContext): Promise<void> {
  const gate = await getSocialPublishingRuntimeStatus(c.env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);
}

function errorResponse(c: AppContext, error: unknown) {
  if (error instanceof SocialPublishingGateError) {
    return c.json({ ok: false, error: error.message, plugin: error.gate }, error.status as any);
  }
  if (error instanceof SitePostShareError || error instanceof SocialPostInputError) {
    return c.json({ ok: false, error: error.message }, error.status as any);
  }
  throw error;
}
