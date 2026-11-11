/**
 * Text carousels: owner-saved slide templates and the slide text kept with a Post.
 *
 * The web app renders each slide to a 1080x1350 JPEG, saves it to Files and attaches it as an
 * ordinary image, so publishing never sees this model. Template values left on "site" are live
 * references to the site's Look (theme, accent override, logo); they are resolved in the browser.
 */
import { SocialPostInputError, type SocialPostEnv } from "./content-packages";

export type CarouselHex = `#${string}`;
export type CarouselBackground = "site-light" | "site-dark" | "photo" | CarouselHex;

export type CarouselTemplateSettings = {
  background: CarouselBackground;
  /** Files id of the template photo, used when background is "photo". */
  photoFileId: string | null;
  /** Photo darkening, 0-80 percent. */
  dim: number;
  accent: "site" | CarouselHex;
  font: "site" | "serif" | "sans";
  weight: "regular" | "bold";
  position: "top" | "middle" | "bottom";
  align: "left" | "center";
  rule: boolean;
  cornerLeft: string;
  cornerRight: string;
  logo: boolean;
};

export type CarouselTemplate = {
  id: string;
  siteId: string;
  name: string;
  settings: CarouselTemplateSettings;
  createdAt: string;
  updatedAt: string;
};

export type TextCarouselSlide = {
  id: string;
  main: string;
  small: string;
  swap: boolean;
  /** Files id of this slide's own photo, overriding the template background. */
  photoFileId: string | null;
};

export type TextCarousel = {
  postId: string;
  templateId: string | null;
  slides: TextCarouselSlide[];
  /** Files ids of the JPEGs last added to the post, so "Add to post" can replace them. */
  fileIds: string[];
  updatedAt: string;
};

export const TEXT_CAROUSEL_MAX_SLIDES = 20;
const MAX_TEMPLATES = 50;
const MAX_MAIN = 1_000;
const MAX_SMALL = 2_000;
const MAX_CORNER = 80;
const MAX_NAME = 60;

const HEX = /^#[0-9a-f]{6}$/i;

export const DEFAULT_CAROUSEL_TEMPLATE_SETTINGS: CarouselTemplateSettings = {
  background: "site-light",
  photoFileId: null,
  dim: 45,
  accent: "site",
  font: "site",
  weight: "regular",
  position: "middle",
  align: "left",
  rule: true,
  cornerLeft: "",
  cornerRight: "",
  logo: true,
};

type TemplateRow = {
  id: string;
  site_id: string;
  name: string;
  settings_json: string;
  created_at: string;
  updated_at: string;
};

type CarouselRow = {
  post_id: string;
  template_id: string | null;
  slides_json: string;
  file_ids_json: string;
  updated_at: string;
};

