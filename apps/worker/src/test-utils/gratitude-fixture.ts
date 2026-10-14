import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { Env } from "../types";

export function gratitudeFixture(timezone = "Europe/Dublin") {
  const raw = new DatabaseSync(":memory:");
  for (const name of ["0001_initial_public_schema", "0028_journal_entry_revision", "0035_calendar_source_event_dismissals", "0036_calendar_push_notifications", "0065_morning_calendar_push", "0067_quotes", "0068_gratitude", "0069_quote_bookmarks", "0070_gratitude_in_today"]) {
    raw.exec(readFileSync(new URL(`../../migrations/${name}.sql`, import.meta.url), "utf8"));
  }
  raw.prepare("INSERT INTO owner_profile(id, username, timezone) VALUES('owner', 'synthetic', ?)").run(timezone);
  const executions = new WeakMap<object, () => unknown>();
  const db = { prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) { values = args; return statement; },
      async first<T>() { return (raw.prepare(sql).get(...values as never[]) ?? null) as T | null; },
      async all<T>() { return { results: raw.prepare(sql).all(...values as never[]) as T[] }; },
      async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }; },
    };
    executions.set(statement, () => ({ meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }));
    return statement;
  }, async batch(statements: object[]) {
    raw.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map(statement => executions.get(statement)!());
      raw.exec("COMMIT");
      return results;
    } catch (error) { raw.exec("ROLLBACK"); throw error; }
  } };
  return { raw, env: { DB: db } as unknown as Env };
}
