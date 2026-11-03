import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renamePersistentSite } from "./site-lifecycle";
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

  for (const [name, sequence] of [
    ["missing cursor", [undefined]],
    ["repeated cursor", ["a", "a"]],
    ["cursor cycle", ["a", "b", "a"]],
  ] as const) {
    it(`preserves the profile and its assets when rename encounters a ${name}`, async () => {
      const siteAssets = new MemoryR2Bucket();
      env.SITE_ASSETS = siteAssets as unknown as R2Bucket;
      const created = await postSite(app, env, { username: "owner" });
      await siteAssets.put("sites/owner/public/hero.png", "profile-image");
      let calls = 0;
      const list = vi.spyOn(siteAssets, "list").mockImplementation(async (options = {}) => {
        if (options.prefix === "sites/new-owner/") {
          return { objects: [], truncated: false, delimitedPrefixes: [] };
        }
        if (calls >= sequence.length) throw new Error("Test stopped an unbounded scan");
        return {
          objects: [{ key: "sites/owner/public/hero.png", size: 13 }],
          truncated: true,
          cursor: sequence[calls++],
          delimitedPrefixes: [],
        } as unknown as Awaited<ReturnType<MemoryR2Bucket["list"]>>;
      });
      await expect(renamePersistentSite(env, {
        ownerId: "owner", siteId: created.body.site.id, toUsername: "new-owner",
      })).rejects.toThrow("R2 object listing did not advance");
      expect(list).toHaveBeenCalledTimes(sequence.length + 1);
      expect(db.raw.prepare("SELECT username FROM sites WHERE id = ?").get(created.body.site.id))
        .toEqual({ username: "owner" });
      expect(siteAssets.has("sites/owner/public/hero.png")).toBe(true);
      expect(siteAssets.has("sites/new-owner/public/hero.png")).toBe(false);
    });
  }

  it("refuses a second site and reports a one-site quota", async () => {
    const beforeProfile = await postSite(app, env, {
      username: "independent-studio",
      siteRole: "organization",
    });
    expect(beforeProfile.response.status).toBe(409);
    expect(beforeProfile.body).toMatchObject({ code: "one_site_per_owner" });

    await postSite(app, env, { username: "owner" });
    const afterProfile = await postSite(app, env, {
      username: "independent-studio",
      siteRole: "organization",
    });
    expect(afterProfile.response.status).toBe(409);
    expect(afterProfile.body).toMatchObject({ code: "one_site_per_owner" });
    expect(db.raw.prepare("SELECT COUNT(*) AS count FROM sites").get()).toEqual({ count: 1 });

    const unknownRole = await postSite(app, env, { username: "other", siteRole: "team" });
    expect(unknownRole.response.status).toBe(400);

    const quotaResponse = await app.fetch(new Request("http://localhost/api/sites/quota"), env);
    const quota = (await quotaResponse.json()) as Record<string, any>;
    expect(quotaResponse.status).toBe(200);
    expect(quota).toMatchObject({
      current: 1,
      limit: 1,
      profile: { current: 1, limit: 1, remaining: 0, can_create: false },
      can_create: false,
      can_create_profile: false,
    });
    expect(quota).not.toHaveProperty("additional_sites");
    expect(quota).not.toHaveProperty("can_create_additional_site");
    expect(quota.capabilities).not.toHaveProperty("maxAdditionalSites");
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
    insertOlderOrganizationSite(db, "studio-id", "studio");

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

  it("leaves an older organization site out of renames", async () => {
    await postSite(app, env, { username: "owner" });
    insertOlderOrganizationSite(db, "studio-id", "studio");

    const renamed = await postSite(app, env, {
      username: "new-studio",
      renameFromSiteId: "studio-id",
    });

    expect(renamed.response.status).toBe(404);
    expect(
      db.raw.prepare("SELECT username FROM sites WHERE id = 'studio-id'").get(),
    ).toEqual({ username: "studio" });
  });

  it("does not count an older organization site against the owner's one site", async () => {
    await postSite(app, env, { username: "owner" });
    insertOlderOrganizationSite(db, "studio-id", "studio");

    const response = await app.fetch(new Request("http://localhost/api/sites/quota"), env);
    expect(await response.json()).toMatchObject({ current: 1, limit: 1 });
  });

  it("lets an owner delete an older organization site and its files", async () => {
    const siteAssets = new MemoryR2Bucket();
    env.SITE_ASSETS = siteAssets as unknown as R2Bucket;
    await postSite(app, env, { username: "owner" });
    insertOlderOrganizationSite(db, "studio-id", "studio");
    db.raw
      .prepare(
        `INSERT INTO site_files (site_id, path, content, content_type, size)
         VALUES ('studio-id', 'public/index.html', 'site', 'text/html', 4)`,
      )
      .run();
    await siteAssets.put("sites/studio/public/index.html", "site");

    const deleted = await app.fetch(
      new Request("http://localhost/api/sites/studio", { method: "DELETE" }),
      env,
    );

    expect(deleted.status).toBe(200);
    expect(
      db.raw.prepare("SELECT COUNT(*) AS count FROM site_files WHERE site_id = 'studio-id'").get(),
    ).toEqual({ count: 0 });
    expect(siteAssets.has("sites/studio/public/index.html")).toBe(false);
  });
});

function insertOlderOrganizationSite(db: SqliteD1, id: string, username: string): void {
  const profile = db.raw.prepare("SELECT id, user_id FROM sites WHERE site_role = 'profile'").get() as {
    id: string;
    user_id: string;
  };
  db.raw
    .prepare(
      `INSERT INTO sites (id, user_id, username, site_type, site_role, profile_site_id)
       VALUES (?, ?, ?, 'profile', 'organization', ?)`,
    )
    .run(id, profile.user_id, username, profile.id);
}

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
