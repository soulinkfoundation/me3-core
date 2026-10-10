import {
  AGENT_LANDING_PAGE_SITE_TEMPLATE_ID,
  buildLandingPageDocument,
  getDefaultLandingPageDesignPackId,
  getLandingPageDesignPack,
  getLandingPageDesignPackId,
  getLandingPageTemplateId,
  getLandingPageTitle,
  getSelectableLandingPageDesignPacks,
  LANDING_PAGES_PLUGIN_ID,
  LANDING_PAGES_PLUGIN_VERSION,
  landingPageDesignPackSupportsPurpose,
  normalizeLandingPageDesignPackId,
  normalizeLandingPageDocument,
  normalizeLandingPageFontPreset,
  setLandingPageDesignPack,
  upgradeLandingPageDocument,
  type LandingPageDesignPackId,
  type LandingPageDocumentV3,
  type LandingPageFontPreset,
  type LandingPageTemplateId,
} from "@me3-core/plugin-landing-pages";
import {
  deleteAgentLandingPageHero,
  findAndStoreAgentLandingPageHero,
  type AgentLandingPageImageEnv,
  type AgentLandingPageStoredImage,
} from "./landing-page-images";

type LandingPageD1Like = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
      all<T = unknown>(): Promise<{ results?: T[] }>;
      run(): Promise<{ meta?: { changes?: number } }>;
    };
  };
};

export type AgentLandingPageEnv = AgentLandingPageImageEnv & {
  DB: LandingPageD1Like;
};

type DbAgentLandingSite = {
  id: string;
  username: string;
  site_role: "profile" | "organization" | null;
  template_id: string | null;
  custom_domain: string | null;
  updated_at: string;
};

type DbAgentLandingPage = {
  id: string;
  site_id: string;
  slug: string;
  title: string;
  template_id: string;
  draft_json: string;
  published_revision_id: string | null;
  updated_at: string;
  published_at: string | null;
};

type DbAgentLandingOwner = {
  name: string | null;
  bio: string | null;
  avatar_url: string | null;
};

export type AgentLandingPageSummary = {
  id: string;
  siteId: string;
  siteUsername: string;
  slug: string;
  title: string;
  purpose: LandingPageTemplateId;
  designPackId: LandingPageDesignPackId;
  designName: string;
  siteCreated: boolean;
  isSiteHomepage: boolean;
  imageProvider: "pexels" | null;
  published: boolean;
  updatedAt: string;
  editorPath: string;
  previewPath: string;
  publicPath: string;
};

export type AgentLandingPageDraftInput = {
  site?: string;
  siteName?: string;
  siteHandle?: string;
  slug?: string;
  purpose: LandingPageTemplateId;
  designPackId?: string;
  brief: string;
  headline?: string;
  subheadline?: string;
  highlights?: string;
  ctaLabel?: string;
  imageQuery?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  fontPreset?: string;
};

export type AgentLandingPageUpdateInput = {
  site?: string;
  pageId: string;
  designPackId?: string;
  headline?: string;
  subheadline?: string;
  highlights?: string;
  ctaLabel?: string;
  imageQuery?: string;
  actionType?: "link" | "subscribe";
  actionHref?: string;
  accentColor?: string;
  backgroundColor?: string;
  textColor?: string;
  fontPreset?: string;
};

export function listAgentLandingPageDesigns() {
  return getSelectableLandingPageDesignPacks().map((pack) => ({
    id: pack.id,
    version: pack.version,
    name: pack.name,
    description: pack.description,
    bestFor: pack.bestFor,
    purposes: [...pack.purposes],
    previewPath: pack.previewPath,
  }));
}

export async function listAgentLandingPages(
  env: AgentLandingPageEnv,
  userId: string,
  siteReference?: string,
): Promise<AgentLandingPageSummary[]> {
  await assertLandingPagesPluginEnabled(env);
  const site = await resolveAgentLandingPageSite(env, userId, siteReference);
  const result = await env.DB.prepare(
    `SELECT id, site_id, slug, title, template_id, draft_json,
            published_revision_id, updated_at, published_at
     FROM site_pages
     WHERE site_id = ? AND kind = 'landing_page'
     ORDER BY updated_at DESC
     LIMIT 50`,
  )
    .bind(site.id)
    .all<DbAgentLandingPage>();
  return (result.results || []).flatMap((row) => {
    const document = parseAgentLandingPageDocument(row.draft_json);
    return document ? [serializeAgentLandingPage(row, site, document)] : [];
  });
}

