// Pay me directly: the owner's saved ways to get paid, and what a buyer is shown for one
// order. Pure functions, shared by the Worker and the apps. Money goes straight to the
// owner; nothing here moves or confirms a payment.
//
// What each method can carry (checked against provider docs 2026-11-16):
// - PayPal   paypal.me/<user>/<amount><CUR>            amount only
// - Revolut  revolut.me/<user>                         nothing; the buyer types the amount
// - Wise     wise.com/pay/business/<name>?amount=&currency=&description=   amount + reference
//            any other wise.com/pay/... link (personal)                    nothing
// - Bank     details shown with the reference; an EPC (SEPA) QR carries amount + reference

export type PaymentMethodKind = "paypal" | "revolut" | "wise" | "bank";

export const PAYMENT_METHOD_KINDS: readonly PaymentMethodKind[] = ["paypal", "revolut", "wise", "bank"];

export type PaymentMethodFields = {
  kind: PaymentMethodKind;
  /** PayPal, Revolut and Wise: the normalised https link. */
  link: string | null;
  accountName: string | null;
  iban: string | null;
  bic: string | null;
  /** UK accounts: six digits. */
  sortCode: string | null;
  /** UK accounts: eight digits. */
  accountNumber: string | null;
  /** Bank accounts only: the one currency this account is offered for. */
  currency: string | null;
};

export type SavedPaymentMethod = PaymentMethodFields & { id: string; enabled: boolean };

export type PaymentMethodParseResult =
  | { ok: true; value: PaymentMethodFields }
  | { ok: false; error: string };

export type PaymentOrder = {
  /** Minor units (cents). Null when the amount is not fixed. */
  amountMinor: number | null;
  currency: string;
  reference: string;
};

export type PaymentOption = {
  methodId: string;
  kind: PaymentMethodKind;
  /** The link to open; null for a bank transfer. */
  url: string | null;
  /** The link or QR fills in the amount for the buyer. */
  carriesAmount: boolean;
  /** The link or QR fills in the reference for the buyer. */
  carriesReference: boolean;
  bank: {
    accountName: string;
    iban: string | null;
    bic: string | null;
    sortCode: string | null;
    accountNumber: string | null;
    currency: string;
  } | null;
  /** Text for a SEPA QR code; only for EUR orders to an IBAN. */
  epcQrPayload: string | null;
};

const LINK_ERRORS: Record<Exclude<PaymentMethodKind, "bank">, string> = {
  paypal: "Paste your PayPal.Me link, like paypal.me/yourname.",
  revolut: "Paste your Revolut link, like revolut.me/yourname.",
  wise: "Paste your Wise payment link. It starts with wise.com/pay/.",
};

const HANDLE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,49}$/;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseUrl(value: string): URL | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.username || url.password || url.port ? null : url;
  } catch {
    return null;
  }
}

/** The normalised link for a pasted link (or, for PayPal and Revolut, a typed name). */
export function normalizePaymentLink(kind: Exclude<PaymentMethodKind, "bank">, input: unknown): string | null {
  const value = text(input, 300);
  if (!value) return null;
  const bare = value.replace(/^@/, "");
  if (kind !== "wise" && HANDLE.test(bare) && !bare.includes(".")) {
    return `https://${kind === "paypal" ? "paypal.me" : "revolut.me"}/${bare}`;
  }
  const url = parseUrl(value);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  if (kind === "paypal") {
    const handle = host === "paypal.me" ? segments[0] : host === "paypal.com" && segments[0]?.toLowerCase() === "paypalme" ? segments[1] : "";
    return handle && HANDLE.test(handle) ? `https://paypal.me/${handle}` : null;
  }
  if (kind === "revolut") {
    return host === "revolut.me" && segments.length === 1 && HANDLE.test(segments[0]) ? `https://revolut.me/${segments[0]}` : null;
  }
  if (host !== "wise.com" || segments[0] !== "pay" || segments.length < 2 || segments.length > 4) return null;
  if (!segments.every((segment) => /^[A-Za-z0-9._~-]{1,80}$/.test(segment))) return null;
  return `https://wise.com/${segments.join("/")}`;
}

export function normalizeIban(input: unknown): string {
  return text(input, 60).replace(/[\s-]/g, "").toUpperCase();
}

