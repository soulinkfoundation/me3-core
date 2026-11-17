import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildEpcQrPayload,
  buildPayPalLink,
  buildPaymentOptions,
  buildWiseLink,
  methodsCoverCurrency,
  parsePaymentMethodInput,
  paymentOptionsText,
  type SavedPaymentMethod,
} from "../../../shared/pay-directly";
import {
  PAY_DIRECTLY_SCHEMA,
  PayDirectlyInputError,
  createPaymentMethod,
  deletePaymentMethod,
  ensurePaymentReference,
  listPaymentMethods,
  manualPaymentAvailable,
  prepareDirectPayment,
  updatePaymentMethod,
} from "./pay-directly";
import { Hono } from "hono";
import { getProfileCommercePublishBlockReason } from "./commerce-readiness";
import { registerCommerceRoutes } from "./routes/commerce";
import type { Env } from "./types";

// Failure modes: a link to a look-alike host (paypal.me.evil.test) is saved and buyers are
// sent to it; a pasted PayPal link that already ends in an amount keeps that amount; a Wise
// link is built from a typed name; an IBAN with a typo or a short sort code is saved; a UK
// account is saved in a currency other than GBP; the PayPal amount loses its cents or the
// Wise link drops the reference; a personal Wise link gets query parameters it ignores; a
// bank account is offered for an order in another currency; the EPC QR is built for a
// non-EUR order or a UK account; a switched-off method is still offered; two orders (or an
// order and a booking) get the same reference; asking twice for the same order makes a
// second reference; one owner edits or removes another owner's method; an offer with
// neither a note nor a usable saved method publishes or takes orders; an offer with a note
// changes behaviour once saved methods exist.

const method = (input: Partial<SavedPaymentMethod> & Pick<SavedPaymentMethod, "id" | "kind">): SavedPaymentMethod => ({
  enabled: true,
  link: null,
  accountName: null,
  iban: null,
  bic: null,
  sortCode: null,
  accountNumber: null,
  currency: null,
  ...input,
});

const paypal = method({ id: "pp", kind: "paypal", link: "https://paypal.me/kieran" });
const revolut = method({ id: "rv", kind: "revolut", link: "https://revolut.me/kieran" });
const wiseBusiness = method({ id: "wb", kind: "wise", link: "https://wise.com/pay/business/kieranltd" });
const wisePersonal = method({ id: "wp", kind: "wise", link: "https://wise.com/pay/me/kieranb12" });
const eurBank = method({ id: "eur", kind: "bank", accountName: "Kieran Butler", iban: "IE29AIBK93115212345678", bic: "AIBKIE2D", currency: "EUR" });
const gbpBank = method({ id: "gbp", kind: "bank", accountName: "Kieran Butler", sortCode: "401234", accountNumber: "12345678", currency: "GBP" });

