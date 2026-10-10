import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach } from "vitest";
import type { AgentDb } from "../../../../packages/agent/src/types";

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));

export function mailboxFixture() {
  const raw = new DatabaseSync(":memory:");
  databases.push(raw);
  const migrations = new URL("../../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  raw.exec(`INSERT INTO owner_profile(id, username) VALUES ('alice','alice'), ('bob','bob');
    INSERT INTO mailbox_aliases(id, user_id, alias_local_part, forwarding_email)
      VALUES ('alice-mailbox','alice','alice','alice@example.test'), ('bob-mailbox','bob','bob','bob@example.test');
    INSERT INTO mailbox_messages(id,mailbox_id,direction,message_kind,status,from_address,to_address,subject,text_body,raw_headers_json,metadata_json,folder,created_by)
      VALUES ('alice-message','alice-mailbox','inbound','email','received','client@example.test','alice@me3.local','TruHealth next slot','A new appointment is available.',
        '{"Message-ID":"<source@example.test>","References":"<earlier@example.test>","From":"Client <client@example.test>"}',
        '{"attachments":[{"storageKey":"mailbox/alice-mailbox/attachment-1","filename":"details.pdf"}]}','inbox','provider'),
      ('bob-message','bob-mailbox','inbound','email','received','private@example.test','bob@me3.local','TruHealth next slot','Other owner private message.','{}','{}','inbox','provider');`);
  const db = { prepare(sql: string) {
    const bound = (values: unknown[]) => ({
      async first() { return raw.prepare(sql).get(...values as never[]) || null; },
      async all() { return { results: raw.prepare(sql).all(...values as never[]) }; },
      async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }; },
    });
    return { ...bound([]), bind: (...values: unknown[]) => bound(values) };
  }, async batch(statements: Array<{ run(): Promise<unknown> }>) {
    raw.exec("BEGIN");
    try { const result = await Promise.all(statements.map(statement => statement.run())); raw.exec("COMMIT"); return result; }
    catch (error) { raw.exec("ROLLBACK"); throw error; }
  } } as unknown as AgentDb;
  return { raw, env: { DB: db } };
}
