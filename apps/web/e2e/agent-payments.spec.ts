import { test, expect } from "./fixtures/test";
import type { Page, Route } from "@playwright/test";

// UI tests: every application API is simulated with synthetic owner data. No payment provider is involved;
// ME3 never charges, so the only "payment" step is the owner opening the merchant's checkout link.
const thread = { id: "main", title: "Main conversation", status: "active", isPrimary: true };
const hostile = `Bramble <img src=x onerror="window.__xss=1">`;
const card = {
  kind: "payment", requiresFreshAuthentication: true, proposalId: "pay-1", proposalHash: "hash-1",
  merchant: { name: hostile, url: "https://bramble.example/book" }, purpose: "Friday dinner deposit",
  items: [{ name: "Table for four", quantity: 1, options: "Fri 19:30" }, { name: "Gift card", quantity: 2 }],
  amount: "20.00", currency: "EUR", amountMinor: 2000, method: "finish_on_device",
  checkoutUrl: "https://pay.other.example/c/1", checkoutDomainDiffers: true, refundPolicy: "Refundable until Thursday 18:00",
  limits: { currency: "EUR", custom: false, perPaymentMax: "250.00", monthlyMax: "1000.00", usedLast30Days: "600.00", remaining: "400.00" },
  howItWorks: "You pay on your own device. ME3 does not charge you and never sees your card details.",
};
const approval = { ...card, id: "appr-1", pluginId: "me3.core", actionId: "core_payments_propose", title: "Approve payment", summary: "20.00 EUR", riskLevel: "high", status: "pending", requestedAt: "2026-10-17T10:00:00Z", threadId: "main", turnId: "turn-1", payload: card };
const now = new Date().toISOString();
const basePayment = {
  id: "pay-1", status: "proposed", method: "finish_on_device", merchant: card.merchant, purpose: card.purpose, items: card.items,
  amount: "20.00", amountMinor: 2000, currency: "EUR", checkoutUrl: card.checkoutUrl, checkoutDomainDiffers: true, refundPolicy: card.refundPolicy,
  proposalHash: "hash-1", threadId: "main", turnId: "turn-1", approvalId: null, approvedWith: null,
  createdAt: now, decidedAt: null, handedOverAt: null, completedAt: null, receipt: null,
};

type State = { approvals: unknown[]; payment: Record<string, unknown>; audit: unknown[]; decisions: unknown[]; staleSession: boolean; receipts: unknown[]; notPaid: number; limits: Record<string, unknown>; limitPuts: unknown[] };

