/**
 * Brings a user's content from their free ME3 into this (paid) ME3. The user asks for it; ME3 Cloud delivers
 * the export. Safe to run again: a row that is already here is left alone, so a retry adds only what is missing
 * and never overwrites what the user has written since.
 *
 * Only the tables named here are written. Columns are matched by name against this database, so an export from
 * a newer or older schema still imports: a column this ME3 does not have is dropped.
 */
import type { Env } from "./types";

export const FREE_IMPORT_FORMAT = "me3-free-export-v1";

/** In insert order: a table comes after the tables its rows point to. */
const IMPORT_TABLES = [
  "mission_projects",
  "mission_project_columns",
  "mission_tasks",
  "mission_private_memory",
  "mission_dashboard_settings",
  "mission_wheel_settings",
  "mission_wheel_snapshots",
  "journal_folders",
  "journal_entries",
  "journal_articles",
  "journal_project_links",
  "gratitude_settings",
  "user_reminders",
] as const;
type ImportTable = (typeof IMPORT_TABLES)[number];

/** Columns that point at a row which may already exist here under another id. */
const REFERENCES: Record<string, "mission_projects" | "journal_entries"> = {
  project_id: "mission_projects",
  journal_entry_id: "journal_entries",
};

const OWNER_FIELDS = ["name", "bio", "timezone", "locale", "assistant_name", "daily_briefing_time"] as const;
const OWNER_ID = "owner";
const CHUNK = 20;
const MAX_ROWS = 20_000;

type Row = Record<string, unknown>;
type Value = string | number | null;
export type FreeImportCounts = { received: number; added: number; merged: number; skipped: number };
export type FreeImportResult = { tables: Record<string, FreeImportCounts>; ownerFieldsFilled: string[] };

export class FreeImportInputError extends Error {}

const isValue = (value: unknown): value is Value => value === null || typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
const isRow = (value: unknown): value is Row => Boolean(value) && typeof value === "object" && !Array.isArray(value);

function parse(input: unknown): { owner: Row; tables: Record<string, Row[]> } {
  if (!isRow(input) || input.format !== FREE_IMPORT_FORMAT || !isRow(input.tables)) throw new FreeImportInputError("This is not a free ME3 export");
  const tables: Record<string, Row[]> = {};
  let total = 0;
  for (const table of IMPORT_TABLES) {
    const rows = input.tables[table];
    if (rows === undefined) continue;
    if (!Array.isArray(rows) || !rows.every(isRow)) throw new FreeImportInputError(`Export table ${table} is malformed`);
    total += rows.length;
    tables[table] = rows;
  }
  if (total > MAX_ROWS) throw new FreeImportInputError("This export is too large to import in one go");
  return { owner: isRow(input.owner) ? input.owner : {}, tables };
}

async function tableShape(env: Env, table: string): Promise<{ columns: Set<string>; key: string[] }> {
  const info = await env.DB.prepare(`SELECT name, pk FROM pragma_table_info('${table}') ORDER BY pk`).all<{ name: string; pk: number }>();
  return { columns: new Set(info.results.map((column) => column.name)), key: info.results.filter((column) => column.pk > 0).map((column) => column.name) };
}

