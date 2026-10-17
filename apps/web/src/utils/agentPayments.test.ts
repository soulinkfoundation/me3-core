import { describe, expect, it } from "vitest";
import { ApiError } from "../api";
import {
  formatPaymentMoney,
  isFreshAuthenticationRequired,
  paymentActions,
  paymentApprovalView,
  paymentAuditLabel,
  paymentHandOver,
  paymentReauthLocation,
  paymentReceiptWarning,
  paymentStatusLabel,
  paymentTimestamp,
  type PaymentRecord,
} from "./agentPayments";

const card = {
  kind: "payment", requiresFreshAuthentication: true, proposalId: "p1", proposalHash: "h1",
  merchant: { name: "Bramble <b>", url: "https://bramble.example/book" }, purpose: "Friday dinner deposit",
  items: [{ name: "Table for four", quantity: 1, options: "Fri 19:30" }, { name: "Gift card", quantity: 2 }],
  amount: "20.00", currency: "EUR", checkoutUrl: "https://pay.other.example/c/1", checkoutDomainDiffers: true,
  refundPolicy: "Refundable until Thursday 18:00",
  limits: { currency: "EUR", perPaymentMax: "250.00", monthlyMax: "1000.00", usedLast30Days: "600.00", remaining: "400.00" },
  howItWorks: "You pay on your own device. ME3 does not charge you and never sees your card details.",
};
const approval = { id: "a1", threadId: "t1", title: "Approve payment", summary: "20.00 EUR to Bramble", status: "pending", payload: card };

const payment = (overrides: Partial<PaymentRecord> = {}): PaymentRecord => ({
  id: "p1", status: "handed_over", merchant: { name: "Bramble", url: "https://bramble.example/book" }, purpose: "Deposit",
  items: [{ name: "Table", quantity: 1 }], amount: "20.00", currency: "EUR", checkoutUrl: null, checkoutDomainDiffers: false,
  refundPolicy: null, createdAt: "2026-10-17 10:00:00", decidedAt: null, handedOverAt: null, completedAt: null, receipt: null, ...overrides,
});

describe("paymentApprovalView", () => {
  it("ignores approvals that are not payments", () => {
    expect(paymentApprovalView({ id: "a2", title: "Send email", payload: { recipient: "a@example.test" } })).toBeNull();
  });

  it("keeps the full proposal: merchant, items with quantity and options, total, purpose, refund policy and limit", () => {
    const view = paymentApprovalView(approval)!;
    expect(view).toMatchObject({
      approvalId: "a1", threadId: "t1", proposalId: "p1", pending: true,
      merchantName: "Bramble <b>", merchantHref: "https://bramble.example/book", merchantHost: "bramble.example",
      purpose: "Friday dinner deposit", refundPolicy: "Refundable until Thursday 18:00",
      items: [{ name: "Table for four", quantity: 1, options: "Fri 19:30" }, { name: "Gift card", quantity: 2, options: null }],
      howItWorks: "You pay on your own device. ME3 does not charge you and never sees your card details.",
    });
    expect(view.total).toBe(formatPaymentMoney("20.00", "EUR"));
    expect(view.remainingLimit).toBe(`${formatPaymentMoney("400.00", "EUR")} left of your ${formatPaymentMoney("1000.00", "EUR")} 30-day limit`);
  });

  it("warns when the checkout link is on a different site than the merchant", () => {
    const view = paymentApprovalView(approval)!;
    expect(view.checkoutHref).toBe("https://pay.other.example/c/1");
    expect(view.checkoutWarning).toBe("The checkout link opens pay.other.example, not bramble.example. Check it is the merchant's payment page before you pay.");
    expect(paymentApprovalView({ ...approval, payload: { ...card, checkoutDomainDiffers: false } })!.checkoutWarning).toBeNull();
  });

  it("never turns a non-https merchant or checkout link into a clickable link", () => {
    const view = paymentApprovalView({ ...approval, payload: { ...card, merchant: { name: "X", url: "javascript:alert(1)" }, checkoutUrl: "http://plain.example/pay" } })!;
    expect(view.merchantHref).toBeNull();
    expect(view.checkoutHref).toBeNull();
  });

  it("always shows the you-pay-on-your-device line even when the card omits it", () => {
    const { howItWorks: _omit, ...rest } = card;
    expect(paymentApprovalView({ ...approval, payload: rest })!.howItWorks).toBe("You pay on your own device. ME3 does not charge you and never sees your card details.");
  });

  it("reads cards that only carry fields at the top level", () => {
    expect(paymentApprovalView({ id: "a3", ...card })!.proposalId).toBe("p1");
  });
});

