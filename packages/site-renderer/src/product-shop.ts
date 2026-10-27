import { externalShopLabel, externalShopUrl, type ProductDelivery } from "./product-delivery.js";
import { LOW_STOCK_THRESHOLD, type ProductOption } from "./product-offer.js";

export type ShopProduct = {
  slug?: string;
  title?: string;
  price?: number;
  currency?: string;
  images?: string[];
  available?: boolean;
  delivery?: ProductDelivery;
  stock?: number;
  stockSetAt?: string;
  options?: ProductOption[];
};

const PHOTO_PATH = /^files\/[a-z0-9][a-z0-9._/-]*\.(?:jpe?g|png|webp|gif|avif)$/i;

function escape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Product photos as site-relative paths; anything else is dropped. */
export function productPhotoPaths(product: Pick<ShopProduct, "images">): string[] {
  return (product.images || [])
    .map((path) => (typeof path === "string" ? path.trim().replace(/^\.?\//, "") : ""))
    .filter((path) => PHOTO_PATH.test(path) && !path.split("/").includes(".."))
    .slice(0, 20);
}

export function formatMoney(amount: number, currency = ""): string {
  return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`.trim();
}

/** Copies left as published, or null when unlimited. Live counts replace this in the browser. */
export function publishedStock(product: ShopProduct): number | null {
  const options = product.options || [];
  if (options.length) {
    if (!options.some((option) => option.stock !== undefined)) return null;
    if (options.some((option) => option.stock === undefined)) return null;
    return options.reduce((total, option) => total + (option.stock || 0), 0);
  }
  return Number.isSafeInteger(product.stock) ? product.stock! : null;
}

export function formatFileSize(bytes: number): string {
  // Decimal units, as Finder and Explorer show them.
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1).replace(/\.0$/, "")} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

export function downloadSummary(delivery: ProductDelivery | undefined): string {
  const file = delivery?.kind === "digital" ? delivery.file : undefined;
  if (!file) return "";
  const extension = file.name.split(".").pop()?.toUpperCase() || "File";
  return `${extension} · ${formatFileSize(file.size)}`;
}

/** One short tag that says how buyers get it. */
function shopCardTag(product: ShopProduct): { text: string; urgent: boolean } | null {
  if (product.available === false) return { text: "Unavailable", urgent: false };
  if (product.delivery?.kind === "external") {
    const host = externalShopUrl(product.delivery.url)?.hostname.replace(/^www\./, "");
    return host ? { text: host, urgent: false } : null;
  }
  const stock = publishedStock(product);
  if (stock === 0) return { text: "Sold out", urgent: false };
  if (stock !== null && stock <= LOW_STOCK_THRESHOLD) return { text: `${stock} left`, urgent: true };
  if ((product.options || []).length > 1) return { text: `${product.options!.length} options`, urgent: false };
  if (product.delivery?.kind === "digital") return { text: "Instant download", urgent: false };
  return null;
}

export function shopCardPrice(product: ShopProduct): string {
  const prices = (product.options || []).map((option) => option.price).filter((price) => Number.isFinite(price));
  if (prices.length) {
    const lowest = Math.min(...prices);
    return `${prices.some((price) => price !== lowest) ? "from " : ""}${formatMoney(lowest, product.currency || "USD")}`;
  }
  return typeof product.price === "number" && Number.isFinite(product.price) ? formatMoney(product.price, product.currency || "USD") : "";
}

export function renderShopCard(product: ShopProduct, options: { slug: string; title: string; excerpt: string; basePath: string }): string {
  const cover = productPhotoPaths(product)[0];
  const tag = shopCardTag(product);
  const price = shopCardPrice(product);
  return `<a class="shop-item${cover ? " shop-item--with-cover" : ""}" href="./${escape(options.slug)}" data-shop-item="${escape(product.slug || "")}">`
    + (cover ? `<img class="shop-item-cover" src="${escape(options.basePath + cover)}" alt="" loading="lazy" decoding="async">` : "")
    + `<div class="shop-item-title">${escape(options.title)}</div>`
    + (price ? `<div class="shop-item-price">${escape(price)}</div>` : "")
    + (!cover && options.excerpt ? `<div class="shop-item-excerpt">${escape(options.excerpt)}</div>` : "")
    + (tag ? `<span class="shop-item-tag${tag.urgent ? " is-urgent" : ""}" data-shop-tag>${escape(tag.text)}</span>` : "")
    + `</a>`;
}

export function renderProductGallery(product: ShopProduct, title: string, basePath: string): string {
  const photos = productPhotoPaths(product);
  if (!photos.length) return "";
  const main = `<img class="product-gallery-main" src="${escape(basePath + photos[0])}" alt="${escape(title)}" data-product-gallery-main decoding="async">`;
  const thumbs = photos.length > 1
    ? `<div class="product-gallery-thumbs">${photos.map((photo, index) => `<button type="button" class="product-gallery-thumb" aria-label="Photo ${index + 1} of ${photos.length}" aria-pressed="${index === 0}" data-src="${escape(basePath + photo)}"><img src="${escape(basePath + photo)}" alt="" loading="lazy" decoding="async"></button>`).join("")}</div>`
      + `<script>(function(){var root=document.currentScript.closest("[data-product-gallery]");var main=root.querySelector("[data-product-gallery-main]");root.querySelectorAll(".product-gallery-thumb").forEach(function(button){button.addEventListener("click",function(){main.src=button.dataset.src;root.querySelectorAll(".product-gallery-thumb").forEach(function(other){other.setAttribute("aria-pressed",String(other===button))});});});})();</script>`
    : "";
  return `<div class="product-gallery" data-product-gallery>${main}${thumbs}</div>`;
}

/** Live copies-left for every product on a shop page, so published counts never oversell. */
export function renderShopAvailabilityScript(username: string): string {
  if (!username) return "";
  const config = JSON.stringify({ username }).replace(/</g, "\\u003c");
  return `<script>(function(config){fetch("/api/shop/"+encodeURIComponent(config.username)+"/availability").then(function(r){return r.ok?r.json():null}).then(function(data){if(!data||!data.products)return;document.querySelectorAll("[data-shop-item]").forEach(function(card){var info=data.products[card.dataset.shopItem];if(!info||info.remaining===null||info.remaining===undefined)return;var tag=card.querySelector("[data-shop-tag]");if(!tag){tag=document.createElement("span");tag.className="shop-item-tag";tag.setAttribute("data-shop-tag","");card.appendChild(tag);}if(info.remaining===0){tag.textContent="Sold out";tag.classList.remove("is-urgent");}else if(info.remaining<=${LOW_STOCK_THRESHOLD}){tag.textContent=info.remaining+" left";tag.classList.add("is-urgent");}});}).catch(function(){});})(${config});</script>`;
}

export { externalShopLabel };

export const productShopCss = `
.shop-items{grid-template-columns:repeat(auto-fill,minmax(min(100%,180px),1fr))}
.shop-item{align-content:start;position:relative}
.shop-item--with-cover{padding:0 0 14px;overflow:hidden}
.shop-item--with-cover>:not(.shop-item-cover){margin-inline:14px}
.shop-item-cover{display:block;width:100%;aspect-ratio:4/5;object-fit:cover;background:var(--border)}
.shop-item-price{color:var(--muted)}
.shop-item-tag{justify-self:start;font-size:.8rem;padding:2px 9px;border-radius:999px;border:1px solid var(--border);color:var(--muted)}
.shop-item-tag.is-urgent{font-weight:700;color:var(--text);border-color:currentColor}
.product-gallery{display:grid;gap:10px;margin:0 0 24px}
.product-gallery-main{display:block;width:100%;max-height:72vh;object-fit:contain;border-radius:var(--radius-md);background:var(--border)}
.product-gallery-thumbs{display:flex;gap:8px;overflow-x:auto}
.product-gallery-thumb{flex:none;width:64px;height:64px;padding:0;border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;background:none;cursor:pointer}
.product-gallery-thumb[aria-pressed="true"]{outline:2px solid var(--text);outline-offset:2px}
.product-gallery-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.product-gallery-thumb:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
`;