export async function createAgentLandingPageDraft(
  env: AgentLandingPageEnv,
  userId: string,
  input: AgentLandingPageDraftInput,
): Promise<AgentLandingPageSummary> {
  const designPackId = resolveAgentDesignPack(input.designPackId, input.purpose);
  await ensureLandingPagesPluginEnabled(env);
  const target = input.site
    ? {
        site: await resolveAgentLandingPageSite(env, userId, input.site),
        created: false,
      }
    : {
        site: await createAgentLandingPageSite(env, userId, input),
        created: true,
      };
  const site = target.site;
  const owner = await env.DB.prepare(
    `SELECT name, bio, avatar_url FROM owner_profile WHERE id = ? LIMIT 1`,
  )
    .bind(userId)
    .first<DbAgentLandingOwner>();
  const id = crypto.randomUUID();
  const image = await findAndStoreAgentLandingPageHero(env, {
    siteId: site.id,
    siteUsername: site.username,
    pageId: id,
    query: input.imageQuery || input.siteName || input.headline || input.brief,
  });
  const document = upgradeLandingPageDocument(
    buildLandingPageDocument({
      username: site.username,
      brief: input.brief,
      template: input.purpose,
      designPackId,
      heroImage: image?.path || null,
      heroImageAttribution: image?.attribution || null,
      profile: {
        name: owner?.name || site.username,
        bio: owner?.bio || null,
        avatar: owner?.avatar_url || null,
        profileUrl: target.created ? "/me" : `/sites/${encodeURIComponent(site.username)}`,
      },
    }),
  );
  applyAgentLandingPageCopy(document, input);
  applyAgentLandingPageStyle(document, input);
  if (target.created && input.purpose !== "waitlist") {
    const action = document.actions.find(
      (candidate) => candidate.id === document.hero.primaryActionId,
    );
    if (action) {
      action.kind = "link";
      action.href = "/me";
      delete action.resourceId;
    }
  }
  const slug = target.created
    ? "home"
    : await uniqueAgentLandingPageSlug(
        env,
        site.id,
        input.slug || input.headline || document.seo.title,
      );
  try {
    await env.DB.prepare(
      `INSERT INTO site_pages
       (id, site_id, slug, kind, title, template_id, draft_json)
       VALUES (?, ?, ?, 'landing_page', ?, ?, ?)`,
    )
      .bind(
        id,
        site.id,
        slug,
        getLandingPageTitle(document),
        getLandingPageTemplateId(document),
        JSON.stringify(document),
      )
      .run();
  } catch (error) {
    await rollbackAgentLandingPageCreation(env, userId, site, image, target.created);
    if (/unique|constraint/i.test(String(error))) {
      throw new Error(`The page path "${slug}" is already in use.`);
    }
    throw error;
  }
  const row = await loadAgentLandingPage(env, site.id, id);
  if (!row) {
    await rollbackAgentLandingPageCreation(env, userId, site, image, target.created);
    throw new Error("The landing-page draft could not be loaded after creation.");
  }
  return serializeAgentLandingPage(row, site, document, {
    siteCreated: target.created,
    imageProvider: image?.provider || null,
  });
}

