-- A deleted (trashed) file kept its name reserved inside a folder because
-- drive_files had a table-level UNIQUE(owner_id, folder_id, filename) that
-- ignored status. Rebuild the table without it and enforce the rule the app
-- already checks: only ready files hold a name, in a folder or at the top level.
PRAGMA defer_foreign_keys = ON;

-- Dropping drive_files fires its ON DELETE CASCADE actions in D1 even while
-- validation is deferred. Keep the dependent rows and restore them afterwards.
CREATE TABLE drive_multipart_uploads_0088_backup AS SELECT * FROM drive_multipart_uploads;
CREATE TABLE drive_multipart_parts_0088_backup AS SELECT * FROM drive_multipart_parts;
CREATE TABLE social_media_delivery_grants_0088_backup AS SELECT * FROM social_media_delivery_grants;

CREATE TABLE drive_files_0088_new (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL DEFAULT 'owner',
  folder_id TEXT REFERENCES drive_folders(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size INTEGER NOT NULL DEFAULT 0,
  storage_key TEXT NOT NULL,
  etag TEXT,
  sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'ready'
    CHECK (status IN ('uploading', 'ready', 'trashed', 'failed')),
  preview_kind TEXT NOT NULL DEFAULT 'download'
    CHECK (preview_kind IN ('image', 'pdf', 'text', 'markdown', 'csv', 'spreadsheet', 'download')),
  extracted_text TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_id) REFERENCES owner_profile(id) ON DELETE CASCADE
);
INSERT INTO drive_files_0088_new
  (id, owner_id, folder_id, filename, mime_type, size, storage_key, etag, sha256,
   status, preview_kind, extracted_text, metadata_json, created_at, updated_at)
SELECT id, owner_id, folder_id, filename, mime_type, size, storage_key, etag, sha256,
   status, preview_kind, extracted_text, metadata_json, created_at, updated_at
FROM drive_files;
DROP TABLE drive_files;
ALTER TABLE drive_files_0088_new RENAME TO drive_files;

CREATE UNIQUE INDEX idx_drive_files_root_filename
  ON drive_files(owner_id, filename)
  WHERE folder_id IS NULL AND status = 'ready';
CREATE UNIQUE INDEX idx_drive_files_folder_filename
  ON drive_files(owner_id, folder_id, filename)
  WHERE folder_id IS NOT NULL AND status = 'ready';
CREATE INDEX idx_drive_files_owner_folder
  ON drive_files(owner_id, folder_id, status, filename);
CREATE INDEX idx_drive_files_owner_updated
  ON drive_files(owner_id, updated_at DESC);

DELETE FROM drive_multipart_parts;
DELETE FROM drive_multipart_uploads;
DELETE FROM social_media_delivery_grants;
INSERT INTO drive_multipart_uploads SELECT * FROM drive_multipart_uploads_0088_backup;
INSERT INTO drive_multipart_parts SELECT * FROM drive_multipart_parts_0088_backup;
INSERT INTO social_media_delivery_grants SELECT * FROM social_media_delivery_grants_0088_backup;

DROP TABLE drive_multipart_uploads_0088_backup;
DROP TABLE drive_multipart_parts_0088_backup;
DROP TABLE social_media_delivery_grants_0088_backup;
PRAGMA defer_foreign_keys = OFF;