describe("saved payment method validation", () => {
  it("normalises pasted links and typed names", () => {
    expect(parsePaymentMethodInput("paypal", { link: " http://www.PayPal.me/Kieran/25EUR?x=1 " })).toMatchObject({ ok: true, value: { link: "https://paypal.me/Kieran" } });
    expect(parsePaymentMethodInput("paypal", { link: "https://www.paypal.com/paypalme/kieran" })).toMatchObject({ ok: true, value: { link: "https://paypal.me/kieran" } });
    expect(parsePaymentMethodInput("paypal", { link: "@kieran" })).toMatchObject({ ok: true, value: { link: "https://paypal.me/kieran" } });
    expect(parsePaymentMethodInput("revolut", { link: "revolut.me/kieran?currency=EUR" })).toMatchObject({ ok: true, value: { link: "https://revolut.me/kieran" } });
    expect(parsePaymentMethodInput("wise", { link: "https://www.wise.com/pay/business/kieranltd?amount=5" })).toMatchObject({ ok: true, value: { link: "https://wise.com/pay/business/kieranltd" } });
    expect(parsePaymentMethodInput("wise", { link: "wise.com/pay/me/kieranb12" })).toMatchObject({ ok: true, value: { link: "https://wise.com/pay/me/kieranb12" } });
  });

  it("refuses links on the wrong host with a plain message", () => {
    for (const [kind, link] of [
      ["paypal", "https://paypal.me.evil.test/kieran"],
      ["paypal", "https://evil.test/paypal.me/kieran"],
      ["paypal", "https://revolut.me/kieran"],
      ["revolut", "https://paypal.me/kieran"],
      ["revolut", "javascript:alert(1)"],
      ["wise", "https://wise.com/invite/abc"],
      ["wise", "https://wise.com.evil.test/pay/business/kieran"],
      ["wise", "kieranb12"],
      ["paypal", ""],
    ] as const) {
      const result = parsePaymentMethodInput(kind, { link });
      expect(result, `${kind} ${link}`).toMatchObject({ ok: false });
      if (!result.ok) expect(result.error).toMatch(/link|Wise/);
    }
    expect(parsePaymentMethodInput("stripe", { link: "x" })).toMatchObject({ ok: false });
  });

  it("checks bank details", () => {
    expect(parsePaymentMethodInput("bank", { accountName: "Kieran Butler", iban: "ie29 aibk 9311 5212 3456 78", bic: "aibkie2d" })).toEqual({
      ok: true,
      value: { kind: "bank", link: null, accountName: "Kieran Butler", iban: "IE29AIBK93115212345678", bic: "AIBKIE2D", sortCode: null, accountNumber: null, currency: "EUR" },
    });
    expect(parsePaymentMethodInput("bank", { accountName: "K B", iban: "GB82WEST12345698765432", currency: "gbp" })).toMatchObject({ ok: true, value: { currency: "GBP", bic: null } });
    expect(parsePaymentMethodInput("bank", { accountName: "K B", sortCode: "40-12-34", accountNumber: "1234 5678" })).toMatchObject({
      ok: true,
      value: { sortCode: "401234", accountNumber: "12345678", currency: "GBP", iban: null },
    });
    const refused = (body: Record<string, unknown>, message: RegExp) => {
      const result = parsePaymentMethodInput("bank", body);
      expect(result).toMatchObject({ ok: false });
      if (!result.ok) expect(result.error).toMatch(message);
    };
    refused({ accountName: "K B", iban: "IE29AIBK93115212345679" }, /IBAN/);
    refused({ accountName: "K B", iban: "IE29" }, /IBAN/);
    refused({ accountName: "K B", iban: "IE29AIBK93115212345678", bic: "NOPE" }, /BIC/);
    refused({ accountName: "K B", sortCode: "40123", accountNumber: "12345678" }, /sort code/i);
    refused({ accountName: "K B", sortCode: "401234", accountNumber: "1234567" }, /account number/i);
    refused({ accountName: "K B", sortCode: "401234", accountNumber: "12345678", currency: "EUR" }, /GBP/);
    refused({ accountName: "", iban: "IE29AIBK93115212345678" }, /name/i);
    refused({ accountName: "K B" }, /IBAN|sort code/i);
    refused({ accountName: "K B", iban: "IE29AIBK93115212345678", currency: "EURO" }, /currency/i);
  });
});