export async function updateAgentLandingPageDraft(
  env: AgentLandingPageEnv,
  userId: string,
  input: AgentLandingPageUpdateInput,
  expected?: { draftJson: string; updatedAt: string },
): Promise<AgentLandingPageSummary> {
  await assertLandingPagesPluginEnabled(env);
  const site = await resolveAgentLandingPageSite(env, userId, input.site);
  const row = await loadAgentLandingPage(env, site.id, input.pageId);
  if (!row) {
    throw new Error("Landing page not found. List landing pages and use an exact page ID.");
  }
  if (expected && (row.draft_json !== expected.draftJson || row.updated_at !== expected.updatedAt)) {
    throw new Error("Landing page changed since it was read. List it again before changing it.");
  }
  const current = parseAgentLandingPageDocument(row.draft_json);
  if (!current) throw new Error("The landing-page draft is invalid and cannot be updated in chat.");
  let document = current;
  if (input.designPackId) {
    document = setLandingPageDesignPack(
      document,
      resolveAgentDesignPack(input.designPackId, document.intent.type),
    );
  }
  applyAgentLandingPageCopy(document, input);
  applyAgentLandingPageAction(document, input);
  applyAgentLandingPageStyle(document, input);
  const imageQuery = normalizeOptionalText(input.imageQuery);
  const replacementImage = imageQuery
    ? await findAndStoreAgentLandingPageHero(env, {
        siteId: site.id,
        siteUsername: site.username,
        pageId: `${row.id}-${crypto.randomUUID()}`,
        query: imageQuery,
      })
    : null;
  if (imageQuery && !replacementImage) {
    throw new Error("ME3 could not find and store a replacement image for that search.");
  }
  const previousImage = current.hero.image &&
      current.assets.heroImageAttribution?.provider === "pexels"
    ? {
        path: current.hero.image,
        provider: "pexels" as const,
        storage: env.SITE_ASSETS ? "r2" as const : "d1" as const,
        attribution: current.assets.heroImageAttribution,
      }
    : null;
  try {
    if (replacementImage) {
      document.hero.image = replacementImage.path;
      document.assets.heroImage = replacementImage.path;
      document.assets.heroImageAttribution = replacementImage.attribution;
      document.seo.socialImage = replacementImage.path;
    }
    document.updatedAt = new Date().toISOString();
    const result = await env.DB.prepare(
      `UPDATE site_pages
       SET title = ?, template_id = ?, draft_json = ?, updated_at = datetime('now')
       WHERE id = ? AND site_id = ? ${expected ? "AND draft_json = ?" : ""}`,
    )
      .bind(
        getLandingPageTitle(document),
        getLandingPageTemplateId(document),
        JSON.stringify(document),
        row.id,
        site.id,
        ...(expected ? [expected.draftJson] : []),
      )
      .run();
    if (expected && (result.meta?.changes || 0) !== 1) throw new Error("Landing page changed while updating. List it again before changing it.");
  } catch (error) {
    await deleteAgentLandingPageHero(env, {
      siteId: site.id,
      siteUsername: site.username,
      image: replacementImage,
    }).catch(() => undefined);
    throw error;
  }
  if (replacementImage && previousImage) {
    await deleteAgentLandingPageHero(env, {
      siteId: site.id,
      siteUsername: site.username,
      image: previousImage,
    }).catch(() => undefined);
  }
  const updated = await loadAgentLandingPage(env, site.id, row.id);
  if (!updated) throw new Error("The updated landing-page draft could not be loaded.");
  return serializeAgentLandingPage(updated, site, document, {
    imageProvider: replacementImage?.provider || null,
  });
}

function applyAgentLandingPageCopy(
  document: LandingPageDocumentV3,
  input: Pick<
    AgentLandingPageDraftInput,
    "headline" | "subheadline" | "highlights" | "ctaLabel"
  >,
): void {
  const headline = normalizeOptionalText(input.headline);
  const subheadline = normalizeOptionalText(input.subheadline);
  const ctaLabel = normalizeOptionalText(input.ctaLabel);
  if (headline) {
    document.hero.headline = headline;
    document.seo.title = headline;
    document.intent.offerName = headline;
  }
  if (subheadline) {
    document.hero.subheadline = subheadline;
    document.seo.description = subheadline;
  }
  if (ctaLabel) {
    const action = document.actions.find(
      (candidate) => candidate.id === document.hero.primaryActionId,
    );
    if (action) action.label = ctaLabel;
  }
  const highlights = parseAgentLandingPageHighlights(input.highlights);
  if (highlights.length) {
    const section = document.content.sections.find(
      (candidate) => candidate.type === "feature-list",
    );
    if (section?.type === "feature-list") section.items = highlights;
  }
  document.updatedAt = new Date().toISOString();
}

