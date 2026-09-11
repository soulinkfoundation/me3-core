import { productDeliveryError, parseDeliveryAddress, type ProductDelivery } from "../../../shared/product-delivery";
import type Stripe from "stripe";
import {
  appendQueryParams,
  getStripe,
  loadSiteProfileForCommerce,
  normalizeEmail,
  normalizeLongText,
  normalizeSiteCheckoutReturnUrl,
  normalizeShortText,
} from "./booking";
import {
  getOwnerContact,
  sendProductPaymentInstructionsEmail,
  sendProductPurchaseConfirmationEmail,
} from "./transactional-emails";
import type { DbCommerceOrder, DbSite, Env } from "./types";
import {
  applyPurchaseEmailTokens,
  productSendsPurchaseConfirmation,
  type ProductPurchaseConfirmationEmail,
} from "../../../shared/product-purchase-confirmation";
import { getManagedCommerceBridgeConfig } from "./commerce-bridge";
import { isCommerceReady } from "./commerce-settings";
import { dispatchWebsitePaymentNotification } from "./payment-notifications";

const PAYMENTS_UNAVAILABLE_MESSAGE =
  "Payments are not available for this purchase right now. Please contact the site owner.";

type ProductCheckoutBody = {
  deliveryAddress?: unknown;
  buyerName?: unknown;
  buyerEmail?: unknown;
  buyerNote?: unknown;
  returnUrl?: unknown;
  pageId?: unknown;
  actionId?: unknown;
  campaign?: unknown;
};

type ProductRecord = {
  delivery?: ProductDelivery;
  slug?: string;
  title?: string;
  price?: number;
  currency?: string;
  available?: boolean;
  paymentMethod?: "stripe" | "manual";
  paymentInstructions?: string;
  confirmationEmail?: ProductPurchaseConfirmationEmail;
};

export class CommerceOrderInputError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "CommerceOrderInputError";
  }
}