describe("building what the buyer sees", () => {
  it("puts only the amount in a PayPal link", () => {
    expect(buildPayPalLink("https://paypal.me/kieran", 6000, "eur")).toBe("https://paypal.me/kieran/60EUR");
    expect(buildPayPalLink("https://paypal.me/kieran", 6050, "EUR")).toBe("https://paypal.me/kieran/60.50EUR");
    expect(buildPayPalLink("https://paypal.me/kieran", 5, "GBP")).toBe("https://paypal.me/kieran/0.05GBP");
    expect(buildPayPalLink("https://paypal.me/kieran", null, "EUR")).toBe("https://paypal.me/kieran");
  });

  it("adds amount, currency and reference to a Wise Business link only", () => {
    expect(buildWiseLink("https://wise.com/pay/business/kieranltd", 6050, "eur", "ME3-7K2P"))
      .toBe("https://wise.com/pay/business/kieranltd?amount=60.50&currency=EUR&description=ME3-7K2P");
    expect(buildWiseLink("https://wise.com/pay/business/kieranltd", null, "EUR", "ME3-7K2P"))
      .toBe("https://wise.com/pay/business/kieranltd?currency=EUR&description=ME3-7K2P");
    expect(buildWiseLink("https://wise.com/pay/me/kieranb12", 6050, "EUR", "ME3-7K2P")).toBe("https://wise.com/pay/me/kieranb12");
  });

  it("builds the EPC QR payload for EUR orders to an IBAN only", () => {
    expect(buildEpcQrPayload({ accountName: "Kieran Butler", iban: "IE29AIBK93115212345678", bic: "AIBKIE2D", amountMinor: 6000, currency: "EUR", reference: "ME3-7K2P" }))
      .toBe("BCD\n002\n1\nSCT\nAIBKIE2D\nKieran Butler\nIE29AIBK93115212345678\nEUR60.00\n\n\nME3-7K2P");
    expect(buildEpcQrPayload({ accountName: "Kieran Butler", iban: "IE29AIBK93115212345678", bic: null, amountMinor: 1, currency: "eur", reference: "ME3-7K2P" }))
      .toBe("BCD\n002\n1\nSCT\n\nKieran Butler\nIE29AIBK93115212345678\nEUR0.01\n\n\nME3-7K2P");
    expect(buildEpcQrPayload({ accountName: "Kieran Butler", iban: "GB82WEST12345698765432", bic: null, amountMinor: 6000, currency: "GBP", reference: "ME3-7K2P" })).toBeNull();
    expect(buildEpcQrPayload({ accountName: "Kieran Butler", iban: null, bic: null, amountMinor: 6000, currency: "EUR", reference: "ME3-7K2P" })).toBeNull();
    expect(buildEpcQrPayload({ accountName: "Kieran Butler", iban: "IE29AIBK93115212345678", bic: null, amountMinor: 100_000_000_000, currency: "EUR", reference: "ME3-7K2P" })).toBeNull();
  });

  it("offers a bank account only for orders in its currency and skips methods that are off", () => {
    const methods = [paypal, revolut, wiseBusiness, wisePersonal, eurBank, gbpBank, method({ id: "off", kind: "paypal", link: "https://paypal.me/old", enabled: false })];
    const eur = buildPaymentOptions(methods, { amountMinor: 6000, currency: "EUR", reference: "ME3-7K2P" });
    expect(eur.map((option) => option.methodId)).toEqual(["pp", "rv", "wb", "wp", "eur"]);
    expect(eur[0]).toMatchObject({ kind: "paypal", url: "https://paypal.me/kieran/60EUR", carriesAmount: true, carriesReference: false, bank: null, epcQrPayload: null });
    expect(eur[1]).toMatchObject({ url: "https://revolut.me/kieran", carriesAmount: false, carriesReference: false });
    expect(eur[2]).toMatchObject({ url: "https://wise.com/pay/business/kieranltd?amount=60&currency=EUR&description=ME3-7K2P", carriesAmount: true, carriesReference: true });
    expect(eur[3]).toMatchObject({ url: "https://wise.com/pay/me/kieranb12", carriesAmount: false, carriesReference: false });
    expect(eur[4]).toMatchObject({ kind: "bank", url: null, carriesReference: true, bank: { accountName: "Kieran Butler", iban: "IE29AIBK93115212345678", bic: "AIBKIE2D", currency: "EUR" } });
    expect(eur[4].epcQrPayload).toContain("EUR60.00");

    const gbp = buildPaymentOptions(methods, { amountMinor: 6000, currency: "gbp", reference: "ME3-7K2P" });
    expect(gbp.map((option) => option.methodId)).toEqual(["pp", "rv", "wb", "wp", "gbp"]);
    expect(gbp[4]).toMatchObject({ bank: { sortCode: "401234", accountNumber: "12345678" }, epcQrPayload: null, carriesReference: false });

    expect(buildPaymentOptions(methods, { amountMinor: 6000, currency: "USD", reference: "ME3-7K2P" }).map((option) => option.kind))
      .toEqual(["paypal", "revolut", "wise", "wise"]);
    expect(methodsCoverCurrency([eurBank, gbpBank], "USD")).toBe(false);
    expect(methodsCoverCurrency([eurBank], "eur")).toBe(true);
    expect(methodsCoverCurrency([{ ...paypal, enabled: false }], "EUR")).toBe(false);
    expect(methodsCoverCurrency([paypal], "USD")).toBe(true);
  });

  it("writes the options as plain text with the reference", () => {
    const text = paymentOptionsText(buildPaymentOptions([paypal, eurBank], { amountMinor: 6000, currency: "EUR", reference: "ME3-7K2P" }), "ME3-7K2P");
    expect(text).toContain("ME3-7K2P");
    expect(text).toContain("PayPal: https://paypal.me/kieran/60EUR");
    expect(text).toContain("IBAN: IE29AIBK93115212345678");
    expect(text).toContain("BIC: AIBKIE2D");
    expect(paymentOptionsText([], "ME3-7K2P")).toBe("");
  });
});