function applyAgentLandingPageStyle(
  document: LandingPageDocumentV3,
  input: Pick<
    AgentLandingPageDraftInput,
    "accentColor" | "backgroundColor" | "textColor" | "fontPreset"
  >,
): void {
  const accentColor = normalizeAgentLandingPageColor(
    input.accentColor,
    "Accent color",
  );
  const backgroundColor = normalizeAgentLandingPageColor(
    input.backgroundColor,
    "Background color",
  );
  const textColor = normalizeAgentLandingPageColor(
    input.textColor,
    "Text color",
  );
  const fontPreset = normalizeAgentLandingPageFontPreset(input.fontPreset);
  if (!accentColor && !backgroundColor && !textColor && !fontPreset) return;

  document.design.customization = {
    ...document.design.customization,
    ...(accentColor ? { accentColor } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(textColor ? { textColor } : {}),
    ...(fontPreset ? { fontPreset } : {}),
  };
}

function applyAgentLandingPageAction(
  document: LandingPageDocumentV3,
  input: Pick<
    AgentLandingPageUpdateInput,
    "actionType" | "actionHref" | "ctaLabel"
  >,
): void {
  if (input.actionType === undefined && input.actionHref === undefined) return;
  const action = document.actions.find(
    (candidate) => candidate.id === document.hero.primaryActionId,
  );
  if (!action) throw new Error("The landing page has no primary action to update.");
  if (input.actionType !== undefined &&
      input.actionType !== "link" &&
      input.actionType !== "subscribe") {
    throw new Error('Action type must be "link" or "subscribe".');
  }
  const actionType = input.actionType || action.kind;
  if (actionType === "subscribe") {
    if (action.kind !== "subscribe" && !normalizeOptionalText(input.ctaLabel)) {
      action.label = "Join the list";
    }
    action.kind = "subscribe";
    delete action.href;
    delete action.resourceId;
    return;
  }
  if (actionType !== "link") {
    throw new Error("Only link and email-signup actions can be updated in chat for now.");
  }
  action.kind = "link";
  action.href = normalizeAgentLandingPageHref(input.actionHref) || action.href || "/me";
  delete action.resourceId;
}

function normalizeAgentLandingPageHref(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.startsWith("/") && !normalized.startsWith("//")) return normalized;
  try {
    const url = new URL(normalized);
    if (url.protocol === "https:") return url.toString();
  } catch {
    // Fall through to the owner-facing validation error.
  }
  throw new Error("Action link must be an internal path or an HTTPS URL.");
}

function normalizeAgentLandingPageColor(
  value: string | undefined,
  label: string,
): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!/^#[0-9a-f]{6}$/i.test(normalized)) {
    throw new Error(`${label} must be a six-digit hex color such as #147d64.`);
  }
  return normalized.toLowerCase();
}

function normalizeAgentLandingPageFontPreset(
  value: string | undefined,
): LandingPageFontPreset | undefined {
  if (value === undefined) return undefined;
  const normalized = normalizeLandingPageFontPreset(value);
  if (!normalized) {
    throw new Error('Font preset must be "editorial", "bold", or "modern".');
  }
  return normalized;
}

function parseAgentLandingPageHighlights(
  value: string | undefined,
): Array<{ title: string; body: string }> {
  if (!value?.trim()) return [];
  return value
    .split(/\n+|\s*\|\s*/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 6)
    .map((line, index) => {
      const separator = line.indexOf(":");
      return separator > 0
        ? {
            title: line.slice(0, separator).trim(),
            body: line.slice(separator + 1).trim(),
          }
        : { title: `Highlight ${index + 1}`, body: line };
    });
}

function resolveAgentDesignPack(
  value: string | undefined,
  purpose: LandingPageTemplateId,
): LandingPageDesignPackId {
  const designPackId = value
    ? normalizeLandingPageDesignPackId(value)
    : getDefaultLandingPageDesignPackId(purpose);
  if (!designPackId || designPackId === "legacy-standard") {
    throw new Error("Choose one of the available starter design-pack IDs.");
  }
  if (!landingPageDesignPackSupportsPurpose(designPackId, purpose)) {
    throw new Error(
      `${getLandingPageDesignPack(designPackId).name} does not support ${purpose} pages.`,
    );
  }
  return designPackId;
}

async function assertLandingPagesPluginEnabled(
  env: AgentLandingPageEnv,
): Promise<void> {
  const plugin = await env.DB.prepare(
    `SELECT enabled, status FROM plugin_installations WHERE plugin_id = ? LIMIT 1`,
  )
    .bind(LANDING_PAGES_PLUGIN_ID)
    .first<{ enabled: number; status: string }>();
  if (!plugin || plugin.enabled === 0 || plugin.status !== "installed") {
    throw new Error("Activate ME3 Landing Pages before creating or editing a page in chat.");
  }
}

