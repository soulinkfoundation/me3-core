import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_SCHEMA_STATEMENTS, createD1TurnStore } from "../../../packages/agent/src/store";
import { paymentTools } from "../../../packages/agent/src/tools/payments";
import type { AgentToolContext } from "../../../packages/agent/src/types";
import {
  AGENT_PAYMENTS_SCHEMA, PAYMENT_PROPOSE_TOOL, createAgentPaymentServices, formatMinorUnits, getPayment, getPaymentLimits, handOverApprovedPayment,
  listPayments, markPaymentNotPaid, paymentApprovalAuth, proposePayment, recordPaymentDecision, recordPaymentReceipt, savePaymentLimits, shopifyCartLink, toMinorUnits,
} from "./agent-payments";
import { registerNewAgentRoutes } from "./routes/new-agent";
import { registerPaymentRoutes } from "./routes/payments";
import type { AppBindings } from "./http/types";
import type { Env } from "./types";

// Failure modes: float rounding, unsafe links, silent proposal edits, approving without a
// fresh sign-in, approving by chat text, double execution, overspending across concurrent
// approvals, a declined payment proceeding, and an agent overwriting the owner's receipt.
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); });

function fixture() {
  const raw = new DatabaseSync(":memory:"); databases.push(raw);
  for (const sql of AGENT_SCHEMA_STATEMENTS) raw.exec(sql);
  raw.exec(readFileSync(new URL("../migrations/0059_agent_targets.sql", import.meta.url), "utf8"));
  raw.exec(readFileSync(new URL("../migrations/0073_agent_payments.sql", import.meta.url), "utf8"));
  const executions = new WeakMap<object, () => unknown>();
  const db = { prepare(sql: string) {
    let values: unknown[] = [];
    const statement = {
      bind(...args: unknown[]) { values = args; return statement; },
      async first<T>() { return (raw.prepare(sql).get(...values as never[]) ?? null) as T | null; },
      async all<T>() { return { results: raw.prepare(sql).all(...values as never[]) as T[] }; },
      async run() { return { meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }; },
    };
    executions.set(statement, () => ({ meta: { changes: Number(raw.prepare(sql).run(...values as never[]).changes) } }));
    return statement;
  }, async batch(statements: object[]) {
    raw.exec("BEGIN IMMEDIATE");
    try { const results = statements.map(statement => executions.get(statement)!()); raw.exec("COMMIT"); return results; }
    catch (error) { raw.exec("ROLLBACK"); throw error; }
  } };
  return { raw, db, env: { DB: db } as unknown as Env };
}

const scope = (key = "key-1") => ({ threadId: "thread", turnId: "turn", idempotencyKey: key });
const deposit = { merchantName: "Synthetic Yoga", merchantUrl: "https://yoga.example.com/retreat", purpose: "Retreat deposit", items: [{ name: "Deposit", quantity: 1 }], amount: "50.00", currency: "eur" };
const webAuth = { channel: "web" as const, signedInAt: "2026-10-17T10:00:00.000Z" };

async function approvedProposal(env: Env, key = "key-1", input: Record<string, unknown> = deposit) {
  const proposal = await proposePayment(env, "owner", scope(key), input as typeof deposit);
  await recordPaymentDecision(env, "owner", { id: `approval-${key}`, tool_name: PAYMENT_PROPOSE_TOOL, card_json: JSON.stringify({ proposalId: proposal.id, proposalHash: proposal.proposalHash }) }, "approved", webAuth);
  return proposal;
}

describe("payment amounts and links", () => {
  it("parses decimal strings exactly per currency", () => {
    expect(toMinorUnits("0.29", "EUR")).toBe(29);
    expect(toMinorUnits("1000", "JPY")).toBe(1000);
    expect(toMinorUnits("1.234", "KWD")).toBe(1234);
    expect(() => toMinorUnits("1.5", "JPY")).toThrow();
    expect(() => toMinorUnits("0", "EUR")).toThrow();
    expect(() => toMinorUnits("-3", "EUR")).toThrow();
    expect(formatMinorUnits(5, "EUR")).toBe("0.05");
  });

  it.each(["http://shop.example.com", "https://localhost/cart", "https://192.168.1.4/pay", "https://intranet/pay", "https://user:pw@shop.example.com", "javascript:alert(1)"])("refuses unsafe link %s", async url => {
    const { env } = fixture();
    await expect(proposePayment(env, "owner", scope(), { ...deposit, merchantUrl: url })).rejects.toThrow(/https URL/);
  });

  it("keeps the migration file and runtime schema identical", () => {
    const normalize = (sql: string) => sql.replace(/\s+/g, " ").replace(/;\s*/g, ";").trim();
    expect(normalize(readFileSync(new URL("../migrations/0073_agent_payments.sql", import.meta.url), "utf8").replace(/^--.*$/gm, ""))).toBe(normalize(AGENT_PAYMENTS_SCHEMA.join(";") + ";"));
  });
});