export async function importFreeContent(env: Env, input: unknown): Promise<FreeImportResult> {
  const { owner, tables } = parse(input);
  const result: FreeImportResult = { tables: {}, ownerFieldsFilled: [] };
  const moved = { mission_projects: new Map<string, string>(), journal_entries: new Map<string, string>() };

  const here = whatIsHere(env);

  for (const table of IMPORT_TABLES) {
    const rows = tables[table] ?? [];
    const counts: FreeImportCounts = (result.tables[table] = { received: rows.length, added: 0, merged: 0, skipped: 0 });
    if (!rows.length) continue;
    const shape = await tableShape(env, table);
    if (!shape.key.length) {
      counts.skipped = rows.length;
      continue;
    }

    const statements: D1PreparedStatement[] = [];
    for (const source of rows) {
      const row: Row = { ...source };
      if ("user_id" in row) row.user_id = OWNER_ID;
      for (const [column, parent] of Object.entries(REFERENCES)) {
        const target = typeof row[column] === "string" ? moved[parent].get(row[column] as string) : undefined;
        if (target) row[column] = target;
      }
      const columns = Object.keys(row).filter((column) => shape.columns.has(column));
      if (!shape.key.every((column) => columns.includes(column) && row[column] !== null) || !columns.every((column) => isValue(row[column]))) {
        counts.skipped++;
        continue;
      }
      if (await alreadyHere(env, table, row, moved, counts, here)) continue;
      statements.push(
        env.DB.prepare(`INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`).bind(...columns.map((column) => row[column] as Value)),
      );
    }

    for (let index = 0; index < statements.length; index += CHUNK) {
      const chunk = statements.slice(index, index + CHUNK);
      try {
        for (const outcome of await env.DB.batch(chunk)) outcome.meta.changes ? counts.added++ : counts.skipped++;
      } catch {
        // One bad row (say, a task whose project is missing) must not cost the rows around it.
        for (const statement of chunk) {
          try {
            (await statement.run()).meta.changes ? counts.added++ : counts.skipped++;
          } catch {
            counts.skipped++;
          }
        }
      }
    }
  }

  const statement = typeof tables.mission_dashboard_settings?.[0]?.mission_statement === "string" ? (tables.mission_dashboard_settings[0].mission_statement as string).trim() : "";
  if (statement) {
    await env.DB.prepare("UPDATE mission_dashboard_settings SET mission_statement = ?, updated_at = datetime('now') WHERE user_id = ? AND coalesce(trim(mission_statement), '') = ''")
      .bind(statement, OWNER_ID)
      .run();
  }

  const ownerColumns = (await tableShape(env, "owner_profile")).columns;
  for (const field of OWNER_FIELDS) {
    const value = owner[field];
    if (typeof value !== "string" || !value.trim() || !ownerColumns.has(field)) continue;
    const filled = await env.DB.prepare(`UPDATE owner_profile SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND coalesce(trim(${field}), '') = ''`).bind(value, OWNER_ID).run();
    if (filled.meta.changes) result.ownerFieldsFilled.push(field);
  }
  return result;
}

type Entry = { id: string; body: string | null; body_format: string | null };
type Here = { projects: () => Promise<Map<string, string>>; entries: () => Promise<Map<string, Entry>> };

/** The owner's projects by name and journal days by date, read once each: a long journal must not cost a query a day. */
function whatIsHere(env: Env): Here {
  let projects: Promise<Map<string, string>> | undefined;
  let entries: Promise<Map<string, Entry>> | undefined;
  return {
    projects: () =>
      (projects ??= env.DB.prepare("SELECT id, slug FROM mission_projects WHERE user_id = ?").bind(OWNER_ID).all<{ id: string; slug: string }>()
        .then((found) => new Map(found.results.map((row) => [row.slug, row.id])))),
    entries: () =>
      (entries ??= env.DB.prepare("SELECT id, entry_date, body, body_format FROM journal_entries WHERE user_id = ?").bind(OWNER_ID).all<Entry & { entry_date: string }>()
        .then((found) => new Map(found.results.map((row) => [row.entry_date, { id: row.id, body: row.body, body_format: row.body_format }])))),
  };
}

/**
 * Two things can only exist once here whatever their id: a project name, and a day's journal entry. When the
 * user already has one, the free rows that point at the free copy are pointed at theirs instead, and the free
 * day's writing is added below theirs (once: a repeat sees it is already there).
 */
async function alreadyHere(
  env: Env,
  table: ImportTable,
  row: Row,
  moved: { mission_projects: Map<string, string>; journal_entries: Map<string, string> },
  counts: FreeImportCounts,
  here: Here,
): Promise<boolean> {
  if (table === "mission_projects" && typeof row.slug === "string") {
    const existing = (await here.projects()).get(row.slug);
    if (!existing || existing === row.id) return false;
    moved.mission_projects.set(row.id as string, existing);
    counts.merged++;
    return true;
  }
  if (table === "journal_entries" && typeof row.entry_date === "string") {
    const existing = (await here.entries()).get(row.entry_date);
    if (!existing || existing.id === row.id) return false;
    moved.journal_entries.set(row.id as string, existing.id);
    const body = typeof row.body === "string" ? row.body.trim() : "";
    const sameFormat = (row.body_format ?? existing.body_format) === existing.body_format;
    if (!body || !sameFormat) {
      counts.skipped++;
      return true;
    }
    if (!(existing.body ?? "").includes(body)) {
      existing.body = (existing.body ?? "").trim() ? `${existing.body}\n\n${body}` : body;
      await env.DB.prepare("UPDATE journal_entries SET body = ?, revision = coalesce(revision, 0) + 1, updated_at = datetime('now') WHERE id = ?").bind(existing.body, existing.id).run();
    }
    counts.merged++;
    return true;
  }
  return false;
}
