import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentAccountsServices } from "./agent-accounts-services";
import type { Env } from "./types";

// Failure modes: a date range returns entries outside it or another owner's; totals mix
// currencies; a decimal amount is stored a cent out; an unknown category is silently created;
// the same receipt photo sent twice makes two entries; a photo from another conversation is
// accepted; the photo is not kept in Files, or lands outside the Receipts folder; another
// owner's entry can be changed.
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
    INSERT INTO assistant_threads (id, owner_id, title) VALUES ('thread', 'owner', 'Main'), ('elsewhere', 'owner', 'Old');`);
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
  const objects = new Map<string, Uint8Array>();
  const env = {
    DB: {
      prepare,
      async batch(statements: ReturnType<typeof prepare>[]) { for (const statement of statements) await statement.run(); },
    },
    SITE_ASSETS: {
      async get(key: string) {
        const bytes = objects.get(key);
        return bytes ? { size: bytes.byteLength, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } : null;
      },
      async put(key: string, value: ArrayBuffer) { objects.set(key, new Uint8Array(value)); return { etag: "etag", httpEtag: '"etag"' }; },
      async delete(key: string) { objects.delete(key); },
    },
  } as unknown as Env;
  const entry = (id: string, owner: string, type: string, date: string, cents: number, currency = "EUR", status = "paid") =>
    raw.prepare(`INSERT INTO financial_entries (id, user_id, entry_type, date, description, amount_cents, currency, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, owner, type, date, `Entry ${id}`, cents, currency, status);
  const photo = (id: string, thread: string, bytes: string) => {
    objects.set(`chat/${id}`, new TextEncoder().encode(bytes));
    raw.prepare(`INSERT INTO assistant_attachments (id, owner_id, thread_id, filename, mime_type, size, kind, status, storage_key)
      VALUES (?, 'owner', ?, 'IMG_1.jpg', 'image/jpeg', ?, 'image', 'ready', ?)`).run(id, thread, bytes.length, `chat/${id}`);
  };
  return { env, raw, objects, entry, photo, accounts: createAgentAccountsServices(env, "owner") };
}

describe("Accounts for the assistant with real SQLite", () => {
  it("lists only the owner's entries inside the date range, with totals per currency", async () => {
    const f = fixture();
    f.entry("in-range", "owner", "expense", "2026-10-10", 4000);
    f.entry("usd", "owner", "expense", "2026-10-12", 2500, "USD");
    f.entry("before", "owner", "expense", "2026-09-30", 900);
    f.entry("after", "owner", "expense", "2026-11-01", 900);
    f.entry("theirs", "other", "expense", "2026-10-11", 7700);
    const result = await f.accounts.listEntries({ entryType: "expense", dateFrom: "2026-10-01", dateTo: "2026-10-31" });
    expect(result.entries.map((entry) => entry.id).sort()).toEqual(["in-range", "usd"]);
    expect(result.total).toBe(2);
    expect(result.totals).toEqual([{ currency: "EUR", amount: "40.00" }, { currency: "USD", amount: "25.00" }]);
  });

  it("stores a decimal amount exactly and refuses a category the owner does not have", async () => {
    const f = fixture();
    const created = await f.accounts.createEntry({ entryType: "expense", amount: 19.99, date: "2026-11-14", description: "Train", category: "travel" }, { threadId: "thread" });
    expect(created.entry).toMatchObject({ amount: "19.99", status: "paid", category: "Travel" });
    expect(f.raw.prepare("SELECT amount_cents FROM financial_entries WHERE id = ?").get(created.entry.id)).toEqual({ amount_cents: 1999 });
    await expect(f.accounts.createEntry({ entryType: "expense", amount: 5, date: "2026-11-14", description: "Odd", category: "Unicorns" }, { threadId: "thread" }))
      .rejects.toThrow(/Travel/);
    expect(f.raw.prepare("SELECT COUNT(*) AS n FROM financial_categories WHERE name = 'Unicorns'").get()).toEqual({ n: 0 });
  });

  it("keeps a receipt photo in Files > Receipts and links it to a needs-review entry", async () => {
    const f = fixture();
    f.photo("att-1", "thread", "receipt-bytes");
    const created = await f.accounts.createEntry({ entryType: "expense", amount: 12.5, date: "2026-11-14", description: "Cafe Nero" }, { threadId: "thread", receiptAttachmentId: "att-1" });
    expect(created.entry.status).toBe("needs_review");
    expect(created.receipt).toMatchObject({ saved: true, folder: "Receipts" });
    const file = f.raw.prepare(`SELECT f.filename, d.path FROM drive_files f JOIN drive_folders d ON d.id = f.folder_id WHERE f.id = ?`).get(created.entry.receiptFileId!) as { filename: string; path: string };
    expect(file.path).toBe("Receipts");
    expect(file.filename).toMatch(/^2026-11-14 Cafe Nero.*\.jpg$/);
  });

  it("returns the first entry when the same photo is sent again", async () => {
    const f = fixture();
    f.photo("att-1", "thread", "same-bytes");
    f.photo("att-2", "thread", "same-bytes");
    const first = await f.accounts.createEntry({ entryType: "expense", amount: 8, date: "2026-11-14", description: "Lunch" }, { threadId: "thread", receiptAttachmentId: "att-1" });
    const again = await f.accounts.createEntry({ entryType: "expense", amount: 8, date: "2026-11-14", description: "Lunch" }, { threadId: "thread", receiptAttachmentId: "att-2" });
    expect(again).toMatchObject({ duplicate: true, entry: { id: first.entry.id } });
    expect(f.raw.prepare("SELECT COUNT(*) AS n FROM financial_entries").get()).toEqual({ n: 1 });
  });

  it("refuses a photo from another conversation and creates nothing", async () => {
    const f = fixture();
    f.photo("att-old", "elsewhere", "old-bytes");
    await expect(f.accounts.createEntry({ entryType: "expense", amount: 8, date: "2026-11-14", description: "Lunch" }, { threadId: "thread", receiptAttachmentId: "att-old" }))
      .rejects.toThrow(/photo/i);
    expect(f.raw.prepare("SELECT COUNT(*) AS n FROM financial_entries").get()).toEqual({ n: 0 });
  });

  it("changes only the owner's entry", async () => {
    const f = fixture();
    f.entry("mine", "owner", "expense", "2026-10-10", 4000, "EUR", "needs_review");
    f.entry("theirs", "other", "expense", "2026-10-10", 4000);
    expect((await f.accounts.updateEntry("mine", { status: "paid", amount: 41 })).entry).toMatchObject({ status: "paid", amount: "41.00" });
    await expect(f.accounts.updateEntry("theirs", { status: "cancelled" })).rejects.toThrow(/not found/i);
  });
});