async function ensureLandingPagesPluginEnabled(
  env: AgentLandingPageEnv,
): Promise<void> {
  const plugin = await env.DB.prepare(
    `SELECT enabled, status FROM plugin_installations WHERE plugin_id = ? LIMIT 1`,
  )
    .bind(LANDING_PAGES_PLUGIN_ID)
    .first<{ enabled: number; status: string }>();
  if (plugin?.enabled !== 0 && plugin?.status === "installed") return;

  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO plugin_installations (
       plugin_id, version, enabled, status, granted_permissions_json,
       setup_state_json, installed_at, updated_at
     )
     VALUES (?, ?, 1, 'installed', ?, ?, ?, ?)
     ON CONFLICT(plugin_id) DO UPDATE SET
       version = excluded.version,
       enabled = 1,
       status = 'installed',
       granted_permissions_json = excluded.granted_permissions_json,
       setup_state_json = excluded.setup_state_json,
       updated_at = excluded.updated_at`,
  )
    .bind(
      LANDING_PAGES_PLUGIN_ID,
      LANDING_PAGES_PLUGIN_VERSION,
      JSON.stringify([
        "sites.landing_pages.manage",
        "agent.landing_pages.generate",
      ]),
      JSON.stringify({ activatedBy: "assistant-site-builder" }),
      now,
      now,
    )
    .run();
}

async function createAgentLandingPageSite(
  env: AgentLandingPageEnv,
  userId: string,
  input: AgentLandingPageDraftInput,
): Promise<DbAgentLandingSite> {
  const result = await env.DB.prepare(
    `SELECT id, username, site_role, template_id, custom_domain, updated_at
     FROM sites
     WHERE user_id = ? AND COALESCE(site_type, 'profile') = 'profile'
     ORDER BY created_at ASC, username ASC
     LIMIT 20`,
  )
    .bind(userId)
    .all<DbAgentLandingSite>();
  const sites = result.results || [];
  const profileSite = sites.find((site) => site.site_role === "profile");
  if (!profileSite) {
    throw new Error("Create your ME3 profile site before building an additional site.");
  }
  if (sites.filter((site) => site.site_role === "organization").length >= 3) {
    throw new Error("You have used all three additional site slots.");
  }

  const requestedHandle =
    normalizeOptionalText(input.siteHandle) ||
    normalizeOptionalText(input.siteName) ||
    normalizeOptionalText(input.headline) ||
    input.brief;
  const username = uniqueAgentSiteUsername(
    requestedHandle,
    new Set(sites.map((site) => site.username.toLowerCase())),
  );
  const id = crypto.randomUUID();
  try {
    await env.DB.prepare(
      `INSERT INTO sites
         (id, user_id, username, site_type, site_role, template_id, profile_site_id)
       VALUES (?, ?, ?, 'profile', 'organization', ?, ?)`,
    )
      .bind(
        id,
        userId,
        username,
        AGENT_LANDING_PAGE_SITE_TEMPLATE_ID,
        profileSite.id,
      )
      .run();
  } catch (error) {
    const message = String(error);
    if (/ME3_SITE_ORGANIZATION_LIMIT/i.test(message)) {
      throw new Error("You have used all three additional site slots.");
    }
    if (/unique|constraint/i.test(message)) {
      throw new Error(`The working site handle @${username} is already in use.`);
    }
    throw error;
  }

  return {
    id,
    username,
    site_role: "organization",
    template_id: AGENT_LANDING_PAGE_SITE_TEMPLATE_ID,
    custom_domain: null,
    updated_at: new Date().toISOString(),
  };
}

function uniqueAgentSiteUsername(value: string, existing: Set<string>): string {
  let base = slugifyAgentLandingPage(value)
    .replace(/-+/g, "-")
    .slice(0, 30)
    .replace(/-+$/g, "");
  if (base.length < 3) base = `site-${base || "new"}`.slice(0, 30);
  if (!existing.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const suffixText = `-${suffix}`;
    const candidate = `${base.slice(0, 30 - suffixText.length)}${suffixText}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("I could not find an unused working handle for the new site.");
}

async function rollbackAgentLandingPageCreation(
  env: AgentLandingPageEnv,
  userId: string,
  site: DbAgentLandingSite,
  image: AgentLandingPageStoredImage | null,
  deleteSite: boolean,
): Promise<void> {
  await deleteAgentLandingPageHero(env, {
    siteId: site.id,
    siteUsername: site.username,
    image,
  }).catch(() => undefined);
  if (!deleteSite) return;
  await env.DB.prepare("DELETE FROM sites WHERE id = ? AND user_id = ?")
    .bind(site.id, userId)
    .run()
    .catch(() => undefined);
}

