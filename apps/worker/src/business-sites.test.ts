import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  buildLandingPageDocument,
  createBusinessSiteDocument,
} from "@me3-core/plugin-landing-pages";
import {
  getBusinessSiteDraft,
  listBusinessSiteRevisions,
  publishBusinessSite,
  restoreBusinessSiteRevision,
  saveBusinessSiteDraft,
} from "./business-sites";
import { servePublicSiteByUsername } from "./sites";
import type { DbSite, Env } from "./types";

describe("Business Site publishing", () => {
  it("publishes one navigable, indexable snapshot and restores its draft", async () => {
    const db = new SqliteD1();
    const env = { DB: db as unknown as D1Database } as Env;
    const site = db.businessSite;
    const home = buildPage("home", "Welcome to Harbour Practice");
    const about = buildPage("about", "About the practice");
    db.insertPage("page-home", site.id, "home", home);
    db.insertPage("page-about", site.id, "about", about);

    const draft = createBusinessSiteDocument("Harbour Practice", {
      homepageSlug: "home",
      description: "Calm, evidence-informed care.",
      designPackId: "clinical-editorial-01",
    });
    draft.navigation.items = [
      { id: "nav-home", label: "Home", pageSlug: "home", visible: true },
      { id: "nav-about", label: "About", pageSlug: "about", visible: true },
    ];
    draft.footer.note = "Independent, expert-led care.";
    await saveBusinessSiteDraft(env, site, draft);

    const published = await publishBusinessSite(
      env,
      site,
      "https://harbour.example",
    );
    const rootHtml = db.textFile(site.id, "public/index.html");
    expect(published.pages).toHaveLength(2);
    expect(rootHtml).toContain('data-design-pack="clinical-editorial-01"');
    expect(rootHtml).toContain('href="/about/"');
    expect(rootHtml).toContain('href="https://harbour.example/"');
    expect(db.textFile(site.id, "public/sitemap.xml")).toContain(
      "https://harbour.example/about/",
    );
    expect(db.textFile(site.id, "public/robots.txt")).toContain(
      "Sitemap: https://harbour.example/sitemap.xml",
    );
    expect(await listBusinessSiteRevisions(env, site)).toMatchObject([
      { id: published.id, pageCount: 2 },
    ]);

    const changed = { ...draft, name: "Changed name" };
    await saveBusinessSiteDraft(env, site, changed);
    const restored = await restoreBusinessSiteRevision(env, site, published.id);
    expect(restored.name).toBe("Harbour Practice");
    expect((await getBusinessSiteDraft(env, site)).name).toBe("Harbour Practice");
  });

  it("keeps noindex pages crawlable and advertises the correct nested profile URL", async () => {
    const db = new SqliteD1();
    const env = { DB: db as unknown as D1Database, CORE_WEB_ORIGIN: "https://example.com" } as Env;
    const site = db.businessSite;
    db.insertPage("home", site.id, "home", buildPage("home", "Welcome"));
    const draft = createBusinessSiteDocument("Harbour Practice", { homepageSlug: "home" });
    draft.seo.indexing = "noindex";
    await saveBusinessSiteDraft(env, site, draft);
    await publishBusinessSite(env, site, "https://example.com/site/harbour-practice");
    expect(db.textFile(site.id, "public/robots.txt")).toContain("Allow: /");
    expect(db.textFile(site.id, "public/sitemap.xml")).not.toContain("<loc>");
    const response = await servePublicSiteByUsername(env, "example.com", site.username, "index.html");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("Link")).toContain("</site/harbour-practice/me.json>");
    expect(await response.text()).toContain('content="noindex,nofollow"');
  });

  it("rejects a missing homepage before public output changes", async () => {
    const db = new SqliteD1();
    const env = { DB: db as unknown as D1Database } as Env;
    const draft = createBusinessSiteDocument("Harbour Practice", {
      homepageSlug: "missing",
    });
    await expect(saveBusinessSiteDraft(env, db.businessSite, draft)).rejects.toMatchObject({
      status: 409,
      message: expect.stringContaining("homepage"),
    });
    expect(db.textFile(db.businessSite.id, "public/index.html")).toBe("");
  });

  it("keeps redirects inside the username fallback route", async () => {
    const db = new SqliteD1();
    const env = { DB: db as unknown as D1Database } as Env;
    db.insertPage("page-home", db.businessSite.id, "home", buildPage("home", "Welcome"));
    db.insertPage("page-start", db.businessSite.id, "start", buildPage("start", "Start here"));
    const draft = createBusinessSiteDocument("Harbour Practice", {
      homepageSlug: "home",
    });
    draft.navigation.items = [
      { id: "home", label: "Home", pageSlug: "home", visible: true },
      { id: "start", label: "Start", pageSlug: "start", visible: true },
    ];
    draft.redirects = [{ id: "old-to-start", from: "/old/", to: "/start/" }];
    await saveBusinessSiteDraft(env, db.businessSite, draft);
    await publishBusinessSite(
      env,
      db.businessSite,
      "http://localhost:8787/site/harbour-practice",
    );

    const response = await servePublicSiteByUsername(
      env,
      "localhost",
      "harbour-practice",
      "old/",
    );
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe(
      "/site/harbour-practice/start/",
    );
  });

  it("rolls back every public change when the publish batch fails", async () => {
    const db = new SqliteD1();
    const env = { DB: db as unknown as D1Database } as Env;
    db.insertPage("page-home", db.businessSite.id, "home", buildPage("home", "Welcome"));
    const draft = createBusinessSiteDocument("Harbour Practice", {
      homepageSlug: "home",
    });
    draft.navigation.items = [
      { id: "home", label: "Home", pageSlug: "home", visible: true },
    ];
    await saveBusinessSiteDraft(env, db.businessSite, draft);
    db.failBatchAt = 2;

    await expect(
      publishBusinessSite(env, db.businessSite, "https://harbour.example"),
    ).rejects.toThrow("Simulated batch failure");
    expect(db.textFile(db.businessSite.id, "public/index.html")).toBe("");
    expect(await listBusinessSiteRevisions(env, db.businessSite)).toEqual([]);
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
