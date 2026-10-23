import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = (name: string) =>
  readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8");

describe("Files trashed-name migration", () => {
  it("lets a deleted file's name be reused in a folder and keeps everything else", () => {
    const directory = mkdtempSync(join(tmpdir(), "me3-drive-trashed-names-"));
    const database = join(directory, "fixture.sqlite");
    try {
      sqliteExec(
        database,
        `PRAGMA foreign_keys = ON;
         CREATE TABLE owner_profile (id TEXT PRIMARY KEY);
         CREATE TABLE social_publications (id TEXT PRIMARY KEY);
         INSERT INTO owner_profile (id) VALUES ('owner');
         ${migration("0012_drive_files")}
         ${migration("0029_social_media_delivery")}
         INSERT INTO drive_folders (id, name, path) VALUES ('folder-1', 'Generated images', '/Generated images');
         INSERT INTO drive_files (id, folder_id, filename, storage_key, status)
           VALUES ('file-trashed', 'folder-1', 'Boat.jpg', 'k1', 'trashed'),
                  ('file-ready', 'folder-1', 'Kept.jpg', 'k2', 'ready');
         INSERT INTO drive_multipart_uploads
           (id, file_id, owner_id, storage_key, r2_upload_id, part_size, total_size, expires_at)
           VALUES ('upload-1', 'file-ready', 'owner', 'k2', 'r2', 5, 10, '2099-01-01');
         INSERT INTO drive_multipart_parts (upload_id, part_number, etag, size)
           VALUES ('upload-1', 1, 'etag', 5);
         INSERT INTO social_media_delivery_grants (id, file_id, owner_id, provider, token_hash, expires_at)
           VALUES ('grant-1', 'file-ready', 'owner', 'x', 'hash', '2099-01-01');`,
      );

      sqliteExec(database, `PRAGMA foreign_keys = ON;\n${migration("0088_drive_files_reuse_trashed_names")}`);

      // A trashed file no longer holds its name inside the folder.
      expect(
        sqliteExitCode(
          database,
          `PRAGMA foreign_keys = ON;
           INSERT INTO drive_files (id, folder_id, filename, storage_key)
           VALUES ('file-new', 'folder-1', 'Boat.jpg', 'k3');`,
        ),
      ).toBe(0);
      // Two ready files still can't share a name, in a folder or at the top level.
      expect(
        sqliteExitCode(
          database,
          `INSERT INTO drive_files (id, folder_id, filename, storage_key)
           VALUES ('file-clash', 'folder-1', 'Kept.jpg', 'k4');`,
        ),
      ).not.toBe(0);
      sqliteExec(database, "INSERT INTO drive_files (id, filename, storage_key) VALUES ('root-1', 'Top.jpg', 'k5');");
      expect(
        sqliteExitCode(
          database,
          "INSERT INTO drive_files (id, filename, storage_key) VALUES ('root-2', 'Top.jpg', 'k6');",
        ),
      ).not.toBe(0);

      // Rows that cascade from drive_files survive the rebuild.
      expect(sqliteRows(database, "SELECT id FROM drive_multipart_uploads")).toEqual([{ id: "upload-1" }]);
      expect(sqliteRows(database, "SELECT upload_id FROM drive_multipart_parts")).toEqual([{ upload_id: "upload-1" }]);
      expect(sqliteRows(database, "SELECT id FROM social_media_delivery_grants")).toEqual([{ id: "grant-1" }]);
      expect(sqliteRows(database, "SELECT id FROM drive_files ORDER BY id")).toEqual([
        { id: "file-new" },
        { id: "file-ready" },
        { id: "file-trashed" },
        { id: "root-1" },
      ]);
      expect(sqliteRows(database, "PRAGMA foreign_key_check")).toEqual([]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function sqliteExec(database: string, sql: string): void {
  execFileSync("sqlite3", [database], { input: sql, encoding: "utf8" });
}

function sqliteExitCode(database: string, sql: string): number | null {
  return spawnSync("sqlite3", ["-bail", database], { input: sql, encoding: "utf8" }).status;
}

function sqliteRows<T = Record<string, unknown>>(database: string, sql: string): T[] {
  const output = execFileSync("sqlite3", ["-json", database], { input: sql, encoding: "utf8" }).trim();
  return output ? (JSON.parse(output) as T[]) : [];
}
