import {
  JournalInputError,
  JournalConflictError,
  requireJournalDateKey as requireDateKey,
  serializeJournalEntry as serializeEntry,
  type JournalEntryRow,
} from "@me3-core/plugin-journal";
import type { Env } from "./types";

export { JournalInputError, JournalConflictError, getJournalDay, updateJournalDay } from "@me3-core/plugin-journal";

export type JournalMediaUploadResult = {
  ok: true;
  id: string;
  src: string;
  filename: string;
  mimeType: string;
  size: number;
  storage: "r2" | "inline";
};

export type JournalMediaObject = {
  body: ReadableStream | ArrayBuffer;
  mimeType: string;
  size?: number;
};

const JOURNAL_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const JOURNAL_IMAGE_MIME_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);
const JOURNAL_MEDIA_FILENAME_RE = /^[a-z0-9][a-z0-9._-]{1,160}$/i;

function normalizeListLimit(value: unknown, fallback = 100): number {
  const parsed =
    typeof value === "string" || typeof value === "number"
      ? Number.parseInt(String(value), 10)
      : fallback;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(parsed, 200));
}

function makeJournalMediaId(): string {
  return crypto.randomUUID();
}

function requireJournalImageMimeType(value: string): string {
  const mimeType = value.toLowerCase();
  if (!JOURNAL_IMAGE_MIME_EXTENSIONS.has(mimeType)) {
    throw new JournalInputError("Journal images must be JPEG, PNG, WebP, or GIF");
  }
  return mimeType;
}

function journalImageExtension(mimeType: string): string {
  return JOURNAL_IMAGE_MIME_EXTENSIONS.get(mimeType) || "jpg";
}

function normalizeMediaFilename(value: string): string {
  const trimmed = value.trim();
  if (!JOURNAL_MEDIA_FILENAME_RE.test(trimmed)) {
    throw new JournalInputError("Journal media filename is invalid");
  }
  return trimmed;
}

function journalMediaKey(userId: string, date: string, filename: string): string {
  return `journal/${userId}/${date}/${filename}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function journalBodyPreview(body: string): string {
  return body
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function rowHasJournalContent(row: JournalEntryRow): boolean {
  return Boolean((row.title || "").trim() || journalBodyPreview(row.body));
}

function serializeArchiveEntry(row: JournalEntryRow) {
  return {
    ...serializeEntry(row),
    preview: journalBodyPreview(row.body),
  };
}

export async function deleteJournalDay(
  env: Env,
  userId: string,
  date: string,
  expectedRevision?: number,
) {
  const normalizedDate = requireDateKey(date);
  const now = new Date().toISOString();

  const result = await env.DB.prepare(
    `UPDATE journal_entries
     SET archived_at = ?, updated_at = ?, revision = revision + 1
     WHERE user_id = ? AND entry_date = ? AND archived_at IS NULL
       ${expectedRevision === undefined ? "" : "AND revision = ?"}`,
  )
    .bind(
      now,
      now,
      userId,
      normalizedDate,
      ...(expectedRevision === undefined ? [] : [expectedRevision]),
    )
    .run();

  // D1 includes search-index trigger changes; zero means the revision did not match.
  if (expectedRevision !== undefined && (result.meta?.changes || 0) < 1) {
    throw new JournalConflictError();
  }

  return { ok: true };
}

export async function listJournalArchive(
  env: Env,
  userId: string,
  options: { limit?: unknown } = {},
) {
  const limit = normalizeListLimit(options.limit, 100);
  const rows = await env.DB.prepare(
    `SELECT id, user_id, entry_date, title, body, body_format, metadata_json,
            created_at, updated_at, archived_at, revision
     FROM journal_entries
     WHERE user_id = ?
       AND archived_at IS NULL
     ORDER BY entry_date DESC, updated_at DESC
     LIMIT ?`,
  )
    .bind(userId, 200)
    .all<JournalEntryRow>();

  return {
    entries: (rows.results || [])
      .filter(rowHasJournalContent)
      .slice(0, limit)
      .map(serializeArchiveEntry),
  };
}

export async function uploadJournalMedia(
  env: Env,
  userId: string,
  input: { date: unknown; file: File },
): Promise<JournalMediaUploadResult> {
  const date = requireDateKey(input.date);
  const mimeType = requireJournalImageMimeType(input.file.type || "");
  if (input.file.size > JOURNAL_IMAGE_MAX_BYTES) {
    throw new JournalInputError("Journal images must be 2 MB or smaller");
  }

  const id = makeJournalMediaId();
  const filename = `${id}.${journalImageExtension(mimeType)}`;
  const buffer = await input.file.arrayBuffer();

  if (env.SITE_ASSETS) {
    await env.SITE_ASSETS.put(journalMediaKey(userId, date, filename), buffer, {
      httpMetadata: { contentType: mimeType },
      customMetadata: {
        feature: "journal",
        ownerId: userId,
        date,
        originalName: input.file.name || filename,
      },
    });

    return {
      ok: true,
      id,
      src: `/api/journal/media/${encodeURIComponent(date)}/${encodeURIComponent(filename)}`,
      filename,
      mimeType,
      size: input.file.size,
      storage: "r2",
    };
  }

  return {
    ok: true,
    id,
    src: `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`,
    filename,
    mimeType,
    size: input.file.size,
    storage: "inline",
  };
}

export async function getJournalMedia(
  env: Env,
  userId: string,
  date: string,
  filename: string,
): Promise<JournalMediaObject> {
  if (!env.SITE_ASSETS) {
    throw new JournalInputError("Journal media storage is not configured", 404);
  }

  const normalizedDate = requireDateKey(date);
  const normalizedFilename = normalizeMediaFilename(filename);
  const object = await env.SITE_ASSETS.get(
    journalMediaKey(userId, normalizedDate, normalizedFilename),
  );
  if (!object) throw new JournalInputError("Journal media not found", 404);

  const mimeType =
    object.httpMetadata?.contentType ||
    object.customMetadata?.mimeType ||
    "application/octet-stream";

  return {
    body: object.body,
    mimeType,
    size: object.size,
  };
}
