import {
  BusinessSiteInputError,
  getBusinessSiteDraft,
  listBusinessSiteRevisions,
  publishBusinessSite,
  renderBusinessSitePagePreview,
  restoreBusinessSiteRevision,
  saveBusinessSiteDraft,
} from "../business-sites";
import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";
import { listSitePages, serializeSitePage } from "../site-pages";
import { getSiteForOwner, injectBaseHref } from "../sites";
import type { DbSite } from "../types";

export function registerBusinessSiteRoutes(
  app: AppHono,
  deps: OwnerRouteDeps,
): void {
  app.get("/api/sites/:username/business-site", async (c) => {
    const site = await requireBusinessSite(c, deps);
    if (site instanceof Response) return site;
    try {
      const [document, pages, revisions, profile] = await Promise.all([
        getBusinessSiteDraft(c.env, site),
        listSitePages(c.env, site.id),
        listBusinessSiteRevisions(c.env, site),
        getRepresentedProfile(c.env, site),
      ]);
      return c.json({
        document,
        pages: pages.map((page) => {
          const { document: _document, ...summary } = serializeSitePage(page);
          return summary;
        }),
        revisions,
        profile,
        publishedAt: site.published_at,
        publicUrl: `${businessSiteOrigin(c.req.url, site)}/`,
      });
    } catch (error) {
      return businessSiteErrorResponse(c, error);
    }
  });

  app.put("/api/sites/:username/business-site", async (c) => {
    const site = await requireBusinessSite(c, deps);
    if (site instanceof Response) return site;
    const body = await c.req
      .json<{ document?: unknown }>()
      .catch((): { document?: unknown } => ({}));
    try {
      return c.json({
        document: await saveBusinessSiteDraft(c.env, site, body.document),
      });
    } catch (error) {
      return businessSiteErrorResponse(c, error);
    }
  });

  app.get(
    "/api/sites/:username/business-site/pages/:pageId/preview-html",
    async (c) => {
      const site = await requireBusinessSite(c, deps);
      if (site instanceof Response) return site;
      try {
        c.header("X-Robots-Tag", "noindex, nofollow");
        c.header("X-Frame-Options", "SAMEORIGIN");
        c.header("Content-Security-Policy", "frame-ancestors 'self'");
        return c.html(
          injectBaseHref(
            await renderBusinessSitePagePreview(
              c.env,
              site,
              c.req.param("pageId"),
              businessSiteOrigin(c.req.url, site),
            ),
            `/preview/${site.username}/`,
          ),
        );
      } catch (error) {
        return businessSiteErrorResponse(c, error);
      }
    },
  );

  app.post("/api/sites/:username/business-site/publish", async (c) => {
    const site = await requireBusinessSite(c, deps);
    if (site instanceof Response) return site;
    try {
      const revision = await publishBusinessSite(
        c.env,
        site,
        businessSiteOrigin(c.req.url, site),
      );
      return c.json({
        ok: true,
        revisionId: revision.id,
        publishedAt: revision.createdAt,
        pageCount: revision.pages.length,
        publicUrl: `${businessSiteOrigin(c.req.url, site)}/`,
      });
    } catch (error) {
      return businessSiteErrorResponse(c, error);
    }
  });

  app.get("/api/sites/:username/business-site/revisions", async (c) => {
    const site = await requireBusinessSite(c, deps);
    if (site instanceof Response) return site;
    try {
      return c.json({ revisions: await listBusinessSiteRevisions(c.env, site) });
    } catch (error) {
      return businessSiteErrorResponse(c, error);
    }
  });

  app.post(
    "/api/sites/:username/business-site/revisions/:revisionId/restore",
    async (c) => {
      const site = await requireBusinessSite(c, deps);
      if (site instanceof Response) return site;
      try {
        return c.json({
          document: await restoreBusinessSiteRevision(
            c.env,
            site,
            c.req.param("revisionId"),
          ),
        });
      } catch (error) {
        return businessSiteErrorResponse(c, error);
      }
    },
  );
}

async function requireBusinessSite(
  c: AppContext,
  deps: OwnerRouteDeps,
): Promise<DbSite | Response> {
  const ownerId = await deps.requireOwner(c);
  if (!ownerId) return deps.unauthorized(c);
  const site = await getSiteForOwner(c.env, ownerId, c.req.param("username") || "");
  if (!site) return c.json({ error: "Site not found" }, 404);
  if (site.site_role !== "organization") {
    return c.json({ error: "This feature is for Business Sites." }, 409);
  }
  return site;
}

async function getRepresentedProfile(env: AppContext["env"], site: DbSite) {
  if (!site.profile_site_id) return null;
  return (
    (await env.DB.prepare(
      `SELECT id, username, published_at
       FROM sites
       WHERE id = ? AND user_id = ? AND site_role = 'profile'`,
    )
      .bind(site.profile_site_id, site.user_id)
      .first<{ id: string; username: string; published_at: string | null }>()) ||
    null
  );
}

function businessSiteOrigin(requestUrl: string, site: DbSite): string {
  if (site.custom_domain && site.custom_domain_status === "active") {
    return `https://${site.custom_domain}`;
  }
  return `${new URL(requestUrl).origin}/site/${encodeURIComponent(site.username)}`;
}

function businessSiteErrorResponse(c: AppContext, error: unknown): Response {
  if (error instanceof BusinessSiteInputError) {
    return c.json({ error: error.message }, error.status);
  }
  console.error("Business Site error:", error);
  return c.json({ error: "Could not update the Business Site." }, 500);
}