/** Lists the site's templates, creating "My site" and "My site, dark" the first time. */
export async function listCarouselTemplates(
  env: SocialPostEnv,
  ownerId: string,
  siteIdInput: unknown,
): Promise<CarouselTemplate[]> {
  const site = await requireOwnedSite(env, ownerId, siteIdInput);
  let rows = await selectTemplates(env, site.id);
  if (!rows.length) {
    const corner = site.name ? `@${site.name}` : "";
    const now = new Date().toISOString();
    const defaults: Array<[string, CarouselTemplateSettings]> = [
      ["My site", { ...DEFAULT_CAROUSEL_TEMPLATE_SETTINGS, cornerLeft: corner }],
      [
        "My site, dark",
        { ...DEFAULT_CAROUSEL_TEMPLATE_SETTINGS, background: "site-dark", position: "bottom", cornerLeft: corner, cornerRight: "Swipe →" },
      ],
    ];
    await env.DB.batch(
      defaults.map(([name, settings], index) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO social_carousel_templates (id, site_id, name, settings_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(`${site.id}:default-${index + 1}`, site.id, name, JSON.stringify(settings), now, now),
      ),
    );
    rows = await selectTemplates(env, site.id);
  }
  return rows.map(serializeTemplate);
}

export async function createCarouselTemplate(
  env: SocialPostEnv,
  ownerId: string,
  input: { siteId?: unknown; name?: unknown; settings?: unknown },
): Promise<CarouselTemplate> {
  const site = await requireOwnedSite(env, ownerId, input.siteId);
  const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM social_carousel_templates WHERE site_id = ?")
    .bind(site.id)
    .first<{ count: number }>();
  if ((count?.count || 0) >= MAX_TEMPLATES) {
    throw new SocialPostInputError(`You can keep up to ${MAX_TEMPLATES} templates`);
  }
  const name = templateName(input.name);
  const settings = normalizeCarouselTemplateSettings(input.settings);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO social_carousel_templates (id, site_id, name, settings_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(id, site.id, name, JSON.stringify(settings), now, now).run();
  return { id, siteId: site.id, name, settings, createdAt: now, updatedAt: now };
}

export async function updateCarouselTemplate(
  env: SocialPostEnv,
  ownerId: string,
  templateId: string,
  input: { name?: unknown; settings?: unknown },
): Promise<CarouselTemplate> {
  const row = await env.DB.prepare(
    `SELECT t.id, t.site_id, t.name, t.settings_json, t.created_at, t.updated_at
     FROM social_carousel_templates t
     JOIN sites s ON s.id = t.site_id
     WHERE t.id = ? AND s.user_id = ?`,
  ).bind(templateId, ownerId).first<TemplateRow>();
  if (!row) throw new SocialPostInputError("Template not found", 404);
  const name = input.name === undefined ? row.name : templateName(input.name);
  const settings = input.settings === undefined
    ? parseSettings(row.settings_json)
    : normalizeCarouselTemplateSettings(input.settings);
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE social_carousel_templates SET name = ?, settings_json = ?, updated_at = ? WHERE id = ?")
    .bind(name, JSON.stringify(settings), now, row.id)
    .run();
  return { id: row.id, siteId: row.site_id, name, settings, createdAt: row.created_at, updatedAt: now };
}

export async function getTextCarousel(
  env: SocialPostEnv,
  ownerId: string,
  postId: string,
): Promise<TextCarousel | null> {
  await requireOwnedPost(env, ownerId, postId);
  const row = await env.DB.prepare(
    "SELECT post_id, template_id, slides_json, file_ids_json, updated_at FROM social_text_carousels WHERE post_id = ?",
  ).bind(postId).first<CarouselRow>();
  return row ? serializeCarousel(row) : null;
}

export async function saveTextCarousel(
  env: SocialPostEnv,
  ownerId: string,
  postId: string,
  input: { templateId?: unknown; slides?: unknown; fileIds?: unknown },
): Promise<TextCarousel> {
  const siteId = await requireOwnedPost(env, ownerId, postId);
  const templateId = typeof input.templateId === "string" && input.templateId.trim() ? input.templateId.trim() : null;
  if (templateId) {
    const template = await env.DB.prepare("SELECT id FROM social_carousel_templates WHERE id = ? AND site_id = ?")
      .bind(templateId, siteId)
      .first<{ id: string }>();
    if (!template) throw new SocialPostInputError("Template not found", 404);
  }
  const slides = normalizeTextCarouselSlides(input.slides);
  const fileIds = normalizeIds(input.fileIds, "fileIds");
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO social_text_carousels (post_id, site_id, template_id, slides_json, file_ids_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(post_id) DO UPDATE SET
       template_id = excluded.template_id,
       slides_json = excluded.slides_json,
       file_ids_json = excluded.file_ids_json,
       updated_at = excluded.updated_at`,
  ).bind(postId, siteId, templateId, JSON.stringify(slides), JSON.stringify(fileIds), now, now).run();
  return { postId, templateId, slides, fileIds, updatedAt: now };
}

export function normalizeCarouselTemplateSettings(value: unknown): CarouselTemplateSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SocialPostInputError("Template settings must be an object");
  }
  const raw = value as Record<string, unknown>;
  const base = DEFAULT_CAROUSEL_TEMPLATE_SETTINGS;
  const background = raw.background === "site-light" || raw.background === "site-dark" || raw.background === "photo"
    ? raw.background
    : typeof raw.background === "string" && HEX.test(raw.background)
      ? raw.background.toLowerCase() as CarouselHex
      : base.background;
  const accent = typeof raw.accent === "string" && HEX.test(raw.accent) ? raw.accent.toLowerCase() as CarouselHex : "site";
  const dim = typeof raw.dim === "number" && Number.isFinite(raw.dim) ? Math.round(Math.min(80, Math.max(0, raw.dim))) : base.dim;
  return {
    background,
    photoFileId: optionalId(raw.photoFileId),
    dim,
    accent,
    font: pick(raw.font, ["site", "serif", "sans"] as const, base.font),
    weight: pick(raw.weight, ["regular", "bold"] as const, base.weight),
    position: pick(raw.position, ["top", "middle", "bottom"] as const, base.position),
    align: pick(raw.align, ["left", "center"] as const, base.align),
    rule: typeof raw.rule === "boolean" ? raw.rule : base.rule,
    cornerLeft: clip(raw.cornerLeft, MAX_CORNER),
    cornerRight: clip(raw.cornerRight, MAX_CORNER),
    logo: typeof raw.logo === "boolean" ? raw.logo : base.logo,
  };
}

export function normalizeTextCarouselSlides(value: unknown): TextCarouselSlide[] {
  if (!Array.isArray(value)) throw new SocialPostInputError("slides must be a list");
  if (value.length > TEXT_CAROUSEL_MAX_SLIDES) {
    throw new SocialPostInputError(`A carousel can have up to ${TEXT_CAROUSEL_MAX_SLIDES} slides`);
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    const raw = item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
    let id = typeof raw.id === "string" && /^[\w-]{1,64}$/.test(raw.id) ? raw.id : `s${index + 1}`;
    while (seen.has(id)) id = `${id}-${index + 1}`;
    seen.add(id);
    return {
      id,
      main: clip(raw.main, MAX_MAIN, false),
      small: clip(raw.small, MAX_SMALL, false),
      swap: raw.swap === true,
      photoFileId: optionalId(raw.photoFileId),
    };
  });
}

async function selectTemplates(env: SocialPostEnv, siteId: string): Promise<TemplateRow[]> {
  const result = await env.DB.prepare(
    `SELECT id, site_id, name, settings_json, created_at, updated_at
     FROM social_carousel_templates WHERE site_id = ? ORDER BY created_at, rowid`,
  ).bind(siteId).all<TemplateRow>();
  return result.results || [];
}

async function requireOwnedSite(
  env: SocialPostEnv,
  ownerId: string,
  siteIdInput: unknown,
): Promise<{ id: string; name: string }> {
  const siteId = typeof siteIdInput === "string" ? siteIdInput.trim() : "";
  if (!siteId) throw new SocialPostInputError("siteId is required");
  const site = await env.DB.prepare("SELECT id, username FROM sites WHERE id = ? AND user_id = ?")
    .bind(siteId, ownerId)
    .first<{ id: string; username: string | null }>();
  if (!site) throw new SocialPostInputError("Site not found", 404);
  return { id: site.id, name: site.username || "" };
}

async function requireOwnedPost(env: SocialPostEnv, ownerId: string, postId: string): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT p.site_id FROM social_packages p JOIN sites s ON s.id = p.site_id WHERE p.id = ? AND s.user_id = ?`,
  ).bind(postId, ownerId).first<{ site_id: string }>();
  if (!row) throw new SocialPostInputError("Post not found", 404);
  return row.site_id;
}

function serializeTemplate(row: TemplateRow): CarouselTemplate {
  return {
    id: row.id,
    siteId: row.site_id,
    name: row.name,
    settings: parseSettings(row.settings_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeCarousel(row: CarouselRow): TextCarousel {
  let slides: TextCarouselSlide[] = [];
  let fileIds: string[] = [];
  try {
    slides = normalizeTextCarouselSlides(JSON.parse(row.slides_json));
  } catch {
    slides = [];
  }
  try {
    fileIds = normalizeIds(JSON.parse(row.file_ids_json), "fileIds");
  } catch {
    fileIds = [];
  }
  return { postId: row.post_id, templateId: row.template_id, slides, fileIds, updatedAt: row.updated_at };
}

function parseSettings(value: string): CarouselTemplateSettings {
  try {
    return normalizeCarouselTemplateSettings(JSON.parse(value));
  } catch {
    return { ...DEFAULT_CAROUSEL_TEMPLATE_SETTINGS };
  }
}

function templateName(value: unknown): string {
  const name = typeof value === "string" ? value.trim().slice(0, MAX_NAME) : "";
  if (!name) throw new SocialPostInputError("Give the template a name");
  return name;
}

function pick<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? value as T : fallback;
}

function clip(value: unknown, max: number, trim = true): string {
  if (typeof value !== "string") return "";
  return (trim ? value.trim() : value).slice(0, max);
}

function optionalId(value: unknown): string | null {
  return typeof value === "string" && /^[\w.:-]{1,128}$/.test(value) ? value : null;
}

function normalizeIds(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new SocialPostInputError(`${field} must be a list`);
  return value.map(optionalId).filter((id): id is string => id !== null).slice(0, TEXT_CAROUSEL_MAX_SLIDES);
}
