import { externalShopLabel, externalShopUrl, type ProductDelivery } from "./product-delivery.js";
import { LOW_STOCK_THRESHOLD, type ProductOption } from "./product-offer.js";
import { downloadSummary, publishedStock } from "./product-shop.js";
type ProductPurchase = {
  stock?: number;
  stockSetAt?: string;
  options?: ProductOption[];
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
  const options = product.options || [];
  const firstOption = options.find((option) => option.stock !== 0) || options[0];
  const basePrice = firstOption ? firstOption.price : product.price;
  const hasPrice = Number.isInteger(basePrice) && basePrice! >= 50 && /^[a-z]{3}$/i.test(product.currency || "");
  const price = typeof basePrice === "number" && Number.isFinite(basePrice)
    ? `<p class="product-price" data-product-price>${escape((basePrice / 100).toFixed(2))} ${escape((product.currency || "").toUpperCase())}</p>`
    : "";
  if (product.delivery?.kind === "external") {
    const url = externalShopUrl(product.delivery.url);
    const notes = product.delivery.instructions?.trim() ? `<p class="product-help">${escape(product.delivery.instructions.trim())}</p>` : "";
    return `<section class="product-purchase" aria-label="Purchase">${price}${url && product.available !== false
      ? `<a class="product-buy" href="${escape(url.toString())}" target="_blank" rel="noopener">${escape(externalShopLabel(product.delivery))} <span aria-hidden="true">↗</span></a>${notes}`
      : "<p>This product is currently unavailable.</p>"}</section>`;
  }
  const stock = publishedStock(product);
  const counted = options.length ? options.some((option) => option.stock !== undefined) : stock !== null && Boolean(product.stockSetAt);
  const soldOut = stock === 0 || (options.length > 0 && options.every((option) => option.stock === 0));
  const stockLine = counted
    ? `<p class="product-stock${!soldOut && stock !== null && stock <= LOW_STOCK_THRESHOLD ? " is-low" : ""}" data-product-availability>${soldOut ? "Sold out" : stock !== null && stock <= LOW_STOCK_THRESHOLD ? `Only ${stock} left` : ""}</p>`
    : "";
  const optionPicker = options.length
    ? `<fieldset class="product-options"><legend>Choose an option</legend>${options.map((option) => `<label class="product-option"><input type="radio" name="optionId" value="${escape(option.id)}" data-price="${option.price}"${option === firstOption && option.stock !== 0 ? " checked" : ""}${option.stock === 0 ? " disabled" : ""} required><span>${escape(option.label)}</span><span class="product-option-price">${escape((option.price / 100).toFixed(2))} ${escape((product.currency || "").toUpperCase())}</span>${option.stock === 0 ? '<span class="product-option-note">Sold out</span>' : ""}</label>`).join("")}</fieldset>`
    : "";
  const manual = product.paymentMethod === "manual";
  const physical = product.delivery?.kind === "physical";
  const money = (amount: number) => `${(amount / 100).toFixed(2)} ${(product.currency || "").toUpperCase()}`;
  const digital = product.delivery?.kind === "digital";
  const deliveryInfo = digital
    ? `<p class="product-help">${escape(downloadSummary(product.delivery))} · download link by email after payment</p>${product.delivery?.instructions?.trim() ? `<p>${escape(product.delivery.instructions.trim())}</p>` : ""}`
    : product.delivery ? `<p>${escape(product.delivery.instructions || "")}</p>` : "";
  const returns = product.delivery?.returns ? `<p><strong>Returns and cancellations</strong><br>${escape(product.delivery.returns)}</p>` : "";
  const shipping = physical ? `<p>Shipping: ${escape(money(product.delivery?.shippingCost || 0))}<br><strong data-product-total>Total: ${escape(money((basePrice || 0) + (product.delivery?.shippingCost || 0)))}</strong></p>` : "";
  const address = physical ? `<fieldset class="product-address"><legend>Delivery address</legend>
    <label for="delivery-line1">Address</label><input id="delivery-line1" name="line1" autocomplete="shipping address-line1" maxlength="200" required>
    <label for="delivery-line2">Apartment, suite, etc. (optional)</label><input id="delivery-line2" name="line2" autocomplete="shipping address-line2" maxlength="200">
    <label for="delivery-city">Town or city</label><input id="delivery-city" name="city" autocomplete="shipping address-level2" maxlength="200" required>
    <label for="delivery-region">County, state or region (optional)</label><input id="delivery-region" name="region" autocomplete="shipping address-level1" maxlength="200">
    <label for="delivery-postal">Postal code (where applicable)</label><input id="delivery-postal" name="postalCode" autocomplete="shipping postal-code" maxlength="32">
    <label for="delivery-country">Country</label><select id="delivery-country" name="country" autocomplete="shipping country" required><option value="">Choose country</option>${(product.delivery?.countries || []).map(code => `<option value="${escape(code)}">${escape(new Intl.DisplayNames(["en"], {type:"region"}).of(code) || code)}</option>`).join("")}</select>
  </fieldset>` : "";
  const unavailable = product.available === false ? "This product is currently unavailable."
    : soldOut ? "Sold out."
    : !hasPrice || !product.username ? "This product is not ready for checkout yet." : "";
  if (unavailable) return `<section class="product-purchase" aria-label="Purchase">${price}${soldOut ? "" : stockLine}<p>${unavailable}</p></section>`;
  const config = JSON.stringify({ username: product.username, slug: product.slug, expectedAmount: basePrice, expectedCurrency: product.currency, manual, physical, digital, counted, shipping: physical ? product.delivery?.shippingCost || 0 : 0, lowStock: LOW_STOCK_THRESHOLD }).replace(/</g, "\\u003c");
  return `<section class="product-purchase" aria-label="Purchase" data-product-purchase>
    ${price}${stockLine}${shipping}${deliveryInfo}${returns}
    <p class="product-status" data-product-status role="status" aria-live="polite"></p>
    ${product.enabled ? `<div data-product-details>
    <form data-product-checkout>
      ${optionPicker}
      <label for="product-buyer-name">Your name</label><input id="product-buyer-name" name="buyerName" autocomplete="name" maxlength="120" required>
      <label for="product-buyer-email">Email</label><input id="product-buyer-email" name="buyerEmail" type="email" autocomplete="email" maxlength="254" required>
      ${address}
      ${manual ? '<p class="product-help">Payment is not taken now. We’ll email you the payment details.</p>' : ""}
      <button class="product-buy" type="submit">${manual ? "Request payment details" : digital ? "Buy and download" : "Continue to checkout"}</button>
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
  const priceLabel = root.querySelector("[data-product-price]");
  const totalLabel = root.querySelector("[data-product-total]");
  const stockLabel = root.querySelector("[data-product-availability]");
  function money(amount) { return (amount / 100).toFixed(2) + " " + String(config.expectedCurrency || "").toUpperCase(); }
  function selectedOption() { return form.querySelector('input[name="optionId"]:checked'); }
  function syncOption() {
    const option = selectedOption();
    if (!option) return;
    config.expectedAmount = Number(option.dataset.price);
    if (priceLabel) priceLabel.textContent = money(config.expectedAmount);
    if (totalLabel) totalLabel.textContent = "Total: " + money(config.expectedAmount + config.shipping);
  }
  form.addEventListener("change", (event) => { if (event.target && event.target.name === "optionId") syncOption(); });
  syncOption();
  function showDownload(url) {
    if (typeof url !== "string" || !/^\/api\/shop\/download\/[A-Za-z0-9_-]+$/.test(url)) return;
    const link = document.createElement("a");
    link.className = "product-buy";
    link.href = url;
    link.textContent = "Download now";
    root.appendChild(link);
  }
  if (config.counted) {
    fetch("/api/shop/" + encodeURIComponent(config.username) + "/availability").then((r) => r.ok ? r.json() : null).then((data) => {
      const info = data && data.products && data.products[config.slug];
      if (!info) return;
      const optionInputs = Array.from(form.querySelectorAll('input[name="optionId"]'));
      for (const input of optionInputs) {
        const left = info.options ? info.options[input.value] : undefined;
        if (left === 0) { input.disabled = true; input.checked = false; }
      }
      if (optionInputs.length && !selectedOption()) {
        const next = optionInputs.find((input) => !input.disabled);
        if (next) { next.checked = true; syncOption(); }
      }
      const soldOut = info.remaining === 0 || (optionInputs.length > 0 && optionInputs.every((input) => input.disabled));
      if (stockLabel) {
        stockLabel.textContent = soldOut ? "Sold out" : typeof info.remaining === "number" && info.remaining <= config.lowStock ? "Only " + info.remaining + " left" : "";
        stockLabel.classList.toggle("is-low", !soldOut && typeof info.remaining === "number" && info.remaining <= config.lowStock);
      }
      if (soldOut && !completed && new URLSearchParams(window.location.search).get("purchase") !== "success") {
        completed = true;
        details.hidden = true;
      }
    }).catch(() => {});
  }
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
        optionId: values.get("optionId") || undefined,
        buyerName: values.get("buyerName"), buyerEmail: values.get("buyerEmail"), expectedAmount: config.expectedAmount, expectedCurrency: config.expectedCurrency, returnUrl: returnUrl.toString(),
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
        message(result.downloadUrl ? "Payment received. Your download is ready, and the link is in your email too." : "Payment received. Thank you for your purchase.");
        showDownload(result.downloadUrl);
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
.product-stock{margin:-12px 0 16px;color:var(--muted)}.product-stock:empty{display:none}.product-stock.is-low{font-weight:700;color:var(--text)}
.product-options{display:grid;gap:8px;border:0;padding:0;margin:0 0 8px;min-width:0}.product-options legend{font-weight:600;margin-bottom:8px}
.product-option{display:flex;gap:10px;align-items:center;min-height:48px;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm);font-weight:400!important;cursor:pointer}
.product-option:has(input:checked){border-color:var(--text)}.product-option:has(input:disabled){opacity:.55;cursor:default}
.product-purchase .product-option input{width:auto;min-height:0;margin:0}
.product-option-price{margin-left:auto;font-variant-numeric:tabular-nums}.product-option-note{font-size:.85rem;color:var(--muted)}
a.product-buy{text-decoration:none;margin-top:12px}
.product-status:empty{display:none}
.product-status{margin:0 0 18px}.product-status.is-error{font-weight:600}
@media(max-width:520px){.product-buy{width:100%}}
`;
