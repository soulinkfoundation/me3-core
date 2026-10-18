import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Me3SiteProfile } from "@me3-core/site-renderer";
import type { AgentToolContext, AgentToolResult } from "../../../packages/agent/src/types";
import type { Env } from "./types";

// Two installations, each on its own real SQLite database: a buyer whose ME3 buys
// and a seller serving the agent commerce API through the real app. Stripe is mocked.
// Failure modes: a stale price slipping through, a second checkout on retry, a silent
// retry after a hold expires, buying when the seller turned agent checkout off or the
// owner declined, the status secret reaching the model, the web or logs, and calling
// any address other than the indexed seller API.

const stripeState = vi.hoisted(() => ({ sessions: new Map<string, Record<string, any>>(), created: [] as Array<Record<string, any>> }));
vi.mock("stripe", () => {
  class FakeStripe {
    checkout = { sessions: {
      create: async (params: Record<string, any>) => {
        const id = `cs_test_${stripeState.sessions.size + 1}`;
        const line = params.line_items[0];
        const session = { id, object: "checkout.session", url: `https://checkout.stripe.test/c/${id}`, status: "open", payment_status: "unpaid", payment_intent: null,
          amount_total: line.price_data.unit_amount * line.quantity, amount_subtotal: line.price_data.unit_amount * line.quantity, currency: line.price_data.currency, metadata: params.metadata, expires_at: params.expires_at };
        stripeState.sessions.set(id, session); stripeState.created.push(params);
        return session;
      },
      retrieve: async (id: string) => stripeState.sessions.get(id),
    } };
  }
  return { default: FakeStripe };
});
vi.mock("./transactional-emails", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./transactional-emails")>()),
  getOwnerContact: vi.fn(async () => ({ name: "Aoife", email: "aoife@example.com" })),
  sendBookingConfirmationEmails: vi.fn(async () => ({ guest: { status: "sent" }, host: { status: "sent" } })),
  sendProductPurchaseConfirmationEmail: vi.fn(async () => ({ status: "sent" })),
}));
vi.mock("./booking-reminders", async (importOriginal) => ({ ...(await importOriginal<typeof import("./booking-reminders")>()), scheduleBookingRemindersForBooking: vi.fn(async () => undefined) }));
vi.mock("./payment-notifications", () => ({ dispatchWebsitePaymentNotification: vi.fn(async () => undefined) }));

const { default: app } = await import("./app");
const { setAgentCheckoutEnabled } = await import("./agent-commerce-store");
const { PAYMENT_PROPOSE_NETWORK_TOOL, createAgentPaymentServices, getPayment, isPaymentApprovalTool, listPayments, recordPaymentDecision } = await import("./agent-payments");
const { AGENT_NETWORK_COMMERCE_SCHEMA, createAgentNetworkPaymentServices, handOverNetworkPurchase, pollNetworkPurchases, sellerApiBase } = await import("./agent-network-commerce");
const { createPeopleSearchToolServices, preferAgentCheckoutOnTies } = await import("./network-directory");
const { paymentTools } = await import("../../../packages/agent/src/tools/payments");
const { schedulingTools } = await import("../../../packages/agent/src/tools/scheduling");

const SELLER_ORIGIN = "https://aoife.example";
const SPEC_URL = `${SELLER_ORIGIN}/api/agent-commerce/v1/sites/aoife/openapi.json`;
const SELLER_PROFILE_ID = "cloud-profile-aoife";
const databases: DatabaseSync[] = [];
const webAuth = { channel: "web" as const, signedInAt: "2026-10-18T09:00:00.000Z" };

function dateInDays(days: number) { return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10); }
const TARGET_DATE = dateInDays(3);
const ALL_DAYS = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, ["09:00-12:00"]]));

function sellerProfile(coachingPrice = 60): Me3SiteProfile {
  return {
    version: "0.1", handle: "aoife", name: "Aoife",
    intents: { book: { enabled: true, title: "Sessions", offers: [
      { id: "coaching", title: "Coaching session", duration: 60, pricing: { enabled: true, suggestedAmount: coachingPrice, currency: "EUR", allowFlexiblePricing: false } },
    ], availability: { timezone: "Europe/Dublin", windows: ALL_DAYS } } },
    products: [{ slug: "clarity-kit", title: "Clarity Kit", file: "shop/clarity-kit.md", price: 4900, currency: "EUR", available: true }],
  } as Me3SiteProfile;
}

