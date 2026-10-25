import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { rehomeOrphanedSocialAccounts } from "@me3-core/plugin-social-publishing";

function d1(sqlite: DatabaseSync) {
  const statement = (sql: string, values: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    async first<T>() { return (sqlite.prepare(sql).get(...(values as string[])) || null) as T | null; },
    async run() { return sqlite.prepare(sql).run(...(values as string[])); },
  });
  return {
    prepare: (sql: string) => statement(sql),
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      for (const item of statements) await item.run();
      return [];
    },
  };
}

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE sites (id TEXT PRIMARY KEY, user_id TEXT, site_type TEXT, site_role TEXT, created_at TEXT);
    CREATE TABLE social_accounts (
      id TEXT PRIMARY KEY, user_id TEXT, site_id TEXT, platform TEXT, platform_account_id TEXT,
      status TEXT, updated_at TEXT, UNIQUE(site_id, platform, platform_account_id)
    );
    INSERT INTO sites VALUES ('current', 'owner', 'profile', 'profile', '2026-10-01');
    INSERT INTO social_accounts VALUES ('youtube-old', 'owner', 'deleted-site', 'youtube', 'UC1', 'active', '2026-09-01');
    INSERT INTO social_accounts VALUES ('linkedin-old', 'owner', 'deleted-site', 'linkedin', 'li-1', 'active', '2026-09-01');
    INSERT INTO social_accounts VALUES ('linkedin-new', 'owner', 'current', 'linkedin', 'li-1', 'active', '2026-10-25');
    INSERT INTO social_accounts VALUES ('x-current', 'owner', 'current', 'x', 'x-1', 'active', '2026-10-25');
  `);
  return sqlite;
}

describe("rehomeOrphanedSocialAccounts", () => {
  it("moves accounts from a deleted site to the profile site and retires ones already reconnected (me3-bli3.3.14)", async () => {
    const sqlite = fixture();
    await rehomeOrphanedSocialAccounts({ DB: d1(sqlite) } as never, "owner");

    const rows = sqlite.prepare("SELECT id, site_id, status FROM social_accounts ORDER BY id").all();
    expect(rows).toEqual([
      { id: "linkedin-new", site_id: "current", status: "active" },
      { id: "linkedin-old", site_id: "deleted-site", status: "revoked" },
      { id: "x-current", site_id: "current", status: "active" },
      { id: "youtube-old", site_id: "current", status: "active" },
    ]);
  });
});
