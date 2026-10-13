import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Failure modes: losing legacy saves, changing shared seed text, missing owner
// boundaries, deleting unsaved private quotes, and replaying the backfill twice.
describe("quote bookmark migration", () => {
  it("backfills memberships without changing any legacy quote field", () => {
    const raw = new DatabaseSync(":memory:");
    try {
      for (const name of ["0001_initial_public_schema", "0067_quotes"]) {
        raw.exec(readFileSync(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8"));
      }
      raw.exec("INSERT INTO owner_profile(id,username) VALUES('owner','synthetic');");
      raw.exec("UPDATE quotes SET user_id='owner',saved_at='2026-10-13T08:00:00Z' WHERE id='q216';");
      raw.exec("INSERT INTO quotes(id,user_id,text,author,origin,saved_at) VALUES('private','owner','Owner words','Owner','agent','2026-10-13T09:00:00Z');");
      raw.exec("INSERT INTO quotes(id,user_id,text,author,origin,archived_at) VALUES('unsaved','owner','Keep my unsaved words','Owner','owner','2026-10-12T09:00:00Z');");
      const before = raw.prepare("SELECT * FROM quotes ORDER BY id").all();
      const migration = readFileSync(new URL("../migrations/0069_quote_bookmarks.sql", import.meta.url), "utf8");
      raw.exec(migration);
      expect(raw.prepare("SELECT * FROM quotes ORDER BY id").all()).toEqual(before);
      const memberships = raw.prepare("SELECT user_id,quote_id,saved_at FROM quote_bookmarks ORDER BY quote_id").all();
      expect(memberships).toEqual([
        { user_id: "owner", quote_id: "private", saved_at: "2026-10-13T09:00:00Z" },
        { user_id: "owner", quote_id: "q216", saved_at: "2026-10-13T08:00:00Z" },
      ]);
      raw.exec(migration);
      expect(raw.prepare("SELECT user_id,quote_id,saved_at FROM quote_bookmarks ORDER BY quote_id").all()).toEqual(memberships);
      expect(raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { raw.close(); }
  });
});
