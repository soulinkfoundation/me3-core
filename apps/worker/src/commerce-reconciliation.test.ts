import { describe, it, expect, vi, afterEach } from "vitest";
import { reconcileProductOrders } from "./commerce-reconciliation";
import { completeProductCheckout } from "./commerce-orders";
import type { Env } from "./types";
vi.mock("./commerce-orders", () => ({ completeProductCheckout: vi.fn() }));
afterEach(() => vi.clearAllMocks());
describe("background product payments", () => {
  it("confirms without a browser, retires expired orders and continues after a failure", async () => {
    const run = vi.fn();
    const rows = ["failed", "paid", "expired"].map(id => ({ id, site_id: "site", checkout_session_id: id }));
    const env = { DB: { prepare: (sql: string) => ({
      bind(...args: unknown[]) { return { run: () => run(sql, args), first: async () => ({ id: "site" }) }; },
      all: async () => ({ results: rows }),
    }) } } as unknown as Env;
    vi.mocked(completeProductCheckout).mockRejectedValueOnce(new Error("temporarily unavailable"))
      .mockResolvedValueOnce({ ok: true, order: { status: "paid" } } as never)
      .mockResolvedValueOnce({ ok: false, checkoutStatus: "expired" });
    await reconcileProductOrders(env);
    expect(completeProductCheckout).toHaveBeenCalledTimes(3);
    expect(run.mock.calls.filter(([sql]) => sql.includes("status = 'failed'"))).toEqual([
      [expect.stringContaining("AND status = 'pending'"), ["expired"]],
    ]);
  });
});
