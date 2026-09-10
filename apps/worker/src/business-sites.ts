import { getSiteImageMetadata } from "./site-images";
import { publicDiscoveryFiles } from "@me3-core/site-renderer";
import {
  businessSitePageHref,
  createBusinessSiteDocument,
  getLandingPageValidationErrors,
  landingPageDesignPackSupportsPurpose,
  normalizeBusinessSiteDocument,
  renderLandingPageHtml,
  type BusinessSiteDocumentV1,
  type LandingPageDocumentV3,
} from "@me3-core/plugin-landing-pages";
import {
  getPagePaymentMethods,
  getPageResourceSite,
  getSitePage,
  listSitePages,
  parsePageDocument,
  validatePageResources,
} from "./site-pages";
import {
  getSiteFileText,
  prepareSiteFileUpsert,
  putSiteFile,
} from "./sites";
import type { DbSite, DbSitePage, Env } from "./types";

const BUSINESS_SITE_DRAFT_PATH = "src/business-site.json";
const BUSINESS_SITE_PUBLIC_PATH = "public/business-site.json";
const BUSINESS_SITE_REVISION_PREFIX = "src/business-site-revisions/";

export class BusinessSiteInputError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = "BusinessSiteInputError";
  }
}

export type BusinessSiteRevision = {
  id: string;
  createdAt: string;
  document: BusinessSiteDocumentV1;
  pages: Array<{
    id: string;
    slug: string;
    document: LandingPageDocumentV3;
    pageRevisionId: string;
  }>;
};

export async function getBusinessSiteDraft(
  env: Env,
  site: DbSite,
): Promise<BusinessSiteDocumentV1> {
  assertBusinessSite(site);
  const raw = await getSiteFileText(env, site.id, BUSINESS_SITE_DRAFT_PATH);
  if (raw) {
    const document = parseBusinessSiteDocument(raw);
    if (!document) {
      throw new BusinessSiteInputError(
        "The Business Site settings draft is invalid.",
        409,
      );
    }
    return document;
  }
  const pages = await listSitePages(env, site.id);
  const document = createBusinessSiteDocument(displayName(site.username), {
    homepageSlug: pages.find((page) => page.slug === "home")?.slug || pages[0]?.slug,
  });
  document.navigation.items = pages.map((page) => ({
    id: page.id,
    label: page.title,
    pageSlug: page.slug,
    visible: true,
  }));
  return document;
}

export async function saveBusinessSiteDraft(
  env: Env,
  site: DbSite,
  value: unknown,
): Promise<BusinessSiteDocumentV1> {
  assertBusinessSite(site);
  const normalized = normalizeBusinessSiteDocument(value);
  if (!normalized) {
    throw new BusinessSiteInputError("Valid Business Site settings are required.");
  }
  const document = {
    ...normalized,
    updatedAt: new Date().toISOString(),
  };
  const errors = await validateBusinessSiteDocument(env, site, document, false);
  if (errors.length) throw new BusinessSiteInputError(errors.join(" "), 409);
  await putSiteFile(
    env,
    site.id,
    BUSINESS_SITE_DRAFT_PATH,
    JSON.stringify(document, null, 2),
    "application/json",
  );
  return document;
}

export async function renderBusinessSitePagePreview(
  env: Env,
  site: DbSite,
  pageId: string,
  publicOrigin?: string,
): Promise<string> {
  const [businessSite, page, resourceSite] = await Promise.all([
    getBusinessSiteDraft(env, site),
    getSitePage(env, site.id, pageId),
    getPageResourceSite(env, site),
  ]);
  const pageDocument = page ? parsePageDocument(page.draft_json) : null;
  if (!page || !pageDocument) {
    throw new BusinessSiteInputError("Page not found.", 404);
  }
  const prepared = preparePageDocument(pageDocument, businessSite);
  return renderLandingPageHtml(prepared, site.username, {
    pageId: page.id,
    slug: page.slug,
    campaign: page.slug,
    actionUsername: resourceSite.username,
    businessSite,
    siteBasePath: publicOrigin ? businessSiteBasePath(publicOrigin) : undefined,
    siteBaseUrl: publicOrigin,
    images: await getSiteImageMetadata(env, site, [JSON.stringify(pageDocument)]),
    canonicalUrl: publicOrigin
      ? `${publicOrigin}${businessSitePageHref(businessSite, page.slug)}`
      : undefined,
    ...(await getPagePaymentMethods(env, site)),
  });
}

