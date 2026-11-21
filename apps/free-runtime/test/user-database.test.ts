import { describe, expect, it } from "vitest";
import { createD1Adapter } from "../src/d1-adapter";
import { activateUserDatabase, prepareUserDatabase } from "../src/user-database";
import { createSqliteHost } from "./sqlite-host";

// Failure modes: the second user in an isolate skips Core's runtime migrations because the first user's
// run is remembered module-wide; activation changes identity on a repeat call or for a different Cloud user.
describe("per-user database", () => {
  it("gives every user in one isolate a fully migrated Core database", async () => {
    for (const _user of ["a", "b"]) {
      const host = createSqliteHost();
      const db = createD1Adapter(host);
      const result = await prepareUserDatabase(host, db);
      expect(result.failed).toEqual([]);
      // Runtime-only tables: created by ensureCoreRuntimeMigrations, not by the SQL files.
      expect(await db.prepare("SELECT count(*) AS n FROM core_runtime_migrations").first("n")).toBeGreaterThan(50);
      expect(await db.prepare("SELECT name FROM sqlite_master WHERE name = 'me3_agent_turns'").first("name")).toBe("me3_agent_turns");
      expect((await prepareUserDatabase(host, db)).applied).toBe(0);
    }
  });

  it("activates once for one Cloud user", async () => {
    const host = createSqliteHost();
    const db = createD1Adapter(host);
    await prepareUserDatabase(host, db);
    const first = await activateUserDatabase(db, { userId: "user_1", email: "a@example.test", name: "Ada", handle: "ada" });
    expect(first.installId).toMatch(/^core_[0-9a-f-]{36}$/);
    const again = await activateUserDatabase(db, { userId: "user_1", email: "new@example.test", name: "Ada L", handle: "ada" });
    expect(again.installId).toBe(first.installId);
    expect(await db.prepare("SELECT email, password_hash FROM owner_profile WHERE id = 'owner'").first()).toEqual({ email: "new@example.test", password_hash: null });
    expect(await db.prepare("SELECT value FROM install_secrets WHERE name = 'ME3_CLOUD_OWNER_ID'").first("value")).toBe("user_1");
    await expect(activateUserDatabase(db, { userId: "user_2", email: "b@example.test", name: "Bo", handle: "bo" })).rejects.toThrow(/different/);
  });
});