describe("fresh sign-in", () => {
  it("recognises only the fresh-authentication refusal", () => {
    expect(isFreshAuthenticationRequired(new ApiError("Sign in again", 403, "fresh_authentication_required"))).toBe(true);
    expect(isFreshAuthenticationRequired(new ApiError("Already decided", 409, "payment_conflict"))).toBe(false);
    expect(isFreshAuthenticationRequired(new ApiError("Forbidden", 403))).toBe(false);
    expect(isFreshAuthenticationRequired(new Error("fresh_authentication_required"))).toBe(false);
  });

  it("sends the owner through the normal sign-in and back to the same approval in Chat", () => {
    expect(paymentReauthLocation({ approvalId: "a 1", threadId: "t/1" })).toEqual({
      path: "/login",
      query: { reauth: "payment", redirect: "/assistant?view=chat&thread=t%2F1&payment=a%201" },
    });
  });
});

describe("hand-over", () => {
  it("opens the checkout link when there is one, otherwise the merchant page, and never says it is paid", () => {
    expect(paymentHandOver(payment({ checkoutUrl: "https://shop.example/cart/1:1" }))).toEqual({
      openUrl: "https://shop.example/cart/1:1",
      instructions: `Open the checkout link on your own device and pay ${formatPaymentMoney("20.00", "EUR")} to Bramble. ME3 does not charge you.`,
    });
    const fallback = paymentHandOver(payment())!;
    expect(fallback.openUrl).toBe("https://bramble.example/book");
    expect(fallback.instructions).toContain("add the items listed");
    expect(fallback.instructions).not.toMatch(/\bpaid\b|complete/i);
  });

  it("has no hand-over for proposals that were not approved", () => {
    expect(paymentHandOver(payment({ status: "proposed" }))).toBeNull();
    expect(paymentHandOver(payment({ status: "declined" }))).toBeNull();
  });
});

describe("receipts", () => {
  it("labels every status", () => {
    expect(["proposed", "declined", "handed_over", "paid", "not_paid"].map(paymentStatusLabel)).toEqual([
      "Waiting for your OK", "Declined", "Waiting for your receipt", "Paid", "Not bought",
    ]);
  });

  it("warns when the receipt amount differs from what was approved", () => {
    const receipt = { amount: "24.00", currency: "EUR", orderReference: "R-1", paidAt: null, source: "email", mismatch: true, ownerConfirmed: false };
    expect(paymentReceiptWarning(payment({ status: "paid", receipt }))).toBe(`The receipt shows ${formatPaymentMoney("24.00", "EUR")}, but you approved ${formatPaymentMoney("20.00", "EUR")}.`);
    expect(paymentReceiptWarning(payment({ status: "paid", receipt: { ...receipt, mismatch: false } }))).toBeNull();
  });

  it("only offers receipt actions the server accepts", () => {
    expect(paymentActions(payment())).toEqual({ confirm: true, notPaid: true });
    expect(paymentActions(payment({ status: "paid", receipt: { amount: "20.00", currency: "EUR", orderReference: null, paidAt: null, source: "email", mismatch: false, ownerConfirmed: false } }))).toEqual({ confirm: true, notPaid: false });
    for (const status of ["proposed", "declined", "not_paid"]) expect(paymentActions(payment({ status }))).toEqual({ confirm: false, notPaid: false });
  });

  it("describes audit events in plain words", () => {
    expect(paymentAuditLabel({ event: "approved", data: { auth: { channel: "web" } } })).toBe("You approved it after signing in again");
    expect(paymentAuditLabel({ event: "approved", data: { auth: { channel: "mobile" } } })).toBe("You approved it on your phone");
    expect(paymentAuditLabel({ event: "receipt_recorded", data: { source: "email", mismatch: true } })).toBe("Receipt read from the order email · amount differs");
    expect(paymentAuditLabel({ event: "receipt_recorded", data: { source: "owner" } })).toBe("You confirmed the receipt");
    expect(paymentAuditLabel({ event: "something_new", data: {} })).toBe("something new");
  });

  it("falls back to the plain amount for an unknown currency", () => {
    expect(formatPaymentMoney("20.00", "ZZZZ")).toBe("20.00 ZZZZ");
  });
});

describe("payment timestamps", () => {
  it("reads both D1 timestamps and ISO strings as UTC", () => {
    expect(paymentTimestamp("2026-10-17 10:00:00")).toBe(Date.UTC(2026, 9, 17, 10));
    expect(paymentTimestamp("2026-10-17T10:00:00.000Z")).toBe(Date.UTC(2026, 9, 17, 10));
    expect(paymentTimestamp("2026-10-17T12:00:00+02:00")).toBe(Date.UTC(2026, 9, 17, 10));
    expect(paymentTimestamp("not a date")).toBeNull();
  });
});
