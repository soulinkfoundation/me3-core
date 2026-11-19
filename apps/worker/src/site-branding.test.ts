import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSiteBranding, saveSiteEmailLogo, setSiteProfileLogo } from "./site-branding";
import type { DbSite, Env } from "./types";

type SqliteValue = null | number | string | Uint8Array;

class SqliteD1Statement {
  private values: SqliteValue[] = [];

  constructor(
    private readonly database: DatabaseSync,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    // D1 takes ArrayBuffers; node:sqlite wants bytes.
    this.values = values.map((value) => value instanceof ArrayBuffer ? new Uint8Array(value) : value) as SqliteValue[];
    return this;
  }

  async first<T>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) || null;
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { results: [], success: true as const, meta: { changes: Number(result.changes) } };
  }
}

describe("Site branding", () => {
  let database: DatabaseSync;
  let env: Env;
  let site: DbSite;

  beforeEach(() => {
    database = new DatabaseSync(":memory:");
    database.exec(`
      CREATE TABLE sites (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        custom_domain TEXT,
        custom_domain_status TEXT
      );
      CREATE TABLE site_files (
        site_id TEXT NOT NULL,
        path TEXT NOT NULL,
        content BLOB NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (site_id, path)
      );
      CREATE TABLE site_branding (
        site_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        logo_ref TEXT,
        email_logo_ref TEXT,
        email_logo_width INTEGER,
        email_logo_height INTEGER,
        accent_color TEXT NOT NULL,
        background_color TEXT NOT NULL,
        surface_color TEXT NOT NULL,
        text_color TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO sites (id, username) VALUES ('site-1', 'kieran');
    `);
    database.prepare(
      `INSERT INTO site_files (site_id, path, content, content_type, size)
       VALUES ('site-1', 'src/me.json', ?, 'application/json', ?)`,
    ).run(
      new TextEncoder().encode(JSON.stringify({
        name: "Kieran Butler",
        logo: "./media/logo.png",
        links: { _accent: "#225544" },
      })),
      100,
    );
    env = {
      DB: { prepare: (sql: string) => new SqliteD1Statement(database, sql) } as unknown as D1Database,
      ME3_SITE_HOST: "sites.example.com",
    } as Env;
    site = {
      id: "site-1",
      username: "kieran",
      custom_domain: null,
      custom_domain_status: null,
    } as DbSite;
  });

  afterEach(() => database.close());

  it("derives defaults from the Site and can persist them", async () => {
    const derived = await getSiteBranding(env, site);
    expect(derived).toMatchObject({
      displayName: "Kieran Butler",
      logoRef: "./media/logo.png",
      logoUrl: "https://sites.example.com/media/logo.png",
      accentColor: "#225544",
      persisted: false,
    });

    const persisted = await getSiteBranding(env, site, true);
    expect(persisted.persisted).toBe(true);
    expect(database.prepare("SELECT COUNT(*) AS count FROM site_branding").get()).toEqual({
      count: 1,
    });
  });

  function writeProfile(profile: Record<string, unknown>) {
    const bytes = new TextEncoder().encode(JSON.stringify(profile));
    database.prepare(
      "UPDATE site_files SET content = ?, size = ? WHERE site_id = 'site-1' AND path = 'src/me.json'",
    ).run(bytes, bytes.length);
  }

  it("follows the logo and accent chosen in the Site editor", async () => {
    await getSiteBranding(env, site, true);
    writeProfile({
      name: "Kieran Butler",
      logo: "./media/new.png",
      extensions: { "me3.app/site": { theme: "meadow", accent: "#112233" } },
    });
    expect(await getSiteBranding(env, site)).toMatchObject({
      logoUrl: "https://sites.example.com/media/new.png",
      accentColor: "#112233",
      persisted: true,
    });

    writeProfile({ name: "Kieran Butler", avatar: "./media/me.jpg", extensions: { "me3.app/site": { theme: "meadow" } } });
    expect(await getSiteBranding(env, site)).toMatchObject({
      logoRef: "./media/me.jpg",
      accentColor: "#3f6b35",
    });
  });

  it("keeps the email logo copy until the Site logo changes", async () => {
    await getSiteBranding(env, site, true);
    const withEmailLogo = await saveSiteEmailLogo(env, site, { width: 180, height: 48, version: "abc" });
    expect(withEmailLogo).toMatchObject({
      emailLogoRef: "./files/email-logo.png?v=abc",
      emailLogoUrl: "https://sites.example.com/files/email-logo.png?v=abc",
      emailLogoWidth: 180,
      emailLogoHeight: 48,
    });

    writeProfile({ name: "Kieran Butler", logo: "./media/logo.png", links: { _accent: "#445566" } });
    const colourOnly = await getSiteBranding(env, site);
    expect(colourOnly).toMatchObject({ accentColor: "#445566", emailLogoUrl: "https://sites.example.com/files/email-logo.png?v=abc" });

    writeProfile({ name: "Kieran Butler", logo: "./media/new.png", links: { _accent: "#445566" } });
    expect(await getSiteBranding(env, site)).toMatchObject({ emailLogoRef: null, emailLogoUrl: null, emailLogoWidth: null });
  });

  it("refuses an email logo bigger than the 200 by 64 slot", async () => {
    await expect(saveSiteEmailLogo(env, site, { width: 400, height: 128, version: "x" })).rejects.toThrow(
      "at most 200 by 64",
    );
  });

  it("sets the Site logo from outside the editor and drops the old email copy", async () => {
    writeProfile({ name: "Kieran Butler", links: { _accent: "#225544" } });
    expect((await getSiteBranding(env, site, true)).logoRef).toBeNull();

    expect(await setSiteProfileLogo(env, "site-1", "./files/logo.png")).toBe(true);
    expect(await getSiteBranding(env, site)).toMatchObject({
      displayName: "Kieran Butler",
      logoRef: "./files/logo.png",
      emailLogoUrl: null,
    });
    expect(await setSiteProfileLogo(env, "site-2", "./files/logo.png")).toBe(false);
  });
});