describe("payment proposals", () => {
  it("returns the same proposal for a retried call and refuses a changed one", async () => {
    const { env } = fixture();
    const first = await proposePayment(env, "owner", scope(), deposit);
    expect(first).toMatchObject({ status: "proposed", amount: "50.00", currency: "EUR", amountMinor: 5000 });
    expect((await proposePayment(env, "owner", scope(), deposit)).id).toBe(first.id);
    await expect(proposePayment(env, "owner", scope(), { ...deposit, amount: "5.00" })).rejects.toThrow(/changed/);
    expect((await listPayments(env, "owner")).payments).toHaveLength(1);
  });

  it("enforces per-payment and 30-day limits at proposal and again at execution", async () => {
    const { env } = fixture();
    await savePaymentLimits(env, "owner", { currency: "EUR", perPaymentMax: "60", monthlyMax: "80" });
    await expect(proposePayment(env, "owner", scope("big"), { ...deposit, amount: "61" })).rejects.toThrow(/per-payment limit/);
    const a = await approvedProposal(env, "a");
    const b = await approvedProposal(env, "b");
    await handOverApprovedPayment(env, "owner", a.id, a.proposalHash);
    // Both fit when proposed, but together they exceed the 30-day limit.
    await expect(handOverApprovedPayment(env, "owner", b.id, b.proposalHash)).rejects.toThrow(/30-day limit/);
    expect(await getPaymentLimits(env, "owner", "EUR")).toMatchObject({ usedLast30DaysMinor: 5000, remainingMinor: 3000 });
    await expect(savePaymentLimits(env, "owner", { currency: "EUR", perPaymentMax: "100", monthlyMax: "50" })).rejects.toThrow(/cannot be higher/);
  });

  it("uses safe defaults and scopes everything to the owner", async () => {
    const { env } = fixture();
    expect(await getPaymentLimits(env, "owner", "EUR")).toMatchObject({ perPaymentMax: "250.00", monthlyMax: "1000.00", custom: false });
    const proposal = await proposePayment(env, "owner", scope(), deposit);
    await expect(getPayment(env, "intruder", proposal.id)).rejects.toThrow(/not found/);
    expect((await listPayments(env, "intruder")).payments).toHaveLength(0);
  });
});

