import { normalizeJournalBodyFormat } from "@me3-core/plugin-journal";
import { JournalConflictError, JournalInputError } from "./journal";
import type { Env } from "./types";

type ArticleRow = {
  id: string;
  user_id: string;
  title: string | null;
  body: string;
  body_format: "plain_text" | "markdown" | "html";
  revision: number;
  project_id: string | null;
  created_at: string;
  updated_at: string;
};

const fields = "id, user_id, title, body, body_format, revision, project_id, created_at, updated_at";

function serialize(row: ArticleRow) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    bodyFormat: row.body_format,
    revision: row.revision,
    projectId: row.project_id ?? null,
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
  return {
    title: typeof value.title === "string" ? value.title.trim().slice(0, 180) || null : null,
    body: value.body,
    bodyFormat: normalizeJournalBodyFormat(value.bodyFormat) || "html",
    // undefined keeps the article's project; null removes it.
    projectId: value.projectId === undefined ? undefined : (value.projectId as string | null)?.trim() ?? null,
  };
}

async function requireOwnedProject(env: Env, ownerId: string, projectId: string | null | undefined) {
  if (!projectId) return;
  const project = await env.DB.prepare("SELECT id FROM mission_projects WHERE user_id = ? AND id = ?")
    .bind(ownerId, projectId).first<{ id: string }>();
  if (!project) throw new JournalInputError("Project not found", 404);
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
  await requireOwnedProject(env, ownerId, article.projectId);
  const id = `article_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO journal_articles (${fields}) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
  ).bind(id, ownerId, article.title, article.body, article.bodyFormat, article.projectId ?? null, now, now).run();
  return getJournalArticle(env, ownerId, id);
}

export async function updateJournalArticle(
  env: Env, ownerId: string, id: string, input: unknown, expectedRevision: number,
) {
  const article = parseInput(input);
  await requireOwnedProject(env, ownerId, article.projectId);
  const keepProject = article.projectId === undefined ? 1 : 0;
  const result = await env.DB.prepare(
    `UPDATE journal_articles SET title = ?, body = ?, body_format = ?,
      project_id = CASE WHEN ? = 1 THEN project_id ELSE ? END,
      updated_at = ?, revision = revision + 1
     WHERE user_id = ? AND id = ? AND revision = ?`,
  ).bind(article.title, article.body, article.bodyFormat, keepProject, article.projectId ?? null,
    new Date().toISOString(), ownerId, requireId(id), expectedRevision).run();
  if (result.meta?.changes !== 1) throw new JournalConflictError();
  return getJournalArticle(env, ownerId, id);
}

export async function deleteJournalArticle(env: Env, ownerId: string, id: string, expectedRevision: number) {
  const result = await env.DB.prepare(
    `DELETE FROM journal_articles WHERE user_id = ? AND id = ? AND revision = ?`,
  ).bind(ownerId, requireId(id), expectedRevision).run();
  if (result.meta?.changes !== 1) throw new JournalConflictError();
  return { ok: true };
}