function database() {
  const raw = new DatabaseSync(":memory:");
  databases.push(raw);
  const migrations = new URL("../migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter(file => file.endsWith(".sql")).sort()) raw.exec(readFileSync(new URL(name, migrations), "utf8"));
  const executions = new WeakMap<object, () => unknown>();
  const db = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...args: unknown[]) { values = args; return statement; },
        async first<T>() { return (raw.prepare(sql).get(...values as never[]) ?? null) as T | null; },
        async all<T>() { return { results: raw.prepare(sql).all(...values as never[]) as T[] }; },
        async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }; },
      };
      executions.set(statement, () => ({ meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }));
      return statement;
    },
    async batch(statements: object[]) {
      raw.exec("BEGIN IMMEDIATE");
      try { const results = statements.map(statement => executions.get(statement)!()); raw.exec("COMMIT"); return results; }
      catch (error) { raw.exec("ROLLBACK"); throw error; }
    },
  };
  return { raw, db };
}

function seller() {
  const { raw, db } = database();
  raw.prepare("INSERT INTO owner_profile (id, username, timezone) VALUES ('owner', 'aoife', 'Europe/Dublin')").run();
  raw.prepare(`INSERT INTO sites (id, user_id, username, site_type, site_role, created_at, updated_at, published_at)
    VALUES ('site-1', 'owner', 'aoife', 'profile', 'profile', datetime('now'), datetime('now'), '2026-10-01 10:00:00')`).run();
  const setProfile = (profile: Me3SiteProfile) => {
    raw.prepare("DELETE FROM site_files WHERE site_id = 'site-1' AND path = 'src/me.json'").run();
    const bytes = new TextEncoder().encode(JSON.stringify(profile));
    raw.prepare("INSERT INTO site_files (site_id, path, content, content_type, size, updated_at) VALUES ('site-1', 'src/me.json', ?, 'application/json', ?, datetime('now'))").run(bytes, bytes.byteLength);
  };
  setProfile(sellerProfile());
  const env = { DB: db, ENVIRONMENT: "test", ME3_DEPLOYMENT_MODE: "self_hosted", TOKEN_ENCRYPTION_KEY: "seller-install-key", STRIPE_SECRET_KEY: "sk_test_seller" } as unknown as Env;
  return { raw, env, setProfile };
}

function buyer() {
  const { raw, db } = database();
  raw.prepare("INSERT INTO owner_profile (id, username, name, email, timezone) VALUES ('owner', 'sam', 'Sam Buyer', 'sam@example.com', 'Europe/London')").run();
  raw.prepare("INSERT INTO assistant_threads (id, owner_id, title) VALUES ('thread', 'owner', 'Main')").run();
  for (const [name, value] of [["ME3_CLOUD_OWNER_ID", "cloud-owner-sam"], ["ME3_CORE_INSTALL_ID", "core_00000000-0000-0000-0000-000000000001"], ["ME3_CLOUD_CORE_TOKEN", "cloud-core-token"]]) {
    raw.prepare("INSERT INTO install_secrets (name, value) VALUES (?, ?)").run(name, value);
  }
  const env = { DB: db, ENVIRONMENT: "test", ME3_DEPLOYMENT_MODE: "self_hosted", TOKEN_ENCRYPTION_KEY: "buyer-install-key", ME3_CLOUD_API_ORIGIN: "https://api.me3.test" } as unknown as Env;
  return { raw, env };
}

