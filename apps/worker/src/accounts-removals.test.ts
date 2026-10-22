import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { deleteFinancialEntry, listAccountCustomers, listFinancialEntries, removeAccountCustomer } from "./accounts";
import type { Env } from "./types";

// Failure modes: a deleted website payment is re-created by the next sync; removing a
// customer leaves them listed or drops a different customer; removing a customer
// silently deletes real income the owner kept; a removed customer who books again stays hidden;
// every Accounts open rewrites all past sales, or skipping unchanged sales misses a later change.
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach((db) => db.close()); });

function fixture() {
  const raw = new DatabaseSync(":memory:");
  databases.push(raw);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) {
    raw.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  raw.exec(`INSERT INTO owner_profile(id, username) VALUES ('owner', 'owner');
    INSERT INTO sites (id, user_id, username, site_role) VALUES ('site', 'owner', 'owner', 'profile');`);
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
        for (const statement of statements) await statement.run();
        raw.exec("COMMIT");
      } catch (error) { raw.exec("ROLLBACK"); throw error; }
    },
  } } as unknown as Env;
  const book = (id: string, email: string, paidAt: string) => raw.exec(`INSERT INTO bookings
    (id, site_id, booking_type, guest_name, guest_email, starts_at, ends_at, duration_minutes,
     status, payment_intent_id, amount_paid, currency, payment_status, paid_at, created_at)
    VALUES ('${id}', 'site', 'one_to_one', 'Guest', '${email}', '${paidAt}', '${paidAt}', 60,
     'confirmed', 'pi_${id}', 500, 'eur', 'succeeded', '${paidAt}', '${paidAt}')`);
  const income = async () => (await listFinancialEntries(env, "owner", new URLSearchParams("entryType=income"))).entries;
  const customers = async () => (await listAccountCustomers(env, "owner", new URLSearchParams())).customers;
  return { env, raw, book, income, customers };
}

describe("Accounts removals with real SQLite", () => {
  it("writes only new or changed website sales when Accounts opens", async () => {
    const f = fixture();
    const batch = f.env.DB.batch.bind(f.env.DB);
    let written = 0;
    f.env.DB.batch = (async (statements: D1PreparedStatement[]) => { written += statements.length; return batch(statements); }) as typeof f.env.DB.batch;
    f.book("b1", "a@example.com", "2026-06-22T10:00:00Z");
    f.book("b2", "b@example.com", "2026-06-23T10:00:00Z");
    expect(await f.income()).toHaveLength(2);
    expect(written).toBe(2);

    written = 0;
    await f.income();
    await f.customers();
    expect(written).toBe(0);

    f.raw.exec("UPDATE bookings SET amount_paid = 900 WHERE id = 'b2'");
    const entries = await f.income();
    expect(written).toBe(1);
    expect(entries.find((entry) => entry.customerEmail === "b@example.com")).toMatchObject({ amountCents: 900 });
    expect(entries).toHaveLength(2);
  });

  it("keeps a deleted website payment deleted across syncs", async () => {
    const f = fixture();
    f.book("b1", "test@example.com", "2026-06-22T10:00:00Z");
    const [entry] = await f.income();
    expect(entry).toMatchObject({ source: "website", amountCents: 500 });

    await deleteFinancialEntry(f.env, "owner", entry.id);
    expect(await f.income()).toEqual([]);
    await f.customers();
    expect(await f.income()).toEqual([]);
  });

  it("removes only the chosen customer and keeps their income unless asked", async () => {
    const f = fixture();
    f.book("b1", "test@example.com", "2026-06-22T10:00:00Z");
    f.book("b2", "real@example.com", "2026-06-23T10:00:00Z");

    await removeAccountCustomer(f.env, "owner", "Test@Example.com", false);
    expect((await f.customers()).map((customer) => customer.email)).toEqual(["real@example.com"]);
    expect(await f.income()).toHaveLength(2);

    expect(await removeAccountCustomer(f.env, "owner", "test@example.com", true)).toEqual({ ok: true, removedEntries: 1 });
    expect((await f.income()).map((entry) => entry.customerEmail)).toEqual(["real@example.com"]);
  });

  it("brings a removed customer back with only their new activity", async () => {
    const f = fixture();
    f.book("b1", "test@example.com", "2020-01-01T10:00:00Z");
    await removeAccountCustomer(f.env, "owner", "test@example.com", true);
    expect(await f.customers()).toEqual([]);

    f.book("b2", "test@example.com", "2099-01-01T10:00:00Z");
    const [customer] = await f.customers();
    expect(customer.activities.map((activity) => activity.id)).toEqual(["booking:b2"]);
    expect(await f.income()).toHaveLength(1);
  });
});
