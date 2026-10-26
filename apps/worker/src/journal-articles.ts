import { normalizeJournalBodyFormat } from "@me3-core/plugin-journal";
import { JournalConflictError, JournalInputError } from "./journal";
import { getJournalFolder, requireOwnedProject } from "./journal-folders";
import type { Env } from "./types";

type ArticleRow = {
  id: string;
  user_id: string;
  title: string | null;
  body: string;
  body_format: "plain_text" | "markdown" | "html";
  revision: number;
  project_id: string | null;
  folder_id: string | null;
  created_at: string;
  updated_at: string;
};

const fields = "id, user_id, title, body, body_format, revision, project_id, folder_id, created_at, updated_at";

function serialize(row: ArticleRow) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    bodyFormat: row.body_format,
    revision: row.revision,
    projectId: row.project_id ?? null,
    folderId: row.folder_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireId(id: string) {
  if (!/^article_[0-9a-f-]{36}$/.test(id)) throw new JournalInputError("Article id is invalid");
  return id;
}

function parseInput(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new JournalInputError("Article body is required");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.body !== "string" || value.body.length > 1_000_000) {
    throw new JournalInputError("Article body must be text up to 1 MB");
  }
  if (value.title !== null && value.title !== undefined && typeof value.title !== "string") {
    throw new JournalInputError("Article title must be text");
  }
  if (value.projectId !== undefined && value.projectId !== null && (typeof value.projectId !== "string" || !value.projectId.trim())) {
    throw new JournalInputError("Article project is invalid");
  }
  if (value.folderId !== undefined && value.folderId !== null && (typeof value.folderId !== "string" || !value.folderId.trim())) {
    throw new JournalInputError("Article folder is invalid");
  }
  return {
    title: typeof value.title === "string" ? value.title.trim().slice(0, 180) || null : null,
    body: value.body,
    bodyFormat: normalizeJournalBodyFormat(value.bodyFormat) || "html",
    // undefined keeps the article's project; null removes it.
    projectId: value.projectId === undefined ? undefined : (value.projectId as string | null)?.trim() ?? null,
    // Same for the folder. Filing into a folder also sets the folder's project.
    folderId: value.folderId === undefined ? undefined : (value.folderId as string | null)?.trim() ?? null,
  };
}

async function resolvePlacement(env: Env, ownerId: string, input: { projectId?: string | null; folderId?: string | null }) {
  if (input.folderId) {
    const { folder } = await getJournalFolder(env, ownerId, input.folderId);
    if (input.projectId !== undefined && (input.projectId ?? null) !== folder.projectId) {
      throw new JournalInputError("Folder belongs to another project");
    }
    return { projectId: folder.projectId, folderId: folder.id };
  }
  await requireOwnedProject(env, ownerId, input.projectId);
  return { projectId: input.projectId, folderId: input.folderId };
}

export async function listJournalArticles(env: Env, ownerId: string, projectId?: string) {
  const rows = await (projectId
    ? env.DB.prepare(
      `SELECT ${fields} FROM journal_articles WHERE user_id = ? AND project_id = ? ORDER BY updated_at DESC, id DESC LIMIT 200`,
    ).bind(ownerId, projectId)
    : env.DB.prepare(
      `SELECT ${fields} FROM journal_articles WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 200`,
    ).bind(ownerId)).all<ArticleRow>();
  return { articles: (rows.results || []).map(serialize) };
}

export async function getJournalArticle(env: Env, ownerId: string, id: string) {
  const row = await env.DB.prepare(
    `SELECT ${fields} FROM journal_articles WHERE user_id = ? AND id = ?`,
  ).bind(ownerId, requireId(id)).first<ArticleRow>();
  if (!row) throw new JournalInputError("Article not found", 404);
  return { article: serialize(row) };
}

export async function createJournalArticle(env: Env, ownerId: string, input: unknown) {
  const article = parseInput(input);
  const placement = await resolvePlacement(env, ownerId, article);
  const id = `article_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO journal_articles (${fields}) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
  ).bind(id, ownerId, article.title, article.body, article.bodyFormat, placement.projectId ?? null, placement.folderId ?? null, now, now).run();
  return getJournalArticle(env, ownerId, id);
}

export async function updateJournalArticle(
  env: Env, ownerId: string, id: string, input: unknown, expectedRevision: number,
) {
  const article = parseInput(input);
  const placement = await resolvePlacement(env, ownerId, article);
  const keepProject = placement.projectId === undefined ? 1 : 0;
  const keepFolder = placement.folderId === undefined ? 1 : 0;
  const newProject = placement.projectId ?? null;
  // Moving a note to another project takes it out of its folder.
  const result = await env.DB.prepare(
    `UPDATE journal_articles SET title = ?, body = ?, body_format = ?,
      project_id = CASE WHEN ? = 1 THEN project_id ELSE ? END,
      folder_id = CASE
        WHEN ? = 0 THEN ?
        WHEN ? = 0 AND project_id IS NOT ? THEN NULL
        ELSE folder_id END,
      updated_at = ?, revision = revision + 1
     WHERE user_id = ? AND id = ? AND revision = ?`,
  ).bind(article.title, article.body, article.bodyFormat, keepProject, newProject,
    keepFolder, placement.folderId ?? null, keepProject, newProject,
    new Date().toISOString(), ownerId, requireId(id), expectedRevision).run();
  // D1 counts the search-index trigger writes too; zero means the conditional write lost.
  if ((result.meta?.changes || 0) < 1) throw new JournalConflictError();
  return getJournalArticle(env, ownerId, id);
}

export async function deleteJournalArticle(env: Env, ownerId: string, id: string, expectedRevision: number) {
  const result = await env.DB.prepare(
    `DELETE FROM journal_articles WHERE user_id = ? AND id = ? AND revision = ?`,
  ).bind(ownerId, requireId(id), expectedRevision).run();
  if ((result.meta?.changes || 0) < 1) throw new JournalConflictError();
  return { ok: true };
}
