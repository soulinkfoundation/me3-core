import { DatabaseSync } from "node:sqlite";

/** A real SQLite database behind the small part of the D1 API these tests use. */
export function sqliteD1(schema: string): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec(schema);
  const statement = (sql: string, values: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    async first<T>() {
      return (db.prepare(sql).get(...(values as never[])) as T) ?? null;
    },
    async all<T>() {
      return { results: db.prepare(sql).all(...(values as never[])) as T[] };
    },
    async run() {
      const result = db.prepare(sql).run(...(values as never[]));
      return { meta: { changes: Number(result.changes) } };
    },
  });
  return { prepare: (sql: string) => statement(sql) } as unknown as D1Database;
}

export const COMMERCE_TEST_SCHEMA = `
CREATE TABLE commerce_orders (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL, product_slug TEXT NOT NULL, product_title TEXT NOT NULL DEFAULT '',
  buyer_name TEXT NOT NULL DEFAULT '', buyer_email TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
  payment_method TEXT NOT NULL DEFAULT 'stripe', option_id TEXT, option_label TEXT, delivery_json TEXT, paid_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE commerce_downloads (
  id TEXT PRIMARY KEY, order_id TEXT NOT NULL, site_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL, file_name TEXT NOT NULL, content_type TEXT NOT NULL, expires_at TEXT NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 5, uses INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);`;
