import {
  SocialPostInputError,
  SocialPublishingGateError,
  createCarouselTemplate,
  getSocialPublishingRuntimeStatus,
  getTextCarousel,
  listCarouselTemplates,
  saveTextCarousel,
  updateCarouselTemplate,
} from "../social-publishing";
import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";

/** Text carousel templates and a Post's slide text. Rendering happens in the browser. */
export function registerSocialTextCarouselRoutes(app: AppHono, deps: OwnerRouteDeps) {
  app.get("/api/social/carousel-templates", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    try {
      await requireSocialPublishing(c);
      return c.json({ templates: await listCarouselTemplates(c.env, ownerId, c.req.query("siteId")) });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.post("/api/social/carousel-templates", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await readBody(c);
    try {
      await requireSocialPublishing(c);
      return c.json({ template: await createCarouselTemplate(c.env, ownerId, body) }, 201);
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.patch("/api/social/carousel-templates/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await readBody(c);
    try {
      await requireSocialPublishing(c);
      return c.json({ template: await updateCarouselTemplate(c.env, ownerId, c.req.param("id"), body) });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.get("/api/social/posts/:id/text-carousel", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    try {
      await requireSocialPublishing(c);
      return c.json({ carousel: await getTextCarousel(c.env, ownerId, c.req.param("id")) });
    } catch (error) {
      return errorResponse(c, error);
    }
  });

  app.put("/api/social/posts/:id/text-carousel", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await readBody(c);
    try {
      await requireSocialPublishing(c);
      return c.json({ carousel: await saveTextCarousel(c.env, ownerId, c.req.param("id"), body) });
    } catch (error) {
      return errorResponse(c, error);
    }
  });
}

async function readBody(c: AppContext): Promise<Record<string, unknown>> {
  const body = await c.req.json<unknown>().catch((): unknown => ({}));
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

async function requireSocialPublishing(c: AppContext): Promise<void> {
  const gate = await getSocialPublishingRuntimeStatus(c.env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);
}

function errorResponse(c: AppContext, error: unknown) {
  if (error instanceof SocialPublishingGateError) {
    return c.json({ ok: false, error: error.message, plugin: error.gate }, error.status as any);
  }
  if (error instanceof SocialPostInputError) {
    return c.json({ ok: false, error: error.message }, error.status as any);
  }
  throw error;
}
