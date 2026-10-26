import { normalizeJournalBodyFormat, type JournalBodyFormat } from "./schema";
import type { JournalAgentDb } from "./agent-read";

// Notes are the longer pieces of writing in Journal > Notes (stored as journal_articles;
// the API path keeps "articles" so released mobile apps keep working).

export type JournalAgentNotesReadInput = {
  noteId?: string;
  projectId?: string;
  folderId?: string;
  limit?: number;
};

export type JournalAgentNoteSummary = {
  id: string;
  title: string | null;
  preview: string;
  wordCount: number;
  projectId: string | null;
  projectName: string | null;
  folderId: string | null;
  folderName: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type JournalAgentNote = Omit<JournalAgentNoteSummary, "preview"> & {
  body: string;
  bodyFormat: JournalBodyFormat;
  bodyTruncated: boolean;
};

export type JournalAgentNotesReadResult = {
  notes: Array<JournalAgentNoteSummary | JournalAgentNote>;
  hasMore: boolean;
};

type NoteRow = {
  id: string;
  title: string | null;
  body: string;
  body_format: string;
  revision: number;
  project_id: string | null;
  project_name: string | null;
  folder_id: string | null;
  folder_name: string | null;
  created_at: string;
  updated_at: string;
};

const DEFAULT_NOTES_LIMIT = 20;
const MAX_NOTES_LIMIT = 50;
const PREVIEW_CHARS = 240;
const MAX_AGENT_NOTE_BODY_CHARS = 24_000;
const NOTE_FIELDS = `a.id, a.title, a.body, a.body_format, a.revision, a.project_id, p.name AS project_name,
     a.folder_id, f.name AS folder_name, a.created_at, a.updated_at
     FROM journal_articles a
     LEFT JOIN mission_projects p ON p.id = a.project_id AND p.user_id = a.user_id
     LEFT JOIN journal_folders f ON f.id = a.folder_id AND f.user_id = a.user_id`;

export async function readJournalNotesForAgent(
  db: JournalAgentDb,
  userId: string,
  input: JournalAgentNotesReadInput,
): Promise<JournalAgentNotesReadResult> {
  if (input.noteId !== undefined) {
    if (typeof input.noteId !== "string" || !/^article_[0-9a-f-]{36}$/.test(input.noteId)) throw new Error("Note id is invalid.");
    const rows = await db.prepare(`SELECT ${NOTE_FIELDS} WHERE a.user_id = ? AND a.id = ? LIMIT 1`)
      .bind(userId, input.noteId).all<NoteRow>();
    const row = rows.results?.[0];
    if (!row) throw new Error("Note not found.");
    return { notes: [serializeNote(row)], hasMore: false };
  }
  const limit = notesLimit(input.limit);
  const projectId = typeof input.projectId === "string" && input.projectId.trim() ? input.projectId.trim() : null;
  const folderId = typeof input.folderId === "string" && input.folderId.trim() ? input.folderId.trim() : null;
  const filters = [projectId ? "a.project_id = ?" : "", folderId ? "a.folder_id = ?" : ""].filter(Boolean);
  const where = ["a.user_id = ?", ...filters].join(" AND ");
  const values = [userId, ...(projectId ? [projectId] : []), ...(folderId ? [folderId] : []), limit + 1];
  const rows = await db.prepare(`SELECT ${NOTE_FIELDS} WHERE ${where} ORDER BY a.updated_at DESC, a.id DESC LIMIT ?`)
    .bind(...values).all<NoteRow>();
  const results = rows.results || [];
  return { notes: results.slice(0, limit).map(serializeNoteSummary), hasMore: results.length > limit };
}

function notesLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_NOTES_LIMIT;
  return Math.max(1, Math.min(Math.floor(value), MAX_NOTES_LIMIT));
}

function serializeNoteSummary(row: NoteRow): JournalAgentNoteSummary {
  const text = noteText(row);
  const words = text.split(/\s+/u).filter(Boolean);
  const collapsed = words.join(" ");
  return {
    id: row.id,
    title: row.title?.trim() || null,
    preview: collapsed.length > PREVIEW_CHARS ? `${collapsed.slice(0, PREVIEW_CHARS).trimEnd()}…` : collapsed,
    wordCount: words.length,
    projectId: row.project_id ?? null,
    projectName: row.project_name ?? null,
    folderId: row.folder_name ? row.folder_id : null,
    folderName: row.folder_name ?? null,
    revision: Number(row.revision || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeNote(row: NoteRow): JournalAgentNote {
  const { preview: _preview, ...summary } = serializeNoteSummary(row);
  const format = normalizeJournalBodyFormat(row.body_format) || "html";
  const body = format === "html" ? htmlToText(row.body) : (row.body ?? "");
  const bodyTruncated = body.length > MAX_AGENT_NOTE_BODY_CHARS;
  return {
    ...summary,
    body: bodyTruncated ? body.slice(0, MAX_AGENT_NOTE_BODY_CHARS) : body,
    bodyFormat: format === "html" ? "plain_text" : format,
    bodyTruncated,
  };
}

function noteText(row: NoteRow): string {
  const format = normalizeJournalBodyFormat(row.body_format) || "html";
  return format === "html" ? htmlToText(row.body) : (row.body ?? "");
}

/** Tiptap HTML to readable text: block boundaries become paragraph breaks, tags and entities go. */
export function htmlToText(html: string): string {
  if (typeof html !== "string" || !html) return "";
  return html
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/giu, "")
    .replace(/<\s*br\s*\/?\s*>/giu, "\n")
    .replace(/<\s*\/\s*(p|h[1-6]|li|div|blockquote|pre|tr|section|article|figure|figcaption)\s*>/giu, "\n\n")
    .replace(/<[^>]+>/gu, "")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, "\"")
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
