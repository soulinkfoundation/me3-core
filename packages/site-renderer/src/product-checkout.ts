import type { ProductDelivery } from "../../../shared/product-delivery";
type ProductPurchase = {
  delivery?: ProductDelivery;
  username: string;
  slug: string;
  price?: number;
  currency?: string;
  available?: boolean;
  paymentMethod?: "stripe" | "manual";
  enabled: boolean;
};

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function renderProductCheckout(product: ProductPurchase): string {
  const hasPrice = Number.isInteger(product.price) && product.price! >= 50 && /^[a-z]{3}$/i.test(product.currency || "");
  const price = typeof product.price === "number" && Number.isFinite(product.price)
    ? `<p class="product-price">${escape((product.price / 100).toFixed(2))} ${escape((product.currency || "").toUpperCase())}</p>`
    : "";
  const manual = product.paymentMethod === "manual";
  const physical = product.delivery?.kind === "physical";
  const money = (amount: number) => `${(amount / 100).toFixed(2)} ${(product.currency || "").toUpperCase()}`;
  const deliveryInfo = product.delivery ? `<p>${escape(product.delivery.instructions || "")}</p>` : "";
  const returns = product.delivery?.returns ? `<p><strong>Returns and cancellations</strong><br>${escape(product.delivery.returns)}</p>` : "";
  const shipping = physical ? `<p>Shipping: ${escape(money(product.delivery?.shippingCost || 0))}<br><strong>Total: ${escape(money((product.price || 0) + (product.delivery?.shippingCost || 0)))}</strong></p>` : "";
  const address = physical ? `<fieldset class="product-address"><legend>Delivery address</legend>
    <label for="delivery-line1">Address</label><input id="delivery-line1" name="line1" autocomplete="shipping address-line1" maxlength="200" required>
    <label for="delivery-line2">Apartment, suite, etc. (optional)</label><input id="delivery-line2" name="line2" autocomplete="shipping address-line2" maxlength="200">
    <label for="delivery-city">Town or city</label><input id="delivery-city" name="city" autocomplete="shipping address-level2" maxlength="200" required>
    <label for="delivery-region">County, state or region (optional)</label><input id="delivery-region" name="region" autocomplete="shipping address-level1" maxlength="200">
    <label for="delivery-postal">Postal code (where applicable)</label><input id="delivery-postal" name="postalCode" autocomplete="shipping postal-code" maxlength="32">
    <label for="delivery-country">Country</label><select id="delivery-country" name="country" autocomplete="shipping country" required><option value="">Choose country</option>${(product.delivery?.countries || []).map(code => `<option value="${escape(code)}">${escape(new Intl.DisplayNames(["en"], {type:"region"}).of(code) || code)}</option>`).join("")}</select>
  </fieldset>` : "";
  const unavailable = product.available === false ? "This product is currently unavailable."
    : !hasPrice || !product.username ? "This product is not ready for checkout yet." : "";
  if (unavailable) return `<section class="product-purchase" aria-label="Purchase">${price}<p>${unavailable}</p></section>`;
  const config = JSON.stringify({ username: product.username, slug: product.slug, manual, physical }).replace(/</g, "\\u003c");
  return `<section class="product-purchase" aria-label="Purchase" data-product-purchase>
    ${price}${shipping}${deliveryInfo}${returns}
    <p class="product-status" data-product-status role="status" aria-live="polite"></p>
    ${product.enabled ? `<div data-product-details>
    <form data-product-checkout>
      <label for="product-buyer-name">Your name</label><input id="product-buyer-name" name="buyerName" autocomplete="name" maxlength="120" required>
      <label for="product-buyer-email">Email</label><input id="product-buyer-email" name="buyerEmail" type="email" autocomplete="email" maxlength="254" required>
      ${address}
      ${manual ? '<p class="product-help">Payment is not taken now. We’ll email you the payment details.</p>' : ""}
      <button class="product-buy" type="submit">${manual ? "Request payment details" : "Continue to checkout"}</button>
    </form></div>` : '<button class="product-buy" type="button" disabled>Buy now</button><p class="product-help">Checkout is available on your published site.</p>'}
  </section>${product.enabled ? `<script>(${productCheckoutScript})(${config});</script>` : ""}`;
}