async function fixture(page: Page, overrides: Partial<State> = {}) {
  const state: State = {
    approvals: [approval], payment: { ...basePayment }, audit: [{ event: "proposed", data: {}, at: now }], decisions: [], staleSession: false,
    receipts: [], notPaid: 0, limits: { ...card.limits, updatedAt: null, perPaymentMaxMinor: 25000, monthlyMaxMinor: 100000 }, limitPuts: [], ...overrides,
  };
  const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url()); const path = url.pathname.replace(/^\/api/, ""); const method = route.request().method();
    if (path === "/assistant/approvals/appr-1" && method === "POST") {
      const body = route.request().postDataJSON(); state.decisions.push(body);
      if (body.decision === "approved" && state.staleSession) return json(route, { ok: false, error: "Sign in again to approve this payment.", code: "fresh_authentication_required" }, 403);
      state.approvals = [];
      state.payment = { ...state.payment, status: body.decision === "approved" ? "handed_over" : "declined", decidedAt: now, handedOverAt: body.decision === "approved" ? now : null };
      state.audit.push({ event: body.decision, data: { auth: { channel: "web" } }, at: now });
      if (body.decision === "approved") state.audit.push({ event: "handed_over", data: {}, at: now });
      return json(route, { ok: true, status: "complete", replyText: "Open the checkout link to pay." });
    }
    if (path === "/payments/pay-1/receipt") {
      const body = route.request().postDataJSON(); state.receipts.push(body);
      state.payment = { ...state.payment, status: "paid", completedAt: now, receipt: { amount: body.amount, currency: "EUR", orderReference: body.orderReference ?? null, paidAt: null, source: "owner", mismatch: body.amount !== "20.00", ownerConfirmed: true } };
      state.audit.push({ event: "receipt_recorded", data: { source: "owner" }, at: now });
      return json(route, { payment: state.payment });
    }
    if (path === "/payments/pay-1/not-paid") {
      state.notPaid++; state.payment = { ...state.payment, status: "not_paid", completedAt: now }; state.audit.push({ event: "not_paid", data: {}, at: now });
      return json(route, { payment: state.payment });
    }
    if (path === "/payments/limits" && method === "PUT") {
      const body = route.request().postDataJSON(); state.limitPuts.push(body);
      if (Number(body.perPaymentMax) > Number(body.monthlyMax)) return json(route, { error: "The per-payment limit cannot be higher than the monthly limit." }, 400);
      state.limits = { ...state.limits, custom: true, perPaymentMax: body.perPaymentMax, monthlyMax: body.monthlyMax };
      return json(route, { limits: state.limits });
    }
    const data: unknown = path === "/auth/me" ? { ok: true, user: { id: "ui-owner", username: "owner", name: "Demo Owner", timezone: "UTC" }, workspace: { hasProfileSite: true } }
      : path === "/assistant/approvals" ? { approvals: url.searchParams.get("status") === "pending" ? state.approvals : state.approvals }
      : path === "/payments" ? { payments: [state.payment] }
      : path === "/payments/pay-1" ? { payment: state.payment, audit: state.audit }
      : path === "/payments/limits" ? { limits: url.searchParams.get("currency") === "EUR" ? state.limits : { ...state.limits, currency: url.searchParams.get("currency") } }
      : path === "/assistant/threads/primary" ? { thread }
      : path === "/assistant/threads" ? { threads: [thread] }
      : path === "/assistant/threads/main/messages" ? { thread, messages: [{ id: "m1", role: "assistant", text: "This action needs your approval before I can continue.", createdAt: now }] }
      : path === "/assistant/settings" ? { displayName: "ME3", assistantName: null }
      : path === "/ai-settings" ? { deploymentMode: "self_hosted", providers: [] }
      : path === "/config" ? { deploymentMode: "self_hosted", ownerAuthConfigured: true, ownerPasswordAuthConfigured: true, setupRequired: [] }
      : path === "/mission-control/approvals" ? { approvals: state.approvals }
      : path === "/calendar/feed" ? { events: [], bookings: [], reminders: [], tasks: [], sources: [] }
      : path === "/mailbox" ? { mailbox: {} } : path === "/mailbox/messages" ? { messages: [] }
      : path === "/mission-control/tasks" ? { tasks: [] } : path === "/journal/archive" ? { entries: [] }
      : path === "/mission-control/wheel" ? { snapshots: [], settings: { segments: [] } }
      : path === "/mission-control/dashboard" ? { settings: { goals: [] } }
      : path === "/mission-control/projects" ? { projects: [] } : path === "/sites" ? { sites: [] }
      : path === "/plugins" ? { plugins: [] } : path === "/navigation-features" ? { features: [] } : {};
    return json(route, data);
  });
  return state;
}

