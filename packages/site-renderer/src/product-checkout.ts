import { externalShopLabel, externalShopUrl, type ProductDelivery } from "./product-delivery.js";
import { LOW_STOCK_THRESHOLD, type ProductOption } from "./product-offer.js";
import { displayMoney, downloadSummary, publishedStock } from "./product-shop.js";
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
  /** With paymentMethod "stripe": the buyer may pay the owner directly instead of by card. */
  allowPayDirectly?: boolean;
  /** Set at publish when nobody can pay for this product yet: Enquire, linking here, replaces Buy. */
  enquireUrl?: string;
  enabled: boolean;
};

/** Enquire links are the Worker's own path or an email link; anything else is dropped. */
export function safeEnquireHref(value: unknown): string {
  if (typeof value !== "string") return "";
  const href = value.trim();
  return /^\/api\/enquire\/[^\s"'<>]+$/.test(href) || /^mailto:[^\s"'<>]+$/i.test(href) ? href : "";
}

function enquireHref(product: ProductPurchase): string {
  return safeEnquireHref(product.enquireUrl);
}

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** What the page can offer for this product: its opening price, and why it can't be bought, if it can't. */
function purchaseState(product: ProductPurchase) {
  const options = product.options || [];
  const firstOption = options.find((option) => option.stock !== 0) || options[0];
  const basePrice = firstOption ? firstOption.price : product.price;
  const hasPrice = Number.isInteger(basePrice) && basePrice! >= 50 && /^[a-z]{3}$/i.test(product.currency || "");
  const stock = publishedStock(product);
  const soldOut = stock === 0 || (options.length > 0 && options.every((option) => option.stock === 0));
  const unavailable = product.available === false ? "This product is currently unavailable."
    : soldOut ? "Sold out."
    : !hasPrice || !product.username ? "This product is not ready for checkout yet." : "";
  return { options, firstOption, basePrice, stock, soldOut, unavailable };
}

/** The phone action bar's Buy button for a product that can be bought here, or "" to keep the site's own action. */
export function renderProductDock(product: ProductPurchase): string {
  if (product.delivery?.kind === "external") {
    const url = externalShopUrl(product.delivery.url);
    return url && product.available !== false
      ? `<a class="site-action-dock__button" href="${escape(url.toString())}" target="_blank" rel="noopener">${escape(externalShopLabel(product.delivery))}</a>` : "";
  }
  const { basePrice, unavailable } = purchaseState(product);
  if (unavailable || !product.enabled || typeof basePrice !== "number") return "";
  const enquire = enquireHref(product);
  if (enquire) return `<a class="site-action-dock__button" href="${escape(enquire)}" rel="nofollow">Enquire</a>`;
  return `<button type="button" class="site-action-dock__button" data-product-dock>Buy now · ${escape(displayMoney(basePrice, product.currency))}</button>`;
}

export function renderProductCheckout(product: ProductPurchase): string {
  const { options, firstOption, basePrice, stock, soldOut, unavailable } = purchaseState(product);
  const money = (amount: number) => displayMoney(amount, product.currency);
  const price = typeof basePrice === "number" && Number.isFinite(basePrice)
    ? `<p class="product-price" data-product-price>${escape(money(basePrice))}</p>`
    : "";
  if (product.delivery?.kind === "external") {
    const url = externalShopUrl(product.delivery.url);
    const notes = product.delivery.instructions?.trim() ? `<p class="product-help">${escape(product.delivery.instructions.trim())}</p>` : "";
    return `<section class="product-purchase" aria-label="Purchase"><div class="product-price-row">${price}</div>${url && product.available !== false
      ? `<a class="product-buy" href="${escape(url.toString())}" target="_blank" rel="noopener">${escape(externalShopLabel(product.delivery))} <span aria-hidden="true">↗</span></a>${notes}`
      : "<p>This product is currently unavailable.</p>"}</section>`;
  }
  const counted = options.length ? options.some((option) => option.stock !== undefined) : stock !== null && Boolean(product.stockSetAt);
  const stockLine = counted
    ? `<p class="product-stock${!soldOut && stock !== null && stock <= LOW_STOCK_THRESHOLD ? " is-low" : ""}" data-product-availability>${soldOut ? "Sold out" : stock !== null && stock <= LOW_STOCK_THRESHOLD ? `Only ${stock} left` : ""}</p>`
    : "";
  const optionPicker = options.length
    ? `<fieldset class="product-options"><legend>Choose an option</legend>${options.map((option) => `<label class="product-option"><input type="radio" name="optionId" value="${escape(option.id)}" data-price="${option.price}"${option === firstOption && option.stock !== 0 ? " checked" : ""}${option.stock === 0 ? " disabled" : ""} required><span>${escape(option.label)}</span><span class="product-option-price">${escape(money(option.price))}</span>${option.stock === 0 ? '<span class="product-option-note">Sold out</span>' : ""}</label>`).join("")}</fieldset>`
    : "";
  const manual = product.paymentMethod === "manual";
  // "Let them choose": a card product whose buyer may pay the owner directly instead.
  const choose = !manual && product.allowPayDirectly === true;
  const physical = product.delivery?.kind === "physical";
  const digital = product.delivery?.kind === "digital";
  const shippingCost = physical ? product.delivery?.shippingCost || 0 : 0;
  const instructions = product.delivery?.instructions?.trim() || "";
  const facts = [
    digital ? `${escape(downloadSummary(product.delivery))} · download link by email after payment` : "",
    physical ? `Shipping ${escape(money(shippingCost))}${instructions ? ` · ${escape(instructions)}` : ""}` : instructions ? escape(instructions) : "",
    digital && instructions ? escape(instructions) : "",
    product.delivery?.returns ? `<strong>Returns and cancellations</strong> ${escape(product.delivery.returns)}` : "",
  ].filter(Boolean);
  const factList = facts.length ? `<ul class="product-facts">${facts.map((fact) => `<li>${fact}</li>`).join("")}</ul>` : "";
  const total = physical ? `<p class="product-total">Total <strong data-product-total>${escape(money((basePrice || 0) + shippingCost))}</strong> <span>including ${escape(money(shippingCost))} shipping</span></p>` : "";
  const address = physical ? `<fieldset class="product-address"><legend>Delivery address</legend>
    <label for="delivery-line1">Address</label><input id="delivery-line1" name="line1" autocomplete="shipping address-line1" maxlength="200" required>
    <label for="delivery-line2">Apartment, suite, etc. (optional)</label><input id="delivery-line2" name="line2" autocomplete="shipping address-line2" maxlength="200">
    <label for="delivery-city">Town or city</label><input id="delivery-city" name="city" autocomplete="shipping address-level2" maxlength="200" required>
    <label for="delivery-region">County, state or region (optional)</label><input id="delivery-region" name="region" autocomplete="shipping address-level1" maxlength="200">
    <label for="delivery-postal">Postal code (where applicable)</label><input id="delivery-postal" name="postalCode" autocomplete="shipping postal-code" maxlength="32">
    <label for="delivery-country">Country</label><select id="delivery-country" name="country" autocomplete="shipping country" required><option value="">Choose country</option>${(product.delivery?.countries || []).map(code => `<option value="${escape(code)}">${escape(new Intl.DisplayNames(["en"], {type:"region"}).of(code) || code)}</option>`).join("")}</select>
  </fieldset>` : "";
  const priceRow = `<div class="product-price-row">${price}${soldOut ? "" : stockLine}</div>`;
  if (unavailable) return `<section class="product-purchase" aria-label="Purchase">${priceRow}<p class="product-unavailable">${unavailable}</p>${factList}</section>`;
  const enquire = enquireHref(product);
  if (enquire) return `<section class="product-purchase" aria-label="Purchase">${priceRow}<a class="product-buy" href="${escape(enquire)}" rel="nofollow">Enquire</a>${factList}</section>`;
  const config = JSON.stringify({ username: product.username, slug: product.slug, expectedAmount: basePrice, expectedCurrency: product.currency, manual, choose, physical, digital, counted, shipping: shippingCost, lowStock: LOW_STOCK_THRESHOLD }).replace(/</g, "\\u003c");
  return `<section class="product-purchase" aria-label="Purchase" data-product-purchase>
    ${priceRow}
    <p class="product-status" data-product-status role="status" aria-live="polite"></p>
    ${product.enabled ? `<div data-product-details>
    <form data-product-checkout>
      ${optionPicker}
      <button class="product-buy" type="button" data-product-start>${manual ? "Request to buy" : "Buy now"}</button>
      <div class="product-step" data-product-step hidden>
      <p class="product-step-title">Your details</p>
      <label for="product-buyer-name">Your name</label><input id="product-buyer-name" name="buyerName" autocomplete="name" maxlength="120" required>
      <label for="product-buyer-email">Email</label><input id="product-buyer-email" name="buyerEmail" type="email" autocomplete="email" maxlength="254" required>
      ${digital ? '<p class="product-help">Your download link is sent to this address.</p>' : ""}
      ${address}
      ${choose ? '<fieldset class="pay-choice" data-pay-choice><legend>How would you like to pay?</legend><label><input type="radio" name="payChoice" value="card" checked><span><strong>Card, Apple Pay or Google Pay</strong><small>Pay now.</small></span></label><label><input type="radio" name="payChoice" value="direct"><span><strong>Pay directly</strong><small>By PayPal, bank transfer or similar. Your order is confirmed once your payment arrives.</small></span></label></fieldset>' : ""}
      ${manual ? '<p class="product-help">Payment is not taken now. We’ll email you the payment details.</p>' : ""}
      ${total}
      <button class="product-buy" type="submit">${manual ? "Request payment details" : digital ? "Buy and download" : "Continue to checkout"}</button>
      </div>
    </form></div>` : '<button class="product-buy" type="button" disabled>Buy now</button><p class="product-help">Checkout is available on your published site.</p>'}
    ${factList}
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
  const step = root.querySelector("[data-product-step]");
  const start = root.querySelector("[data-product-start]");
  // The phone bar comes after this script in the page, so find it when needed.
  const dockButton = () => document.querySelector("[data-product-dock]");
  function money(amount) {
    const code = String(config.expectedCurrency || "").toUpperCase();
    try { return new Intl.NumberFormat("en", { style: "currency", currency: code, minimumFractionDigits: amount % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(amount / 100); }
    catch (error) { return (amount / 100).toFixed(2) + " " + code; }
  }
  let stepOpen = false;
  function openStep(scroll) {
    stepOpen = true;
    if (step) step.hidden = false;
    if (start) start.hidden = true;
    const dock = dockButton();
    if (dock) dock.textContent = button.textContent;
    const first = form.querySelector('[name="buyerName"]');
    if (scroll) root.scrollIntoView({ behavior: "smooth", block: "start" });
    if (first) first.focus({ preventScroll: Boolean(scroll) });
  }
  if (start) start.addEventListener("click", () => openStep(false));
  // Once the details step is open, the phone bar submits it.
  document.addEventListener("click", (event) => {
    if (!event.target || !event.target.closest || !event.target.closest("[data-product-dock]")) return;
    if (stepOpen) form.requestSubmit(); else openStep(true);
  });
  function selectedOption() { return form.querySelector('input[name="optionId"]:checked'); }
  function syncOption() {
    const option = selectedOption();
    if (!option) return;
    config.expectedAmount = Number(option.dataset.price);
    if (priceLabel) priceLabel.textContent = money(config.expectedAmount);
    if (totalLabel) totalLabel.textContent = money(config.expectedAmount + config.shipping);
    const dock = dockButton();
    if (dock && !stepOpen) dock.textContent = "Buy now · " + money(config.expectedAmount);
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
        if (dockButton()) dockButton().hidden = true;
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
    const dock = dockButton();
    if (dock) { dock.disabled = value || completed; dock.hidden = completed; }
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
    const values = new FormData(form);
    const direct = config.choose && values.get("payChoice") === "direct";
    message(config.manual || direct ? "Sending your request…" : "Opening secure checkout…");
    try {
      const returnUrl = new URL(window.location.href);
      returnUrl.searchParams.delete("purchase");
      returnUrl.searchParams.delete("session_id");
      returnUrl.hash = "";
      const result = await post("/api/shop/" + encodeURIComponent(config.username) + "/" + encodeURIComponent(config.slug) + "/order", {
        deliveryAddress: config.physical ? Object.fromEntries(["line1", "line2", "city", "region", "postalCode", "country"].map(key => [key, values.get(key)])) : undefined,
        optionId: values.get("optionId") || undefined,
        buyerName: values.get("buyerName"), buyerEmail: values.get("buyerEmail"), expectedAmount: config.expectedAmount, expectedCurrency: config.expectedCurrency, returnUrl: returnUrl.toString(),
        payDirectly: direct || undefined,
      });
      if (result.paymentMethod === "manual") {
        // A pay-directly order goes on to its own pay page; the email carries the same link.
        if (typeof result.payUrl === "string" && result.payUrl.startsWith("/api/pay/")) {
          window.location.assign(result.payUrl);
          return;
        }
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
    openStep(false);
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
.content.content--product{width:min(1120px,calc(100% - 48px))}
.product{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,.92fr);gap:clamp(32px,5vw,64px);align-items:start}
.product--no-media{grid-template-columns:minmax(0,640px);justify-content:center}
.product__media{position:sticky;top:96px}
.product__media .product-gallery{margin:0}
.product__panel{min-width:0;padding-top:4px}
.product__panel h1{margin:0 0 12px;font-size:clamp(2rem,3.4vw,2.9rem);line-height:1.08;letter-spacing:-.025em}
.product-purchase{margin:0;padding:0;border:0}
.product-price-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:0 0 22px}
.product-price{margin:0;font-size:1.45rem;font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.product-stock{margin:0;padding:3px 10px;border-radius:999px;background:var(--raised,var(--border));color:var(--muted);font-size:.82rem;font-weight:600}
.product-stock:empty{display:none}
.product-stock.is-low{background:color-mix(in srgb,var(--accent) 14%,transparent);color:var(--text)}
.product-unavailable{margin:0 0 18px;font-weight:600}
.product-purchase [hidden]{display:none!important}
.product-buy,.content a.product-buy{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:100%;min-height:52px;padding:12px 24px;border:1px solid var(--accent);border-radius:var(--cta-radius,var(--radius-md));background:var(--accent);color:var(--accent-text,var(--surface));font:inherit;font-family:var(--cta-font,inherit);font-weight:600;cursor:pointer;list-style:none;text-align:center;text-decoration:none;transition:filter .2s ease,transform .2s ease}
.product-buy:hover:not(:disabled){filter:brightness(1.06)}
.product-buy:active:not(:disabled){transform:translateY(1px)}
.product-buy::-webkit-details-marker{display:none}
.product-buy:disabled{opacity:.6;cursor:default}
.product-buy:focus-visible,.product-purchase input:focus-visible,.product-purchase select:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
.product-purchase form{display:grid;gap:12px;margin:0}
.product-step{display:grid;gap:10px;margin-top:10px;padding:20px;border:1px solid var(--border);border-radius:var(--radius,16px);background:var(--surface);animation:product-step-in .3s ease both}
.product-step-title{margin:0 0 2px;font-family:var(--display-font,inherit);font-size:1.15rem;font-weight:600}
.product-purchase label{font-size:.92rem;font-weight:600}
.product-address{display:grid;gap:10px;border:0;padding:0;margin:8px 0 0;min-width:0}.product-address legend{font-weight:600;margin-bottom:10px}
.product-purchase select,.product-purchase input{box-sizing:border-box;width:100%;min-height:48px;padding:12px 14px;border:1px solid var(--border);border-radius:var(--radius-sm,10px);background:var(--bg,var(--surface));color:var(--text);font:inherit}
.product-help{font-size:.88rem;color:var(--muted);margin:0}
.product-total{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px;margin:6px 0 2px;padding-top:12px;border-top:1px solid var(--border)}.product-total strong{font-size:1.15rem;font-variant-numeric:tabular-nums}.product-total span{color:var(--muted);font-size:.88rem}
.product-facts{display:grid;gap:10px;margin:22px 0 0;padding:20px 0 0;border-top:1px solid var(--border);list-style:none;color:var(--muted);font-size:.92rem;line-height:1.5}
.product-facts li{position:relative;padding-left:18px}.product-facts li:before{content:"";position:absolute;left:2px;top:.62em;width:6px;height:6px;border-radius:50%;background:var(--accent)}
.product-facts strong{color:var(--text);font-weight:600}
.pay-choice{display:grid;gap:8px;margin:8px 0;padding:0;border:0;min-width:0}.pay-choice[hidden]{display:none}.pay-choice legend{margin:0 0 8px;padding:0;font-weight:600}.pay-choice label{display:flex;align-items:flex-start;gap:10px;min-height:48px;padding:12px 14px;border:1px solid var(--border);border-radius:14px;cursor:pointer;text-align:left}.pay-choice label:has(input:checked){border-color:var(--text)}.pay-choice input{flex:0 0 auto;width:18px;height:18px;margin:3px 0 0;accent-color:var(--accent)}.pay-choice strong,.pay-choice small{display:block}.pay-choice small{color:var(--muted);font-size:.9rem;line-height:1.4}
.product-options{display:grid;gap:8px;border:0;padding:0;margin:0 0 6px;min-width:0}.product-options legend{font-size:.92rem;font-weight:600;margin-bottom:10px}
.product-option{display:flex;gap:12px;align-items:center;min-height:52px;padding:10px 16px;border:1px solid var(--border);border-radius:var(--radius-sm,12px);background:var(--surface);font-weight:500!important;cursor:pointer;transition:border-color .15s ease,box-shadow .15s ease}
.product-option:has(input:checked){border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}.product-option:has(input:disabled){opacity:.5;cursor:default}
.product-purchase .product-option input{width:18px;height:18px;min-height:0;margin:0;accent-color:var(--accent)}
.product-option-price{margin-left:auto;font-variant-numeric:tabular-nums;color:var(--muted)}.product-option-note{font-size:.82rem;color:var(--muted)}
.product__description{margin-top:28px;padding-top:24px;border-top:1px solid var(--border);font-size:1rem;line-height:1.65}
.product__description>:first-child{margin-top:0}
.product-status:empty{display:none}
.product-status{margin:0 0 16px}.product-status.is-error{font-weight:600}
@keyframes product-step-in{from{transform:translateY(6px)}to{transform:none}}
@media(prefers-reduced-motion:reduce){.product-step{animation:none}}
@media(max-width:760px){
  .content.content--product{width:calc(100% - 40px)}
  .product{grid-template-columns:1fr;gap:22px}
  .product__media{position:static}
  .product__panel h1{font-size:2rem}
  .product-step{padding:16px}
}
`;
