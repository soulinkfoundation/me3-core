import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import type { AppBindings, AppContext } from "./http/types";
import { registerSiteRoutes } from "./routes/sites";
import type { Env } from "./types";

const siteRolesMigration = readFileSync(
  new URL("../migrations/0038_site_roles.sql", import.meta.url),
  "utf8",
);
const businessSiteProfileOwnershipMigration = readFileSync(
  new URL(
    "../migrations/0046_business_site_profile_ownership.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("0038 site roles migration", () => {
  it("preserves legacy sites and enforces one profile plus three organizations", () => {
    const db = new SqliteD1(false);
    db.raw.exec(`
      INSERT INTO sites
        (id, user_id, username, site_type, template_id, custom_domain,
         custom_domain_status, custom_domain_cf_id, created_at, updated_at, published_at)
      VALUES
        ('site-profile', 'owner', 'owner', 'profile', 'me3', 'owner.example.com',
         'active', 'cf-profile', '2026-01-01', '2026-02-01', '2026-02-01'),
        ('site-second', 'owner', 'studio', 'profile', 'me3', NULL,
         NULL, NULL, '2026-01-02', '2026-02-02', NULL),
        ('legacy-page', 'owner', 'launch', 'landing_page', 'event', NULL,
         NULL, NULL, '2026-01-03', '2026-02-03', '2026-02-03');
    `);

    db.raw.exec(siteRolesMigration);

    expect(
      db.raw
        .prepare(
          `SELECT id, username, site_type, site_role, template_id, custom_domain,
                  custom_domain_status, custom_domain_cf_id, created_at, updated_at, published_at
           FROM sites ORDER BY created_at`,
        )
        .all(),
    ).toEqual([
      {
        id: "site-profile",
        username: "owner",
        site_type: "profile",
        site_role: "profile",
        template_id: "me3",
        custom_domain: "owner.example.com",
        custom_domain_status: "active",
        custom_domain_cf_id: "cf-profile",
        created_at: "2026-01-01",
        updated_at: "2026-02-01",
        published_at: "2026-02-01",
      },
      {
        id: "site-second",
        username: "studio",
        site_type: "profile",
        site_role: "organization",
        template_id: "me3",
        custom_domain: null,
        custom_domain_status: null,
        custom_domain_cf_id: null,
        created_at: "2026-01-02",
        updated_at: "2026-02-02",
        published_at: null,
      },
      {
        id: "legacy-page",
        username: "launch",
        site_type: "landing_page",
        site_role: null,
        template_id: "event",
        custom_domain: null,
        custom_domain_status: null,
        custom_domain_cf_id: null,
        created_at: "2026-01-03",
        updated_at: "2026-02-03",
        published_at: "2026-02-03",
      },
    ]);

    expect(() => insertSite(db, "profile-2", "profile-two", "profile")).toThrow(
      /ME3_SITE_PROFILE_LIMIT/,
    );
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO sites (id, user_id, username, site_type)
           VALUES ('untyped', 'owner', 'untyped', 'profile')`,
        )
        .run(),
    ).toThrow(/ME3_SITE_ROLE_REQUIRED/);
    insertSite(db, "organization-2", "shop", "organization");
    insertSite(db, "organization-3", "collective", "organization");
    expect(() =>
      insertSite(db, "organization-4", "fourth", "organization"),
    ).toThrow(/ME3_SITE_ORGANIZATION_LIMIT/);

    db.raw.prepare("DELETE FROM sites WHERE id = 'organization-2'").run();
    expect(() =>
      insertSite(db, "organization-4", "fourth", "organization"),
    ).not.toThrow();
  });
});

describe("0046 Business Site profile ownership migration", () => {
  it("backfills organizations and enforces same-owner profile associations", () => {
    const db = new SqliteD1(false);
    db.raw.exec(`
      INSERT INTO sites (id, user_id, username, site_type, created_at)
      VALUES
        ('profile', 'owner', 'owner', 'profile', '2026-01-01'),
        ('business', 'owner', 'studio', 'profile', '2026-01-02');
    `);
    db.raw.exec(siteRolesMigration);
    db.raw.exec(businessSiteProfileOwnershipMigration);

    expect(
      db.raw.prepare("SELECT profile_site_id FROM sites WHERE id = 'business'").get(),
    ).toEqual({ profile_site_id: "profile" });
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO sites
             (id, user_id, username, site_type, site_role, profile_site_id)
           VALUES ('invalid', 'owner', 'invalid', 'profile', 'organization', 'missing')`,
        )
        .run(),
    ).toThrow(/ME3_SITE_PROFILE_OWNERSHIP/);
  });
});

