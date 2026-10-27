import { describe, expect, it } from "vitest";
import { productAvailability } from "./product-stock";
import { COMMERCE_TEST_SCHEMA, sqliteD1 } from "./test-support/sqlite-d1";

const setAt = "2026-10-27T10:00:00.000Z";

async function withOrders(rows: Array<[slug: string, status: string, createdAt: string, optionId?: string, method?: string]>) {
  const db = sqliteD1(COMMERCE_TEST_SCHEMA);
  let n = 0;
  for (const [slug, status, createdAt, optionId, method] of rows) {
    await db.prepare("INSERT INTO commerce_orders (id, site_id, product_slug, status, created_at, option_id, payment_method) VALUES (?, 'site-1', ?, ?, ?, ?, ?)")
      .bind(`o${n++}`, slug, status, createdAt, optionId ?? null, method ?? "stripe").run();
  }
  return db;
}

describe("copies left", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  it("counts paid orders and live holds since stock was set", async () => {
    const db = await withOrders([
      ["log", "paid", "2026-10-27 11:00:00"],
      ["log", "paid", "2026-10-26 09:00:00"], // before the owner set the count
      ["log", "pending", "2026-10-27 11:50:00"], // checkout still open
      ["log", "pending", "2026-10-27 10:30:00"], // abandoned checkout
      ["log", "failed", "2026-10-27 11:00:00"],
      ["log", "pending", "2026-10-25 10:30:00", undefined, "manual"], // before set
      ["log", "pending", "2026-10-27 10:30:00", undefined, "manual"], // waiting on manual payment
      ["other", "paid", "2026-10-27 11:00:00"],
    ]);
    const result = await productAvailability(db, "site-1", { slug: "log", stock: 5, stockSetAt: setAt }, now);
    expect(result.remaining).toBe(2);
  });

  it("is unlimited without a count and never negative", async () => {
    const db = await withOrders([["log", "paid", "2026-10-27 11:00:00"], ["log", "paid", "2026-10-27 11:01:00"]]);
    expect((await productAvailability(db, "site-1", { slug: "log" }, now)).remaining).toBeNull();
    expect((await productAvailability(db, "site-1", { slug: "log", stock: 1, stockSetAt: setAt }, now)).remaining).toBe(0);
  });

  it("counts each option on its own", async () => {
    const db = await withOrders([["print", "paid", "2026-10-27 11:00:00", "a3"], ["print", "paid", "2026-10-27 11:00:00", "a4"]]);
    const result = await productAvailability(db, "site-1", {
      slug: "print", stockSetAt: setAt,
      options: [{ id: "a4", label: "A4", price: 2000 }, { id: "a3", label: "A3", price: 3500, stock: 1 }, { id: "a2", label: "A2", price: 6000, stock: 4 }],
    }, now);
    expect(result.options).toEqual({ a4: null, a3: 0, a2: 4 });
    expect(result.remaining).toBeNull();
  });
});