// Literal JavaScript stays independent of bundler helper functions.
const productCheckoutScript = String.raw`function(config) {
  const root = document.querySelector("[data-product-purchase]");
  if (!root) return;
  const form = root.querySelector("[data-product-checkout]");
  const details = root.querySelector("[data-product-details]");
  const status = root.querySelector("[data-product-status]");
  const button = form.querySelector('button[type="submit"]');
  let busy = false;
  let completed = false;
  function message(text, error = false) {
    status.textContent = text;
    status.classList.toggle("is-error", error);
  }
  function pending(value) {
    busy = value;
    button.disabled = value || completed;
    form.setAttribute("aria-busy", String(value));
  }
  async function post(path, payload) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "We couldn’t complete that request. Please try again.");
    return data;
  }
  function clearReturnParameters() {
    const url = new URL(window.location.href);
    url.searchParams.delete("purchase");
    url.searchParams.delete("session_id");
    window.history.replaceState(null, "", url.toString());
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy || completed || !form.reportValidity()) return;
    pending(true);
    message(config.manual ? "Sending your request…" : "Opening secure checkout…");
    try {
      const values = new FormData(form);
      const returnUrl = new URL(window.location.href);
      returnUrl.searchParams.delete("purchase");
      returnUrl.searchParams.delete("session_id");
      returnUrl.hash = "";
      const result = await post("/api/shop/" + encodeURIComponent(config.username) + "/" + encodeURIComponent(config.slug) + "/order", {
        deliveryAddress: config.physical ? Object.fromEntries(["line1", "line2", "city", "region", "postalCode", "country"].map(key => [key, values.get(key)])) : undefined,
        buyerName: values.get("buyerName"), buyerEmail: values.get("buyerEmail"), returnUrl: returnUrl.toString(),
      });
      if (result.paymentMethod === "manual") {
        completed = true;
        details.hidden = true;
        message(result.message || "Your request is confirmed. Check your email for payment details.");
        pending(false);
      } else if (typeof result.url === "string" && new URL(result.url).protocol === "https:") {
        window.location.assign(result.url);
      } else throw new Error("Checkout is unavailable. Please try again.");
    } catch (error) {
      message(error instanceof Error ? error.message : "Checkout is unavailable. Please try again.", true);
      pending(false);
    }
  });
  const params = new URLSearchParams(window.location.search);
  if (params.get("purchase") === "cancelled") {
    message("Checkout cancelled. No payment was taken. You can try again.");
    clearReturnParameters();
  } else if (params.get("purchase") === "success") {
    const sessionId = params.get("session_id");
    details.hidden = true;
    const recovery = document.createElement("div");
    root.appendChild(recovery);
    function returnToProduct() {
      clearReturnParameters();
      recovery.replaceChildren();
      details.hidden = false;
      pending(false);
    }
    function action(label, handler) {
      const control = document.createElement("button");
      control.type = "button";
      control.className = "product-buy";
      control.textContent = label;
      control.addEventListener("click", handler);
      recovery.appendChild(control);
    }
    const validReference = sessionId && /^cs_[a-zA-Z0-9_]+$/.test(sessionId);
    async function confirmPayment() {
      recovery.replaceChildren();
      pending(true);
      message("Confirming your payment…");
      try {
        const result = await post("/api/shop/" + encodeURIComponent(config.username) + "/complete-checkout", { sessionId });
        if (result.ok === false && result.checkoutStatus === "expired") {
          message("This checkout expired without payment. You can try again.");
          returnToProduct();
          return;
        }
        if (result.ok !== true || result.order?.status !== "paid" || result.order?.product_slug !== config.slug) {
          throw new Error("Payment has not been confirmed for this product.");
        }
        completed = true;
        pending(false);
        message("Payment received. Thank you for your purchase.");
        clearReturnParameters();
      } catch (error) {
        pending(false);
        message((error instanceof Error ? error.message : "Payment could not be confirmed.") + " Check the payment status again or contact the seller before paying again.", true);
        action("Check payment status again", confirmPayment);
        action("Return to product", returnToProduct);
      }
    }
    if (!validReference) {
      message("We couldn’t confirm payment because the checkout reference is missing or invalid. Contact the seller before paying again.", true);
      action("Return to product", returnToProduct);
    } else {
      void confirmPayment();
    }
  }
}`;

export const productCheckoutCss = `
.product-purchase{margin:28px 0 12px;padding-top:24px;border-top:1px solid var(--border)}
.product-price{font-size:1.5rem;font-weight:700;margin:0 0 20px}
.product-purchase [hidden]{display:none!important}
.product-buy{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-height:48px;padding:12px 24px;border:1px solid var(--accent);border-radius:var(--radius-md);background:var(--accent);color:var(--surface);font:inherit;font-weight:700;cursor:pointer;list-style:none;text-align:center}
.product-buy::-webkit-details-marker{display:none}
.product-buy:disabled{opacity:.6;cursor:default}
.product-buy:focus-visible,.product-purchase input:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.product-purchase form{display:grid;gap:10px;margin-top:20px;max-width:420px}
.product-purchase label{font-weight:600}
.product-address{display:grid;gap:10px;border:0;padding:0;margin:8px 0;min-width:0}.product-address legend{font-weight:700;margin-bottom:12px}
.product-purchase select,.product-purchase input{box-sizing:border-box;width:100%;min-height:48px;padding:12px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text);font:inherit}
.product-help{font-size:.9rem;color:var(--muted);margin:4px 0 12px}
.product-status:empty{display:none}
.product-status{margin:0 0 18px}.product-status.is-error{font-weight:600}
@media(max-width:520px){.product-buy{width:100%}}
`;
