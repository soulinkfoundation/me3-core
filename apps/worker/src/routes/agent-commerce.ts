import { requestCountry } from "../../../../shared/regional-pricing";
import {
  AGENT_COMMERCE_BASE_PATH,
  AgentCommerceError,
  agentCommerceSiteBase,
  assertAgentCheckoutOpen,
  createAgentCheckout,
  enforceAgentCommerceRateLimit,
  getAgentCheckout,
  getAgentOfferingAvailability,
  identifyAgentCommerceCaller,
  listAgentCommerceOfferings,
  openAgentCheckoutPayment,
  type AgentCommerceCaller,
  AGENT_COMMERCE_RATE_LIMITS,
} from "../agent-commerce";
import { buildAgentCommerceOpenApi } from "../agent-commerce-openapi";
import { getSiteByUsername } from "../booking";
import type { AppContext, AppHono } from "../http/types";
import type { DbSite } from "../types";

// Public, unauthenticated like the site's own checkout. Existing checkouts stay
// readable and payable after the owner turns agent checkout off.
export function registerAgentCommerceRoutes(app: AppHono) {
  const base = `${AGENT_COMMERCE_BASE_PATH}/sites/:username`;

  app.get(`${base}/openapi.json`, (c) =>
    handle(c, "read", async (site) =>
      c.json(buildAgentCommerceOpenApi({
        serverUrl: agentCommerceSiteBase(new URL(c.req.url).origin, site.username),
        siteName: site.username,
      })),
    ),
  );

  app.get(`${base}/offerings`, (c) =>
    handle(c, "read", async (site) => {
      await assertAgentCheckoutOpen(c.env, site);
      return c.json({
        offerings: await listAgentCommerceOfferings(c.env, { site, country: requestCountry(c.req.raw) }),
      });
    }),
  );

  app.get(`${base}/offerings/:offeringId/availability`, (c) =>
    handle(c, "read", async (site) => {
      await assertAgentCheckoutOpen(c.env, site);
      return c.json(
        await getAgentOfferingAvailability(
          c.env,
          { site, country: requestCountry(c.req.raw) },
          c.req.param("offeringId"),
          { from: c.req.query("from") || undefined, to: c.req.query("to") || undefined },
        ),
      );
    }),
  );

  app.post(`${base}/checkouts`, (c) =>
    handle(c, "checkout", async (site, caller) => {
      await assertAgentCheckoutOpen(c.env, site);
      const body = await c.req.json<unknown>().catch(() => null);
      if (!body) throw new AgentCommerceError("Send a JSON body.", 400, "invalid_request");
      const result = await createAgentCheckout(
        c.env,
        { site, requestUrl: c.req.url, country: requestCountry(c.req.raw), caller },
        body,
      );
      return c.json(result.checkout, result.created ? 201 : 200);
    }),
  );

  app.get(`${base}/checkouts/:checkoutId`, (c) =>
    handle(c, "read", async (site) => {
      const authorization = c.req.header("Authorization") || "";
      const secret = authorization.match(/^Bearer\s+(\S+)$/i)?.[1] || "";
      return c.json(await getAgentCheckout(c.env, { site, requestUrl: c.req.url }, c.req.param("checkoutId"), secret));
    }),
  );

  // The human payment link: a page, not part of the agent contract.
  app.get(`${base}/checkouts/:checkoutId/pay`, async (c) => {
    try {
      const site = await publishedSite(c);
      await enforceAgentCommerceRateLimit(c.env, "read", await identifyAgentCommerceCaller(c.env, c.req.raw));
      return c.redirect(await openAgentCheckoutPayment(c.env, site, c.req.param("checkoutId")), 303);
    } catch (error) {
      if (!(error instanceof AgentCommerceError)) throw error;
      return c.html(paymentPage(error.message), error.status);
    }
  });
}

async function handle(
  c: AppContext,
  bucket: keyof typeof AGENT_COMMERCE_RATE_LIMITS,
  run: (site: DbSite, caller: AgentCommerceCaller) => Promise<Response>,
): Promise<Response> {
  try {
    const site = await publishedSite(c);
    const caller = await identifyAgentCommerceCaller(c.env, c.req.raw);
    await enforceAgentCommerceRateLimit(c.env, bucket, caller);
    return await run(site, caller);
  } catch (error) {
    if (!(error instanceof AgentCommerceError)) throw error;
    if (error.status === 429) c.header("Retry-After", String(error.details.retryAfterSeconds || 60));
    return c.json({ error: error.message, code: error.code, ...error.details }, error.status);
  }
}

async function publishedSite(c: AppContext): Promise<DbSite> {
  const site = await getSiteByUsername(c.env, c.req.param("username") || "");
  if (!site?.published_at) throw new AgentCommerceError("Site not found.", 404, "site_not_found");
  return site;
}

function paymentPage(message: string): string {
  const escaped = message.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Checkout</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;line-height:1.5;color:#1f2933}</style></head><body><h1>Checkout unavailable</h1><p>${escaped}</p></body></html>`;
}
