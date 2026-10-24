import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = new URL("../migrations/", import.meta.url);
const migrationFiles = readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).sort();

describe("social Facebook Pages migration", () => {
  it("accepts Facebook on every checked table and keeps dependent rows", () => {
    const directory = mkdtempSync(join(tmpdir(), "me3-social-facebook-migration-"));
    const database = join(directory, "fixture.sqlite");
    try {
      for (const name of migrationFiles.filter((file) => file < "0090")) {
        // Older files carry statements later files supersede; only the resulting schema matters here.
        spawnSync("sqlite3", [database], { input: readFileSync(new URL(name, migrationsDirectory), "utf8") });
      }
      sqliteExec(
        database,
        `INSERT OR IGNORE INTO owner_profile (id) VALUES ('owner');
         INSERT INTO drive_files (id, owner_id, filename, storage_key) VALUES ('file-1', 'owner', 'a.png', 'k');
         INSERT INTO social_publications (id, variant_id, site_id, platform, status)
         VALUES ('publication-original', 'version-1', 'site-1', 'linkedin', 'published');
         INSERT INTO social_media_delivery_grants (
           id, owner_id, publication_id, file_id, provider, token_hash, expires_at
         ) VALUES ('grant-1', 'owner', 'publication-original', 'file-1', 'linkedin', 'hash', '2030-01-01');`,
      );

      sqliteExec(
        database,
        `PRAGMA foreign_keys = ON;\n${readFileSync(new URL("0090_social_facebook_pages.sql", migrationsDirectory), "utf8")}`,
      );
      sqliteExec(
        database,
        `INSERT INTO social_accounts (id, user_id, site_id, platform, platform_account_id, access_token_ciphertext)
         VALUES ('account-1', 'owner', 'site-1', 'facebook', 'page-1', 'token');
         INSERT INTO social_publications (id, variant_id, site_id, platform, status)
         VALUES ('publication-facebook', 'version-2', 'site-1', 'facebook', 'scheduled');`,
      );

      expect(sqliteRows<{ id: string }>(database, "SELECT id FROM social_media_delivery_grants")).toEqual([
        { id: "grant-1" },
      ]);
      expect(
        sqliteRows<{ platform: string }>(database, "SELECT platform FROM social_publications ORDER BY id"),
      ).toEqual([{ platform: "facebook" }, { platform: "linkedin" }]);
      expect(
        sqliteExitCode(
          database,
          `INSERT INTO social_accounts (id, user_id, site_id, platform, platform_account_id, access_token_ciphertext)
           VALUES ('account-2', 'owner', 'site-1', 'myspace', 'p', 't');`,
        ),
      ).not.toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function sqliteExec(database: string, sql: string): void {
  execFileSync("sqlite3", [database], { input: sql, encoding: "utf8" });
}

function sqliteExitCode(database: string, sql: string): number | null {
  return spawnSync("sqlite3", [database], { input: sql, encoding: "utf8" }).status;
}

function sqliteRows<T>(database: string, sql: string): T[] {
  const output = execFileSync("sqlite3", ["-json", database], { input: sql, encoding: "utf8" }).trim();
  return output ? (JSON.parse(output) as T[]) : [];
}