export async function createProductCheckout(
  env: Env,
  site: DbSite,
  productSlug: string,
  body: ProductCheckoutBody,
  requestUrl: string,
): Promise<{
  paymentMethod: "stripe" | "manual";
  orderId: string;
  url?: string;
  sessionId?: string;
  message?: string;
}> {
  const buyerName = normalizeShortText(body.buyerName, 120);
  const buyerEmail = normalizeEmail(body.buyerEmail);
  const buyerNote = normalizeLongText(body.buyerNote, 2000);
  if (!buyerName) throw new CommerceOrderInputError("Your name is required.");
  if (!buyerEmail) throw new CommerceOrderInputError("Enter a valid email address.");
  const product = await findProduct(env, site, productSlug);
  if (!product || product.available === false) {
    throw new CommerceOrderInputError("Product is not available.", 404);
  }
  const deliveryError = productDeliveryError(product.delivery);
  if (deliveryError) throw new CommerceOrderInputError(deliveryError, 409);
  let deliveryAddress;
  if (product.delivery?.kind === "physical") {
    try { deliveryAddress = parseDeliveryAddress(body.deliveryAddress, product.delivery.countries!); }
    catch (error) { throw new CommerceOrderInputError((error as Error).message); }
  }
  if (!Number.isSafeInteger(product.price) || product.price! < 50) throw new CommerceOrderInputError("Product price is not ready for checkout.", 409);
  const shippingCost = product.delivery?.kind === "physical" ? product.delivery.shippingCost! : 0;
  const amount = Number(product.price || 0) + shippingCost;
  const deliverySnapshot = product.delivery ? JSON.stringify({ ...product.delivery, address: deliveryAddress, productAmount: product.price }) : null;
  const currency = normalizeShortText(product.currency, 3).toLowerCase();
  if (!Number.isSafeInteger(amount) || amount < 50 || !/^[a-z]{3}$/.test(currency)) {
    throw new CommerceOrderInputError("Product price is not ready for checkout.", 409);
  }
  const paymentMethod = product.paymentMethod === "manual" ? "manual" : "stripe";
  const paymentInstructions = normalizeLongText(product.paymentInstructions, 8000);
  if (paymentMethod === "manual" && !paymentInstructions) {
    throw new CommerceOrderInputError("Payment instructions are not configured for this product.", 409);
  }
  const orderId = crypto.randomUUID();
  const pageId = normalizeShortText(body.pageId, 100) || null;
  const actionId = normalizeShortText(body.actionId, 100) || null;
  const campaign = normalizeShortText(body.campaign, 160) || null;

  if (paymentMethod === "manual") {
    await env.DB.prepare(
      `INSERT INTO commerce_orders
       (id, site_id, page_id, action_id, campaign, product_slug, product_title,
        buyer_name, buyer_email, buyer_note, amount_paid, amount_due, currency,
        provider, payment_method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'me3_cloud', 'manual')`,
    )
      .bind(
        orderId,
        site.id,
        pageId,
        actionId,
        campaign,
        product.slug,
        product.title || product.slug,
        buyerName,
        buyerEmail,
        buyerNote || null,
        amount,
        currency,
      )
      .run();

    await env.DB.prepare("UPDATE commerce_orders SET delivery_json = ? WHERE id = ?").bind(deliverySnapshot, orderId).run();
    const owner = await getOwnerContact(env, site.user_id);
    const tokens = {
      buyerName,
      buyerNote,
      productTitle: product.title || product.slug || "ME3 offer",
      siteName: site.username,
      supportEmail: owner.email || "",
    };
    const extraMessage = productSendsPurchaseConfirmation(product.confirmationEmail)
      ? applyPurchaseEmailTokens(product.confirmationEmail.message, tokens)
      : "";
    const sent = await sendProductPaymentInstructionsEmail(env, {
      operationId: `order:${orderId}:payment-instructions`,
      ownerId: site.user_id,
      hostName: owner.name || site.username,
      hostEmail: owner.email,
      buyerName,
      buyerEmail,
      productTitle: tokens.productTitle,
      amountDue: amount,
      currency,
      paymentInstructions,
      messageText: extraMessage,
    });
    if (sent.status !== "sent" && sent.status !== "pending") {
      await env.DB.prepare(
        `UPDATE commerce_orders SET status = 'failed', updated_at = datetime('now') WHERE id = ?`,
      )
        .bind(orderId)
        .run();
      throw new CommerceOrderInputError(
        sent.error || "Payment details could not be emailed right now.",
        502,
      );
    }
    return {
      paymentMethod,
      orderId,
      message: sent.status === "pending"
        ? "Your request is confirmed. Email delivery is still being confirmed."
        : "Your request is confirmed. Check your email for payment details.",
    };
  }

  const stripe = await getStripe(env, site.user_id);
  const managed = !stripe && await isCommerceReady(env, site.user_id);
  if (!stripe && !managed) {
    throw new CommerceOrderInputError(PAYMENTS_UNAVAILABLE_MESSAGE, 503);
  }
  const provider = stripe ? "stripe_direct" : "me3_cloud";
  await env.DB.prepare(
    `INSERT INTO commerce_orders
     (id, site_id, page_id, action_id, campaign, product_slug, product_title,
      buyer_name, buyer_email, buyer_note, amount_paid, amount_due, currency,
      provider, payment_method)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 'stripe')`,
  )
    .bind(
      orderId,
      site.id,
      pageId,
      actionId,
      campaign,
      product.slug,
      product.title || product.slug,
      buyerName,
      buyerEmail,
      buyerNote || null,
      amount,
      currency,
      provider,
    )
    .run();

  await env.DB.prepare("UPDATE commerce_orders SET delivery_json = ? WHERE id = ?").bind(deliverySnapshot, orderId).run();
  const returnUrl = normalizeSiteCheckoutReturnUrl(
    body.returnUrl,
    requestUrl,
    env,
    site,
  );
  try {
    const checkout = stripe
      ? await createDirectCheckout(stripe, {
          orderId,
          site,
          product,
          amount,
          currency,
          buyerName,
          buyerEmail,
          buyerNote,
          pageId,
          actionId,
          campaign,
          returnUrl,
        })
      : await createManagedCheckout(env, {
          orderId,
          site,
          product,
          amount,
          currency,
          buyerName,
          buyerEmail,
          buyerNote,
          pageId,
          actionId,
          campaign,
          returnUrl,
        });
    await env.DB.prepare(
      `UPDATE commerce_orders
       SET checkout_session_id = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(checkout.sessionId, orderId)
      .run();
    return { ...checkout, paymentMethod, orderId };
  } catch (error) {
    await env.DB.prepare(
      `UPDATE commerce_orders SET status = 'failed', updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(orderId)
      .run();
    throw error;
  }
}

export async function completeProductCheckout(
  env: Env,
  site: DbSite,
  sessionId: string,
): Promise<{ ok: true; order: DbCommerceOrder; alreadyCompleted?: true } | { ok: false; checkoutStatus: "expired" }> {
  const order = await getOrderBySession(env, site.id, sessionId);
  if (!order) throw new CommerceOrderInputError("Checkout session not found.", 404);
  if (order.payment_method === "manual") {
    throw new CommerceOrderInputError("This order does not use online checkout.", 409);
  }
  if (order.status === "paid") {
    await sendProductConfirmation(env, site, order);
    return { ok: true, order, alreadyCompleted: true };
  }
  if (order.provider === "me3_cloud") {
    const session = await retrieveManagedCheckout(env, sessionId);
    if (session.checkoutStatus === "expired" && session.paymentStatus === "unpaid") {
      return { ok: false, checkoutStatus: "expired" };
    }
    return finalizeProductOrder(env, site, order, {
      paid: session.paymentStatus === "paid",
      paymentIntentId: session.paymentIntentId || null,
      amount: session.amountTotal ?? null,
      currency: session.currency || null,
      orderId: session.orderId,
      siteId: session.siteId,
    });
  }
  const stripe = await getStripe(env, site.user_id);
  if (!stripe) throw new CommerceOrderInputError("Stripe is not configured.", 503);
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.status === "expired" && session.payment_status === "unpaid") {
    return { ok: false, checkoutStatus: "expired" };
  }
  return finalizeStripeProductCheckout(
    env,
    site,
    session,
  );
}

