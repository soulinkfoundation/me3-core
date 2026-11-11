import {
  SocialPostInputError,
  SocialPostingPlanInputError,
  SocialPublishingGateError,
  SocialPublishingInputError,
  addPostVersion,
  cancelPublication,
  chooseSocialSuggestion,
  confirmPostingPlan,
  createPostVersionPublication,
  createSocialPost,
  deletePostVersion,
  ensureLocalSocialDemo,
  deleteSocialPost,
  createSocialSuggestions,
  createPostingPlan,
  discardSocialSuggestion,
  getSocialPost,
  getPostingPlan,
  getPreferredPostingTimes,
  getSocialPublishingRuntimeStatus,
  listApprovedPostVersionsForScheduling,
  listPostVersionPublications,
  listSocialPosts,
  listSocialSuggestions,
  resolvePublicationOutcome,
  reschedulePublication,
  searchPostLibrary,
  updatePostVersion,
  updateSocialPost,
  updateSocialSuggestion,
  updatePreferredPostingTimes,
  type ChooseSocialSuggestionInput,
  type CreatePublicationInput,
  type CreatePostVersionInput,
  type CreateSocialPostInput,
  type CreatePostingPlanInput,
  type CreateSocialSuggestionsInput,
  type DiscardSocialSuggestionInput,
  type ReschedulePublicationInput,
  type ConfirmPostingPlanInput,
  type PostLibrarySearchInput,
  type SocialSuggestionStatus,
  type UpdatePostVersionInput,
  type UpdateSocialPostInput,
  type UpdateSocialSuggestionInput,
  type UpdatePreferredPostingTimesInput,
} from "../social-publishing";
import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";
import { fetchSocialLinkPreview } from "../social-link-preview";
import { AltTextInputError, draftSocialAltText } from "../social-alt-text";
import { ShortenInputError, shortenSocialText } from "../social-shorten";

