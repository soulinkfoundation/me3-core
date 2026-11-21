/**
 * Presents a Durable Object's SQLite as a D1Database, so ME3 Core runs unchanged against one private
 * database per user. Covers the D1 surface Core uses: prepare/bind/first/all/run/raw, batch and exec.
 */
type SqlCursor = { toArray(): Record<string, unknown>[]; rowsRead: number; rowsWritten: number };
export type SqlHost = {
  sql: { exec(query: string, ...bindings: any[]): SqlCursor };
  transactionSync<T>(work: () => T): T;
};

type Binding = string | number | null | ArrayBuffer;
type Statement = D1PreparedStatement & { query: string; params: unknown[] };

function toBinding(value: unknown): Binding {
  if (value === undefined) throw new Error("D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined'");
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
  throw new Error(`D1_TYPE_ERROR: Type '${typeof value}' not supported`);
}

export function createD1Adapter(host: SqlHost): D1Database {
  const run = (query: string, params: unknown[]) => {
    const cursor = host.sql.exec(query, ...params.map(toBinding));
    const results = cursor.toArray().map((row) => {
      // D1 returns BLOBs as number arrays.
      for (const key in row) if (row[key] instanceof ArrayBuffer) row[key] = Array.from(new Uint8Array(row[key] as ArrayBuffer));
      return row;
    });
    // changes() keeps the previous statement's count after one that wrote nothing, so only read it after a write.
    const wrote = cursor.rowsWritten > 0;
    const counts = wrote
      ? (host.sql.exec("SELECT changes() AS changes, last_insert_rowid() AS id").toArray()[0] as { changes: number; id: number })
      : { changes: 0, id: 0 };
    return {
      success: true as const,
      results,
      meta: { duration: 0, changes: counts.changes, last_row_id: counts.id, rows_read: cursor.rowsRead, rows_written: cursor.rowsWritten, changed_db: wrote, size_after: 0, served_by: "durable-object-sqlite" },
    };
  };
  const statement = (query: string, params: unknown[] = []): Statement => ({
    query,
    params,
    bind: (...values: unknown[]) => statement(query, values),
    async first(column?: string) {
      const row = run(query, params).results[0];
      if (!row) return null;
      return column === undefined ? row : (row[column] ?? null);
    },
    async all() { return run(query, params); },
    async run() { return run(query, params); },
    async raw() { return run(query, params).results.map((row) => Object.values(row)); },
  }) as unknown as Statement;
  return {
    prepare: (query: string) => statement(query),
    async batch(statements: D1PreparedStatement[]) {
      return host.transactionSync(() => (statements as Statement[]).map((item) => run(item.query, item.params)));
    },
    async exec(query: string) {
      host.sql.exec(query).toArray();
      return { count: 1, duration: 0 };
    },
    withSession() { throw new Error("D1 sessions are not available in the free runtime"); },
    async dump() { throw new Error("D1 dump is not available in the free runtime"); },
  } as unknown as D1Database;
}