export async function finalizeStripeProductCheckout(
  env: Env,
  site: DbSite,
  session: Stripe.Checkout.Session,
): Promise<{ ok: true; order: DbCommerceOrder; alreadyCompleted?: true }> {
  const order = await getOrderBySession(env, site.id, session.id);
  if (!order) throw new CommerceOrderInputError("Checkout order not found.", 404);
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || null;
  return finalizeProductOrder(env, site, order, {
    paid: session.payment_status === "paid",
    paymentIntentId,
    amount: session.amount_total,
    currency: session.currency,
    orderId: session.metadata?.order_id,
    siteId: session.metadata?.site_id,
  });
}

async function finalizeProductOrder(
  env: Env,
  site: DbSite,
  order: DbCommerceOrder,
  payment: {
    paid: boolean;
    paymentIntentId: string | null;
    amount: number | null;
    currency: string | null;
    orderId?: string | null;
    siteId?: string | null;
  },
) {
  if (!payment.paid) throw new CommerceOrderInputError("Payment has not completed.");
  if (payment.orderId !== order.id || payment.siteId !== site.id) {
    throw new CommerceOrderInputError("Checkout does not match this order.", 409);
  }
  if (payment.currency?.toLowerCase() !== order.currency?.toLowerCase() || payment.amount !== order.amount_due) {
    throw new CommerceOrderInputError("Payment total does not match this order.", 409);
  }
  if (order.status === "paid") {
    await sendProductConfirmation(env, site, order);
    return { ok: true as const, order, alreadyCompleted: true as const };
  }
  await env.DB.prepare(
    `UPDATE commerce_orders
     SET status = 'paid', payment_intent_id = ?, amount_paid = ?, currency = ?,
         paid_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND site_id = ? AND status IN ('pending', 'failed')`,
  )
    .bind(
      payment.paymentIntentId,
      payment.amount,
      payment.currency,
      order.id,
      site.id,
    )
    .run();
  const updated = await getOrderBySession(env, site.id, order.checkout_session_id || "");
  if (!updated) throw new Error("Paid order could not be loaded");
  if (updated.status !== "paid") throw new CommerceOrderInputError("Order cannot be completed in its current state.", 409);
  await sendProductConfirmation(env, site, updated);
  await queueProductPaymentNotification(env, site, updated);
  return { ok: true as const, order: updated };
}