describe("site role API lifecycle", () => {
  let db: SqliteD1;
  let env: Env;
  let app: Hono<AppBindings>;

  beforeEach(() => {
    db = new SqliteD1(true);
    env = { DB: db as unknown as D1Database } as Env;
    app = new Hono<AppBindings>();
    registerSiteRoutes(app, {
      requireOwner: async () => "owner",
      unauthorized: (c: AppContext) => c.json({ error: "Unauthorized" }, 401),
    });
  });

  it("requires a profile, associates organizations, and reports role-aware quota", async () => {
    const rejected = await postSite(app, env, {
      username: "independent-studio",
      siteRole: "organization",
    });
    expect(rejected.response.status).toBe(409);
    expect(rejected.body).toMatchObject({ code: "profile_required" });

    const profile = await postSite(app, env, { username: "owner" });
    const organization = await postSite(app, env, {
      username: "independent-studio",
      siteRole: "organization",
    });
    expect(organization.response.status).toBe(201);
    expect(organization.body.site).toMatchObject({
      username: "independent-studio",
      site_role: "organization",
      profile_site_id: profile.body.site.id,
    });

    const quotaResponse = await app.fetch(new Request("http://localhost/api/sites/quota"), env);
    const quota = (await quotaResponse.json()) as Record<string, any>;
    expect(quotaResponse.status).toBe(200);
    expect(quota).toMatchObject({
      current: 2,
      limit: 4,
      profile: { current: 1, limit: 1, remaining: 0, can_create: false },
      additional_sites: { current: 1, limit: 3, remaining: 2, can_create: true },
      remaining_additional_sites: 2,
      can_create_profile: false,
      can_create_additional_site: true,
    });
  });

  it("renames and unpublishes the profile but rejects standalone deletion", async () => {
    const siteAssets = new MemoryR2Bucket();
    env.SITE_ASSETS = siteAssets as unknown as R2Bucket;
    const created = await postSite(app, env, { username: "owner" });
    const profileId = String(created.body.site.id);
    await db
      .prepare(
        `UPDATE sites
         SET published_at = '2026-08-24T10:00:00Z', custom_domain = 'owner.example.com',
             custom_domain_status = 'active'
         WHERE id = ?`,
      )
      .bind(profileId)
      .run();
    db.raw
      .prepare(
        `INSERT INTO site_files (site_id, path, content, content_type, size)
         VALUES (?, 'public/index.html', 'profile', 'text/html', 7)`,
      )
      .run(profileId);
    await siteAssets.put("sites/owner/public/hero.png", "profile-image");
    await postSite(app, env, { username: "studio", siteRole: "organization" });

    const renamed = await postSite(app, env, {
      username: "new-owner",
      siteRole: "profile",
      renameFromUsername: "owner",
    });
    expect(renamed.response.status).toBe(200);
    expect(renamed.body).toMatchObject({
      renamed: true,
      site: {
        id: profileId,
        username: "new-owner",
        site_role: "profile",
        published_at: "2026-08-24T10:00:00Z",
        custom_domain: "owner.example.com",
      },
    });
    expect(
      db.raw.prepare("SELECT COUNT(*) AS count FROM site_files WHERE site_id = ?").get(profileId),
    ).toEqual({ count: 1 });
    expect(
      db.raw.prepare("SELECT COUNT(*) AS count FROM sites WHERE site_role = 'organization'").get(),
    ).toEqual({ count: 1 });
    expect(siteAssets.has("sites/owner/public/hero.png")).toBe(false);
    expect(siteAssets.has("sites/new-owner/public/hero.png")).toBe(true);

    const unpublished = await app.fetch(
      new Request("http://localhost/api/sites/new-owner/unpublish", { method: "POST" }),
      env,
    );
    expect(unpublished.status).toBe(200);
    expect(db.raw.prepare("SELECT published_at FROM sites WHERE id = ?").get(profileId)).toEqual({
      published_at: null,
    });

    const deleted = await app.fetch(
      new Request("http://localhost/api/sites/new-owner", { method: "DELETE" }),
      env,
    );
    expect(deleted.status).toBe(409);
    await expect(deleted.json()).resolves.toMatchObject({
      code: "profile_delete_forbidden",
    });
    expect(db.raw.prepare("SELECT COUNT(*) AS count FROM sites WHERE id = ?").get(profileId)).toEqual({
      count: 1,
    });
  });

  it("loads editable profile data from a legacy public-only site", async () => {
    const created = await postSite(app, env, { username: "connie" });
    const profileId = String(created.body.site.id);
    const publicProfile = JSON.stringify({
      version: "0.1",
      visibility: "public",
      handle: "connie",
      name: "Connie Fahy",
      bio: "Published profile biography",
      pages: [{ slug: "about", title: "About" }],
    });
    db.raw
      .prepare(
        `INSERT INTO site_files (site_id, path, content, content_type, size)
         VALUES (?, 'public/me.json', ?, 'application/json', ?)`,
      )
      .run(
        profileId,
        new TextEncoder().encode(publicProfile),
        publicProfile.length,
      );

    const response = await app.fetch(
      new Request("http://localhost/api/sites/connie/content"),
      env,
    );
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      profile: {
        handle: "connie",
        name: "Connie Fahy",
        bio: "Published profile biography",
      },
      pages: [],
      posts: [],
      products: [],
    });

    const markdown = '<div data-me3-site-block="booking">​</div>';
    db.raw.prepare(
      `INSERT INTO site_files (site_id, path, content, content_type, size)
       VALUES (?, 'src/about.md', ?, 'text/markdown', ?)`,
    ).run(profileId, new TextEncoder().encode(markdown), markdown.length);
    const editable = await app.fetch(new Request("http://localhost/api/sites/connie/content"), env);
    const editableBody = (await editable.json()) as { pages: Array<{ source: string }> };
    expect(editableBody.pages[0].source).toBe(markdown);
  });

  it("renames only the organization selected by stable site id", async () => {
    const profile = await postSite(app, env, { username: "owner" });
    const studio = await postSite(app, env, {
      username: "studio",
      siteRole: "organization",
    });
    const community = await postSite(app, env, {
      username: "community",
      siteRole: "organization",
    });

    const renamed = await postSite(app, env, {
      username: "new-studio",
      siteRole: "organization",
      renameFromSiteId: studio.body.site.id,
    });

    expect(renamed.response.status).toBe(200);
    expect(renamed.body).toMatchObject({
      renamed: true,
      site: {
        id: studio.body.site.id,
        username: "new-studio",
        site_role: "organization",
      },
    });
    expect(
      db.raw.prepare("SELECT username FROM sites WHERE id = ?").get(profile.body.site.id),
    ).toEqual({ username: "owner" });
    expect(
      db.raw.prepare("SELECT username FROM sites WHERE id = ?").get(community.body.site.id),
    ).toEqual({ username: "community" });

    const wrongRole = await postSite(app, env, {
      username: "should-not-rename",
      siteRole: "profile",
      renameFromSiteId: studio.body.site.id,
    });
    expect(wrongRole.response.status).toBe(404);
    expect(
      db.raw.prepare("SELECT username FROM sites WHERE id = ?").get(studio.body.site.id),
    ).toEqual({ username: "new-studio" });
  });

  it("enforces three additional sites and releases quota after deletion", async () => {
    const siteAssets = new MemoryR2Bucket();
    env.SITE_ASSETS = siteAssets as unknown as R2Bucket;
    await postSite(app, env, { username: "owner" });
    const attempts = await Promise.all(
      ["one", "two", "three", "four"].map((username) =>
        postSite(app, env, { username, siteRole: "organization" }),
      ),
    );
    expect(attempts.map(({ response }) => response.status).sort()).toEqual([
      201,
      201,
      201,
      409,
    ]);
    const rejected = attempts.find(({ response }) => response.status === 409)!;
    expect(rejected.response.status).toBe(409);
    expect(rejected.body).toMatchObject({ code: "organization_limit" });

    const siteToDelete = db.raw
      .prepare(
        "SELECT id, username FROM sites WHERE site_role = 'organization' ORDER BY username LIMIT 1",
      )
      .get() as { id: string; username: string };
    db.raw
      .prepare(
        `INSERT INTO site_files (site_id, path, content, content_type, size)
         VALUES (?, 'public/index.html', 'site', 'text/html', 4)`,
      )
      .run(siteToDelete.id);
    await siteAssets.put(`sites/${siteToDelete.username}/public/index.html`, "site");
    const deleted = await app.fetch(
      new Request(`http://localhost/api/sites/${siteToDelete.username}`, {
        method: "DELETE",
      }),
      env,
    );
    expect(deleted.status).toBe(200);
    expect(
      db.raw.prepare("SELECT COUNT(*) AS count FROM site_files WHERE site_id = ?").get(siteToDelete.id),
    ).toEqual({ count: 0 });
    expect(
      siteAssets.has(`sites/${siteToDelete.username}/public/index.html`),
    ).toBe(false);

    const replacement = await postSite(app, env, {
      username: "replacement",
      siteRole: "organization",
    });
    expect(replacement.response.status).toBe(201);
  });
});