const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach((db) => db.close()); });

function fixture() {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  raw.exec(readFileSync(new URL("../migrations/0001_initial_public_schema.sql", import.meta.url), "utf8"));
  raw.exec("CREATE TABLE IF NOT EXISTS commerce_orders (id TEXT PRIMARY KEY, site_id TEXT NOT NULL)");
  raw.exec(readFileSync(new URL("../migrations/0108_pay_directly.sql", import.meta.url), "utf8"));
  for (const sql of PAY_DIRECTLY_SCHEMA) raw.exec(sql);
  raw.exec(`INSERT INTO owner_profile(id, email) VALUES('owner', 'me@owner.test'), ('other', 'other@owner.test');
    INSERT INTO sites(id, user_id, username) VALUES('site', 'owner', 'owner');
    INSERT INTO commerce_orders(id, site_id) VALUES('order-1', 'site'), ('order-2', 'site');
    INSERT INTO bookings(id, site_id, guest_name, guest_email, starts_at, ends_at, duration_minutes)
      VALUES('booking-1', 'site', 'Guest', 'guest@example.test', '2026-12-01T10:00:00Z', '2026-12-01T11:00:00Z', 60);`);
  const prepare = (sql: string) => {
    const query = raw.prepare(sql); let values: unknown[] = [];
    const statement = { bind(...args: unknown[]) { values = args; return statement; },
      async first() { return query.get(...values as never[]) ?? null; },
      async all() { return { results: query.all(...values as never[]) }; },
      async run() { return { meta: { changes: Number(query.run(...values as never[]).changes) } }; },
    }; return statement;
  };
  const env = { DB: { prepare, async batch(statements: ReturnType<typeof prepare>[]) { for (const statement of statements) await statement.run(); } } } as unknown as Env;
  return { raw, env };
}

