import { ensureCoreRuntimeMigrations } from "../../worker/src/core-runtime-migrations";
import type { Env } from "../../worker/src/types";
import type { SqlHost } from "./d1-adapter";
import { CORE_SQL_MIGRATIONS } from "./migrations.generated";

const SCHEMA_TABLE = "free_runtime_schema";

/** Brings one user's database to the current Core schema: the SQL migrations an install gets from wrangler, then Core's runtime migrations. */
export async function prepareUserDatabase(host: SqlHost, db: D1Database): Promise<{ applied: number; failed: string[] }> {
  host.sql.exec(`CREATE TABLE IF NOT EXISTS ${SCHEMA_TABLE} (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  const done = new Set(host.sql.exec(`SELECT name FROM ${SCHEMA_TABLE}`).toArray().map((row) => String(row.name)));
  let applied = 0;
  const failed: string[] = [];
  for (const migration of CORE_SQL_MIGRATIONS) {
    if (done.has(migration.name)) continue;
    try {
      host.transactionSync(() => {
        host.sql.exec(migration.sql).toArray();
        host.sql.exec(`INSERT INTO ${SCHEMA_TABLE} (name) VALUES (?)`, migration.name);
      });
      applied++;
    } catch (error) {
      // Later migrations build on earlier ones; stop at the first failure.
      failed.push(`${migration.name}: ${error instanceof Error ? error.message : String(error)}`);
      break;
    }
  }
  if (!failed.length) await ensureCoreRuntimeMigrations({ DB: db } as Env);
  return { applied, failed };
}

export type ActivationInput = { userId: string; email: string | null; name: string | null; handle: string | null; timezone?: string | null };

/**
 * Makes this database the given ME3 Cloud user's ME3: the single Core owner row (no password; sign-in is
 * through ME3 Cloud), the linked Cloud owner id that Core checks on every mobile token claim, and a stable
 * install id for Cloud to hand to the apps. Safe to repeat; refuses a different Cloud user. Email and handle
 * follow ME3 Cloud on every sign-in; the name is only a starting point, since the user can change it here.
 */
export async function activateUserDatabase(db: D1Database, input: ActivationInput): Promise<{ installId: string }> {
  const secret = (name: string) => db.prepare("SELECT value FROM install_secrets WHERE name = ?").bind(name).first<string>("value");
  const linked = await secret("ME3_CLOUD_OWNER_ID");
  if (linked && linked !== input.userId) throw new Error("This ME3 belongs to a different ME3 account");
  const installId = (await secret("ME3_CORE_INSTALL_ID")) ?? `core_${crypto.randomUUID()}`;
  await db.batch([
    db.prepare(
      `INSERT INTO owner_profile (id, email, name, username, timezone, updated_at) VALUES ('owner', ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = COALESCE(NULLIF(owner_profile.name, ''), excluded.name), username = excluded.username,
         timezone = COALESCE(excluded.timezone, owner_profile.timezone), updated_at = CURRENT_TIMESTAMP`,
    ).bind(input.email, input.name?.trim() || input.handle?.trim() || input.email?.split("@")[0] || null, input.handle, input.timezone ?? null),
    ...[["ME3_CLOUD_OWNER_ID", input.userId], ["ME3_CORE_INSTALL_ID", installId]].map(([name, value]) =>
      db.prepare(
        `INSERT INTO install_secrets (name, value, created_at, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(name) DO NOTHING`,
      ).bind(name, value)),
  ]);
  return { installId };
}