async function findProduct(
  env: Env,
  site: DbSite,
  productSlug: string,
): Promise<ProductRecord | null> {
  const profile = await loadSiteProfileForCommerce(env, site);
  return (
    ((profile?.products || []) as ProductRecord[]).find(
      (product) => product.slug === productSlug,
    ) || null
  );
}

async function getOrderBySession(
  env: Env,
  siteId: string,
  sessionId: string,
): Promise<DbCommerceOrder | null> {
  return (
    (await env.DB.prepare(
      `SELECT id, site_id, page_id, action_id, campaign, product_slug, product_title,
              buyer_name, buyer_email, buyer_note, amount_paid, amount_due, currency, status,
              provider, payment_method, checkout_session_id, payment_intent_id, paid_at,
              created_at, updated_at, confirmation_sent_at, payment_checked_at, delivery_json, fulfilled_at
       FROM commerce_orders WHERE site_id = ? AND checkout_session_id = ?`,
    )
      .bind(siteId, sessionId)
      .first<DbCommerceOrder>()) || null
  );
}

type CheckoutInput = {
  orderId: string;
  site: DbSite;
  product: ProductRecord;
  amount: number;
  currency: string;
  buyerName: string;
  buyerEmail: string;
  buyerNote: string;
  pageId: string | null;
  actionId: string | null;
  campaign: string | null;
  returnUrl: string;
};

async function createDirectCheckout(
  stripe: Stripe,
  input: CheckoutInput,
): Promise<{ url: string; sessionId: string }> {
  const successUrl = appendQueryParams(input.returnUrl, {
    purchase: "success",
    session_id: "{CHECKOUT_SESSION_ID}",
  });
  const cancelUrl = appendQueryParams(input.returnUrl, { purchase: "cancelled" });
  const metadata = {
    purchase_kind: "product",
    order_id: input.orderId,
    site_id: input.site.id,
    product_slug: input.product.slug || "",
    page_id: input.pageId || "",
    action_id: input.actionId || "",
    campaign: input.campaign || "",
  };
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: input.buyerEmail,
    line_items: [
      {
        price_data: {
          currency: input.currency,
          product_data: { name: (input.product.title || input.product.slug || "ME3 offer") + (input.product.delivery?.kind === "physical" ? " (including shipping)" : "") },
          unit_amount: input.amount,
        },
        quantity: 1,
      },
    ],
    metadata,
    payment_intent_data: { metadata },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  if (!session.url) throw new Error("Stripe checkout URL missing");
  return { url: session.url, sessionId: session.id };
}

async function createManagedCheckout(
  env: Env,
  input: CheckoutInput,
): Promise<{ url: string; sessionId: string }> {
  const bridge = await getManagedCommerceBridgeConfig(env);
  if (!bridge) {
    throw new CommerceOrderInputError("Managed commerce bridge is not configured.", 503);
  }
  const response = await fetch(
    `${bridge.origin.replace(/\/+$/, "")}/v1/commerce/checkout-sessions`,
    {
      method: "POST",
      headers: {
        ...bridge.headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId: input.orderId,
        referenceId: input.orderId,
        kind: "product",
        siteId: input.site.id,
        ownerId: input.site.user_id,
        product: {
          id: input.product.slug,
          name: (input.product.title || input.product.slug) + (input.product.delivery?.kind === "physical" ? " (including shipping)" : ""),
          amount: input.amount,
          currency: input.currency,
        },
        customer: {
          name: input.buyerName,
          email: input.buyerEmail,
          note: input.buyerNote || undefined,
        },
        attribution: {
          pageId: input.pageId,
          actionId: input.actionId,
          campaign: input.campaign,
        },
        returnUrl: input.returnUrl,
      }),
    },
  );
  const data = (await response.json()) as {
    url?: string;
    sessionId?: string;
    error?: string;
  };
  if (!response.ok || !data.url || !data.sessionId) {
    console.error("Managed product checkout failed:", response.status, data.error);
    throw new CommerceOrderInputError(PAYMENTS_UNAVAILABLE_MESSAGE, 503);
  }
  return { url: data.url, sessionId: data.sessionId };
}

