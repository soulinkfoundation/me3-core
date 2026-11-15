import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentContactServices } from "./agent-contact-services";
import type { Env } from "./types";

// Failure modes: the person view shows another owner's contact, or another person's bookings
// and payments; a save without an ID overwrites an existing person; an update clears fields the
// owner did not mention; a reminder is set on someone else's contact; "in touch" is not recorded.
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach((db) => db.close()); });

function fixture() {
  const raw = new DatabaseSync(":memory:");
  databases.push(raw);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  raw.exec(`INSERT INTO owner_profile(id, username) VALUES ('owner', 'owner'), ('other', 'other');
    INSERT INTO sites (id, user_id, username, site_role) VALUES ('site', 'owner', 'owner', 'profile');
    INSERT INTO contacts (id, user_id, name, email, notes) VALUES ('ada', 'owner', 'Ada Example', 'ada@example.test', 'Met at the fair'), ('theirs', 'other', 'Hidden', 'hidden@example.test', NULL);
    INSERT INTO bookings (id, site_id, booking_type, guest_name, guest_email, starts_at, ends_at, duration_minutes, status)
      VALUES ('b-ada', 'site', 'one_to_one', 'Ada', 'ada@example.test', '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z', 60, 'confirmed'),
             ('b-bob', 'site', 'one_to_one', 'Bob', 'bob@example.test', '2026-10-02T10:00:00Z', '2026-10-02T11:00:00Z', 60, 'confirmed');
    INSERT INTO financial_entries (id, user_id, entry_type, date, description, amount_cents, currency, status, customer_email)
      VALUES ('p-ada', 'owner', 'income', '2026-10-01', 'Session', 9000, 'EUR', 'paid', 'ada@example.test'),
             ('p-bob', 'owner', 'income', '2026-10-02', 'Session', 5000, 'EUR', 'paid', 'bob@example.test');`);
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
  const env = { DB: { prepare, async batch(statements: ReturnType<typeof prepare>[]) { for (const statement of statements) await statement.run(); } } } as unknown as Env;
  return { raw, people: createAgentContactServices(env, "owner") };
}

describe("People for the assistant with real SQLite", () => {
  it("shows one person's own bookings and payments, and never another owner's contact", async () => {
    const f = fixture();
    const view = await f.people.read("ada") as any;
    expect(view.contact).toMatchObject({ name: "Ada Example", notes: "Met at the fair" });
    expect(view.bookings.recent.map((booking: { id: string }) => booking.id)).toEqual(["b-ada"]);
    expect(view.payments).toMatchObject({ totals: [{ currency: "EUR", amount: "90.00" }], recent: [{ id: "p-ada" }] });
    expect(await f.people.read("theirs")).toBeNull();
  });

  it("adds a new person, and an update changes only the named fields", async () => {
    const f = fixture();
    const added = await f.people.save({ name: "Sam Field", email: "sam@acme.test", organisation: "Acme" }, "Europe/Dublin");
    expect(added).toMatchObject({ created: true, contact: { name: "Sam Field", organisation: "Acme" } });
    const changed = await f.people.save({ contactId: "ada", phone: "0871234567" }, "Europe/Dublin");
    expect(changed).toMatchObject({ created: false, contact: { name: "Ada Example", email: "ada@example.test", notes: "Met at the fair", phone: "0871234567" } });
    expect(f.raw.prepare("SELECT COUNT(*) AS n FROM contacts WHERE user_id = 'owner'").get()).toEqual({ n: 2 });
  });

  it("records in touch and a reminder for the owner's contact only", async () => {
    const f = fixture();
    const remindOn = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    const saved = await f.people.save({ contactId: "ada", inTouch: true, remindOn }, "Europe/Dublin");
    expect(saved.reminderAt?.slice(0, 10)).toBe(remindOn);
    expect(saved.contact.lastInteractionAt).toBeTruthy();
    await expect(f.people.save({ contactId: "theirs", remindOn }, "Europe/Dublin")).rejects.toThrow(/not found/i);
    expect(f.raw.prepare("SELECT COUNT(*) AS n FROM user_reminders WHERE context_id = 'theirs'").get()).toEqual({ n: 0 });
  });
});
