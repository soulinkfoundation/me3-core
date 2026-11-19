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
  updatePayDirectlyHoldSettings,
  getCommerceSettings,
  updateCommerceSettings,
} from "../commerce-settings";
import {
  PayDirectlyInputError,
  createPaymentMethod,
  deletePaymentMethod,
  listPaymentMethods,
  reorderPaymentMethods,
  updatePaymentMethod,
} from "../pay-directly";
import {
  createManagedCommerceOnboardingLink,
  ManagedCommerceBridgeError,
} from "../commerce-bridge";
import {
  parseStripeReturnApp,
  STRIPE_APP_RETURN_PATH,
  stripeAppDeepLink,
  stripeAppReturnPage,
  stripeAppReturnUrl,
} from "../stripe-app-return";
import type { AppContext, AppHono, OwnerRouteDeps } from "../http/types";
import type { DbSite, Env } from "../types";
import { requestCountry } from "../../../../shared/regional-pricing";
import { parseMe3Json, type Me3Profile } from "me3-protocol";
import { applyAgentCheckoutSetting } from "../agent-commerce";
import { syncPublishedProfileToSoulinkDirectory } from "../network-directory";
import { getPublishedSiteBaseUrl, getSiteFileText, getSiteForOwner, isMissingSiteFilesTableError } from "../sites";
import { republishForPaymentChange } from "../site-publish";
import { cleanAbout, deliverSiteEnquiry, enquiryPage, parseEnquiry } from "../site-enquiry";

type CommerceRouteDeps = OwnerRouteDeps & {
  getCoreWebOrigin(env: Env, requestUrl?: string): string;
};

