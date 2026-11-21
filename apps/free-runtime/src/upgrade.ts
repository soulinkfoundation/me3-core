/**
 * Leaving the free runtime for a paid ME3. ME3 Cloud closes the user's free ME3 once the paid one is live,
 * and the paid ME3 may then fetch a copy of the user's own content if they ask to bring it over.
 *
 * The export is a short allowlist of plain content. A table that is not named here is never exported:
 * chats, sessions and tokens, secrets, calendar connections and push registrations all stay behind.
 */
import type { SqlHost } from "./d1-adapter";

export const FREE_EXPORT_FORMAT = "me3-free-export-v1";

/** In insert order: a table comes after the tables its rows point to. */
export const FREE_EXPORT_TABLES = [
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

/** Things the user set about themselves. Email, handle and photo follow ME3 Cloud; there is no password here. */
export const FREE_EXPORT_OWNER_FIELDS = ["name", "bio", "timezone", "locale", "assistant_name", "daily_briefing_time"] as const;

export type FreeExport = {
  format: typeof FREE_EXPORT_FORMAT;
  exportedAt: string;
  owner: Record<string, unknown>;
  tables: Record<string, Record<string, unknown>[]>;
};

const columnsOf = (host: SqlHost, table: string) =>
  host.sql.exec(`SELECT name FROM pragma_table_info('${table}')`).toArray().map((row) => String(row.name));

export function exportFreeContent(host: SqlHost, now = new Date()): FreeExport {
  const tables: FreeExport["tables"] = {};
  for (const table of FREE_EXPORT_TABLES) {
    // A table missing from an older database is simply empty.
    tables[table] = columnsOf(host, table).length ? host.sql.exec(`SELECT * FROM ${table} ORDER BY rowid`).toArray() : [];
  }
  const present = new Set(columnsOf(host, "owner_profile"));
  const fields = FREE_EXPORT_OWNER_FIELDS.filter((field) => present.has(field));
  const owner = fields.length ? (host.sql.exec(`SELECT ${fields.join(", ")} FROM owner_profile WHERE id = 'owner'`).toArray()[0] ?? {}) : {};
  return { format: FREE_EXPORT_FORMAT, exportedAt: now.toISOString(), owner, tables };
}

/** What a closed free ME3 answers to the apps: sign in again and Cloud hands over the paid ME3. */
export const upgradedReply = () =>
  Response.json({ ok: false, error: "This ME3 has moved to your paid plan. Sign in again to open it.", code: "upgraded" }, { status: 410 });