async function resolveAgentLandingPageSite(
  env: AgentLandingPageEnv,
  userId: string,
  siteReference?: string,
): Promise<DbAgentLandingSite> {
  const result = await env.DB.prepare(
    `SELECT id, username, site_role, template_id, custom_domain, updated_at
     FROM sites
     WHERE user_id = ? AND COALESCE(site_type, 'profile') = 'profile'
     ORDER BY updated_at DESC, username ASC
     LIMIT 20`,
  )
    .bind(userId)
    .all<DbAgentLandingSite>();
  const sites = result.results || [];
  if (!sites.length) throw new Error("Create your ME3 profile site before adding a landing page.");
  const reference = normalizeOptionalText(siteReference)?.replace(/^@/, "").toLowerCase();
  if (reference) {
    const matches = sites.filter(
      (site) =>
        site.username.toLowerCase() === reference ||
        site.custom_domain?.toLowerCase() === reference,
    );
    if (matches.length === 1) return matches[0];
    throw new Error(`I could not find a profile site matching "${siteReference}".`);
  }
  if (sites.length === 1) return sites[0];
  throw new Error(
    `I found multiple profile sites: ${sites.map((site) => `@${site.username}`).join(", ")}. Which should I use?`,
  );
}

async function uniqueAgentLandingPageSlug(
  env: AgentLandingPageEnv,
  siteId: string,
  value: string,
): Promise<string> {
  const base = slugifyAgentLandingPage(value) || "landing-page";
  const result = await env.DB.prepare(
    `SELECT slug FROM site_pages WHERE site_id = ? LIMIT 200`,
  )
    .bind(siteId)
    .all<{ slug: string }>();
  const existing = new Set((result.results || []).map((row) => row.slug));
  if (!existing.has(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const suffixText = `-${suffix}`;
    const candidate = `${base.slice(0, 60 - suffixText.length)}${suffixText}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error("I could not find an unused landing-page path.");
}

function slugifyAgentLandingPage(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

async function loadAgentLandingPage(
  env: AgentLandingPageEnv,
  siteId: string,
  pageId: string,
): Promise<DbAgentLandingPage | null> {
  return env.DB.prepare(
    `SELECT id, site_id, slug, title, template_id, draft_json,
            published_revision_id, updated_at, published_at
     FROM site_pages
     WHERE site_id = ? AND id = ? AND kind = 'landing_page'
     LIMIT 1`,
  )
    .bind(siteId, pageId)
    .first<DbAgentLandingPage>();
}

function parseAgentLandingPageDocument(raw: string): LandingPageDocumentV3 | null {
  try {
    const normalized = normalizeLandingPageDocument(JSON.parse(raw));
    return normalized ? upgradeLandingPageDocument(normalized) : null;
  } catch {
    return null;
  }
}

function serializeAgentLandingPage(
  row: DbAgentLandingPage,
  site: DbAgentLandingSite,
  document: LandingPageDocumentV3,
  options: {
    siteCreated?: boolean;
    imageProvider?: "pexels" | null;
  } = {},
): AgentLandingPageSummary {
  const designPackId = getLandingPageDesignPackId(document);
  const isSiteHomepage =
    site.site_role === "organization" &&
    site.template_id === AGENT_LANDING_PAGE_SITE_TEMPLATE_ID &&
    row.slug === "home";
  return {
    id: row.id,
    siteId: row.site_id,
    siteUsername: site.username,
    slug: row.slug,
    title: getLandingPageTitle(document),
    purpose: getLandingPageTemplateId(document),
    designPackId,
    designName: getLandingPageDesignPack(designPackId).name,
    siteCreated: options.siteCreated === true,
    isSiteHomepage,
    imageProvider:
      options.imageProvider === "pexels" ||
      document.assets.heroImageAttribution?.provider === "pexels"
        ? "pexels"
        : null,
    published: Boolean(row.published_revision_id || row.published_at),
    updatedAt: row.updated_at,
    editorPath: `/sites/${encodeURIComponent(site.username)}/pages/${encodeURIComponent(row.id)}`,
    previewPath: `/api/sites/${encodeURIComponent(site.username)}/pages/${encodeURIComponent(row.id)}/preview-html`,
    publicPath: isSiteHomepage
      ? `/site/${encodeURIComponent(site.username)}/`
      : `/me/${encodeURIComponent(row.slug)}`,
  };
}

function normalizeOptionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function readAgentLandingPageRevision(env: AgentLandingPageEnv, userId: string, pageId: string) {
  const row = await env.DB.prepare(`SELECT p.id, p.draft_json, p.updated_at, s.username
    FROM site_pages p JOIN sites s ON s.id = p.site_id
    WHERE p.id = ? AND s.user_id = ? AND p.kind = 'landing_page'`)
    .bind(pageId, userId).first<{ id: string; draft_json: string; updated_at: string; username: string }>();
  if (!row) throw new Error("Landing page not found.");
  return { id: row.id, draftJson: row.draft_json, updatedAt: row.updated_at, siteUsername: row.username };
}
