import { DatabaseSync } from "node:sqlite";
import { describe, it, expect } from "vitest";
import { updateOrderFulfillment } from "./account-order-fulfillment";
import type { Env } from "./types";

describe("order fulfilment ownership", () => {
  it("only updates paid orders belonging to the owner and can undo fulfilment", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`CREATE TABLE sites(id TEXT, user_id TEXT);
      CREATE TABLE commerce_orders(id TEXT, site_id TEXT, status TEXT, fulfilled_at TEXT, updated_at TEXT);
      INSERT INTO sites VALUES ('a','alice'),('b','bob');
      INSERT INTO commerce_orders VALUES ('paid','a','paid',NULL,NULL),('pending','a','pending',NULL,NULL),('other','b','paid',NULL,NULL);`);
    const env = { DB: { prepare: (sql: string) => ({ bind: (...values: (string | number)[]) => ({
      run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...values).changes) } }),
    }) }) } } as unknown as Env;
    await expect(updateOrderFulfillment(env, "alice", "other", true)).rejects.toThrow("not found");
    await expect(updateOrderFulfillment(env, "alice", "pending", true)).rejects.toThrow("not found");
    await expect(updateOrderFulfillment(env, "alice", "paid", "true")).rejects.toThrow("Choose");
    await updateOrderFulfillment(env, "alice", "paid", true);
    expect(db.prepare("SELECT fulfilled_at FROM commerce_orders WHERE id='paid'").get()?.fulfilled_at).toBeTruthy();
    await updateOrderFulfillment(env, "alice", "paid", false);
    expect(db.prepare("SELECT fulfilled_at FROM commerce_orders WHERE id='paid'").get()?.fulfilled_at).toBeNull();
    db.close();
  });
});
