import { normalizeJournalBodyFormat, normalizeJournalDateKey, type JournalBodyFormat } from "./schema";

type JournalDayDb = {
  prepare(sql: string): { bind(...values: unknown[]): {
    first<T = unknown>(): Promise<T | null>;
    run(): Promise<{ meta?: { changes?: number } }>;
  } };
};

export class JournalInputError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 | 502 = 400,
  ) {
    super(message);
  }
}

export class JournalConflictError extends JournalInputError {
  constructor() {
    super("Journal entry changed since it was loaded", 409);
  }
}

export type JournalEntryRow = {
  id: string;
  user_id: string;
  entry_date: string;
  title: string | null;
  body: string;
  body_format: JournalBodyFormat;
  metadata_json: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  revision: number;
};

export function requireJournalDateKey(value: unknown): string {
  const normalized = normalizeJournalDateKey(value);
  if (!normalized) {
    throw new JournalInputError("Journal date must use YYYY-MM-DD");
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNullableText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 180) : null;
}

function newJournalEntryId(date: string): string {
  return `journal_${date}_${crypto.randomUUID()}`;
}

export function serializeJournalEntry(row: JournalEntryRow) {
  return {
    id: row.id,
    date: row.entry_date,
    title: row.title,
    body: row.body,
    bodyFormat: row.body_format,
    metadata: JSON.parse(row.metadata_json || "{}") as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    revision: row.revision,
  };
}

export async function getJournalDay(env: { DB: JournalDayDb }, userId: string, date: string) {
  const normalizedDate = requireJournalDateKey(date);
  const row = await env.DB.prepare(
    `SELECT id, user_id, entry_date, title, body, body_format, metadata_json,
            created_at, updated_at, archived_at, revision
     FROM journal_entries
     WHERE user_id = ? AND entry_date = ? AND archived_at IS NULL`,
  )
    .bind(userId, normalizedDate)
    .first<JournalEntryRow>();

  return { entry: row ? serializeJournalEntry(row) : null };
}

export async function updateJournalDay(
  env: { DB: JournalDayDb },
  userId: string,
  date: string,
  input: unknown,
  expectedRevision?: number | null,
  options: { restoreArchived?: boolean; writeId?: string } = {},
) {
  const normalizedDate = requireJournalDateKey(date);
  const body = isRecord(input) ? input : {};
  const entryBody = typeof body.body === "string" ? body.body : "";
  const title = normalizeNullableText(body.title);
  const bodyFormat = normalizeJournalBodyFormat(body.bodyFormat) || "html";
  const now = new Date().toISOString();
  const id = newJournalEntryId(normalizedDate);
  const metadataSql = options.writeId ? "json_object('agentJournalWriteId', ?)" : "'{}'";
  const metadataUpdateSql = options.writeId ? ", metadata_json = json_set(metadata_json, '$.agentJournalWriteId', ?)" : "";

  if (expectedRevision === null) {
    const result = await env.DB.prepare(
      `INSERT INTO journal_entries (
         id, user_id, entry_date, title, body, body_format, metadata_json,
         created_at, updated_at, revision
       ) VALUES (?, ?, ?, ?, ?, ?, ${metadataSql}, ?, ?, 1)
       ON CONFLICT(user_id, entry_date) DO UPDATE SET
         title = excluded.title,
         body = excluded.body,
         body_format = excluded.body_format,
         updated_at = excluded.updated_at,
         archived_at = NULL,
         revision = journal_entries.revision + 1${metadataUpdateSql}
       WHERE journal_entries.archived_at IS NOT NULL${options.restoreArchived === false ? " AND 0" : ""}`,
    )
      .bind(id, userId, normalizedDate, title, entryBody, bodyFormat, ...(options.writeId ? [options.writeId] : []), now, now, ...(options.writeId ? [options.writeId] : []))
      .run();
    // D1 includes search-index trigger changes; zero means the conditional write lost.
    if ((result.meta?.changes || 0) < 1) throw new JournalConflictError();
  } else if (expectedRevision !== undefined) {
    const result = await env.DB.prepare(
      `UPDATE journal_entries
       SET title = ?, body = ?, body_format = ?, updated_at = ?, archived_at = NULL,
           revision = revision + 1${metadataUpdateSql}
       WHERE user_id = ? AND entry_date = ? AND archived_at IS NULL AND revision = ?`,
    )
      .bind(title, entryBody, bodyFormat, now, ...(options.writeId ? [options.writeId] : []), userId, normalizedDate, expectedRevision)
      .run();
    if ((result.meta?.changes || 0) < 1) throw new JournalConflictError();
  } else {
    await env.DB.prepare(
      `INSERT INTO journal_entries (
         id, user_id, entry_date, title, body, body_format, metadata_json,
         created_at, updated_at, revision
       ) VALUES (?, ?, ?, ?, ?, ?, ${metadataSql}, ?, ?, 1)
       ON CONFLICT(user_id, entry_date) DO UPDATE SET
         title = excluded.title,
         body = excluded.body,
         body_format = excluded.body_format,
         updated_at = excluded.updated_at,
         archived_at = NULL,
         revision = journal_entries.revision + 1${metadataUpdateSql}`,
    )
      .bind(id, userId, normalizedDate, title, entryBody, bodyFormat, ...(options.writeId ? [options.writeId] : []), now, now, ...(options.writeId ? [options.writeId] : []))
      .run();
  }

  const saved = await env.DB.prepare(
    `SELECT id, user_id, entry_date, title, body, body_format, metadata_json,
            created_at, updated_at, archived_at, revision
     FROM journal_entries
     WHERE user_id = ? AND entry_date = ?`,
  )
    .bind(userId, normalizedDate)
    .first<JournalEntryRow>();

  if (!saved) throw new JournalInputError("Journal entry could not be saved");
  return { entry: serializeJournalEntry(saved) };
}
