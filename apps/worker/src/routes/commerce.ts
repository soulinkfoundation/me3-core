import {
  CommerceOrderInputError,
  completeProductCheckout,
  createProductCheckout,
} from "../commerce-orders";
import { getSiteByUsername } from "../booking";
import {
  CommerceSettingsInputError,
  getCommerceSettings,
  updateCommerceSettings,
} from "../commerce-settings";
import {
  createManagedCommerceOnboardingLink,
  ManagedCommerceBridgeError,
} from "../commerce-bridge";
import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";
import type { Env } from "../types";

type CommerceRouteDeps = OwnerRouteDeps & {
  getCoreWebOrigin(env: Env, requestUrl?: string): string;
};

export function registerCommerceRoutes(app: AppHono, deps: CommerceRouteDeps) {
  app.get("/api/commerce/status", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    return c.json({
      ok: true,
      ...(await getCommerceSettings(c.env, ownerId)),
    });
  });

  app.put("/api/commerce/settings", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const body = await c.req.json().catch(() => ({}));
    try {
      return c.json(await updateCommerceSettings(c.env, ownerId, body));
    } catch (error) {
      return commerceSettingsErrorResponse(c, error);
    }
  });

  async function startStripeOnboarding(
    c: AppContext,
    mode: "onboard" | "refresh",
  ) {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const body = await c.req
      .json<{ country?: unknown }>()
      .catch((): { country?: unknown } => ({}));
    const country = typeof body.country === "string" ? body.country.trim().toUpperCase() : "";
    if (country && !/^[A-Z]{2}$/.test(country)) {
      return c.json({ error: "Choose a valid country." }, 400);
    }

    try {
      const returnUrl = new URL("/settings?section=payments", deps.getCoreWebOrigin(c.env, c.req.url));
      return c.json(await createManagedCommerceOnboardingLink(c.env, {
        country,
        returnUrl: returnUrl.toString(),
        mode,
      }));
    } catch (error) {
      return commerceSettingsErrorResponse(c, error);
    }
  }

  app.post("/api/commerce/connect/onboard", (c) => startStripeOnboarding(c, "onboard"));
  app.post("/api/commerce/connect/refresh", (c) => startStripeOnboarding(c, "refresh"));

  const startProductOrder = async (c: AppContext) => {
    const site = await getSiteByUsername(
      c.env,
      c.req.param("username") || "",
    );
    if (!site) return c.json({ error: "Site not found" }, 404);
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ error: "Invalid request body" }, 400);
    try {
      return c.json(
        await createProductCheckout(
          c.env,
          site,
          c.req.param("productSlug") || "",
          body,
          c.req.url,
        ),
      );
    } catch (error) {
      if (error instanceof CommerceOrderInputError) {
        return c.json({ error: error.message }, error.status as 400);
      }
      throw error;
    }
  };

  app.post("/api/shop/:username/:productSlug/order", startProductOrder);
  app.post(
    "/api/shop/:username/:productSlug/checkout-session",
    startProductOrder,
  );

  app.post("/api/shop/:username/complete-checkout", async (c) => {
    const site = await getSiteByUsername(c.env, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    const body = await c.req.json<{ sessionId?: unknown }>().catch(() => null);
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    if (!sessionId) return c.json({ error: "Checkout session ID is required" }, 400);
    try {
      const result = await completeProductCheckout(c.env, site, sessionId);
      return c.json(result.ok ? { ok: true, order: { status: result.order.status, product_slug: result.order.product_slug }, alreadyCompleted: result.alreadyCompleted } : result);
    } catch (error) {
      if (error instanceof CommerceOrderInputError) {
        return c.json({ error: error.message }, error.status as 400);
      }
      throw error;
    }
  });
}

function commerceSettingsErrorResponse(c: AppContext, error: unknown) {
  if (error instanceof CommerceSettingsInputError || error instanceof ManagedCommerceBridgeError) {
    return c.json({ ok: false, error: error.message }, error.status as any);
  }
  throw error;
}
