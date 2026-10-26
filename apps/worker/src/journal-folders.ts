import { JournalInputError } from "./journal";
import type { Env } from "./types";

// A folder files Notes inside one project, or under No project when projectId is null.
// Folders have no parent, so a note is at most two levels deep: project, then folder.

type FolderRow = {
  id: string;
  project_id: string | null;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

// A folder whose project was deleted reads as a No project folder.
const fields = `f.id, CASE WHEN p.id IS NULL THEN NULL ELSE f.project_id END AS project_id,
  f.name, f.sort_order, f.created_at, f.updated_at
  FROM journal_folders f
  LEFT JOIN mission_projects p ON p.id = f.project_id AND p.user_id = f.user_id`;

export type JournalFolder = ReturnType<typeof serialize>;

function serialize(row: FolderRow) {
  return {
    id: row.id,
    projectId: row.project_id ?? null,
    name: row.name,
    sortOrder: Number(row.sort_order || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireFolderId(id: string) {
  if (!/^folder_[0-9a-f-]{36}$/.test(id)) throw new JournalInputError("Folder id is invalid");
  return id;
}

function parseName(value: unknown) {
  const name = typeof value === "string" ? value.trim().slice(0, 80) : "";
  if (!name) throw new JournalInputError("Folder name is required");
  return name;
}

export async function requireOwnedProject(env: Env, ownerId: string, projectId: string | null | undefined) {
  if (!projectId) return;
  const project = await env.DB.prepare("SELECT id FROM mission_projects WHERE user_id = ? AND id = ?")
    .bind(ownerId, projectId).first<{ id: string }>();
  if (!project) throw new JournalInputError("Project not found", 404);
}

export async function getJournalFolder(env: Env, ownerId: string, id: string) {
  const row = await env.DB.prepare(`SELECT ${fields} WHERE f.user_id = ? AND f.id = ?`)
    .bind(ownerId, requireFolderId(id)).first<FolderRow>();
  if (!row) throw new JournalInputError("Folder not found", 404);
  return { folder: serialize(row) };
}

export async function listJournalFolders(env: Env, ownerId: string) {
  const rows = await env.DB.prepare(`SELECT ${fields} WHERE f.user_id = ? ORDER BY f.sort_order, f.name COLLATE NOCASE, f.id LIMIT 500`)
    .bind(ownerId).all<FolderRow>();
  return { folders: (rows.results || []).map(serialize) };
}

export async function createJournalFolder(env: Env, ownerId: string, input: unknown) {
  const value = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  if (value.parentId !== undefined && value.parentId !== null) throw new JournalInputError("Folders cannot contain folders");
  if (value.projectId !== undefined && value.projectId !== null && (typeof value.projectId !== "string" || !value.projectId.trim())) {
    throw new JournalInputError("Folder project is invalid");
  }
  const name = parseName(value.name);
  const projectId = typeof value.projectId === "string" ? value.projectId.trim() : null;
  await requireOwnedProject(env, ownerId, projectId);
  const id = `folder_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO journal_folders (id, user_id, project_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)`,
  ).bind(id, ownerId, projectId, name, now, now).run();
  return getJournalFolder(env, ownerId, id);
}

export async function renameJournalFolder(env: Env, ownerId: string, id: string, input: unknown) {
  const value = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const name = parseName(value.name);
  await getJournalFolder(env, ownerId, id);
  await env.DB.prepare(`UPDATE journal_folders SET name = ?, updated_at = ? WHERE user_id = ? AND id = ?`)
    .bind(name, new Date().toISOString(), ownerId, id).run();
  return getJournalFolder(env, ownerId, id);
}

// Deleting a folder never deletes notes: they stay loose in the same project.
export async function deleteJournalFolder(env: Env, ownerId: string, id: string) {
  await getJournalFolder(env, ownerId, id);
  await env.DB.prepare(`UPDATE journal_articles SET folder_id = NULL WHERE user_id = ? AND folder_id = ?`)
    .bind(ownerId, id).run();
  await env.DB.prepare(`DELETE FROM journal_folders WHERE user_id = ? AND id = ?`).bind(ownerId, id).run();
  return { ok: true };
}
