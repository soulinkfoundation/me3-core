import { updateOrderFulfillment, recordManualOrderPayment } from "../account-order-fulfillment";
import {
  ACCOUNTS_PLUGIN_ID,
  AccountsInputError,
  createFinancialCategory,
  createFinancialEntry,
  deleteFinancialCategory,
  deleteFinancialEntry,
  exportFinancialEntriesCsv,
  getAccountsStripeStatus,
  getFinancialStats,
  importFinancialEntriesCsv,
  listAccountCustomers,
  listFinancialCategories,
  listFinancialEntries,
  syncAccountsStripe,
  updateFinancialEntry,
} from "../accounts";
import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";
import { isCorePluginEnabled } from "../plugins";

export function registerAccountsRoutes(app: AppHono, deps: OwnerRouteDeps) {
  app.post("/api/accounts/orders/:id/manual-payment", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireAccountsPlugin(c);
    if (blocked) return blocked;
    try { return c.json(await recordManualOrderPayment(c.env, ownerId, c.req.param("id"))); }
    catch (error) { if (error instanceof Error && "status" in error) return c.json({ error: error.message }, 404); throw error; }
  });
  app.put("/api/accounts/orders/:id/fulfillment", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireAccountsPlugin(c);
    if (blocked) return blocked;
    try {
      const body = await c.req.json<{ fulfilled?: unknown }>().catch(() => ({} as { fulfilled?: unknown }));
      return c.json(await updateOrderFulfillment(c.env, ownerId, c.req.param("id"), body.fulfilled));
    } catch (error) { return accountsErrorResponse(c, error); }
  });
  app.get("/api/accounts/customers", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireAccountsPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await listAccountCustomers(c.env, ownerId, new URL(c.req.url).searchParams));
    } catch (error) {
      return accountsErrorResponse(c, error);
    }
  });

  app.get("/api/accounts/entries", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireAccountsPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await listFinancialEntries(c.env, ownerId, new URL(c.req.url).searchParams));
    } catch (error) {
      return accountsErrorResponse(c, error);
    }
  });

  app.post("/api/accounts/entries", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireAccountsPlugin(c);
    if (blocked) return blocked;

    try {
      const body = await c.req.json<unknown>().catch((): unknown => ({}));
      return c.json(await createFinancialEntry(c.env, ownerId, body), 201);
    } catch (error) {
      return accountsErrorResponse(c, error);
    }
  });

  app.put("/api/accounts/entries/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireAccountsPlugin(c);
    if (blocked) return blocked;

    try {
      const body = await c.req.json<unknown>().catch((): unknown => ({}));
      return c.json(await updateFinancialEntry(c.env, ownerId, c.req.param("id"), body));
    } catch (error) {
      return accountsErrorResponse(c, error);
    }
  });

  app.delete("/api/accounts/entries/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireAccountsPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await deleteFinancialEntry(c.env, ownerId, c.req.param("id")));
    } catch (error) {
      return accountsErrorResponse(c, error);
    }
  });

  app.get("/api/accounts/categories", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireAccountsPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await listFinancialCategories(c.env, ownerId, c.req.query("entryType")));
    } catch (error) {
      return accountsErrorResponse(c, error);
    }
  });

  app.post("/api/accounts/categories", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireAccountsPlugin(c);
    if (blocked) return blocked;

    try {
      const body = await c.req.json<unknown>().catch((): unknown => ({}));
      return c.json(await createFinancialCategory(c.env, ownerId, body), 201);
    } catch (error) {
      return accountsErrorResponse(c, error);
    }
  });

  app.delete("/api/accounts/categories/:id", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireAccountsPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await deleteFinancialCategory(c.env, ownerId, c.req.param("id")));
    } catch (error) {
      return accountsErrorResponse(c, error);
    }
  });

  app.get("/api/accounts/export", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireAccountsPlugin(c);
    if (blocked) return blocked;

    try {
      return exportFinancialEntriesCsv(c.env, ownerId, new URL(c.req.url).searchParams);
    } catch (error) {
      return accountsErrorResponse(c, error);
    }
  });

  app.post("/api/accounts/import", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireAccountsPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await importFinancialEntriesCsv(c.env, ownerId, await c.req.formData()));
    } catch (error) {
      return accountsErrorResponse(c, error);
    }
  });

  app.get("/api/accounts/stats", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireAccountsPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await getFinancialStats(c.env, ownerId, c.req.query("entryType") || null));
    } catch (error) {
      return accountsErrorResponse(c, error);
    }
  });

  app.get("/api/accounts/stripe/status", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireAccountsPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await getAccountsStripeStatus(c.env, ownerId));
    } catch (error) {
      return accountsErrorResponse(c, error);
    }
  });

  app.post("/api/accounts/stripe/sync", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const blocked = await requireAccountsPlugin(c);
    if (blocked) return blocked;

    try {
      return c.json(await syncAccountsStripe(c.env, ownerId));
    } catch (error) {
      return accountsErrorResponse(c, error);
    }
  });
}

async function requireAccountsPlugin(c: AppContext) {
  if (await isCorePluginEnabled(c.env, ACCOUNTS_PLUGIN_ID)) return null;
  return c.json({ ok: false, error: "Accounts is disabled" }, 403);
}

function accountsErrorResponse(c: AppContext, error: unknown) {
  if (error instanceof AccountsInputError) {
    return c.json({ ok: false, error: error.message }, error.status as any);
  }
  throw error;
}