describe("payment approval and hand-over", () => {
  it("requires a recent web sign-in or a device unlock", () => {
    const now = 1_800_000_000;
    expect(paymentApprovalAuth({ channel: "web", sessionIssuedAt: now - 60 }, now)).toMatchObject({ channel: "web" });
    expect(() => paymentApprovalAuth({ channel: "web", sessionIssuedAt: now - 3600 }, now)).toThrow(/Sign in again/);
    expect(() => paymentApprovalAuth({ channel: "web", sessionIssuedAt: null }, now)).toThrow(/Sign in again/);
    expect(paymentApprovalAuth({ channel: "mobile", deviceAuthentication: "biometric" }, now)).toEqual({ channel: "mobile", deviceAuthentication: "biometric" });
    expect(() => paymentApprovalAuth({ channel: "mobile" }, now)).toThrow(/Face ID/);
  });

  it("hands over exactly once and never without an approved sign-in", async () => {
    const { env, raw } = fixture();
    const proposal = await proposePayment(env, "owner", scope(), { ...deposit, checkoutUrl: "https://yoga.example.com/cart/123:1" });
    await expect(handOverApprovedPayment(env, "owner", proposal.id, proposal.proposalHash)).rejects.toThrow(/fresh sign-in/);
    await recordPaymentDecision(env, "owner", { id: "approval", tool_name: PAYMENT_PROPOSE_TOOL, card_json: JSON.stringify({ proposalId: proposal.id, proposalHash: proposal.proposalHash }) }, "approved", webAuth);
    await expect(handOverApprovedPayment(env, "owner", proposal.id, "different-hash")).rejects.toThrow(/no longer matches/);
    const first = await handOverApprovedPayment(env, "owner", proposal.id, proposal.proposalHash);
    const second = await handOverApprovedPayment(env, "owner", proposal.id, proposal.proposalHash);
    expect(first.handOver.openUrl).toBe("https://yoga.example.com/cart/123:1");
    expect(second.proposal.handedOverAt).toBe(first.proposal.handedOverAt);
    expect(raw.prepare("SELECT event FROM agent_payment_events ORDER BY seq").all().map(row => (row as { event: string }).event)).toEqual(["proposed", "approved", "handed_over"]);
  });

  it("keeps a decline final and ignores a late decline after approval", async () => {
    const { env } = fixture();
    const declined = await proposePayment(env, "owner", scope("d"), deposit);
    const card = (p: { id: string; proposalHash: string }) => JSON.stringify({ proposalId: p.id, proposalHash: p.proposalHash });
    await recordPaymentDecision(env, "owner", { id: "ad", tool_name: PAYMENT_PROPOSE_TOOL, card_json: card(declined) }, "declined");
    await recordPaymentDecision(env, "owner", { id: "ad", tool_name: PAYMENT_PROPOSE_TOOL, card_json: card(declined) }, "approved", webAuth);
    await expect(handOverApprovedPayment(env, "owner", declined.id, declined.proposalHash)).rejects.toThrow(/declined/);
    const approved = await approvedProposal(env, "a");
    await recordPaymentDecision(env, "owner", { id: "approval-a", tool_name: PAYMENT_PROPOSE_TOOL, card_json: card(approved) }, "declined");
    expect((await handOverApprovedPayment(env, "owner", approved.id, approved.proposalHash)).proposal.status).toBe("handed_over");
    await expect(recordPaymentDecision(env, "owner", { id: "x", tool_name: PAYMENT_PROPOSE_TOOL, card_json: "{}" }, "approved", webAuth)).rejects.toThrow(/no longer matches/);
  });
});

describe("payment receipts", () => {
  it("flags a mismatch, lets the owner correct it, and never lets the agent overwrite the owner", async () => {
    const { env } = fixture();
    const proposal = await approvedProposal(env);
    await expect(recordPaymentReceipt(env, "owner", { proposalId: proposal.id, amount: "50.00", sourceMessageId: "mail" }, "email")).rejects.toThrow(/handed-over/);
    await handOverApprovedPayment(env, "owner", proposal.id, proposal.proposalHash);
    const fromEmail = await recordPaymentReceipt(env, "owner", { proposalId: proposal.id, amount: "54.10", currency: "EUR", orderReference: "SY-1", sourceMessageId: "mail" }, "email");
    expect(fromEmail).toMatchObject({ status: "paid", receipt: { amount: "54.10", mismatch: true, source: "email", ownerConfirmed: false } });
    const owner = await recordPaymentReceipt(env, "owner", { proposalId: proposal.id, amount: "50.00" }, "owner");
    expect(owner.receipt).toMatchObject({ amount: "50.00", mismatch: false, ownerConfirmed: true, orderReference: "SY-1" });
    await expect(recordPaymentReceipt(env, "owner", { proposalId: proposal.id, amount: "99.00", sourceMessageId: "mail-2" }, "email")).rejects.toThrow(/already confirmed/);
    expect((await getPayment(env, "owner", proposal.id)).audit.map(entry => entry.event)).toEqual(["proposed", "approved", "handed_over", "receipt_recorded", "receipt_recorded"]);
  });

  it("marks only an unpaid hand-over as not paid", async () => {
    const { env } = fixture();
    const proposal = await approvedProposal(env);
    await expect(markPaymentNotPaid(env, "owner", proposal.id)).rejects.toThrow();
    await handOverApprovedPayment(env, "owner", proposal.id, proposal.proposalHash);
    expect((await markPaymentNotPaid(env, "owner", proposal.id)).status).toBe("not_paid");
    expect(await getPaymentLimits(env, "owner", "EUR")).toMatchObject({ usedLast30DaysMinor: 0 });
  });
});