function insertSite(
  db: SqliteD1,
  id: string,
  username: string,
  role: "profile" | "organization",
) {
  db.raw
    .prepare(
      `INSERT INTO sites (id, user_id, username, site_type, site_role, created_at, updated_at)
       VALUES (?, 'owner', ?, 'profile', ?, datetime('now'), datetime('now'))`,
    )
    .run(id, username, role);
}

async function postSite(
  app: Hono<AppBindings>,
  env: Env,
  body: Record<string, unknown>,
): Promise<{ response: Response; body: Record<string, any> }> {
  const response = await app.fetch(
    new Request("http://localhost/api/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );
  return { response, body: (await response.json()) as Record<string, any> };
}

class SqliteD1 {
  raw = new DatabaseSync(":memory:");

  constructor(applyRolesMigration: boolean) {
    this.raw.exec("PRAGMA foreign_keys = ON");
    this.raw.exec(`
      CREATE TABLE owner_profile (id TEXT PRIMARY KEY);
      INSERT INTO owner_profile (id) VALUES ('owner');
      CREATE TABLE install_secrets (
        name TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE sites (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'owner',
        username TEXT NOT NULL UNIQUE,
        site_type TEXT NOT NULL DEFAULT 'profile'
          CHECK (site_type IN ('profile', 'landing_page')),
        template_id TEXT,
        custom_domain TEXT,
        custom_domain_status TEXT CHECK (custom_domain_status IN ('pending', 'active', 'failed')),
        custom_domain_cf_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        published_at TEXT,
        FOREIGN KEY (user_id) REFERENCES owner_profile(id) ON DELETE CASCADE
      );
      CREATE TABLE site_files (
        site_id TEXT NOT NULL,
        path TEXT NOT NULL,
        content BLOB NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (site_id, path),
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
      );
    `);
    if (applyRolesMigration) {
      this.raw.exec(siteRolesMigration);
      this.raw.exec(businessSiteProfileOwnershipMigration);
    }
  }

  prepare(sql: string) {
    const statement = this.raw.prepare(sql);
    let values: unknown[] = [];
    const wrapper = {
      bind: (...next: unknown[]) => {
        values = next;
        return wrapper;
      },
      run: async () => {
        const result = statement.run(...(values as any[]));
        return { meta: { changes: Number(result.changes) } };
      },
      first: async <T>() => (statement.get(...(values as any[])) || null) as T | null,
      all: async <T>() => ({ results: statement.all(...(values as any[])) as T[] }),
    };
    return wrapper;
  }

  async batch(statements: Array<{ run(): Promise<{ meta: { changes: number } }> }>) {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.raw.exec("COMMIT");
      return results;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }
}

class MemoryR2Bucket {
  private readonly objects = new Map<
    string,
    {
      bytes: Uint8Array;
      httpMetadata: R2HTTPMetadata | Headers;
      customMetadata: Record<string, string>;
    }
  >();

  has(key: string): boolean {
    return this.objects.has(key);
  }

  async put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | Blob | ReadableStream,
    options: R2PutOptions = {},
  ) {
    const bytes = new Uint8Array(await new Response(value as BodyInit).arrayBuffer());
    this.objects.set(key, {
      bytes,
      httpMetadata: options.httpMetadata || {},
      customMetadata: options.customMetadata || {},
    });
    return { key };
  }

  async get(key: string) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    const bytes = stored.bytes.slice();
    return {
      key,
      body: new Response(bytes).body!,
      httpMetadata: stored.httpMetadata,
      customMetadata: stored.customMetadata,
    };
  }

  async list(options: R2ListOptions = {}) {
    const prefix = options.prefix || "";
    return {
      objects: [...this.objects.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, stored]) => ({ key, size: stored.bytes.byteLength })),
      truncated: false as const,
      delimitedPrefixes: [],
    };
  }

  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }
}