export function registerSocialContentRoutes(app: AppHono, deps: OwnerRouteDeps) {
  app.get("/api/social/link-preview", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      const preview = await fetchSocialLinkPreview(c.req.query("url"));
      return c.json({ preview }, 200, {
        "Cache-Control": "private, max-age=1800",
      });
    } catch {
      return c.json({ preview: null });
    }
  });

  app.post("/api/social/local-demo", async (c) => {
    if (c.env.ENVIRONMENT !== "local") return c.notFound();
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body: { siteId?: string } = await c.req.json<{ siteId?: string }>().catch(() => ({}));

    try {
      await requireSocialPublishing(c);
      return c.json({ post: await ensureLocalSocialDemo(c.env, ownerId, body.siteId || "") });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.get("/api/social/posts", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      await requireSocialPublishing(c);
      return c.json({
        posts: await listSocialPosts(c.env, ownerId, c.req.query("siteId")),
      });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.get("/api/social/library", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      await requireSocialPublishing(c);
      const input: PostLibrarySearchInput = {
        siteId: c.req.query("siteId"),
        query: c.req.query("query"),
        source: c.req.query("source"),
        platform: c.req.query("platform"),
        accountId: c.req.query("accountId"),
        approvalStatus: c.req.query("approvalStatus"),
        deliveryState: c.req.query("deliveryState"),
        tag: c.req.query("tag"),
        publishedFrom: c.req.query("publishedFrom"),
        publishedTo: c.req.query("publishedTo"),
        limit: c.req.query("limit"),
      };
      return c.json({ items: await searchPostLibrary(c.env, ownerId, input) });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.get("/api/social/suggestions", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      await requireSocialPublishing(c);
      const requestedStatus = c.req.query("status") || "suggested";
      return c.json({
        suggestions: await listSocialSuggestions(
          c.env,
          ownerId,
          c.req.query("siteId"),
          requestedStatus as SocialSuggestionStatus | "all",
        ),
      });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.post("/api/social/suggestions", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json<unknown>().catch((): unknown => ({}));

    try {
      await requireSocialPublishing(c);
      const input = (body && typeof body === "object" ? body : {}) as CreateSocialSuggestionsInput;
      const suggestions = await createSocialSuggestions(c.env, ownerId, {
        ...input,
        createdBy: "user",
      });
      return c.json({ ok: true, suggestions }, 201);
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.patch("/api/social/suggestions/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json<unknown>().catch((): unknown => ({}));

    try {
      await requireSocialPublishing(c);
      const suggestion = await updateSocialSuggestion(
        c.env,
        ownerId,
        c.req.param("id"),
        (body && typeof body === "object" ? body : {}) as UpdateSocialSuggestionInput,
      );
      if (!suggestion) return c.json({ ok: false, error: "Suggestion not found" }, 404);
      return c.json({ ok: true, suggestion });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.delete("/api/social/suggestions/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      await requireSocialPublishing(c);
      const suggestion = await discardSocialSuggestion(
        c.env,
        ownerId,
        c.req.param("id"),
        { expectedUpdatedAt: c.req.query("expectedUpdatedAt") } as DiscardSocialSuggestionInput,
      );
      if (!suggestion) return c.json({ ok: false, error: "Suggestion not found" }, 404);
      return c.json({ ok: true, suggestion });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.post("/api/social/suggestions/:id/post", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json<unknown>().catch((): unknown => ({}));

    try {
      await requireSocialPublishing(c);
      const chosen = await chooseSocialSuggestion(
        c.env,
        ownerId,
        c.req.param("id"),
        (body && typeof body === "object" ? body : {}) as ChooseSocialSuggestionInput,
      );
      if (!chosen) return c.json({ ok: false, error: "Suggestion not found" }, 404);
      return c.json({ ok: true, ...chosen }, 201);
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.post("/api/social/posts", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json<unknown>().catch((): unknown => ({}));

    try {
      await requireSocialPublishing(c);
      const input = (body && typeof body === "object" ? body : {}) as CreateSocialPostInput;
      const post = await createSocialPost(c.env, ownerId, {
        ...input,
        createdBy: "user",
      });
      return c.json({ ok: true, post }, 201);
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.get("/api/social/posts/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      await requireSocialPublishing(c);
      const post = await getSocialPost(c.env, ownerId, c.req.param("id"));
      if (!post) return c.json({ ok: false, error: "Social Post not found" }, 404);
      return c.json({ post });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.post("/api/social/posts/:id/versions", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json<unknown>().catch((): unknown => ({}));

    try {
      await requireSocialPublishing(c);
      const post = await addPostVersion(
        c.env,
        ownerId,
        c.req.param("id"),
        (body && typeof body === "object" ? body : {}) as CreatePostVersionInput,
      );
      if (!post) return c.json({ ok: false, error: "Social Post not found" }, 404);
      return c.json({ ok: true, post }, 201);
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.patch("/api/social/posts/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json<unknown>().catch((): unknown => ({}));

    try {
      await requireSocialPublishing(c);
      const post = await updateSocialPost(
        c.env,
        ownerId,
        c.req.param("id"),
        (body && typeof body === "object" ? body : {}) as UpdateSocialPostInput,
      );
      if (!post) return c.json({ ok: false, error: "Social Post not found" }, 404);
      return c.json({ ok: true, post });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.delete("/api/social/posts/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      await requireSocialPublishing(c);
      const deleted = await deleteSocialPost(
        c.env,
        ownerId,
        c.req.param("id"),
        c.req.query("expectedUpdatedAt"),
      );
      if (!deleted) return c.json({ ok: false, error: "Social Post not found" }, 404);
      return c.json({ ok: true });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.get("/api/social/accounts/:id/preferred-posting-times", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      await requireSocialPublishing(c);
      return c.json({
        preference: await getPreferredPostingTimes(c.env, ownerId, c.req.param("id")),
      });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.put("/api/social/accounts/:id/preferred-posting-times", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json<unknown>().catch((): unknown => ({}));

    try {
      await requireSocialPublishing(c);
      const preference = await updatePreferredPostingTimes(
        c.env,
        ownerId,
        c.req.param("id"),
        (body && typeof body === "object" ? body : {}) as UpdatePreferredPostingTimesInput,
      );
      return c.json({ ok: true, preference });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.post("/api/social/posting-plans", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json<unknown>().catch((): unknown => ({}));

    try {
      await requireSocialPublishing(c);
      const plan = await createPostingPlan(
        c.env,
        ownerId,
        (body && typeof body === "object" ? body : {}) as CreatePostingPlanInput,
      );
      return c.json({ ok: true, plan }, 201);
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.get("/api/social/posting-plans/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      await requireSocialPublishing(c);
      const plan = await getPostingPlan(c.env, ownerId, c.req.param("id"));
      if (!plan) return c.json({ ok: false, error: "Posting plan not found" }, 404);
      return c.json({ plan });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.post("/api/social/posting-plans/:id/confirm", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json<unknown>().catch((): unknown => ({}));

    try {
      await requireSocialPublishing(c);
      const plan = await confirmPostingPlan(
        c.env,
        ownerId,
        c.req.param("id"),
        (body && typeof body === "object" ? body : {}) as ConfirmPostingPlanInput,
        { requestedByType: "owner" },
      );
      if (!plan) return c.json({ ok: false, error: "Posting plan not found" }, 404);
      return c.json({ ok: true, plan });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.patch("/api/social/versions/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json<unknown>().catch((): unknown => ({}));

    try {
      await requireSocialPublishing(c);
      const version = await updatePostVersion(
        c.env,
        ownerId,
        c.req.param("id"),
        (body && typeof body === "object" ? body : {}) as UpdatePostVersionInput,
      );
      if (!version) return c.json({ ok: false, error: "Post Version not found" }, 404);
      return c.json({ ok: true, version });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.delete("/api/social/versions/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      await requireSocialPublishing(c);
      const post = await deletePostVersion(c.env, ownerId, c.req.param("id"));
      if (!post) return c.json({ ok: false, error: "Post Version not found" }, 404);
      return c.json({ ok: true, post });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.post("/api/social/shorten", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json<{ text?: unknown; limit?: unknown }>().catch(() => ({}));

    try {
      await requireSocialPublishing(c);
      return c.json({ ok: true, text: await shortenSocialText(c.env, ownerId, body) });
    } catch (error) {
      if (error instanceof ShortenInputError) return c.json({ ok: false, error: error.message }, 400);
      return socialContentErrorResponse(c, error);
    }
  });

  app.post("/api/social/alt-text", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json<{ image?: unknown; context?: unknown }>().catch(() => ({}));

    try {
      await requireSocialPublishing(c);
      return c.json({ ok: true, altText: await draftSocialAltText(c.env, ownerId, body) });
    } catch (error) {
      if (error instanceof AltTextInputError) return c.json({ ok: false, error: error.message }, error.status);
      return socialContentErrorResponse(c, error);
    }
  });

  app.get("/api/social/scheduling/approved-versions", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      await requireSocialPublishing(c);
      return c.json({
        versions: await listApprovedPostVersionsForScheduling(
          c.env,
          ownerId,
          c.req.query("siteId"),
        ),
      });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.get("/api/social/versions/:id/publications", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      await requireSocialPublishing(c);
      const publications = await listPostVersionPublications(
        c.env,
        ownerId,
        c.req.param("id"),
      );
      return c.json({ publications });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.post("/api/social/versions/:id/publications", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json<unknown>().catch((): unknown => ({}));

    try {
      await requireSocialPublishing(c);
      const input = (body && typeof body === "object" ? body : {}) as CreatePublicationInput;
      const publication = await createPostVersionPublication(
        c.env,
        ownerId,
        c.req.param("id"),
        { ...input, requestedByType: "owner" },
      );
      if (!publication) return c.json({ ok: false, error: "Post Version not found" }, 404);
      return c.json({
        ok: true,
        publication,
        result: {
          action: publication.status === "scheduled" ? "scheduled" : "publish_requested",
          publicationId: publication.id,
          status: publication.status,
          scheduledFor: publication.scheduledFor,
          timezone: publication.timezone,
        },
      }, 201);
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.post("/api/social/versions/:id/publish", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json<unknown>().catch((): unknown => ({}));

    try {
      await requireSocialPublishing(c);
      const input = (body && typeof body === "object" ? body : {}) as CreatePublicationInput;
      const publication = await createPostVersionPublication(
        c.env,
        ownerId,
        c.req.param("id"),
        { ...input, requestedByType: "owner" },
      );
      if (!publication) return c.json({ ok: false, error: "Post Version not found" }, 404);
      return c.json({ ok: true, publication });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.delete("/api/social/publications/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    try {
      await requireSocialPublishing(c);
      const publication = await cancelPublication(c.env, ownerId, c.req.param("id"));
      if (!publication) return c.json({ ok: false, error: "Publication not found" }, 404);
      return c.json({
        ok: true,
        publication,
        result: {
          action: "cancelled",
          publicationId: publication.id,
          status: publication.status,
        },
      });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.patch("/api/social/publications/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json<unknown>().catch((): unknown => ({}));

    try {
      await requireSocialPublishing(c);
      const result = await reschedulePublication(
        c.env,
        ownerId,
        c.req.param("id"),
        (body && typeof body === "object" ? body : {}) as ReschedulePublicationInput,
      );
      if (!result) return c.json({ ok: false, error: "Publication not found" }, 404);
      return c.json({ ok: true, publication: result.publication, result });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });

  app.post("/api/social/publications/:id/resolve", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json<unknown>().catch((): unknown => ({}));

    try {
      await requireSocialPublishing(c);
      const publication = await resolvePublicationOutcome(
        c.env,
        ownerId,
        c.req.param("id"),
        body && typeof body === "object"
          ? body as { outcome?: unknown; platformPostUrl?: unknown }
          : {},
      );
      if (!publication) return c.json({ ok: false, error: "Publication not found" }, 404);
      return c.json({ ok: true, publication });
    } catch (error) {
      return socialContentErrorResponse(c, error);
    }
  });
}

async function requireSocialPublishing(c: AppContext): Promise<void> {
  const gate = await getSocialPublishingRuntimeStatus(c.env);
  if (!gate.ready) throw new SocialPublishingGateError(gate);
}

function socialContentErrorResponse(c: AppContext, error: unknown) {
  if (error instanceof SocialPublishingGateError) {
    return c.json({ ok: false, error: error.message, plugin: error.gate }, error.status as any);
  }
  if (
    error instanceof SocialPostInputError ||
    error instanceof SocialPublishingInputError ||
    error instanceof SocialPostingPlanInputError
  ) {
    return c.json({ ok: false, error: error.message }, error.status as any);
  }
  throw error;
}