describe("payment agent tools", () => {
  function context(env: Env, overrides: Partial<AgentToolContext> = {}): AgentToolContext {
    return { db: env.DB as never, ownerId: "owner", threadId: "thread", turnId: "turn", requestId: "req", toolCallId: "call", idempotencyKey: "tool-key",
      ownerTimezone: "Europe/Dublin", messageText: "Book the retreat deposit", messages: [], enabledPluginIds: new Set(), services: { payments: createAgentPaymentServices(env, "owner") }, signal: new AbortController().signal, ...overrides };
  }
  const [propose, receipt] = paymentTools();

  it("asks for approval with the full reviewed payment, then hands over only after a fresh sign-in", async () => {
    const { env } = fixture();
    const pending = await propose.execute(deposit, context(env));
    expect(pending).toMatchObject({ status: "needs_approval", approval: { kind: "payment", requiresFreshAuthentication: true, amount: "50.00", currency: "EUR", merchant: { name: "Synthetic Yoga" }, items: [{ name: "Deposit", quantity: 1 }] } });
    const card = pending.approval!;
    const tampered = await propose.execute(deposit, context(env, { approved: true, approvalData: { ...card, proposalHash: "other" } }));
    expect(tampered).toMatchObject({ status: "error", error: expect.stringMatching(/does not match/) });
    const notSignedIn = await propose.execute(deposit, context(env, { approved: true, approvalData: card }));
    expect(notSignedIn).toMatchObject({ status: "error", error: expect.stringMatching(/fresh sign-in/) });
    await recordPaymentDecision(env, "owner", { id: "approval", tool_name: PAYMENT_PROPOSE_TOOL, card_json: JSON.stringify(card) }, "approved", webAuth);
    const done = await propose.execute(deposit, context(env, { approved: true, approvalData: card }));
    expect(done).toMatchObject({ status: "ok", data: { handOver: { openUrl: "https://yoga.example.com/retreat" }, proposal: { status: "handed_over" } } });
  });

  it("records a receipt only from an order email read in this conversation", async () => {
    const { env, raw } = fixture();
    const proposal = await approvedProposal(env);
    await handOverApprovedPayment(env, "owner", proposal.id, proposal.proposalHash);
    const args = { paymentId: proposal.id, orderEmailId: "mail-1", amount: "50.00", currency: "EUR" };
    expect(await receipt.execute(args, context(env))).toMatchObject({ status: "error", error: expect.stringMatching(/Read the order confirmation/) });
    raw.prepare("INSERT INTO me3_agent_targets(owner_id,thread_id,domain,record_id,snapshot_json,read_turn_id,read_at) VALUES('owner','thread','mailbox message','mail-1','{}','turn',?)").run(new Date().toISOString());
    expect(await receipt.execute(args, context(env))).toMatchObject({ status: "ok", data: { payment: { status: "paid", receipt: { source: "email", sourceMessageId: "mail-1" } } } });
  });
});

describe("payment routes", () => {
  function app(env: Env, sessionIssuedAt: number | null) {
    let resumes = 0;
    const hono = new Hono<AppBindings>();
    const deps = { requireOwner: async () => "owner", unauthorized: (c: never) => (c as { json(v: unknown, s: number): Response }).json({ error: "Unauthorized" }, 401), ownerSessionIssuedAt: async () => sessionIssuedAt };
    registerNewAgentRoutes(hono, deps as never); registerPaymentRoutes(hono, deps as never);
    const bindings = { ...env, ME3_AGENT: { idFromName: () => "owner", get: () => ({ fetch: async () => { resumes++; return Response.json({ ok: true }); } }) } };
    const request = (path: string, body?: unknown) => hono.request(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, bindings);
    return { request, resumes: () => resumes };
  }
  async function pendingApproval(env: Env, db: never) {
    const proposal = await proposePayment(env, "owner", scope(), deposit);
    const store = createD1TurnStore(db, { ownerId: "owner", threadId: "thread", turnId: "turn", requestId: "req" });
    return store.requestApproval("key", { id: "call", name: PAYMENT_PROPOSE_TOOL, arguments: deposit }, { title: "Approve payment", summary: "50.00 EUR", proposalId: proposal.id, proposalHash: proposal.proposalHash });
  }

  it("refuses a stale web session and does not resume the agent", async () => {
    const { env, db } = fixture();
    const id = await pendingApproval(env, db as never);
    const stale = app(env, Math.floor(Date.now() / 1000) - 3600);
    const response = await stale.request(`/api/assistant/approvals/${id}`, { decision: "approved" });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "fresh_authentication_required" });
    expect(stale.resumes()).toBe(0);
  });

  it("approves with a fresh web sign-in, and a mobile client must report its device unlock", async () => {
    const { env, db } = fixture();
    const id = await pendingApproval(env, db as never);
    const mobile = app(env, null);
    expect((await mobile.request(`/api/assistant/approvals/${id}`, { decision: "approved" })).status).toBe(403);
    expect((await mobile.request(`/api/assistant/approvals/${id}`, { decision: "approved", deviceAuthentication: "biometric" })).status).toBe(200);
    expect(mobile.resumes()).toBe(1);
    const listed = await (await mobile.request("/api/payments")).json() as { payments: Array<{ approvedWith: unknown }> };
    expect(listed.payments[0].approvedWith).toEqual({ channel: "mobile", deviceAuthentication: "biometric" });
  });

  it("lets the owner read limits and confirm a receipt", async () => {
    const { env } = fixture();
    const proposal = await approvedProposal(env);
    await handOverApprovedPayment(env, "owner", proposal.id, proposal.proposalHash);
    const routes = app(env, Math.floor(Date.now() / 1000));
    expect(await (await routes.request("/api/payments/limits?currency=EUR")).json()).toMatchObject({ limits: { usedLast30Days: "50.00" } });
    const confirmed = await routes.request(`/api/payments/${proposal.id}/receipt`, { amount: "50.00", orderReference: "R-1" });
    expect(await confirmed.json()).toMatchObject({ payment: { status: "paid", receipt: { ownerConfirmed: true, orderReference: "R-1" } } });
    expect((await routes.request("/api/payments/missing")).status).toBe(404);
  });
});

