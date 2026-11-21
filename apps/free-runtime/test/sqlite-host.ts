// Test stand-in for a Durable Object's SQLite (ctx.storage), backed by node:sqlite.
// It mirrors the parts of SqlStorage the adapter relies on; real workerd behaviour is covered by the smoke run.
import { DatabaseSync } from "node:sqlite";
import type { SqlHost } from "../src/d1-adapter";

export function createSqliteHost(): SqlHost & { db: DatabaseSync } {
  const db = new DatabaseSync(":memory:");
  const total = () => Number((db.prepare("SELECT total_changes() AS t").get() as { t: number }).t);
  return {
    db,
    sql: {
      exec(query: string, ...bindings: unknown[]) {
        const before = total();
        let rows: Record<string, unknown>[] = [];
        if (!bindings.length && /;\s*\S/.test(query.trim().replace(/;\s*$/, ""))) db.exec(query);
        else {
          rows = db.prepare(query).all(...(bindings.map((value) => value instanceof ArrayBuffer ? new Uint8Array(value) : value) as never[])) as Record<string, unknown>[];
          for (const row of rows) for (const key in row) {
            const value = row[key];
            if (value instanceof Uint8Array) row[key] = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
          }
        }
        const rowsWritten = total() - before;
        return { toArray: () => rows, one: () => rows[0], rowsRead: rows.length, rowsWritten };
      },
    },
    transactionSync<T>(work: () => T): T {
      db.exec("BEGIN");
      try { const result = work(); db.exec("COMMIT"); return result; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
}
