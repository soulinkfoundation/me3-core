export const MAX_PRODUCT_OPTIONS = 12;
/** Show "Only N left" at or below this many. */
export const LOW_STOCK_THRESHOLD = 5;

export type ProductOption = {
  id: string;
  label: string;
  price: number;
  /** Copies of this option, counted from stockSetAt. Blank means unlimited. */
  stock?: number;
};

export type ProductOffer = {
  /** Copies left when the owner last set it. Blank means unlimited. */
  stock?: number;
  /** When stock was last set; paid orders after this reduce it. */
  stockSetAt?: string;
  options?: ProductOption[];
};

const isCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

export function productOfferError(product: ProductOffer): string | null {
  const options = product.options;
  const counted = product.stock !== undefined || (options || []).some((option) => option.stock !== undefined);
  if (product.stock !== undefined && !isCount(product.stock)) return "Copies left must be a whole number, or blank for unlimited.";
  if (counted && (typeof product.stockSetAt !== "string" || Number.isNaN(Date.parse(product.stockSetAt)))) return "Set how many copies are left again.";
  if (options === undefined) return null;
  if (!Array.isArray(options) || options.length > MAX_PRODUCT_OPTIONS) return `Add up to ${MAX_PRODUCT_OPTIONS} options.`;
  const ids = new Set<string>();
  for (const option of options) {
    if (typeof option?.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(option.id) || ids.has(option.id)) return "Each option needs its own name.";
    ids.add(option.id);
    if (typeof option.label !== "string" || !option.label.trim() || option.label.length > 60) return "Name each option (up to 60 characters).";
    if (!Number.isSafeInteger(option.price) || option.price < 50) return `Set a price for ${option.label.trim()}.`;
    if (option.stock !== undefined && !isCount(option.stock)) return `Copies left for ${option.label.trim()} must be a whole number, or blank.`;
  }
  return null;
}

export function productOption<T extends ProductOption>(product: { options?: T[] }, optionId: unknown): T | null {
  if (typeof optionId !== "string") return null;
  return (product.options || []).find((option) => option.id === optionId) || null;
}

/** A stable option id from its label, unique among the ids already taken. */
export function productOptionId(label: string, taken: Iterable<string> = []): string {
  const used = new Set(taken);
  const base = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "option";
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  return id;
}