const indexedOffering = (overrides: Record<string, unknown> = {}) => ({
  type: "service", id: "service:coaching", title: "Coaching session", url: `${SELLER_ORIGIN}/book/coaching`, durationMinutes: 60, price: { amount: "60.00", currency: "EUR" },
  kind: "booking", delivery: "online", agentCheckout: { version: "1", specUrl: SPEC_URL }, ...overrides,
});
function searchResponse() {
  return { query: "coaching", results: [
    // An outside seller ranked first by ME3 Cloud, with an equally relevant match.
    { profileId: "cloud-profile-brian", name: "Brian", handle: "brian", kind: "person", profileUrl: "https://brian.example/", publicUrl: "https://brian.example/",
      offerings: [indexedOffering({ id: "service:coaching-b", url: "https://brian.example/book", agentCheckout: null })], reasons: ["Offers Coaching session"], indexedAt: "2026-10-17T10:00:00Z",
      seller: { soulinkLinked: false, listedSince: "2026-10-01T00:00:00Z", completedNetworkSales: 0, reportStatus: "none", newSeller: true, agentCheckout: false } },
    { profileId: SELLER_PROFILE_ID, name: "Aoife", handle: "aoife", kind: "person", profileUrl: `${SELLER_ORIGIN}/`, publicUrl: `${SELLER_ORIGIN}/`,
      offerings: [indexedOffering(), indexedOffering({ type: "product", id: "product:clarity-kit", title: "Clarity Kit", url: `${SELLER_ORIGIN}/shop/clarity-kit`, kind: "product", durationMinutes: null, price: { amount: "49.00", currency: "EUR" } })],
      reasons: ["Offers Coaching session"], indexedAt: "2026-10-17T10:00:00Z",
      seller: { soulinkLinked: true, listedSince: "2026-06-01T00:00:00Z", completedNetworkSales: 12, reportStatus: "none", newSeller: false, agentCheckout: true } },
  ] };
}

type Journey = ReturnType<typeof journey>;
function journey() {
  const sellerSide = seller();
  const buyerSide = buyer();
  const requests: Array<{ method: string; url: string }> = [];
  const secrets: string[] = [];
  let failNextCheckoutResponse = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init.method || "GET";
    requests.push({ method, url });
    if (url === "https://api.me3.test/v1/network/search") return Response.json(searchResponse());
    if (url.startsWith(`${SELLER_ORIGIN}/`)) {
      const headers = new Headers(init.headers);
      headers.set("cf-connecting-ip", "198.51.100.7");
      const response = await app.fetch(new Request(url, { ...init, headers }), sellerSide.env);
      if (method === "POST" && url.endsWith("/checkouts")) {
        const body = await response.clone().json().catch(() => ({})) as { statusSecret?: string };
        if (body.statusSecret) secrets.push(body.statusSecret);
        // The seller created the checkout but the answer never reached the buyer.
        if (failNextCheckoutResponse && response.ok) { failNextCheckoutResponse = false; throw new TypeError("network connection lost"); }
      }
      return response;
    }
    return Response.json({ error: "Not found" }, { status: 404 });
  });
  const services = { people: createPeopleSearchToolServices(buyerSide.env, "owner") as never, payments: { ...createAgentPaymentServices(buyerSide.env, "owner"), ...createAgentNetworkPaymentServices(buyerSide.env, "owner") } };
  let turn = 0;
  const context = (overrides: Partial<AgentToolContext> = {}): AgentToolContext => ({
    db: buyerSide.env.DB as never, ownerId: "owner", threadId: "thread", turnId: `turn-${turn}`, requestId: "req", toolCallId: "call", idempotencyKey: `tool-key-${turn}`,
    ownerTimezone: "Europe/London", messageText: "Book me a coaching session", messages: [], enabledPluginIds: new Set(), services, signal: new AbortController().signal, ...overrides,
  });
  const tools = Object.fromEntries([...paymentTools(), ...schedulingTools()].map(tool => [tool.name, tool]));
  const results: AgentToolResult[] = [];
  const run = async (name: string, args: Record<string, unknown>, overrides: Partial<AgentToolContext> = {}) => {
    const result = await tools[name].execute(args, context(overrides));
    results.push(result);
    return result as AgentToolResult & { data?: any; approval?: any };
  };
  return {
    seller: sellerSide, buyer: buyerSide, requests, secrets, results, run,
    nextTurn() { turn++; },
    failNextCheckoutResponse() { failNextCheckoutResponse = true; },
    sellerCheckouts: () => sellerSide.raw.prepare("SELECT * FROM agent_commerce_checkouts").all() as Array<Record<string, any>>,
  };
}

async function searchAndCheck(j: Journey) {
  const search = await j.run("core_people_search", { query: "coaching", offeringKind: "booking" });
  const checked = await j.run("core_payments_network_check", { profileId: SELLER_PROFILE_ID, offeringId: "service:coaching", from: TARGET_DATE, to: TARGET_DATE });
  return { search, checked, slot: checked.data.availability.slots[0] as { start: string; end: string } };
}