async function retrieveManagedCheckout(env: Env, sessionId: string) {
  const bridge = await getManagedCommerceBridgeConfig(env);
  if (!bridge) {
    throw new CommerceOrderInputError("Managed commerce bridge is not configured.", 503);
  }
  const response = await fetch(
    `${bridge.origin.replace(/\/+$/, "")}/v1/commerce/checkout-sessions/${encodeURIComponent(sessionId)}`,
    { headers: bridge.headers },
  );
  const data = (await response.json()) as {
    paymentStatus?: string;
    checkoutStatus?: string;
    paymentIntentId?: string | null;
    amountTotal?: number | null;
    currency?: string | null;
    orderId?: string | null;
    siteId?: string | null;
    error?: string;
  };
  if (!response.ok) {
    throw new CommerceOrderInputError(data.error || "Managed checkout could not be verified.", 502);
  }
  return data;
}

async function sendProductConfirmation(
  env: Env,
  site: DbSite,
  order: DbCommerceOrder,
): Promise<void> {
  if (order.confirmation_sent_at) return;
  const product = await findProduct(env, site, order.product_slug);
  const owner = await getOwnerContact(env, site.user_id);
  const tokens = {
    buyerName: order.buyer_name,
    buyerNote: order.buyer_note || "",
    productTitle: order.product_title,
    siteName: site.username,
    supportEmail: owner.email || "",
  };
  const custom = productSendsPurchaseConfirmation(product?.confirmationEmail) ? product.confirmationEmail : null;
  const amount = new Intl.NumberFormat("en", { style: "currency", currency: order.currency || "EUR" }).format((order.amount_paid || 0) / 100);
  const delivery = order.delivery_json ? JSON.parse(order.delivery_json) as ProductDelivery : null;
  const result = await sendProductPurchaseConfirmationEmail(env, {
    operationId: `order:${order.id}:purchase-confirmation`,
    ownerId: site.user_id,
    hostName: owner.name || site.username,
    hostEmail: owner.email,
    buyerName: order.buyer_name,
    buyerEmail: order.buyer_email,
    productTitle: order.product_title,
    subject: custom ? applyPurchaseEmailTokens(custom.subject, tokens) : `Order confirmed: ${order.product_title}`,
    messageText: `Hi ${order.buyer_name},\n\nPayment received for ${order.product_title}.\nAmount paid: ${amount}\nOrder reference: ${order.id}` + (delivery?.instructions ? `\n\nDelivery: ${delivery.instructions}` : "") + (custom ? `\n\n${applyPurchaseEmailTokens(custom.message, tokens)}` : ""),
  });
  if (result.status === "sent") {
    await env.DB.prepare("UPDATE commerce_orders SET confirmation_sent_at = datetime('now') WHERE id = ? AND site_id = ?")
      .bind(order.id, site.id).run();
  }
}


export async function confirmManualProductOrder(env: Env, ownerId: string, orderId: string): Promise<void> {
  const order = await env.DB.prepare(`SELECT * FROM commerce_orders WHERE id = ? AND payment_method = 'manual'
    AND site_id IN (SELECT id FROM sites WHERE user_id = ?)`).bind(orderId, ownerId).first<DbCommerceOrder>();
  if (!order || (order.status !== "pending" && order.status !== "paid")) throw new CommerceOrderInputError("Manual order not found.", 404);
  const paid = await env.DB.prepare(`UPDATE commerce_orders SET status = 'paid', amount_paid = amount_due, paid_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND site_id = ? AND status = 'pending'`).bind(order.id, order.site_id).run();
  const site = await env.DB.prepare("SELECT * FROM sites WHERE id = ? AND user_id = ?").bind(order.site_id, ownerId).first<DbSite>();
  if (site) {
    const updated: DbCommerceOrder = { ...order, status: "paid", amount_paid: order.amount_due };
    await sendProductConfirmation(env, site, updated);
    if (Number(paid.meta.changes || 0) > 0) await queueProductPaymentNotification(env, site, updated);
  }
}

async function queueProductPaymentNotification(env: Env, site: DbSite, order: DbCommerceOrder) {
  await dispatchWebsitePaymentNotification(env, site.user_id, {
    sourceKind: "order",
    sourceId: order.id,
    amountCents: Number(order.amount_paid || order.amount_due || 0),
    currency: String(order.currency || "USD").toUpperCase(),
    customerName: order.buyer_name?.trim() || null,
    itemTitle: order.product_title || "Product payment",
    siteName: site.username,
  }).catch((error) => console.error("Product payment notification failed", error));
}