export function registerCommerceRoutes(app: AppHono, deps: CommerceRouteDeps) {
  app.get("/api/commerce/status", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const settings = await getCommerceSettings(c.env, ownerId);
    // Stripe onboarding finishes on Stripe's side; the first status read after it flips Enquire to Book or Buy.
    if (settings.stripe.connectionStatus !== "unavailable") queuePaymentRepublish(c, ownerId);
    return c.json({ ok: true, ...settings });
  });

  // Pay me directly: days until an unpaid buyer is reminded and an unpaid booking or order is released.
  app.put("/api/commerce/pay-directly-settings", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = await c.req.json().catch(() => ({}));
    try {
      return c.json({ ok: true, ...(await updatePayDirectlyHoldSettings(c.env, ownerId, body)) });
    } catch (error) {
      if (error instanceof CommerceSettingsInputError) return c.json({ ok: false, error: error.message }, 400);
      throw error;
    }
  });

  app.put("/api/commerce/settings", async (c) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const body = await c.req.json().catch(() => ({}));
    try {
      const settings = await updateCommerceSettings(c.env, ownerId, body);
      queuePaymentRepublish(c, ownerId);
      if (body && typeof body === "object" && "agentCheckoutEnabled" in body) {
        queueAgentCheckoutDirectorySync(c, ownerId);
      }
      return c.json(settings);
    } catch (error) {
      return commerceSettingsErrorResponse(c, error);
    }
  });

  // Pay me directly: the owner's saved ways to get paid. Owner-only; never part of the published site.
  const paymentMethodRoute = (
    handler: (c: AppContext, ownerId: string, body: unknown) => Promise<Record<string, unknown>>,
    status: 200 | 201 = 200,
  ) => async (c: AppContext) => {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);
    const body = c.req.method === "GET" || c.req.method === "DELETE" ? null : await c.req.json().catch(() => null);
    try {
      const result = await handler(c, ownerId, body);
      // A saved, changed or removed way to get paid changes which offers show Enquire.
      if (c.req.method !== "GET") queuePaymentRepublish(c, ownerId);
      return c.json({ ok: true, ...result }, status);
    } catch (error) {
      if (error instanceof PayDirectlyInputError) {
        return c.json({ ok: false, error: error.message }, error.status as 400);
      }
      throw error;
    }
  };

  app.get("/api/commerce/payment-methods", paymentMethodRoute(async (c, ownerId) => ({
    methods: await listPaymentMethods(c.env, ownerId),
  })));
  app.post("/api/commerce/payment-methods", paymentMethodRoute(async (c, ownerId, body) => ({
    method: await createPaymentMethod(c.env, ownerId, body),
  }), 201));
  app.put("/api/commerce/payment-methods/order", paymentMethodRoute(async (c, ownerId, body) => ({
    methods: await reorderPaymentMethods(c.env, ownerId, body),
  })));
  app.patch("/api/commerce/payment-methods/:id", paymentMethodRoute(async (c, ownerId, body) => ({
    method: await updatePaymentMethod(c.env, ownerId, c.req.param("id") || "", body),
  })));
  app.delete("/api/commerce/payment-methods/:id", paymentMethodRoute(async (c, ownerId) => {
    await deletePaymentMethod(c.env, ownerId, c.req.param("id") || "");
    return {};
  }));

  async function startStripeOnboarding(
    c: AppContext,
    mode: "onboard" | "refresh",
  ) {
    const ownerId = await deps.requireOwner(c);
    if (!ownerId) return deps.unauthorized(c);

    const body = await c.req
      .json<{ country?: unknown; app?: unknown; returnPath?: unknown }>()
      .catch((): { country?: unknown; app?: unknown; returnPath?: unknown } => ({}));
    const country = typeof body.country === "string" ? body.country.trim().toUpperCase() : "";
    if (country && !/^[A-Z]{2}$/.test(country)) {
      return c.json({ error: "Choose a valid country." }, 400);
    }

    try {
      const webOrigin = deps.getCoreWebOrigin(c.env, c.req.url);
      const app = parseStripeReturnApp(body.app);
      const returnUrl = app
        ? stripeAppReturnUrl(webOrigin, app)
        : new URL(stripeWebReturnPath(body.returnPath), webOrigin).toString();
      return c.json(await createManagedCommerceOnboardingLink(c.env, {
        country,
        returnUrl,
        mode,
      }));
    } catch (error) {
      return commerceSettingsErrorResponse(c, error);
    }
  }

  app.post("/api/commerce/connect/onboard", (c) => startStripeOnboarding(c, "onboard"));
  app.post("/api/commerce/connect/refresh", (c) => startStripeOnboarding(c, "refresh"));

  // Public: Stripe redirects the owner's browser here, which has no ME3 session.
  app.get(STRIPE_APP_RETURN_PATH, (c) => {
    const target = parseStripeReturnApp(c.req.query("app"));
    if (!target) return c.text("Not found", 404);
    const page = stripeAppReturnPage(stripeAppDeepLink(target, c.req.query("stripe_connect")));
    return c.html(page, 200, {
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
    });
  });

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

  // Public: a site's Enquire button (a paid offer nobody can pay for yet) opens a short form. What the
  // visitor sends lands in the owner's ME3 inbox, with the offer named in the subject.
  app.on(["GET", "POST"], "/api/enquire/:username", async (c) => {
    const site = await getSiteByUsername(c.env, c.req.param("username"));
    if (!site?.published_at) return c.text("Not found", 404);
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex");
    const profile = await loadSiteProfileForCommerce(c.env, site).catch(() => null);
    const siteName = (typeof profile?.name === "string" && profile.name.trim()) || site.username;
    const siteUrl = await getPublishedSiteBaseUrl(c.env, site);
    const action = `/api/enquire/${encodeURIComponent(site.username)}`;
    if (c.req.method === "GET") {
      return c.html(enquiryPage({ siteName, siteUrl, about: cleanAbout(c.req.query("about")), action }));
    }
    const body = await c.req.parseBody().catch(() => ({}));
    const form: Record<string, unknown> = Object.fromEntries(Object.entries(body).map(([key, value]) => [key, typeof value === "string" ? value : ""]));
    const about = cleanAbout(form.about);
    // Bots fill the hidden field; they get the thank-you page and nothing is filed.
    if (String(form.website ?? "").trim()) return c.html(enquiryPage({ siteName, siteUrl, about, action, state: "sent" }));
    const parsed = parseEnquiry(form);
    if ("error" in parsed) {
      return c.html(enquiryPage({ siteName, siteUrl, about, action, error: parsed.error, values: { name: String(form.name ?? ""), email: String(form.email ?? ""), message: String(form.message ?? "") } }), 400);
    }
    let waitUntil: ((work: Promise<unknown>) => void) | undefined;
    try { const ctx = c.executionCtx; waitUntil = (work) => ctx.waitUntil(work); } catch { waitUntil = undefined; }
    const state = await deliverSiteEnquiry(c.env, parsed.enquiry, { siteUrl, waitUntil });
    return c.html(enquiryPage({ siteName, siteUrl, about, action, state }), state === "sent" ? 200 : 503);
  });

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
/** Republishes the owner's live sites in the background when payment readiness changed since they were rendered. */
function queuePaymentRepublish(c: AppContext, ownerId: string): void {
  let executionCtx: { waitUntil(promise: Promise<unknown>): void };
  try {
    executionCtx = c.executionCtx;
  } catch {
    return;
  }
  executionCtx.waitUntil(
    republishForPaymentChange(c.env, ownerId).catch((error) => console.error("Failed to republish after a payment change:", error)),
  );
}

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

/**
 * Where Stripe sends the owner back on the web: the site editor step they started from, or
 * Settings → Payments. Only /create paths are accepted, so this can't send anyone elsewhere.
 */
export function stripeWebReturnPath(value: unknown): string {
  if (typeof value !== "string") return "/settings?section=payments";
  return /^\/create(?:\?[\w.~%&=+-]*)?$/.test(value) ? value : "/settings?section=payments";
}
