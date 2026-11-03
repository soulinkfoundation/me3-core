import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { buildLandingPageDocument } from "@me3-core/plugin-landing-pages";
import { publishSitePage } from "./site-pages";
import { putSiteFile, servePublicSiteByUsername } from "./sites";
import type { DbSite, Env } from "./types";

const PUBLISHED_SETTINGS = {
  version: 1,
  name: "Harbour Practice",
  homepageSlug: "home",
  navigation: { items: [] },
  footer: { note: "", links: [] },
  seo: { titleSuffix: "", description: "", indexing: "noindex" },
  organization: {},
  redirects: [{ id: "old-to-start", from: "/old/", to: "/start/" }],
  connectedResources: { collectionIds: [], productIds: [], bookingOfferIds: [] },
  design: { packId: "clinical-editorial-01", packVersion: 1 },
  updatedAt: "2026-08-31T10:00:00Z",
};

/** Business Sites can no longer be made or edited, but any already published keep serving. */
describe("older Business Sites", () => {
  async function publishedSite() {
    const db = new SqliteD1();
    const env = { DB: db as unknown as D1Database } as Env;
    db.raw.prepare("UPDATE sites SET published_at = '2026-08-31T10:00:00Z' WHERE id = 'business'").run();
    await putSiteFile(env, "business", "public/index.html", "<h1>Harbour</h1>", "text/html");
    await putSiteFile(env, "business", "public/business-site.json", JSON.stringify(PUBLISHED_SETTINGS), "application/json");
    return { db, env };
  }

  it("keeps serving pages with their published noindex setting", async () => {
    const { env } = await publishedSite();

    const response = await servePublicSiteByUsername(env, "localhost", "harbour-practice", "");

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(await response.text()).toContain("Harbour");
  });

  it("keeps redirects inside the username fallback route", async () => {
    const { env } = await publishedSite();

    const response = await servePublicSiteByUsername(env, "localhost", "harbour-practice", "old/");

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/site/harbour-practice/start/");
  });

  it("refuses to republish one page without the site's navigation", async () => {
    const { db, env } = await publishedSite();
    db.insertPage("page-home", "business", "home", buildPage("home", "Welcome"));

    await expect(publishSitePage(env, db.businessSite, "page-home")).rejects.toThrow(
      "can no longer be edited",
    );
    expect(db.textFile("business", "public/index.html")).toBe("<h1>Harbour</h1>");
  });

  it("still republishes a page on an older agent-built site", async () => {
    const db = new SqliteD1();
    const env = { DB: db as unknown as D1Database } as Env;
    const site = { ...db.businessSite, template_id: "agent-landing-page" };
    db.insertPage("page-home", site.id, "home", buildPage("home", "Welcome back"));

    await publishSitePage(env, site, "page-home");

    expect(db.textFile(site.id, "public/index.html")).toContain("Welcome");
  });
});

function buildPage(slug: string, brief: string) {
  const page = buildLandingPageDocument({
    username: "harbour-practice",
    brief,
    template: "service",
    designPackId: "clinical-editorial-01",
    profile: { name: "Owner", bio: null, avatar: null, profileUrl: null },
  });
  if (page.version !== 3) throw new Error("Expected v3 page");
  page.actions[0] = {
    ...page.actions[0],
    kind: "link",
    href: slug === "home" ? "/contact/" : "/",
    resourceId: undefined,
  };
  return page;
}

class SqliteD1 {
  readonly raw = new DatabaseSync(":memory:");
  failBatchAt: number | null = null;
  readonly businessSite: DbSite = {
    id: "business",
    user_id: "owner",
    username: "harbour-practice",
    site_type: "profile",
    site_role: "organization",
    profile_site_id: "profile",
    template_id: "business-site",
    custom_domain: null,
    custom_domain_status: null,
    custom_domain_cf_id: null,
    created_at: "2026-08-31T10:00:00Z",
    updated_at: "2026-08-31T10:00:00Z",
    published_at: null,
  };

  constructor() {
    this.raw.exec(`
      CREATE TABLE sites (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL, username TEXT NOT NULL,
        site_type TEXT NOT NULL, site_role TEXT, profile_site_id TEXT,
        template_id TEXT, custom_domain TEXT, custom_domain_status TEXT,
        custom_domain_cf_id TEXT, created_at TEXT, updated_at TEXT, published_at TEXT
      );
      CREATE TABLE site_pages (
        id TEXT PRIMARY KEY, site_id TEXT NOT NULL, slug TEXT NOT NULL,
        kind TEXT NOT NULL, title TEXT NOT NULL, template_id TEXT,
        draft_json TEXT NOT NULL, published_revision_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        published_at TEXT
      );
      CREATE TABLE site_page_revisions (
        id TEXT PRIMARY KEY, page_id TEXT NOT NULL, document_json TEXT NOT NULL,
        rendered_html TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE site_files (
        site_id TEXT NOT NULL, path TEXT NOT NULL, content BLOB NOT NULL,
        content_type TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (site_id, path)
      );
    `);
    this.raw
      .prepare(
        `INSERT INTO sites VALUES
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
         (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "profile", "owner", "owner", "profile", "profile", null, null,
        null, null, null, "2026-08-31T09:00:00Z", "2026-08-31T09:00:00Z", "2026-08-31T09:00:00Z",
        this.businessSite.id, this.businessSite.user_id, this.businessSite.username,
        this.businessSite.site_type, this.businessSite.site_role,
        this.businessSite.profile_site_id ?? null, this.businessSite.template_id ?? null,
        null, null, null, this.businessSite.created_at, this.businessSite.updated_at, null,
      );
  }

  insertPage(id: string, siteId: string, slug: string, document: unknown) {
    this.raw
      .prepare(
        `INSERT INTO site_pages
         (id, site_id, slug, kind, title, template_id, draft_json)
         VALUES (?, ?, ?, 'landing_page', ?, 'service', ?)`,
      )
      .run(id, siteId, slug, slug, JSON.stringify(document));
  }

  textFile(siteId: string, path: string): string {
    const row = this.raw
      .prepare("SELECT content FROM site_files WHERE site_id = ? AND path = ?")
      .get(siteId, path) as { content: Uint8Array } | undefined;
    return row ? new TextDecoder().decode(row.content) : "";
  }

  async batch(statements: Array<{ run: () => Promise<unknown> }>) {
    this.raw.exec("BEGIN");
    try {
      const results = [];
      for (const [index, statement] of statements.entries()) {
        if (index === this.failBatchAt) throw new Error("Simulated batch failure");
        results.push(await statement.run());
      }
      this.raw.exec("COMMIT");
      return results;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }

  prepare(sql: string) {
    const statement = this.raw.prepare(sql);
    let values: unknown[] = [];
    const sqliteValues = () => values.map((value) =>
      value instanceof ArrayBuffer ? new Uint8Array(value) : value,
    ) as any[];
    const wrapper = {
      bind: (...next: unknown[]) => {
        values = next;
        return wrapper;
      },
      run: async () => {
        const result = statement.run(...sqliteValues());
        return { meta: { changes: Number(result.changes) } };
      },
      first: async <T>() => (statement.get(...sqliteValues()) || null) as T | null,
      all: async <T>() => ({ results: statement.all(...sqliteValues()) as T[] }),
    };
    return wrapper;
  }
}