describe("saved ways to get paid", () => {
  it("adds, edits, switches and removes methods for their owner only", async () => {
    const { env } = fixture();
    expect(await listPaymentMethods(env, "owner")).toEqual([]);
    const pp = await createPaymentMethod(env, "owner", { kind: "paypal", link: "paypal.me/kieran" });
    const bank = await createPaymentMethod(env, "owner", { kind: "bank", accountName: "Kieran Butler", iban: "IE29 AIBK 9311 5212 3456 78" });
    expect(pp).toMatchObject({ kind: "paypal", link: "https://paypal.me/kieran", enabled: true });
    expect(bank).toMatchObject({ kind: "bank", iban: "IE29AIBK93115212345678", currency: "EUR", enabled: true });
    expect((await listPaymentMethods(env, "owner")).map((entry) => entry.id)).toEqual([pp.id, bank.id]);
    expect(await listPaymentMethods(env, "other")).toEqual([]);

    expect(await updatePaymentMethod(env, "owner", pp.id, { enabled: false })).toMatchObject({ enabled: false, link: "https://paypal.me/kieran" });
    expect(await updatePaymentMethod(env, "owner", bank.id, { bic: "aibkie2d" })).toMatchObject({ bic: "AIBKIE2D", iban: "IE29AIBK93115212345678", accountName: "Kieran Butler" });
    expect(await updatePaymentMethod(env, "owner", bank.id, { iban: "", sortCode: "401234", accountNumber: "12345678", bic: "", currency: "GBP" }))
      .toMatchObject({ iban: null, bic: null, sortCode: "401234", currency: "GBP" });

    await expect(updatePaymentMethod(env, "owner", bank.id, { sortCode: "4012" })).rejects.toThrow(PayDirectlyInputError);
    await expect(updatePaymentMethod(env, "owner", pp.id, { link: "https://evil.test/kieran" })).rejects.toThrow(/PayPal/);
    await expect(createPaymentMethod(env, "owner", { kind: "bank", accountName: "K", iban: "IE29AIBK93115212345679" })).rejects.toThrow(/IBAN/);
    await expect(updatePaymentMethod(env, "other", pp.id, { enabled: true })).rejects.toMatchObject({ status: 404 });
    await expect(deletePaymentMethod(env, "other", pp.id)).rejects.toMatchObject({ status: 404 });
    expect((await listPaymentMethods(env, "owner")).find((entry) => entry.id === pp.id)).toMatchObject({ enabled: false });

    await deletePaymentMethod(env, "owner", pp.id);
    expect((await listPaymentMethods(env, "owner")).map((entry) => entry.id)).toEqual([bank.id]);
  });
});