test("Chat shows the whole proposal, escapes merchant text and declines in one click", async ({ page }, testInfo) => {
  const state = await fixture(page);
  await page.goto("/assistant?view=chat&thread=main");
  const cardEl = page.getByTestId("payment-approval");
  await expect(cardEl).toContainText(hostile);
  await expect(cardEl).toContainText("1 × Table for four · Fri 19:30");
  await expect(cardEl).toContainText("2 × Gift card");
  await expect(cardEl).toContainText("20.00 EUR");
  await expect(cardEl).toContainText("Friday dinner deposit");
  await expect(cardEl).toContainText("Refundable until Thursday 18:00");
  await expect(cardEl).toContainText("left of your");
  await expect(cardEl).toContainText("You pay on your own device. ME3 does not charge you and never sees your card details.");
  await expect(cardEl.getByRole("alert")).toContainText("The checkout link opens pay.other.example, not bramble.example.");
  await expect(cardEl.getByRole("link", { name: "https://pay.other.example/c/1" })).toHaveAttribute("href", "https://pay.other.example/c/1");
  await expect(cardEl.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
  await page.screenshot({ path: testInfo.outputPath("payment-card.png"), fullPage: true });

  await cardEl.getByRole("button", { name: "Decline", exact: true }).click();
  await expect.poll(() => state.decisions).toEqual([{ decision: "declined" }]);
  await expect(page.locator(".chat-payments")).toContainText("Declined");
});

test("A stale session signs in again, then the owner approves and gets the hand-over", async ({ page }, testInfo) => {
  const state = await fixture(page, { staleSession: true });
  await page.goto("/assistant?view=chat&thread=main");
  const cardEl = page.getByTestId("payment-approval");
  await cardEl.getByRole("button", { name: /^Approve/ }).click();
  await expect(cardEl).toContainText("sign in again before approving a payment");
  // One refused attempt, no silent retry.
  await page.waitForTimeout(300); expect(state.decisions).toEqual([{ decision: "approved" }]);

  await cardEl.getByRole("button", { name: "Sign in again", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?/);
  const login = new URL(page.url());
  expect(login.searchParams.get("reauth")).toBe("payment");
  expect(login.searchParams.get("redirect")).toBe("/assistant?view=chat&thread=main&payment=appr-1");
  await expect(page.getByText("Sign in again to approve your payment.")).toBeVisible();

  // The sign-in itself is the owner's normal flow; here the session is now fresh and the login redirects back.
  state.staleSession = false;
  await page.goto(login.searchParams.get("redirect")!);
  await expect(page.getByTestId("payment-approval")).toContainText("You're signed in again");
  expect(state.decisions).toHaveLength(1);
  await page.getByTestId("payment-approval").getByRole("button", { name: /^Approve/ }).click();
  await expect.poll(() => state.decisions).toEqual([{ decision: "approved" }, { decision: "approved" }]);

  const handOver = page.getByRole("region", { name: /^Pay / });
  await expect(handOver).toContainText("Open the checkout link on your own device and pay");
  await expect(handOver).toContainText("ME3 does not charge you.");
  await expect(handOver).not.toContainText(/payment (is )?complete|you paid/i);
  await expect(handOver.getByRole("link", { name: "Open checkout" })).toHaveAttribute("href", "https://pay.other.example/c/1");
  await expect(page).not.toHaveURL(/payment=/);
  await page.screenshot({ path: testInfo.outputPath("hand-over.png"), fullPage: true });
});

test("Receipt view confirms the amount, warns on mismatch and keeps the audit trail", async ({ page }) => {
  const state = await fixture(page, { approvals: [], payment: { ...basePayment, status: "handed_over", decidedAt: now, handedOverAt: now }, audit: [{ event: "proposed", data: {}, at: now }, { event: "approved", data: { auth: { channel: "web" } }, at: now }, { event: "handed_over", data: {}, at: now }] });
  await page.goto("/assistant?view=chat&thread=main");
  await page.getByRole("region", { name: /^Pay / }).getByRole("button", { name: "Receipt", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Waiting for your receipt");
  await expect(dialog).toContainText("You approved it after signing in again");
  await expect(dialog.getByRole("button", { name: "I didn't buy it" })).toBeVisible();
  await dialog.getByLabel(/Amount you paid/).fill("24.00");
  await dialog.getByLabel(/Order reference/).fill("R-77");
  await dialog.getByRole("button", { name: "Confirm amount" }).click();
  await expect.poll(() => state.receipts).toEqual([{ amount: "24.00", currency: "EUR", orderReference: "R-77" }]);
  await expect(dialog).toContainText("Paid");
  await expect(dialog).toContainText("R-77");
  await expect(dialog).toContainText("Confirmed by you");
  await expect(dialog.getByRole("alert")).toContainText("The receipt shows");
  await expect(dialog).toContainText("You confirmed the receipt");
  await expect(dialog.getByRole("button", { name: "I didn't buy it" })).toHaveCount(0);
});

test("I didn't buy it marks a handed-over payment as not bought", async ({ page }) => {
  const state = await fixture(page, { approvals: [], payment: { ...basePayment, status: "handed_over", decidedAt: now, handedOverAt: now } });
  await page.goto("/settings/payments");
  await page.getByRole("button", { name: new RegExp(`^${hostile.slice(0, 7)}`) }).click();
  await page.getByRole("dialog").getByRole("button", { name: "I didn't buy it" }).click();
  await expect.poll(() => state.notPaid).toBe(1);
  await expect(page.getByRole("dialog")).toContainText("Not bought");
});

test("Settings shows limits, rejects a per-payment limit above the monthly one, and saves", async ({ page }, testInfo) => {
  const state = await fixture(page, { approvals: [], payment: { ...basePayment, status: "paid", receipt: { amount: "20.00", currency: "EUR", orderReference: null, paidAt: null, source: "email", mismatch: false, ownerConfirmed: false } } });
  await page.goto("/settings/payments");
  await expect(page.getByText("ME3 doesn't store cards")).toBeVisible();
  await expect(page.getByText("You pay on your own device.")).toBeVisible();
  const limits = page.getByRole("region", { name: "Spend limits" });
  await expect(limits).toContainText("EUR");
  await expect(limits).toContainText("Default limits");
  await page.getByRole("button", { name: "Edit EUR limits" }).click();
  await page.getByLabel("Most for one payment").fill("2000");
  await page.getByLabel("Most in 30 days").fill("1000");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(limits.getByRole("alert")).toHaveText("The per-payment limit cannot be higher than the monthly limit.");
  await page.getByLabel("Most for one payment").fill("100");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(limits).not.toContainText("Default limits");
  expect(state.limitPuts).toEqual([{ currency: "EUR", perPaymentMax: "2000", monthlyMax: "1000" }, { currency: "EUR", perPaymentMax: "100", monthlyMax: "1000" }]);
  await expect(page.getByRole("region", { name: "History" })).toContainText("Paid");
  await page.screenshot({ path: testInfo.outputPath("settings-payments.png"), fullPage: true });
});
