import {
  CommerceOrderInputError,
  completeProductCheckout,
  createProductCheckout,
  productDownloadLink,
} from "../commerce-orders";
import { getSiteByUsername, loadSiteProfileForCommerce } from "../booking";
import { productAvailability } from "../product-stock";
import { downloadResponse, ProductDownloadError, storeProductDownload } from "../product-downloads";
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
import type { DbSite, Env } from "../types";
import { requestCountry } from "../../../../shared/regional-pricing";
import { parseMe3Json, type Me3Profile } from "me3-protocol";
import { applyAgentCheckoutSetting } from "../agent-commerce";
import { syncPublishedProfileToSoulinkDirectory } from "../network-directory";
import { getSiteFileText, getSiteForOwner, isMissingSiteFilesTableError } from "../sites";

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
      const settings = await updateCommerceSettings(c.env, ownerId, body);
      if (body && typeof body === "object" && "agentCheckoutEnabled" in body) {
        queueAgentCheckoutDirectorySync(c, ownerId);
      }
      return c.json(settings);
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
          requestCountry(c.req.raw),
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

  // Live copies left, so a published page never sells what is gone.
  app.get("/api/shop/:username/availability", async (c) => {
    const site = await getSiteByUsername(c.env, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    const profile = await loadSiteProfileForCommerce(c.env, site);
    const products: Record<string, Awaited<ReturnType<typeof productAvailability>>> = {};
    for (const product of (profile?.products || []) as Array<Parameters<typeof productAvailability>[2]>) {
      if (product.slug) products[product.slug] = await productAvailability(c.env.DB, site.id, product);
    }
    c.header("Cache-Control", "no-store");
    return c.json({ products });
  });

  app.get("/api/shop/download/:token", (c) => downloadResponse(c.env, c.req.param("token")));

  // The owner's paid download. It is stored privately and only released per order.
  app.post("/api/sites/:username/products/download", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const site = await getSiteForOwner(c.env, ownerId, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    try {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return c.json({ error: "Choose a file to upload" }, 400);
      return c.json({ ok: true, file: await storeProductDownload(c.env, site, file) });
    } catch (error) {
      if (error instanceof ProductDownloadError) return c.json({ error: error.message }, error.status as 400);
      if (isMissingSiteFilesTableError(error) || (error instanceof Error && error.message.includes("too large for Core D1 storage"))) {
        return c.json({ error: "Activate storage in Account settings to upload downloads larger than a few MB." }, 413);
      }
      throw error;
    }
  });

  app.post("/api/shop/:username/complete-checkout", async (c) => {
    const site = await getSiteByUsername(c.env, c.req.param("username"));
    if (!site) return c.json({ error: "Site not found" }, 404);
    const body = await c.req.json<{ sessionId?: unknown }>().catch(() => null);
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
    if (!sessionId) return c.json({ error: "Checkout session ID is required" }, 400);
    try {
      const result = await completeProductCheckout(c.env, site, sessionId);
      if (!result.ok) return c.json(result);
      const downloadUrl = await productDownloadLink(c.env, site, result.order).catch(() => null);
      return c.json({ ok: true, order: { status: result.order.status, product_slug: result.order.product_slug }, alreadyCompleted: result.alreadyCompleted, ...(downloadUrl ? { downloadUrl } : {}) });
    } catch (error) {
      if (error instanceof CommerceOrderInputError) {
        return c.json({ error: error.message }, error.status as 400);
      }
      throw error;
    }
  });
}

// The network directory should stop (or resume) advertising agent checkout as
// soon as the owner flips the switch, not at the next publish.
function queueAgentCheckoutDirectorySync(c: AppContext, ownerId: string): void {
  let executionCtx: { waitUntil(promise: Promise<unknown>): void };
  try {
    executionCtx = c.executionCtx;
  } catch {
    return;
  }
  executionCtx.waitUntil(
    (async () => {
      const site = await c.env.DB.prepare(
        `SELECT * FROM sites
         WHERE user_id = ? AND site_role = 'profile' AND published_at IS NOT NULL
         ORDER BY created_at ASC LIMIT 1`,
      )
        .bind(ownerId)
        .first<DbSite>();
      const stored = site ? await getSiteFileText(c.env, site.id, "public/me.json") : null;
      const parsed = stored ? parseMe3Json(stored) : null;
      if (!site || !parsed?.valid || !parsed.profile) return;
      await syncPublishedProfileToSoulinkDirectory(
        c.env,
        await applyAgentCheckoutSetting(c.env, ownerId, parsed.profile as Me3Profile),
      );
    })().catch((error) => console.error("Failed to sync agent checkout to the directory:", error)),
  );
}

function commerceSettingsErrorResponse(c: AppContext, error: unknown) {
  if (error instanceof CommerceSettingsInputError || error instanceof ManagedCommerceBridgeError) {
    return c.json({ ok: false, error: error.message }, error.status as any);
  }
  throw error;
}
