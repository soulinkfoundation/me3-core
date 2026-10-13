import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import {
  createAgentContact,
  listAgentContacts,
  markAgentMailboxDraftSent,
  updateAgentContact,
} from "./agent-chat";
import { registerContactsRoutes } from "./routes/contacts";
import { syncSoulinkContacts } from "./routes/channels";
import type { AppHono } from "./http/types";
import type { Env } from "./types";

const databases: DatabaseSync[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
  vi.unstubAllGlobals();
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
  const addBooking = (
    id: string, siteId: string, email: string, startsAt: string,
    status = "confirmed", createdAt = "2026-08-01 09:00:00",
  ) => {
    raw.prepare(`INSERT INTO bookings (id, site_id, guest_name, guest_email, starts_at, ends_at, duration_minutes, status, created_at)
      VALUES (?, ?, 'Guest', ?, ?, ?, 30, ?, ?)`).run(id, siteId, email, startsAt, startsAt, status, createdAt);
  };
  const lastInteraction = (id: string) =>
    (raw.prepare("SELECT last_interaction_at FROM contacts WHERE id = ?").get(id) as { last_interaction_at: string | null })
      .last_interaction_at;
  return { raw, env, addContact, addBooking, lastInteraction };
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

describe("People data", () => {
  it("returns closeness, isClient and lastInTouchAt for each contact", async () => {
    const { env, addContact } = fixture();
    addContact("c-erum", "alice", "Erum", "erum@example.com", {
      metadata: JSON.stringify({ closeness: "very_close", closeSince: "2026-09-01T00:00:00.000Z" }),
      last_interaction_at: "2026-09-20 10:00:00",
    });
    addContact("c-jo", "alice", "Jo", null, { metadata: JSON.stringify({ closeness: "acquaintance" }) });

    const { contacts } = await listAgentContacts(env, "alice");
    expect(contacts.find((contact) => contact.id === "c-erum")).toMatchObject({
      closeness: "very_close",
      isClose: true,
      closeSince: "2026-09-01T00:00:00.000Z",
      isClient: false,
      lastInTouchAt: "2026-09-20T10:00:00.000Z",
    });
    expect(contacts.find((contact) => contact.id === "c-jo")).toMatchObject({
      closeness: "acquaintance",
      isClose: false,
      closeSince: null,
      lastInTouchAt: null,
    });
  });

  it("derives Client from own-site bookings, orders and Stripe payments only", async () => {
    const { raw, env, addContact, addBooking } = fixture();
    addContact("c-booked", "alice", "Booked", "booked@example.com");
    addContact("c-bought", "alice", "Bought", "BOUGHT@example.com");
    addContact("c-stripe", "alice", "Stripe", "stripe@example.com");
    addContact("c-foreign", "alice", "Foreign", "foreign@example.com");
    addContact("c-cancelled", "alice", "Cancelled", "cancelled@example.com");
    addContact("c-marked", "alice", "Marked", null, { relationship: "client" });
    addBooking("b-own", "alice-site", "booked@example.com", "2026-09-01T10:00:00Z");
    addBooking("b-foreign", "bob-site", "foreign@example.com", "2026-09-01T10:00:00Z");
    addBooking("b-cancelled", "alice-site", "cancelled@example.com", "2026-09-01T10:00:00Z", "cancelled");
    raw.exec(`INSERT INTO commerce_orders (id, site_id, product_slug, product_title, buyer_name, buyer_email, status)
      VALUES ('o-1', 'alice-site', 'guide', 'Guide', 'Bought', 'bought@example.com', 'paid'),
             ('o-2', 'bob-site', 'guide', 'Guide', 'Foreign', 'foreign@example.com', 'paid')`);
    raw.exec(`INSERT INTO financial_entries (id, user_id, entry_type, date, description, amount_cents, source, customer_email)
      VALUES ('e-1', 'alice', 'income', '2026-09-01', 'Coaching', 5000, 'stripe', 'stripe@example.com'),
             ('e-2', 'bob', 'income', '2026-09-01', 'Coaching', 5000, 'stripe', 'foreign@example.com')`);

    const { contacts } = await listAgentContacts(env, "alice");
    const clients = Object.fromEntries(contacts.map((contact) => [contact.id, contact.isClient]));
    expect(clients).toEqual({
      "c-booked": true,
      "c-bought": true,
      "c-stripe": true,
      "c-foreign": false,
      "c-cancelled": false,
      "c-marked": true,
    });
  });

  it("moves last in touch forward from bookings made and booking calls held", async () => {
    const { env, addContact, addBooking, lastInteraction } = fixture();
    addContact("c-past", "alice", "Past", "past@example.com");
    addContact("c-future", "alice", "Future", "future@example.com");
    addContact("c-newer", "alice", "Newer", "newer@example.com", { last_interaction_at: "2026-10-01T00:00:00.000Z" });
    addContact("c-foreign", "alice", "Foreign", "foreign@example.com");
    addBooking("b-past", "alice-site", "past@example.com", "2026-09-10T15:00:00Z", "confirmed", "2026-09-01 08:00:00");
    addBooking("b-future", "alice-site", "future@example.com", "2999-01-01T10:00:00Z", "confirmed", "2026-09-05 08:00:00");
    addBooking("b-older", "alice-site", "newer@example.com", "2026-09-10T15:00:00Z");
    addBooking("b-foreign", "bob-site", "foreign@example.com", "2026-09-10T15:00:00Z");

    await listAgentContacts(env, "alice");
    expect(lastInteraction("c-past")).toBe("2026-09-10T15:00:00.000Z");
    expect(lastInteraction("c-future")).toBe("2026-09-05T08:00:00.000Z");
    expect(lastInteraction("c-newer")).toBe("2026-10-01T00:00:00.000Z");
    expect(lastInteraction("c-foreign")).toBeNull();
  });

  it("moves last in touch forward when the agent's email to the contact is sent", async () => {
    const { raw, env, addContact, lastInteraction } = fixture();
    addContact("c-erum", "alice", "Erum", "erum@example.com", { last_interaction_at: "2026-01-01T00:00:00.000Z" });
    raw.exec(`INSERT INTO mailbox_aliases (id, user_id, alias_local_part, forwarding_email, status)
      VALUES ('alice-mailbox', 'alice', 'alice', '', 'active')`);
    raw.exec(`INSERT INTO mailbox_messages (id, mailbox_id, direction, message_kind, status, to_address, subject, text_body, folder)
      VALUES ('draft-1', 'alice-mailbox', 'outbound', 'draft', 'approved', 'Erum@Example.com', 'Hello', 'Hi', 'drafts')`);

    await markAgentMailboxDraftSent(env, "alice", "draft-1", {
      providerId: "test", providerMessageId: "msg-1", approvedByUserId: "alice", sentAt: "2026-10-12T09:30:00.000Z",
    });
    expect(lastInteraction("c-erum")).toBe("2026-10-12T09:30:00.000Z");
  });

  it("uses Soulink message and call times without storing message content", async () => {
    const { raw, env, addContact, lastInteraction } = fixture();
    addContact("c-ada", "alice", "Ada", null, {
      source: "soulink",
      source_ref: "node-ada",
      last_interaction_at: "2026-09-01T00:00:00.000Z",
      metadata: JSON.stringify({ closeness: "close", closeSince: "2026-08-01T00:00:00.000Z", soulinkNodeId: "node-ada" }),
    });
    raw.exec(`INSERT INTO agent_channel_connections (id, user_id, channel, status, setup_token, provider_user_id, provider_metadata_json)
      VALUES ('conn-1', 'alice', 'soulink', 'active', 'token', 'node-alice', '{"ownerNodeId":"node-alice"}')`);
    const links = [{
      id: "link-ada",
      status: "active",
      createdAt: "2026-05-01T00:00:00Z",
      updatedAt: "2026-05-02T00:00:00Z",
      otherNode: { id: "node-ada", displayName: "Ada Lovelace", handle: "ada" },
      context: {
        lastActiveAt: "2026-09-15T00:00:00Z",
        lastMessageAt: "2026-10-02T18:00:00Z",
        lastCallAt: "2026-10-01T12:00:00Z",
        lastMessage: "secret plans for Saturday",
      },
    }];
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, links })));
    (env as Env & { SOULINK_API_ORIGIN: string }).SOULINK_API_ORIGIN = "https://soulink.test";

    expect(await syncSoulinkContacts(env, "alice")).toMatchObject({ ok: true, updated: 1 });
    expect(lastInteraction("c-ada")).toBe("2026-10-02T18:00:00.000Z");
    const stored = JSON.stringify(raw.prepare("SELECT * FROM contacts").all());
    expect(stored).not.toContain("secret plans");
    expect(JSON.parse(String((raw.prepare("SELECT metadata FROM contacts WHERE id = 'c-ada'").get() as { metadata: string }).metadata)))
      .toMatchObject({ closeness: "close", closeSince: "2026-08-01T00:00:00.000Z" });

    links[0].context.lastMessageAt = "2026-06-01T00:00:00Z";
    links[0].context.lastCallAt = "2026-06-01T00:00:00Z";
    links[0].context.lastActiveAt = "2026-06-01T00:00:00Z";
    await syncSoulinkContacts(env, "alice");
    expect(lastInteraction("c-ada")).toBe("2026-10-02T18:00:00.000Z");
  });

  it("records 'We talked' for the owner's contact only", async () => {
    const { env, addContact, lastInteraction } = fixture();
    addContact("c-erum", "alice", "Erum", null);
    addContact("c-bob", "bob", "Bob's friend", null);
    const app = new Hono() as unknown as AppHono;
    registerContactsRoutes(app, {
      requireOwner: async () => "alice",
      unauthorized: (c) => c.json({ error: "Unauthorized" }, 401),
    });

    const response = await app.request("/api/contacts/c-erum/in-touch", { method: "POST" }, env);
    expect(response.status).toBe(200);
    const body = await response.json() as { contact: { lastInTouchAt: string } };
    expect(Date.now() - Date.parse(body.contact.lastInTouchAt)).toBeLessThan(60_000);
    expect(lastInteraction("c-erum")).toBe(body.contact.lastInTouchAt);

    expect((await app.request("/api/contacts/c-bob/in-touch", { method: "POST" }, env)).status).toBe(404);
    expect(lastInteraction("c-bob")).toBeNull();
  });

  it("stars and unstars Close, keeping when someone was first starred", async () => {
    const { env } = fixture();
    const created = await createAgentContact(env, "alice", { name: "Erum", closeness: "close" });
    if ("error" in created) throw new Error(created.error);
    expect(created).toMatchObject({ isClose: true, closeSince: expect.any(String) });

    const renamed = await updateAgentContact(env, "alice", created.id, { name: "Erum K" });
    expect(renamed).toMatchObject({ isClose: true, closeSince: created.closeSince });

    const unstarred = await updateAgentContact(env, "alice", created.id, { closeness: null });
    expect(unstarred).toMatchObject({ closeness: null, isClose: false, closeSince: null });
    if ("error" in unstarred) throw new Error(unstarred.error);
    expect(unstarred.metadata?.closeSince).toBeUndefined();
  });
});