/** ISO 13616 mod-97 check. */
export function isValidIban(input: unknown): boolean {
  const iban = normalizeIban(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const digits = char >= "A" ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** Checks what the owner typed and returns the fields to store, or a plain message. */
export function parsePaymentMethodInput(kind: unknown, body: Record<string, unknown>): PaymentMethodParseResult {
  if (!PAYMENT_METHOD_KINDS.includes(kind as PaymentMethodKind)) {
    return { ok: false, error: "Choose PayPal, Revolut, Wise or bank transfer." };
  }
  const empty = { link: null, accountName: null, iban: null, bic: null, sortCode: null, accountNumber: null, currency: null };
  if (kind !== "bank") {
    const linkKind = kind as Exclude<PaymentMethodKind, "bank">;
    const link = normalizePaymentLink(linkKind, body.link);
    return link ? { ok: true, value: { ...empty, kind: linkKind, link } } : { ok: false, error: LINK_ERRORS[linkKind] };
  }

  const accountName = text(body.accountName, 70);
  if (!accountName) return { ok: false, error: "Add the name on the account." };
  const iban = normalizeIban(body.iban);
  const sortCode = text(body.sortCode, 20).replace(/[\s-]/g, "");
  const accountNumber = text(body.accountNumber, 20).replace(/[\s-]/g, "");
  const currencyInput = text(body.currency, 10).toUpperCase();
  if (currencyInput && !/^[A-Z]{3}$/.test(currencyInput)) {
    return { ok: false, error: "Use a three-letter currency code, like EUR." };
  }
  if (iban) {
    if (sortCode || accountNumber) return { ok: false, error: "Add either an IBAN, or a sort code and account number." };
    if (!isValidIban(iban)) return { ok: false, error: "That IBAN does not look right. Check it and try again." };
    const bic = text(body.bic, 20).replace(/\s/g, "").toUpperCase();
    if (bic && !/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) {
      return { ok: false, error: "That BIC does not look right. It has 8 or 11 letters and numbers." };
    }
    return { ok: true, value: { ...empty, kind: "bank", accountName, iban, bic: bic || null, currency: currencyInput || "EUR" } };
  }
  if (!sortCode && !accountNumber) return { ok: false, error: "Add an IBAN, or a UK sort code and account number." };
  if (!/^\d{6}$/.test(sortCode)) return { ok: false, error: "A sort code has 6 digits." };
  if (!/^\d{8}$/.test(accountNumber)) return { ok: false, error: "A UK account number has 8 digits." };
  if (currencyInput && currencyInput !== "GBP") return { ok: false, error: "A sort code and account number can only take GBP." };
  return { ok: true, value: { ...empty, kind: "bank", accountName, sortCode, accountNumber, currency: "GBP" } };
}

function hasAmount(amountMinor: number | null | undefined): amountMinor is number {
  return typeof amountMinor === "number" && Number.isSafeInteger(amountMinor) && amountMinor > 0;
}

/** "60" for a whole amount (the form PayPal documents), otherwise "60.50". */
export function formatPayAmount(amountMinor: number): string {
  return amountMinor % 100 === 0 ? String(amountMinor / 100) : (amountMinor / 100).toFixed(2);
}

/** PayPal carries the amount only: <link>/<amount><CUR>. */
export function buildPayPalLink(link: string, amountMinor: number | null, currency: string): string {
  return hasAmount(amountMinor) ? `${link}/${formatPayAmount(amountMinor)}${currency.toUpperCase()}` : link;
}

export function isWiseBusinessLink(link: string): boolean {
  return link.startsWith("https://wise.com/pay/business/");
}

/** A Wise Business link takes amount, currency and reference. Any other Wise link is used as saved. */
export function buildWiseLink(link: string, amountMinor: number | null, currency: string, reference: string): string {
  if (!isWiseBusinessLink(link)) return link;
  const params = new URLSearchParams();
  if (hasAmount(amountMinor)) params.set("amount", formatPayAmount(amountMinor));
  params.set("currency", currency.toUpperCase());
  params.set("description", reference);
  return `${link}?${params.toString()}`;
}

/** EPC069-12 (SEPA credit transfer) QR text. Null unless the order is in EUR and the account is an IBAN. */
export function buildEpcQrPayload(input: {
  accountName: string | null;
  iban: string | null;
  bic: string | null;
  amountMinor: number | null;
  currency: string;
  reference: string;
}): string | null {
  if (input.currency.toUpperCase() !== "EUR" || !input.iban || !input.accountName) return null;
  if (hasAmount(input.amountMinor) && input.amountMinor > 99_999_999_999) return null;
  const line = (value: string, max: number) => value.replace(/[\r\n]+/g, " ").trim().slice(0, max);
  return [
    "BCD",
    "002",
    "1",
    "SCT",
    input.bic || "",
    line(input.accountName, 70),
    input.iban,
    hasAmount(input.amountMinor) ? `EUR${(input.amountMinor / 100).toFixed(2)}` : "",
    "",
    "",
    line(input.reference, 140),
  ].join("\n");
}

function offeredFor(method: SavedPaymentMethod, currency: string): boolean {
  if (!method.enabled) return false;
  if (method.kind !== "bank") return Boolean(method.link);
  return Boolean(method.accountName) && (method.currency || "").toUpperCase() === currency.toUpperCase();
}

/** True when at least one switched-on method can take an order in this currency. */
export function methodsCoverCurrency(methods: SavedPaymentMethod[], currency: string | null | undefined): boolean {
  const code = (currency || "").toUpperCase();
  return methods.some((method) => offeredFor(method, code));
}

/** What to show the buyer for one order, in the owner's saved order. */
export function buildPaymentOptions(methods: SavedPaymentMethod[], order: PaymentOrder): PaymentOption[] {
  const currency = order.currency.toUpperCase();
  const amount = hasAmount(order.amountMinor) ? order.amountMinor : null;
  return methods.filter((method) => offeredFor(method, currency)).map((method): PaymentOption => {
    const base = { methodId: method.id, kind: method.kind, bank: null, epcQrPayload: null };
    if (method.kind === "paypal") {
      return { ...base, url: buildPayPalLink(method.link!, amount, currency), carriesAmount: amount !== null, carriesReference: false };
    }
    if (method.kind === "revolut") {
      return { ...base, url: method.link!, carriesAmount: false, carriesReference: false };
    }
    if (method.kind === "wise") {
      const business = isWiseBusinessLink(method.link!);
      return {
        ...base,
        url: buildWiseLink(method.link!, amount, currency, order.reference),
        carriesAmount: business && amount !== null,
        carriesReference: business,
      };
    }
    const epcQrPayload = buildEpcQrPayload({ accountName: method.accountName, iban: method.iban, bic: method.bic, amountMinor: amount, currency, reference: order.reference });
    return {
      ...base,
      url: null,
      carriesAmount: Boolean(epcQrPayload) && amount !== null,
      carriesReference: Boolean(epcQrPayload),
      bank: {
        accountName: method.accountName!,
        iban: method.iban,
        bic: method.bic,
        sortCode: method.sortCode,
        accountNumber: method.accountNumber,
        currency,
      },
      epcQrPayload,
    };
  });
}

const LINK_LABELS: Record<Exclude<PaymentMethodKind, "bank">, string> = { paypal: "PayPal", revolut: "Revolut", wise: "Wise" };

/** "PayPal", "Revolut", "Wise" or "Bank transfer". */
export function paymentMethodName(kind: PaymentMethodKind): string {
  return kind === "bank" ? "Bank transfer" : LINK_LABELS[kind];
}

/**
 * What tapping a PayPal, Revolut or Wise button does for the buyer, true to what the link
 * carries: only some fill in the amount, and only Wise Business fills in the reference.
 */
export function paymentOptionHint(
  option: Pick<PaymentOption, "kind" | "carriesAmount" | "carriesReference">,
  amount: string,
): string {
  const name = paymentMethodName(option.kind);
  if (option.carriesAmount && option.carriesReference) return `Opens ${name} with ${amount} and the reference filled in.`;
  if (option.carriesAmount) return `Opens ${name} with ${amount} filled in. Add the reference as a note if you can.`;
  return `Opens ${name}. Enter ${amount} and add the reference.`;
}

/** The options as plain text, for emails. Empty when there is nothing to offer. */
export function paymentOptionsText(options: PaymentOption[], reference: string): string {
  if (!options.length) return "";
  const blocks = options.map((option) => {
    if (option.kind !== "bank" || !option.bank) return `${LINK_LABELS[option.kind as Exclude<PaymentMethodKind, "bank">]}: ${option.url}`;
    return [
      "Bank transfer",
      `Account name: ${option.bank.accountName}`,
      ...(option.bank.iban ? [`IBAN: ${option.bank.iban}`] : []),
      ...(option.bank.bic ? [`BIC: ${option.bank.bic}`] : []),
      ...(option.bank.sortCode ? [`Sort code: ${option.bank.sortCode}`] : []),
      ...(option.bank.accountNumber ? [`Account number: ${option.bank.accountNumber}`] : []),
      `Reference: ${reference}`,
    ].join("\n");
  });
  return [`Your payment reference is ${reference}. Add it to your payment if you can.`, ...blocks].join("\n\n");
}

/** No 0, O, 1 or I, so a reference survives being read aloud or retyped. */
export const PAYMENT_REFERENCE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function randomPaymentReference(length = 4): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += PAYMENT_REFERENCE_ALPHABET[byte % PAYMENT_REFERENCE_ALPHABET.length];
  return `ME3-${code}`;
}

// ---------------------------------------------------------------------------
// Holding, reminding and releasing unpaid pay-directly orders and bookings.

export const PAY_DIRECTLY_DEFAULT_REMIND_DAYS = 2;
export const PAY_DIRECTLY_DEFAULT_RELEASE_DAYS = 5;
/** After "I've paid" nothing is released automatically; this long later the owner is asked to decide. */
export const PAY_DIRECTLY_SAYS_PAID_PAUSE_DAYS = 3;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type PayDirectlyHoldSettings = { remindAfterDays: number; releaseAfterDays: number };

/** Remind after 1 to 14 days, release after 2 to 30, and always remind before releasing. */
export function parsePayDirectlyHoldSettings(
  input: { remindAfterDays?: unknown; releaseAfterDays?: unknown },
  current: PayDirectlyHoldSettings,
): { ok: true; value: PayDirectlyHoldSettings } | { ok: false; error: string } {
  const whole = (value: unknown, fallback: number) => (value === undefined || value === null ? fallback : value);
  const remindAfterDays = whole(input.remindAfterDays, current.remindAfterDays);
  const releaseAfterDays = whole(input.releaseAfterDays, current.releaseAfterDays);
  if (typeof remindAfterDays !== "number" || !Number.isInteger(remindAfterDays) || remindAfterDays < 1 || remindAfterDays > 14) {
    return { ok: false, error: "Remind buyers after 1 to 14 days." };
  }
  if (typeof releaseAfterDays !== "number" || !Number.isInteger(releaseAfterDays) || releaseAfterDays < 2 || releaseAfterDays > 30) {
    return { ok: false, error: "Release unpaid bookings after 2 to 30 days." };
  }
  if (remindAfterDays >= releaseAfterDays) return { ok: false, error: "Remind buyers before the booking is released." };
  return { ok: true, value: { remindAfterDays, releaseAfterDays } };
}

export type PayDirectlyTimeline = {
  /** When the buyer gets their one reminder. */
  remindAtMs: number;
  /** When the owner is warned that release is coming (a day before, less for a short hold). */
  warnOwnerAtMs: number;
  /** When an unpaid order or booking is released. Always before a booking starts. */
  releaseAtMs: number;
};

/**
 * When to remind, warn and release, counted from when the hold began. A booking that starts
 * sooner than the release setting is released a day before it starts (or halfway to the start
 * for a very late booking), and the reminder moves earlier in proportion.
 */
export function payDirectlyTimeline(input: {
  heldFromMs: number;
  /** A booking's start; null for a product order. */
  startsAtMs: number | null;
  remindAfterDays: number;
  releaseAfterDays: number;
}): PayDirectlyTimeline {
  const full = input.releaseAfterDays * DAY_MS;
  let releaseAtMs = input.heldFromMs + full;
  if (input.startsAtMs !== null && input.startsAtMs > input.heldFromMs) {
    const lead = input.startsAtMs - input.heldFromMs;
    releaseAtMs = Math.min(releaseAtMs, Math.max(input.startsAtMs - DAY_MS, input.heldFromMs + lead / 2));
  }
  const window = releaseAtMs - input.heldFromMs;
  return {
    remindAtMs: input.heldFromMs + Math.round(window * (input.remindAfterDays / input.releaseAfterDays)),
    warnOwnerAtMs: releaseAtMs - payDirectlyWarningLeadMs(window),
    releaseAtMs,
  };
}

/** How long before release the owner is warned: a day, or a third of a hold shorter than three days. */
export function payDirectlyWarningLeadMs(windowMs: number): number {
  return Math.min(DAY_MS, Math.round(windowMs / 3));
}

/** After "I've paid": when the owner is asked to confirm or release. Before a booking starts. */
export function payDirectlyDecideAtMs(input: { saysPaidAtMs: number; startsAtMs: number | null }): number {
  const pause = input.saysPaidAtMs + PAY_DIRECTLY_SAYS_PAID_PAUSE_DAYS * DAY_MS;
  if (input.startsAtMs === null || input.startsAtMs <= input.saysPaidAtMs) return pause;
  const lead = input.startsAtMs - input.saysPaidAtMs;
  return Math.min(pause, Math.max(input.startsAtMs - DAY_MS, input.saysPaidAtMs + lead / 2));
}

// ---------------------------------------------------------------------------
// "Let them choose": a card offer whose buyer may pay the owner directly instead.

/**
 * The flag sits beside paymentMethod: pricing.allowPayDirectly on a booking offer, allowPayDirectly
 * on a product. paymentMethod stays "stripe", so anything that does not know the flag (older apps,
 * buying agents) sees an ordinary card offer. It means nothing on a "manual" offer.
 */
export function buyerMayPayDirectly(
  offer: { paymentMethod?: unknown; allowPayDirectly?: unknown } | null | undefined,
): boolean {
  return Boolean(offer) && offer!.paymentMethod !== "manual" && offer!.allowPayDirectly === true;
}

/** The same offer as this buyer chose to pay it: directly, when they asked to and the offer allows it. */
export function forBuyersPaymentChoice<T extends { paymentMethod?: "stripe" | "manual"; allowPayDirectly?: boolean }>(
  offer: T,
  payDirectly: unknown,
): T {
  return payDirectly === true && buyerMayPayDirectly(offer) ? { ...offer, paymentMethod: "manual" } : offer;
}