describe("Shopify cart links", () => {
  const product = { title: "Tree Runner", handle: "tree-runner", options: [{ name: "Size", values: ["UK 8", "UK 9"] }], variants: [
    { id: 101, title: "UK 8", option1: "UK 8", price: 11000, available: false },
    { id: 102, title: "UK 9", option1: "UK 9", price: 11000, available: true },
  ] };
  function store(overrides: Record<string, unknown> = {}) {
    const requested: string[] = [];
    const fetcher = (async (url: string) => {
      requested.push(url);
      const body = url.endsWith("/cart.js") ? { currency: "GBP" } : url.includes("/products/tree-runner.js") ? { ...product, ...overrides } : null;
      return { ok: body !== null, status: body ? 200 : 404, url, text: async () => JSON.stringify(body) } as unknown as Response;
    }) as unknown as typeof fetch;
    return { fetcher, requested };
  }

  it("builds a cart link from the store's own variant, stock and price", async () => {
    const { fetcher, requested } = store();
    const result = await shopifyCartLink({ productUrl: "https://shop.example.com/en-ie/collections/men/products/tree-runner?variant=1", options: { size: "uk 9" }, quantity: 2 }, fetcher);
    expect(result).toMatchObject({ status: "ready", cartUrl: "https://shop.example.com/cart/102:2", unitPrice: "110.00", itemsTotal: "220.00", currency: "GBP", merchantUrl: "https://shop.example.com/en-ie/products/tree-runner" });
    expect(requested[0]).toBe("https://shop.example.com/en-ie/products/tree-runner.js");
  });

  it("asks for a choice or reports stock instead of guessing", async () => {
    const { fetcher } = store();
    expect(await shopifyCartLink({ productUrl: "https://shop.example.com/products/tree-runner" }, fetcher)).toMatchObject({ status: "choose" });
    expect(await shopifyCartLink({ productUrl: "https://shop.example.com/products/tree-runner", options: { Colour: "Red" } }, fetcher)).toMatchObject({ status: "choose", reason: expect.stringMatching(/no option called Colour/) });
    expect(await shopifyCartLink({ productUrl: "https://shop.example.com/products/tree-runner", options: { Size: "UK 8" } }, fetcher)).toMatchObject({ status: "unavailable" });
  });

  it("refuses non-Shopify data, private redirects and non-product URLs", async () => {
    const { fetcher } = store({ variants: "nope" });
    await expect(shopifyCartLink({ productUrl: "https://shop.example.com/products/tree-runner", options: { Size: "UK 9" } }, fetcher)).rejects.toThrow(/Shopify product data/);
    await expect(shopifyCartLink({ productUrl: "https://shop.example.com/about" }, store().fetcher)).rejects.toThrow(/\/products\//);
    const redirecting = (async () => ({ ok: true, status: 200, url: "https://127.0.0.1/products/x.js", text: async () => "{}" })) as unknown as typeof fetch;
    await expect(shopifyCartLink({ productUrl: "https://shop.example.com/products/tree-runner" }, redirecting)).rejects.toThrow(/public https/);
  });
});