async function proposeAndApprove(j: Journey, slotStart: string) {
  const pending = await j.run(PAYMENT_PROPOSE_NETWORK_TOOL, { profileId: SELLER_PROFILE_ID, offeringId: "service:coaching", slotStart, purpose: "A coaching session" });
  expect(pending.status).toBe("needs_approval");
  const card = pending.approval;
  await recordPaymentDecision(j.buyer.env, "owner", { id: `approval-${card.proposalId}`, tool_name: PAYMENT_PROPOSE_NETWORK_TOOL, card_json: JSON.stringify(card) }, "approved", webAuth);
  const resume = () => j.run(PAYMENT_PROPOSE_NETWORK_TOOL, { profileId: SELLER_PROFILE_ID, offeringId: "service:coaching", slotStart, purpose: "A coaching session" }, { approved: true, approvalData: card });
  return { card, resume };
}

/** The owner opens the seller's payment link and pays with Stripe. */
async function ownerPays(j: Journey, payUrl: string) {
  const opened = await app.fetch(new Request(payUrl, { headers: { "cf-connecting-ip": "203.0.113.50" } }), j.seller.env);
  expect(opened.status).toBe(303);
  const sessionId = opened.headers.get("location")!.split("/").pop()!;
  Object.assign(stripeState.sessions.get(sessionId)!, { status: "complete", payment_status: "paid", payment_intent: `pi_${sessionId}` });
}

function dueNow(j: Journey) {
  j.buyer.raw.prepare("UPDATE agent_network_purchases SET next_check_at=? WHERE checkout_status='pending'").run(new Date(Date.now() - 1000).toISOString());
}

function everyBuyerRow(raw: DatabaseSync): string {
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
  return tables.map(({ name }) => JSON.stringify(raw.prepare(`SELECT * FROM "${name}"`).all())).join("\n");
}

