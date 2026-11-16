import { countAgentCommerceRequest } from "../agent-commerce-store";
import type { AppContext, AppHono } from "../http/types";
import { payPagePath } from "../pay-directly";
import { getPayPageData, recordSaysPaid, renderPayPage, renderPayPageNotFound } from "../pay-page";

// The buyer's pay page for a pay-directly order or booking. Public: the unguessable token in the
// link is the only key, so nothing here is cached, indexed or passed on to payment sites as a referrer.

const SAYS_PAID_LIMIT = 10;
const SAYS_PAID_WINDOW_SECONDS = 60;

const PAGE_HEADERS = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};
const HTML_HEADERS = {
  ...PAGE_HEADERS,
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
};

async function saysPaidLimited(c: AppContext): Promise<number | null> {
  const ip = c.req.header("cf-connecting-ip")?.trim() || c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`me3:pay-says-paid:${ip}`));
  const key = Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
  try {
    const { count, retryAfterSeconds } = await countAgentCommerceRequest(c.env, `pay-says-paid:${key}`, SAYS_PAID_WINDOW_SECONDS);
    return count > SAYS_PAID_LIMIT ? retryAfterSeconds : null;
  } catch (error) {
    console.error("Pay page rate limit could not be checked:", error);
    return null;
  }
}

export function registerPayRoutes(app: AppHono) {
  app.get("/api/pay/:token", async (c) => {
    const token = c.req.param("token");
    const data = await getPayPageData(c.env, token);
    if (!data) return c.html(renderPayPageNotFound(), 404, HTML_HEADERS);
    return c.html(renderPayPage(data, token), 200, HTML_HEADERS);
  });

  // The same facts as JSON, for a client that draws its own pay screen.
  app.get("/api/pay/:token/details", async (c) => {
    const data = await getPayPageData(c.env, c.req.param("token"));
    if (!data) return c.json({ ok: false, error: "Payment page not found." }, 404, PAGE_HEADERS);
    return c.json({ ok: true, payment: data }, 200, PAGE_HEADERS);
  });

  // "I've paid". A form post from the page comes back to the page; a JSON client gets the new state.
  app.post("/api/pay/:token/paid", async (c) => {
    const wantsJson = (c.req.header("accept") || "").includes("application/json");
    const retryAfter = await saysPaidLimited(c);
    if (retryAfter !== null) {
      const headers = { ...PAGE_HEADERS, "Retry-After": String(retryAfter) };
      return wantsJson
        ? c.json({ ok: false, error: "Too many requests. Try again in a minute." }, 429, headers)
        : c.text("Too many requests. Try again in a minute.", 429, headers);
    }
    const token = c.req.param("token");
    const data = await recordSaysPaid(c.env, token);
    if (!data) {
      return wantsJson
        ? c.json({ ok: false, error: "Payment page not found." }, 404, PAGE_HEADERS)
        : c.html(renderPayPageNotFound(), 404, HTML_HEADERS);
    }
    if (wantsJson) return c.json({ ok: true, payment: data }, 200, PAGE_HEADERS);
    return c.redirect(payPagePath(token), 303);
  });
}
