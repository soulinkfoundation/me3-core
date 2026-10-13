import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { listAgentContacts } from "./agent-chat";
import type { Env } from "./types";

const databases: DatabaseSync[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
});

function fixture() {
  const raw = new DatabaseSync(":memory:");
  databases.push(raw);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  raw.exec("INSERT INTO owner_profile(id, username) VALUES ('alice', 'alice'), ('bob', 'bob')");
  raw.exec(`INSERT INTO sites (id, user_id, username, site_role) VALUES
    ('alice-site', 'alice', 'alice-site', 'profile'), ('bob-site', 'bob', 'bob-site', 'profile')`);
  const prepare = (sql: string) => {
    let params: (string | number | null)[] = [];
    const statement = {
      bind(...values: (string | number | null)[]) { params = values; return statement; },
      async first() { return raw.prepare(sql).get(...params) || null; },
      async all() { return { results: raw.prepare(sql).all(...params) }; },
      async run() { return { success: true, meta: { changes: Number(raw.prepare(sql).run(...params).changes) } }; },
    };
    return statement;
  };
  const env = { DB: {
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      raw.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        raw.exec("COMMIT");
        return results;
      } catch (error) { raw.exec("ROLLBACK"); throw error; }
    },
  } } as unknown as Env;
  const addContact = (id: string, userId: string, name: string, email: string | null, extra: Record<string, string | null> = {}) => {
    const columns = ["id", "user_id", "name", "email", ...Object.keys(extra)];
    raw.prepare(`INSERT INTO contacts (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
      .run(id, userId, name, email, ...Object.values(extra));
  };
  const addBooking = (id: string, siteId: string, email: string, startsAt: string, status = "confirmed") => {
    raw.prepare(`INSERT INTO bookings (id, site_id, guest_name, guest_email, starts_at, ends_at, duration_minutes, status)
      VALUES (?, ?, 'Guest', ?, ?, ?, 30, ?)`).run(id, siteId, email, startsAt, startsAt, status);
  };
  return { raw, env, addContact, addBooking };
}

describe("owner contacts", () => {
  it("counts only bookings made on the owner's own sites", async () => {
    const { env, addContact, addBooking } = fixture();
    addContact("c-erum", "alice", "Erum", "erum@example.com");
    addBooking("b-own", "alice-site", "erum@example.com", "2026-09-01T10:00:00Z");
    addBooking("b-foreign", "bob-site", "erum@example.com", "2026-10-01T10:00:00Z");

    const { contacts } = await listAgentContacts(env, "alice");
    expect(contacts).toHaveLength(1);
    expect(contacts[0]).toMatchObject({ bookingCount: 1, lastBookingAt: "2026-09-01T10:00:00Z" });
  });

  it("reports no bookings when the only booking is on another owner's site", async () => {
    const { env, addContact, addBooking } = fixture();
    addContact("c-sam", "alice", "Sam", "sam@example.com");
    addBooking("b-foreign", "bob-site", "sam@example.com", "2026-10-01T10:00:00Z");

    const { contacts } = await listAgentContacts(env, "alice");
    expect(contacts[0]).toMatchObject({ bookingCount: 0, lastBookingAt: null });
  });
});