let consoleCalls: unknown[][] = [];
beforeEach(() => {
  consoleCalls = [];
  for (const level of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { consoleCalls.push(args); });
});
afterEach(() => {
  databases.splice(0).forEach(db => db.close());
  stripeState.sessions.clear(); stripeState.created.length = 0;
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("network commerce journey (two installations)", () => {
  it("searches, checks live, proposes, approves, checks out, and records the seller receipt and calendar entry", async () => {
    const j = journey();
    const { search, checked, slot } = await searchAndCheck(j);

    // Search: commerce fields and badges; the agent-ready seller wins the near-tie, the outside one stays listed.
    expect(search.status).toBe("ok");
    expect(search.data.results.map((result: any) => result.name)).toEqual(["Aoife", "Brian"]);
    expect(search.data.results[0]).toMatchObject({ badges: ["ME3 agent checkout", "Soulink member", "12 network sales"], seller: { agentCheckout: true },
      offerings: [expect.objectContaining({ kind: "booking", delivery: "online", agentCheckout: { version: "1", specUrl: SPEC_URL } }), expect.anything()] });
    expect(search.data.results[1].badges).toEqual(["New seller"]);
    expect(j.requests.find(request => request.url.endsWith("/v1/network/search"))).toBeTruthy();

    // Live check comes from the seller's own API, in minor units.
    expect(checked).toMatchObject({ status: "ok", data: { status: "ready", seller: { name: "Aoife", onMe3Network: true },
      offering: { id: "service:coaching", kind: "booking", amount: 6000, currency: "EUR", requiresSlot: true, price: { amount: "60.00", currency: "EUR" } } } });
    expect(checked.data.availability.slots.length).toBeGreaterThan(0);

    // Propose: the approval card names the seller and what is shared.
    const { card, resume } = await proposeAndApprove(j, slot.start);
    expect(card).toMatchObject({ kind: "payment", method: "in_network", requiresFreshAuthentication: true, amount: "60.00", currency: "EUR",
      merchant: { name: "Aoife", url: `${SELLER_ORIGIN}/book/coaching` }, sharesNotice: "Shares your name and email with Aoife.",
      network: { seller: { name: "Aoife" }, slot: { start: slot.start, end: slot.end }, sharesWith: { name: "Sam Buyer", email: "sam@example.com" }, holdMinutes: 15 } });
    expect(j.sellerCheckouts()).toHaveLength(0);

    // Approve (fresh sign-in) and hand over: one seller checkout, payUrl to the owner.
    const handed = await resume();
    expect(handed).toMatchObject({ status: "ok", data: { outcome: "checkout_ready", proposal: { status: "handed_over", network: { checkoutStatus: "pending" } } } });
    const payUrl = handed.data.handOver.openUrl as string;
    expect(payUrl).toMatch(new RegExp(`^${SELLER_ORIGIN}/api/agent-commerce/v1/sites/aoife/checkouts/[^/]+/pay$`));
    const [checkout] = j.sellerCheckouts();
    expect(checkout).toMatchObject({ buyer_name: "Sam Buyer", buyer_email: "sam@example.com", amount_minor: 6000, slot_start: slot.start, status: "pending" });
    const postBody = j.requests.filter(request => request.method === "POST" && request.url.endsWith("/checkouts"));
    expect(postBody).toHaveLength(1);

    // Pending poll changes nothing; then the owner pays and the scheduled sweep records the receipt.
    dueNow(j); await pollNetworkPurchases(j.buyer.env);
    expect((await getPayment(j.buyer.env, "owner", card.proposalId)).payment.status).toBe("handed_over");
    await ownerPays(j, payUrl);
    dueNow(j); await pollNetworkPurchases(j.buyer.env);

    const { payment, audit } = await getPayment(j.buyer.env, "owner", card.proposalId);
    expect(payment).toMatchObject({ status: "paid", method: "in_network", receipt: { amount: "60.00", currency: "EUR", source: "seller", mismatch: false },
      network: { checkoutStatus: "paid", reference: { type: "booking" }, calendarEventId: `network-purchase-${card.proposalId}`, payUrl: null } });
    expect(audit.map(entry => entry.event)).toEqual(["proposed", "approved", "handed_over", "receipt_recorded", "network_paid"]);
    const event = j.buyer.raw.prepare("SELECT * FROM user_calendar_events").get() as Record<string, any>;
    expect(event).toMatchObject({ title: "Coaching session with Aoife", starts_at: slot.start, ends_at: slot.end, timezone: "Europe/London" });
    const message = j.buyer.raw.prepare("SELECT content FROM assistant_messages WHERE thread_id='thread'").get() as { content: string };
    expect(message.content).toMatch(/^Booked: .+Coaching session with Aoife, €60\.00 paid\. It's in your calendar\.$/);
    expect(j.seller.raw.prepare("SELECT status FROM agent_commerce_checkouts").get()).toEqual({ status: "paid" });

    // Polling again is a no-op.
    dueNow(j); await pollNetworkPurchases(j.buyer.env);
    expect(j.buyer.raw.prepare("SELECT COUNT(*) AS n FROM assistant_messages").get()).toEqual({ n: 1 });

    // Only the seller API and the directory were called.
    for (const request of j.requests) expect(request.url.startsWith(`${SELLER_ORIGIN}/api/agent-commerce/v1/sites/aoife/`) || request.url.startsWith("https://api.me3.test/")).toBe(true);
  });

  it("never lets the checkout status secret reach model context, the web, stored views or logs", async () => {
    const j = journey();
    const { slot } = await searchAndCheck(j);
    const { card, resume } = await proposeAndApprove(j, slot.start);
    const handed = await resume();
    await resume();
    await j.run("core_payments_network_status", { paymentId: card.proposalId });
    await ownerPays(j, handed.data.handOver.openUrl);
    await j.run("core_payments_network_status", { paymentId: card.proposalId });
    await j.run("core_payments_list", {});

    expect(j.secrets.length).toBeGreaterThan(0);
    const [secret] = j.secrets;
    expect(new Set(j.secrets)).toEqual(new Set([secret]));
    const leaks = (value: unknown) => JSON.stringify(value).includes(secret);
    expect(j.results.some(leaks)).toBe(false);
    expect(leaks(card)).toBe(false);
    expect(leaks(await listPayments(j.buyer.env, "owner"))).toBe(false);
    expect(leaks(await getPayment(j.buyer.env, "owner", card.proposalId))).toBe(false);
    expect(consoleCalls.some(leaks)).toBe(false);
    // Stored only encrypted: no buyer table holds it in plain text.
    expect(everyBuyerRow(j.buyer.raw).includes(secret)).toBe(false);
    const stored = j.buyer.raw.prepare("SELECT encrypted_status_secret FROM agent_network_purchases").get() as { encrypted_status_secret: string };
    expect(stored.encrypted_status_secret).toMatch(/^v1\./);

  });

  it("refuses a changed price at checkout and re-proposes for a fresh approval", async () => {
    const j = journey();
    const { slot } = await searchAndCheck(j);
    const { card, resume } = await proposeAndApprove(j, slot.start);
    j.seller.setProfile(sellerProfile(70));
    const handed = await resume();
    expect(handed).toMatchObject({ status: "ok", data: { outcome: "price_changed", handOver: null, proposal: { status: "not_paid", network: { checkoutStatus: "price_changed", livePrice: { amount: "70.00", currency: "EUR" } } } } });
    expect(handed.data.next).toMatch(/70\.00 EUR.*propose again/);
    expect(j.sellerCheckouts()).toHaveLength(0);
    expect(stripeState.created).toHaveLength(0);
    // Retrying the approved one never buys at the new price.
    expect((await resume()).data.outcome).toBe("price_changed");
    expect(j.sellerCheckouts()).toHaveLength(0);
    // Nothing bought: the limit is free again.
    expect((await getPayment(j.buyer.env, "owner", card.proposalId)).audit.map(entry => entry.event)).toContain("price_changed");

    j.nextTurn();
    const again = await j.run(PAYMENT_PROPOSE_NETWORK_TOOL, { profileId: SELLER_PROFILE_ID, offeringId: "service:coaching", slotStart: slot.start, purpose: "A coaching session" });
    expect(again).toMatchObject({ status: "needs_approval", approval: { amount: "70.00", currency: "EUR" } });
    expect(again.approval.proposalId).not.toBe(card.proposalId);
  });

  it("tells the owner when the 15-minute hold expires and never retries on its own", async () => {
    const j = journey();
    const { slot } = await searchAndCheck(j);
    const { card, resume } = await proposeAndApprove(j, slot.start);
    expect((await resume()).data.outcome).toBe("checkout_ready");
    const past = new Date(Date.now() - 60_000).toISOString();
    j.seller.raw.prepare("UPDATE agent_commerce_checkouts SET expires_at=?").run(past);
    j.seller.raw.prepare("UPDATE booking_holds SET expires_at=?").run(past);
    dueNow(j); await pollNetworkPurchases(j.buyer.env);

    const { payment, audit } = await getPayment(j.buyer.env, "owner", card.proposalId);
    expect(payment).toMatchObject({ status: "not_paid", receipt: null, network: { checkoutStatus: "expired", payUrl: null } });
    expect(audit.map(entry => entry.event)).toContain("checkout_expired");
    expect((j.buyer.raw.prepare("SELECT content FROM assistant_messages").get() as { content: string }).content).toMatch(/hold on Coaching session with Aoife expired.*nothing was bought/);
    expect(j.buyer.raw.prepare("SELECT COUNT(*) AS n FROM user_calendar_events").get()).toEqual({ n: 0 });
    // No silent retry: a resumed hand-over reports the expiry without a new checkout.
    const retried = await resume();
    expect(retried.data).toMatchObject({ outcome: "expired", handOver: null });
    expect(j.sellerCheckouts()).toHaveLength(1);
    expect(j.requests.filter(request => request.method === "POST" && request.url.endsWith("/checkouts"))).toHaveLength(1);
  });

  it("falls back to the seller's page when agent checkout is turned off", async () => {
    const j = journey();
    const { slot } = await searchAndCheck(j);
    const { resume } = await proposeAndApprove(j, slot.start);
    await setAgentCheckoutEnabled(j.seller.env, "owner", false);
    const handed = await resume();
    expect(handed.data).toMatchObject({ outcome: "agent_checkout_off", handOver: null, fallbackUrl: `${SELLER_ORIGIN}/book/coaching`, proposal: { status: "not_paid" } });
    expect(handed.data.next).toContain(`${SELLER_ORIGIN}/book/coaching`);
    expect(j.sellerCheckouts()).toHaveLength(0);
    // The live check says so too.
    const checked = await j.run("core_payments_network_check", { profileId: SELLER_PROFILE_ID, offeringId: "service:coaching" });
    expect(checked.data).toMatchObject({ status: "agent_checkout_off", fallbackUrl: `${SELLER_ORIGIN}/book/coaching` });
  });

  it("buys nothing when the owner declines or has not approved with a fresh sign-in", async () => {
    const j = journey();
    const { slot } = await searchAndCheck(j);
    const pending = await j.run(PAYMENT_PROPOSE_NETWORK_TOOL, { profileId: SELLER_PROFILE_ID, offeringId: "service:coaching", slotStart: slot.start, purpose: "A coaching session" });
    const card = pending.approval;
    const notApproved = await j.run(PAYMENT_PROPOSE_NETWORK_TOOL, { profileId: SELLER_PROFILE_ID, offeringId: "service:coaching", slotStart: slot.start, purpose: "A coaching session" }, { approved: true, approvalData: card });
    expect(notApproved).toMatchObject({ status: "error", error: expect.stringMatching(/fresh sign-in/) });
    expect(isPaymentApprovalTool(PAYMENT_PROPOSE_NETWORK_TOOL)).toBe(true);
    await recordPaymentDecision(j.buyer.env, "owner", { id: "approval-d", tool_name: PAYMENT_PROPOSE_NETWORK_TOOL, card_json: JSON.stringify(card) }, "declined");
    await expect(handOverNetworkPurchase(j.buyer.env, "owner", card.proposalId, card.proposalHash)).rejects.toThrow(/declined/);
    expect((await getPayment(j.buyer.env, "owner", card.proposalId)).payment.status).toBe("declined");
    expect(j.sellerCheckouts()).toHaveLength(0);
    expect(j.requests.filter(request => request.method === "POST" && request.url.endsWith("/checkouts"))).toHaveLength(0);
  });

  it("retries a lost checkout answer without creating a second checkout", async () => {
    const j = journey();
    const { slot } = await searchAndCheck(j);
    const { card, resume } = await proposeAndApprove(j, slot.start);
    j.failNextCheckoutResponse();
    const lost = await resume();
    expect(lost).toMatchObject({ status: "error", error: expect.stringMatching(/did not answer/) });
    expect((await getPayment(j.buyer.env, "owner", card.proposalId)).payment.status).toBe("proposed");
    const retried = await resume();
    const again = await resume();
    expect(retried.data.outcome).toBe("checkout_ready");
    expect(again.data.handOver.openUrl).toBe(retried.data.handOver.openUrl);
    expect(j.sellerCheckouts()).toHaveLength(1);
    expect(stripeState.created).toHaveLength(1);
    // The stable idempotency key was reused; once stored, no further POST is sent.
    expect(j.requests.filter(request => request.method === "POST" && request.url.endsWith("/checkouts"))).toHaveLength(2);
    expect(j.seller.raw.prepare("SELECT idempotency_key FROM agent_commerce_checkouts").get()).toEqual({ idempotency_key: `me3-network-${card.proposalId}` });
  });

  it("flags a seller receipt whose amount differs from the approval", async () => {
    const j = journey();
    const { slot } = await searchAndCheck(j);
    const { card, resume } = await proposeAndApprove(j, slot.start);
    const handed = await resume();
    await ownerPays(j, handed.data.handOver.openUrl);
    // Stripe charged a different total (for example a coupon applied on the checkout page).
    for (const session of stripeState.sessions.values()) Object.assign(session, { amount_total: 5500 });
    const result = await j.run("core_payments_network_status", { paymentId: card.proposalId });
    expect(result.data).toMatchObject({ payment: { status: "paid", receipt: { source: "seller", mismatch: true } }, next: expect.stringMatching(/different amount/) });
    expect(result.data.payment.receipt.amount).not.toBe("60.00");
    expect((j.buyer.raw.prepare("SELECT content FROM assistant_messages").get() as { content: string }).content).toMatch(/but you approved €60\.00/);
  });
});

describe("seller addresses and search ranking", () => {
  it("accepts only public https agent commerce spec URLs", () => {
    expect(sellerApiBase(SPEC_URL)).toBe(`${SELLER_ORIGIN}/api/agent-commerce/v1/sites/aoife`);
    for (const url of ["http://aoife.example/api/agent-commerce/v1/sites/aoife/openapi.json", "https://127.0.0.1/api/agent-commerce/v1/sites/aoife/openapi.json",
      "https://localhost/api/agent-commerce/v1/sites/aoife/openapi.json", "https://aoife.example/other/openapi.json", "https://aoife.example/api/agent-commerce/v1/sites/aoife/openapi.json?x=1",
      "https://user:pw@aoife.example/api/agent-commerce/v1/sites/aoife/openapi.json", "https://10.0.0.4/api/agent-commerce/v1/sites/a/openapi.json"]) {
      expect(() => sellerApiBase(url), url).toThrow();
    }
  });

  it("does not follow redirects and refuses oversized answers", async () => {
    const j = journey();
    await j.run("core_people_search", { query: "coaching" });
    vi.stubGlobal("fetch", async () => new Response(null, { status: 302, headers: { location: "https://169.254.169.254/" } }));
    expect(await j.run("core_payments_network_check", { profileId: SELLER_PROFILE_ID, offeringId: "service:coaching" })).toMatchObject({ status: "error", error: expect.stringMatching(/redirect/) });
    vi.stubGlobal("fetch", async () => new Response("x".repeat(300_000), { status: 200 }));
    expect(await j.run("core_payments_network_check", { profileId: SELLER_PROFILE_ID, offeringId: "service:coaching" })).toMatchObject({ status: "error", error: expect.stringMatching(/too large/) });
  });

  it("only checks sellers and offerings found by search in this conversation", async () => {
    const j = journey();
    expect(await j.run("core_payments_network_check", { profileId: SELLER_PROFILE_ID, offeringId: "service:coaching" })).toMatchObject({ status: "error", error: expect.stringMatching(/core_people_search first/) });
    await j.run("core_people_search", { query: "coaching" });
    expect(await j.run("core_payments_network_check", { profileId: SELLER_PROFILE_ID, offeringId: "service:invented" })).toMatchObject({ status: "error", error: expect.stringMatching(/not one this seller listed/) });
    expect(await j.run("core_payments_network_check", { profileId: "cloud-profile-brian", offeringId: "service:coaching-b" })).toMatchObject({ status: "ok", data: { status: "no_agent_checkout", fallbackUrl: "https://brian.example/book" } });
  });

  it("moves an agent-ready seller at most one place, and never past a clearly different match", () => {
    const result = (name: string, agent: boolean, reasons = ["Offers Coaching"], reportStatus: "none" | "reported" = "none") => ({
      relationshipTier: "public" as const, profileId: name, contactName: null, name, handle: null, kind: "person", bio: null, avatarUrl: null, profileUrl: null, publicUrl: null, location: null,
      offerings: [{ type: "service" as const, id: `service:${name}`, title: "Coaching", description: null, url: null, durationMinutes: null, price: null, agentCheckout: agent ? { version: "1", specUrl: SPEC_URL } : null }],
      reasons, indexedAt: "", seller: { soulinkLinked: false, listedSince: null, completedNetworkSales: 0, reportStatus, newSeller: false, agentCheckout: agent },
    });
    const names = (list: ReturnType<typeof result>[]) => preferAgentCheckoutOnTies(list).map(entry => entry.name);
    expect(names([result("a", false), result("b", false), result("c", true)])).toEqual(["a", "c", "b"]);
    expect(names([result("a", false, ["Based in Galway"]), result("b", true)])).toEqual(["a", "b"]);
    expect(names([result("a", false), result("b", true, ["Offers Coaching"], "reported")])).toEqual(["a", "b"]);
    expect(names([result("a", true), result("b", false)])).toEqual(["a", "b"]);
  });

  it("keeps the migration file and runtime schema identical", () => {
    const normalize = (sql: string) => sql.replace(/\s+/g, " ").replace(/;\s*/g, ";").trim();
    expect(normalize(readFileSync(new URL("../migrations/0077_agent_network_purchases.sql", import.meta.url), "utf8").replace(/^--.*$/gm, ""))).toBe(normalize(AGENT_NETWORK_COMMERCE_SCHEMA.join(";") + ";"));
  });
});