export async function publishBusinessSite(
  env: Env,
  site: DbSite,
  publicOrigin: string,
): Promise<BusinessSiteRevision> {
  assertBusinessSite(site);
  const [businessSite, pages, resourceSite, paymentMethods] = await Promise.all([
    getBusinessSiteDraft(env, site),
    listSitePages(env, site.id),
    getPageResourceSite(env, site),
    getPagePaymentMethods(env, site),
  ]);
  const errors = await validateBusinessSiteDocument(env, site, businessSite, true);
  if (errors.length) throw new BusinessSiteInputError(errors.join(" "), 409);

  const images = await getSiteImageMetadata(env, site, pages.map(page => page.draft_json));
  const createdAt = new Date().toISOString();
  const revisionId = crypto.randomUUID();
  const renderedPages: Array<{
    page: DbSitePage;
    document: LandingPageDocumentV3;
    html: string;
    pageRevisionId: string;
  }> = [];
  for (const page of pages) {
    const parsed = parsePageDocument(page.draft_json);
    if (!parsed) throw new BusinessSiteInputError(`${page.title} has an invalid draft.`, 409);
    const document = preparePageDocument(parsed, businessSite);
    const pageRevisionId = crypto.randomUUID();
    renderedPages.push({
      page,
      document,
      pageRevisionId,
      html: renderLandingPageHtml(document, site.username, {
        pageId: page.id,
        slug: page.slug,
        campaign: page.slug,
        actionUsername: resourceSite.username,
        businessSite,
        siteBasePath: businessSiteBasePath(publicOrigin),
        siteBaseUrl: publicOrigin,
        images,
        canonicalUrl: `${publicOrigin}${businessSitePageHref(businessSite, page.slug)}`,
        ...paymentMethods,
      }),
    });
  }

  const revision: BusinessSiteRevision = {
    id: revisionId,
    createdAt,
    document: businessSite,
    pages: renderedPages.map(({ page, document, pageRevisionId }) => ({
      id: page.id,
      slug: page.slug,
      document,
      pageRevisionId,
    })),
  };

  // Validation and file preparation complete before public output changes.
  // D1 batch execution is transactional, so every page and site-wide setting
  // becomes visible together under one immutable revision id.
  const statements: D1PreparedStatement[] = [];
  const publicFiles: Array<{
    path: string;
    content: string;
    contentType: string;
  }> = [];
  for (const rendered of renderedPages) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO site_page_revisions (id, page_id, document_json, rendered_html, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        rendered.pageRevisionId,
        rendered.page.id,
        JSON.stringify(rendered.document),
        rendered.html,
        createdAt,
      ),
    );
    publicFiles.push({
      path: `public/${rendered.page.slug}/index.html`,
      content: rendered.html,
      contentType: "text/html",
    });
    if (rendered.page.slug === businessSite.homepageSlug) {
      publicFiles.push({
        path: "public/index.html",
        content: rendered.html,
        contentType: "text/html",
      });
    }
    statements.push(
      env.DB.prepare(
        `UPDATE site_pages
         SET published_revision_id = ?, published_at = ?, updated_at = ?
         WHERE id = ? AND site_id = ?`,
      ).bind(
        rendered.pageRevisionId,
        createdAt,
        createdAt,
        rendered.page.id,
        site.id,
      ),
    );
  }

  publicFiles.push({
    path: "public/llms.txt",
    content: publicDiscoveryFiles({ baseUrl: publicOrigin, name: businessSite.name,
      description: businessSite.organization.description || businessSite.seo.description,
      noindex: businessSite.seo.indexing === "noindex",
      pages: pages.map(page => ({ title: page.title, path: businessSitePageHref(businessSite, page.slug).replace(/^\//, "") })),
    })["llms.txt"], contentType: "text/plain; charset=utf-8",
  });
  publicFiles.push(
    {
      path: BUSINESS_SITE_PUBLIC_PATH,
      content: JSON.stringify(businessSite, null, 2),
      contentType: "application/json",
    },
    {
      path: `${BUSINESS_SITE_REVISION_PREFIX}${revisionId}.json`,
      content: JSON.stringify(revision),
      contentType: "application/json",
    },
    {
      path: "public/sitemap.xml",
      content: renderSitemap(publicOrigin, businessSite, pages),
      contentType: "application/xml",
    },
    {
      path: "public/robots.txt",
      content: renderRobots(publicOrigin, businessSite),
      contentType: "text/plain",
    },
    {
      path: "public/_redirects",
      content: businessSite.redirects.length
        ? businessSite.redirects
            .map((redirect) => `${redirect.from} ${redirect.to} 301`)
            .join("\n")
        : "# No redirects\n",
      contentType: "text/plain",
    },
  );
  const representedMeJson = resourceSite.published_at
    ? await getSiteFileText(env, resourceSite.id, "public/me.json")
    : null;
  if (representedMeJson) {
    publicFiles.push({
      path: "public/me.json",
      content: representedMeJson,
      contentType: "application/json",
    });
  }
  statements.push(
    ...(await Promise.all(
      publicFiles.map((file) =>
        prepareSiteFileUpsert(
          env,
          site.id,
          file.path,
          file.content,
          file.contentType,
        ),
      ),
    )),
    env.DB.prepare(
      "UPDATE sites SET published_at = ?, updated_at = ? WHERE id = ?",
    ).bind(createdAt, createdAt, site.id),
  );
  await env.DB.batch(statements);
  return revision;
}

function businessSiteBasePath(publicOrigin: string): string {
  const pathname = new URL(publicOrigin).pathname.replace(/\/+$/, "");
  return pathname === "/" ? "" : pathname;
}

export async function listBusinessSiteRevisions(
  env: Env,
  site: DbSite,
): Promise<Array<Pick<BusinessSiteRevision, "id" | "createdAt"> & { pageCount: number }>> {
  assertBusinessSite(site);
  const result = await env.DB.prepare(
    `SELECT path FROM site_files
     WHERE site_id = ? AND path LIKE ?
     ORDER BY updated_at DESC
     LIMIT 10`,
  )
    .bind(site.id, `${BUSINESS_SITE_REVISION_PREFIX}%`)
    .all<{ path: string }>();
  const revisions = [];
  for (const row of result.results || []) {
    const raw = await getSiteFileText(env, site.id, row.path);
    const revision = raw ? parseBusinessSiteRevision(raw) : null;
    if (revision) {
      revisions.push({
        id: revision.id,
        createdAt: revision.createdAt,
        pageCount: revision.pages.length,
      });
    }
  }
  return revisions;
}

export async function restoreBusinessSiteRevision(
  env: Env,
  site: DbSite,
  revisionId: string,
): Promise<BusinessSiteDocumentV1> {
  assertBusinessSite(site);
  const raw = await getSiteFileText(
    env,
    site.id,
    `${BUSINESS_SITE_REVISION_PREFIX}${revisionId}.json`,
  );
  const revision = raw ? parseBusinessSiteRevision(raw) : null;
  if (!revision) throw new BusinessSiteInputError("Revision not found.", 404);
  for (const page of revision.pages) {
    await env.DB.prepare(
      `UPDATE site_pages
       SET title = ?, draft_json = ?, updated_at = datetime('now')
       WHERE id = ? AND site_id = ?`,
    )
      .bind(page.document.seo.title, JSON.stringify(page.document), page.id, site.id)
      .run();
  }
  const restored = {
    ...revision.document,
    updatedAt: new Date().toISOString(),
  };
  await putSiteFile(
    env,
    site.id,
    BUSINESS_SITE_DRAFT_PATH,
    JSON.stringify(restored, null, 2),
    "application/json",
  );
  return restored;
}

async function validateBusinessSiteDocument(
  env: Env,
  site: DbSite,
  document: BusinessSiteDocumentV1,
  forPublish: boolean,
): Promise<string[]> {
  const pages = await listSitePages(env, site.id);
  const pageSlugs = new Set(pages.map((page) => page.slug));
  const errors: string[] = [];
  if (forPublish && pages.length === 0) errors.push("Add at least one page before publishing.");
  if (!pageSlugs.has(document.homepageSlug)) {
    errors.push("Choose an existing page as the homepage.");
  }
  const itemIds = new Set<string>();
  for (const item of document.navigation.items) {
    if (itemIds.has(item.id)) errors.push("Navigation item IDs must be unique.");
    itemIds.add(item.id);
    if (item.pageSlug && !pageSlugs.has(item.pageSlug)) {
      errors.push(`${item.label} links to a page that does not exist.`);
    }
  }
  for (const redirect of document.redirects) {
    const fromSlug = redirect.from.replace(/^\/+|\/+$/g, "");
    if (pageSlugs.has(fromSlug)) {
      errors.push(`${redirect.from} cannot redirect because it is a page.`);
    }
  }
  if (!forPublish) return [...new Set(errors)];
  for (const page of pages) {
    const parsed = parsePageDocument(page.draft_json);
    if (!parsed) {
      errors.push(`${page.title} has an invalid draft.`);
      continue;
    }
    if (!landingPageDesignPackSupportsPurpose(document.design.packId, parsed.intent.type)) {
      errors.push(`${document.design.packId} does not support ${page.title}.`);
      continue;
    }
    errors.push(...getLandingPageValidationErrors(preparePageDocument(parsed, document)));
    errors.push(...(await validatePageResources(env, site, parsed)));
  }
  return [...new Set(errors)];
}

function preparePageDocument(
  source: LandingPageDocumentV3,
  site: BusinessSiteDocumentV1,
): LandingPageDocumentV3 {
  const document = structuredClone(source);
  document.design.packId = site.design.packId;
  document.design.packVersion = site.design.packVersion;
  document.design.customization = {
    ...document.design.customization,
    ...site.design.customization,
  };
  const suffix = site.seo.titleSuffix.trim();
  if (suffix && !document.seo.title.toLowerCase().includes(suffix.toLowerCase())) {
    document.seo.title = `${document.seo.title} | ${suffix}`;
  }
  if (!document.seo.description.trim() && site.seo.description.trim()) {
    document.seo.description = site.seo.description.trim();
  }
  if (!document.seo.socialImage && site.seo.socialImage) {
    document.seo.socialImage = site.seo.socialImage;
  }
  return document;
}

function renderSitemap(
  publicOrigin: string,
  site: BusinessSiteDocumentV1,
  pages: DbSitePage[],
): string {
  const urls = site.seo.indexing === "noindex"
    ? []
    : pages.map((page) => `${publicOrigin}${businessSitePageHref(site, page.slug)}`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((url) => `\n  <url><loc>${escapeXml(url)}</loc></url>`).join("")}\n</urlset>\n`;
}

function renderRobots(
  publicOrigin: string,
  site: BusinessSiteDocumentV1,
): string {
  return `User-agent: *\nAllow: /\nSitemap: ${publicOrigin}/sitemap.xml\n`;
}

function parseBusinessSiteDocument(raw: string): BusinessSiteDocumentV1 | null {
  try {
    return normalizeBusinessSiteDocument(JSON.parse(raw));
  } catch {
    return null;
  }
}

function parseBusinessSiteRevision(raw: string): BusinessSiteRevision | null {
  try {
    const revision = JSON.parse(raw) as Partial<BusinessSiteRevision>;
    const document = normalizeBusinessSiteDocument(revision.document);
    if (
      typeof revision.id !== "string" ||
      typeof revision.createdAt !== "string" ||
      !document ||
      !Array.isArray(revision.pages)
    ) {
      return null;
    }
    return { ...revision, document } as BusinessSiteRevision;
  } catch {
    return null;
  }
}

function assertBusinessSite(site: DbSite): void {
  if (site.site_role !== "organization") {
    throw new BusinessSiteInputError("This feature is for Business Sites.", 409);
  }
  if (!site.profile_site_id) {
    throw new BusinessSiteInputError(
      "Assign an ME3 Profile before editing this Business Site.",
      409,
    );
  }
}

function displayName(username: string): string {
  return username
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