describe("owner API for ways to get paid", () => {
  it("lists, adds, edits, reorders and removes over HTTP, and refuses bad input plainly", async () => {
    const { env } = fixture();
    let ownerId: string | null = "owner";
    const app = new Hono<{ Bindings: Env }>();
    registerCommerceRoutes(app as never, {
      requireOwner: async () => ownerId,
      unauthorized: (c: { json(body: unknown, status: number): Response }) => c.json({ error: "Unauthorized" }, 401),
      getCoreWebOrigin: () => "http://localhost",
    } as never);
    const call = async (method: string, path: string, body?: unknown) => {
      const response = await app.fetch(new Request(`http://localhost/api/commerce/payment-methods${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }), env);
      return { status: response.status, body: await response.json() as Record<string, any> };
    };

    const created = await call("POST", "", { kind: "paypal", link: "paypal.me/kieran" });
    expect(created).toMatchObject({ status: 201, body: { ok: true, method: { kind: "paypal", link: "https://paypal.me/kieran", enabled: true } } });
    const bank = await call("POST", "", { kind: "bank", accountName: "Kieran Butler", sortCode: "40-12-34", accountNumber: "12345678" });
    expect(bank.body.method).toMatchObject({ kind: "bank", sortCode: "401234", currency: "GBP" });
    expect(await call("POST", "", { kind: "bank", accountName: "K", iban: "IE29AIBK93115212345679" }))
      .toEqual({ status: 400, body: { ok: false, error: "That IBAN does not look right. Check it and try again." } });
    expect(await call("POST", "", { kind: "wise", link: "https://wise.com/invite/abc" })).toMatchObject({ status: 400, body: { ok: false } });

    const id = created.body.method.id as string;
    expect(await call("PATCH", `/${id}`, { enabled: false })).toMatchObject({ status: 200, body: { method: { id, enabled: false } } });
    expect(await call("PATCH", "/missing", { enabled: false })).toMatchObject({ status: 404, body: { ok: false } });
    const reordered = await call("PUT", "/order", { ids: [bank.body.method.id, id] });
    expect(reordered.body.methods.map((entry: { id: string }) => entry.id)).toEqual([bank.body.method.id, id]);
    expect(await call("DELETE", `/${id}`)).toEqual({ status: 200, body: { ok: true } });
    const listed = await call("GET", "");
    expect(listed.body.methods.map((entry: { id: string }) => entry.id)).toEqual([bank.body.method.id]);

    ownerId = null;
    expect((await call("GET", "")).status).toBe(401);
    expect((await call("POST", "", { kind: "paypal", link: "paypal.me/kieran" })).status).toBe(401);
  });
});

describe("order references", () => {
  it("gives each order and booking one short reference", async () => {
    const { env } = fixture();
    const first = await ensurePaymentReference(env, "owner", { orderId: "order-1" });
    expect(first).toMatch(/^ME3-[2-9A-HJ-NP-Z]{4}$/);
    expect(await ensurePaymentReference(env, "owner", { orderId: "order-1" })).toBe(first);
    const booking = await ensurePaymentReference(env, "owner", { bookingId: "booking-1" });
    expect(booking).toMatch(/^ME3-[2-9A-HJ-NP-Z]{4}$/);
    expect(booking).not.toBe(first);
  });

  it("retries when a reference is already taken by an order or a booking", async () => {
    const { env, raw } = fixture();
    const sequence = ["ME3-AAAA", "ME3-AAAA", "ME3-AAAA", "ME3-BBBB", "ME3-AAAA", "ME3-BBBB", "ME3-CCCC"];
    const next = () => sequence.shift()!;
    expect(await ensurePaymentReference(env, "owner", { orderId: "order-1" }, next)).toBe("ME3-AAAA");
    expect(await ensurePaymentReference(env, "owner", { bookingId: "booking-1" }, next)).toBe("ME3-BBBB");
    expect(await ensurePaymentReference(env, "owner", { orderId: "order-2" }, next)).toBe("ME3-CCCC");
    const rows = raw.prepare("SELECT reference, order_id, booking_id FROM commerce_direct_payments ORDER BY reference").all();
    expect(rows).toEqual([
      { reference: "ME3-AAAA", order_id: "order-1", booking_id: null },
      { reference: "ME3-BBBB", order_id: null, booking_id: "booking-1" },
      { reference: "ME3-CCCC", order_id: "order-2", booking_id: null },
    ]);
  });

  it("uses a longer reference rather than failing when short ones keep colliding", async () => {
    const { env } = fixture();
    await ensurePaymentReference(env, "owner", { orderId: "order-1" }, () => "ME3-AAAA");
    let calls = 0;
    const reference = await ensurePaymentReference(env, "owner", { orderId: "order-2" }, (length) => {
      calls += 1;
      return length > 4 ? "ME3-ABCDEF" : "ME3-AAAA";
    });
    expect(reference).toBe("ME3-ABCDEF");
    expect(calls).toBeGreaterThan(2);
  });
});

describe("offers that let the buyer choose", () => {
  const profile = () => ({
    version: "0.1", handle: "owner", name: "Owner",
    products: [{ slug: "kit", title: "Kit", price: 4900, currency: "EUR", available: true, paymentMethod: "stripe", allowPayDirectly: true }],
    intents: { book: { enabled: true, offers: [{ pricing: { enabled: true, paymentMethod: "stripe", allowPayDirectly: true, currency: "EUR" } }] } },
  }) as unknown as Parameters<typeof getProfileCommercePublishBlockReason>[2];

  it("need a way to get paid directly and Stripe before they publish", async () => {
    const { env } = fixture();
    expect(await getProfileCommercePublishBlockReason(env, "owner", profile())).toMatch(/way to get paid in EUR.*note/i);
    await createPaymentMethod(env, "owner", { kind: "paypal", link: "paypal.me/owner" });
    // The saved method is there; it is still a card offer, so Stripe has to be ready too.
    expect(await getProfileCommercePublishBlockReason(env, "owner", profile())).toBe("Connect Stripe in Settings → Payments before publishing paid bookings or products.");
  });
});

describe("pay-directly offers", () => {
  const profile = (overrides: { note?: string; currency?: string } = {}) => ({
    version: "0.1",
    handle: "owner",
    name: "Owner",
    products: [{ slug: "kit", title: "Kit", price: 4900, currency: overrides.currency || "EUR", available: true, paymentMethod: "manual", paymentInstructions: overrides.note || "" }],
    intents: { book: { enabled: true, offers: [{ pricing: { enabled: true, paymentMethod: "manual", currency: overrides.currency || "EUR", paymentInstructions: overrides.note || "" } }] } },
  }) as unknown as Parameters<typeof getProfileCommercePublishBlockReason>[2];

  it("publish and take orders with a saved method or a note, and are blocked with neither", async () => {
    const { env } = fixture();
    expect(await getProfileCommercePublishBlockReason(env, "owner", profile())).toMatch(/way to get paid.*note/i);
    expect(await manualPaymentAvailable(env, "owner", "", "EUR")).toBe(false);
    // Existing offers with free text behave as before.
    expect(await getProfileCommercePublishBlockReason(env, "owner", profile({ note: "Pay by bank transfer." }))).toBeNull();
    expect(await manualPaymentAvailable(env, "owner", "Pay by bank transfer.", "EUR")).toBe(true);

    const bank = await createPaymentMethod(env, "owner", { kind: "bank", accountName: "Kieran Butler", iban: "IE29AIBK93115212345678" });
    expect(await getProfileCommercePublishBlockReason(env, "owner", profile())).toBeNull();
    expect(await manualPaymentAvailable(env, "owner", "", "eur")).toBe(true);
    // A EUR bank account cannot take a USD order.
    expect(await getProfileCommercePublishBlockReason(env, "owner", profile({ currency: "USD" }))).toMatch(/USD/);
    expect(await manualPaymentAvailable(env, "owner", "", "USD")).toBe(false);

    await updatePaymentMethod(env, "owner", bank.id, { enabled: false });
    expect(await getProfileCommercePublishBlockReason(env, "owner", profile())).toMatch(/way to get paid/i);
    expect(await manualPaymentAvailable(env, "owner", "", "EUR")).toBe(false);
  });

  it("keeps the note alone when no method is saved, and adds the saved methods when there are", async () => {
    const { env } = fixture();
    const before = await prepareDirectPayment(env, "owner", { orderId: "order-1", amountMinor: 4900, currency: "eur", note: "Pay by bank transfer." });
    expect(before.instructions).toBe("Pay by bank transfer.");
    expect(before.reference).toMatch(/^ME3-/);

    await createPaymentMethod(env, "owner", { kind: "paypal", link: "paypal.me/kieran" });
    await createPaymentMethod(env, "owner", { kind: "bank", accountName: "Kieran Butler", iban: "IE29AIBK93115212345678" });
    const after = await prepareDirectPayment(env, "owner", { bookingId: "booking-1", amountMinor: 4900, currency: "eur", note: "" });
    expect(after.reference).not.toBe(before.reference);
    expect(after.instructions).toContain(after.reference);
    expect(after.instructions).toContain("https://paypal.me/kieran/49EUR");
    expect(after.instructions).toContain("IE29AIBK93115212345678");
    const both = await prepareDirectPayment(env, "owner", { orderId: "order-1", amountMinor: 4900, currency: "usd", note: "Thanks!" });
    expect(both.reference).toBe(before.reference);
    expect(both.instructions).toContain("https://paypal.me/kieran/49USD");
    expect(both.instructions).not.toContain("IBAN");
    expect(both.instructions.endsWith("Thanks!")).toBe(true);
  });
});
