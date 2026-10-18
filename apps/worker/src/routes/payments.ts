import { refreshNetworkPurchase } from "../agent-network-commerce";
import { PaymentError, getPayment, getPaymentLimits, listPayments, markPaymentNotPaid, recordPaymentReceipt, savePaymentLimits } from "../agent-payments";
import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";

/** Owner-facing payments: history, receipts and spend limits. ME3 never charges from these routes. */
export function registerPaymentRoutes(app: AppHono, deps: OwnerRouteDeps) {
  app.use("/api/payments/*", async (c, next) => {
    const owner = await deps.requireOwner(c); if (!owner) return deps.unauthorized(c);
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  app.use("/api/payments", async (c, next) => {
    const owner = await deps.requireOwner(c); if (!owner) return deps.unauthorized(c);
    c.header("Cache-Control", "private, no-store");
    await next();
  });
  const owner = async (c: AppContext) => (await deps.requireOwner(c))!;
  const handle = async (c: AppContext, work: () => Promise<unknown>) => {
    try { return c.json(await work()); }
    catch (error) { if (error instanceof PaymentError) return c.json({ error: error.message }, error.status as 400 | 403 | 404 | 409); throw error; }
  };
  app.get("/api/payments", c => handle(c, async () => listPayments(c.env, await owner(c), { status: c.req.query("status"), limit: Number(c.req.query("limit")) || undefined })));
  app.get("/api/payments/limits", c => handle(c, async () => ({ limits: await getPaymentLimits(c.env, await owner(c), c.req.query("currency") || "EUR") })));
  app.put("/api/payments/limits", c => handle(c, async () => ({ limits: await savePaymentLimits(c.env, await owner(c), await c.req.json().catch(() => ({}))) })));
  app.get("/api/payments/:id", c => handle(c, async () => getPayment(c.env, await owner(c), c.req.param("id"))));
  // The owner confirms or corrects what was actually paid; this overrides an email-derived receipt.
  app.post("/api/payments/:id/receipt", c => handle(c, async () => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    return { payment: await recordPaymentReceipt(c.env, await owner(c), { proposalId: c.req.param("id"), amount: body.amount, currency: body.currency, orderReference: body.orderReference, paidAt: body.paidAt }, "owner") };
  }));
  // Network purchases: ask the seller now instead of waiting for the background check.
  app.post("/api/payments/:id/refresh", c => handle(c, async () => ({ payment: await refreshNetworkPurchase(c.env, await owner(c), c.req.param("id")) })));
  app.post("/api/payments/:id/not-paid", c => handle(c, async () => ({ payment: await markPaymentNotPaid(c.env, await owner(c), c.req.param("id")) })));
}
