import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn() }));
vi.mock("../api", () => ({ API_BASE: "/api", ApiError: class extends Error {}, api }));
vi.mock("../composables/useAppToast", () => ({
  useAppToast: () => ({ toastFromUnknown: vi.fn(), toastSuccess: vi.fn(), toastError: vi.fn() }),
}));
vi.mock("vue-router", () => ({ RouterLink: { props: ["to"], template: '<a :href="to"><slot /></a>' } }));

import WaitingPayments from "../components/accounts/WaitingPayments.vue";
import PaymentsNeedYou from "../components/home/PaymentsNeedYou.vue";
import PayDirectlySettings from "../components/payments/PayDirectlySettings.vue";
import PaymentCollectionFields from "../components/wizard/PaymentCollectionFields.vue";
import { validateManualPaymentInstructions } from "../composables/usePublish";
import { buyerPreview, methodsOfferedFor, usePayDirectlyMethods, type PaymentMethod, type WaitingPayment } from "./payDirectly";

// Failure modes this file guards:
// - an offer with a saved method and no note is still blocked from publishing, or one with neither gets through;
// - a bank account in another currency counts as a way to pay (a EUR account for a USD offer);
// - the note is still required, or existing free text is dropped or changed when the editor opens;
// - the editor says nothing when the owner has no way to get paid, or does not point to Settings;
// - Settings sends the wrong fields (a UK account saved as an IBAN, or stale IBAN left behind after a switch);
// - the "buyers see" preview claims a link carries the reference when it does not;
// - Waiting marks the wrong thing paid, uses the order route for a booking, or pays on a single stray tap.

const method = (over: Partial<PaymentMethod>): PaymentMethod => ({
  id: "m", kind: "paypal", enabled: true, link: null, accountName: null, iban: null, bic: null,
  sortCode: null, accountNumber: null, currency: null, ...over,
});
const paypal = method({ id: "m-paypal", kind: "paypal", link: "https://paypal.me/clara" });
const eurBank = method({ id: "m-eur", kind: "bank", accountName: "Clara Byrne", iban: "IE29AIBK93115212345678", currency: "EUR" });
const stubs = { AppDialog: { props: ["open"], template: '<div v-if="open"><slot /></div>' }, StripePaymentSetupCallout: true, UiIcon: true, PageLoading: true };

function wizardWith(over: { note?: string; currency?: string; product?: boolean }) {
  const pricing = { enabled: true, suggestedAmount: 60, currency: over.currency || "EUR", paymentMethod: "manual", paymentInstructions: over.note || "" };
  return {
    shopEnabled: Boolean(over.product),
    products: over.product ? [{ title: "Print", available: true, price: 25, currency: over.currency || "EUR", paymentMethod: "manual", paymentInstructions: over.note || "" }] : [],
    bookingsEnabled: !over.product,
    profile: { booking: { offers: [{ title: "Intro session", pricing }], classOffers: [], retreatOffers: [] } },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  usePayDirectlyMethods().reset();
  localStorage.clear();
});

describe("publishing a Pay me directly offer", () => {
  it("lets through an offer with a saved method and no note, and one with only a note", () => {
    expect(validateManualPaymentInstructions(wizardWith({}), [paypal])).toBeNull();
    expect(validateManualPaymentInstructions(wizardWith({ note: "Cash on the day" }), [])).toBeNull();
    expect(validateManualPaymentInstructions(wizardWith({ product: true }), [eurBank])).toBeNull();
  });

  it("names the offer and points to Settings when there is neither", () => {
    expect(validateManualPaymentInstructions(wizardWith({}), [])).toBe(
      'Bookings — "Intro session": add a way to get paid in EUR in Settings → Payments, or a note for buyers.',
    );
    expect(validateManualPaymentInstructions(wizardWith({ product: true, currency: "USD" }), [])).toContain('Offerings — "Print": add a way to get paid in USD');
  });

  it("does not count a bank account in another currency, or a method that is switched off", () => {
    expect(validateManualPaymentInstructions(wizardWith({ currency: "USD" }), [eurBank])).toContain("in USD");
    expect(validateManualPaymentInstructions(wizardWith({}), [{ ...paypal, enabled: false }])).toContain("in EUR");
    expect(methodsOfferedFor([paypal, eurBank], "USD").map((item) => item.id)).toEqual(["m-paypal"]);
  });
});

describe("the offer editor's payment fields", () => {
  const mountFields = (props: Record<string, unknown>) => mount(PaymentCollectionFields, {
    props: { modelValue: "manual", instructions: "", inputId: "offer", currency: "EUR", ...props },
    global: { stubs },
  });

  it("is called Pay me directly, with an optional note and the saved methods that will be offered", async () => {
    api.get.mockResolvedValue({ methods: [paypal, eurBank, method({ id: "gbp", kind: "bank", accountName: "Clara", sortCode: "401234", accountNumber: "12345678", currency: "GBP" })] });
    const wrapper = mountFields({});
    await flushPromises();
    expect(wrapper.text()).toContain("Pay me directly");
    expect(wrapper.text()).not.toContain("Pay separately");
    expect(wrapper.get('[data-test="pay-directly-offered"]').text()).toContain("PayPal, Bank transfer");
    const note = wrapper.get("textarea");
    expect(note.attributes("required")).toBeUndefined();
    expect(wrapper.text()).toContain("Note for buyers (optional)");
    expect(wrapper.find('[data-test="pay-directly-missing"]').exists()).toBe(false);
  });

  it("opens existing free text in the note unchanged, and suggests tidying it only once", async () => {
    api.get.mockResolvedValue({ methods: [paypal] });
    const wrapper = mountFields({ instructions: "Pay to IE29 AIBK 9311 5212 3456 78\nThanks!" });
    await flushPromises();
    expect((wrapper.get("textarea").element as HTMLTextAreaElement).value).toBe("Pay to IE29 AIBK 9311 5212 3456 78\nThanks!");
    expect(wrapper.emitted("update:instructions")).toBeUndefined();
    await wrapper.get('[data-test="pay-directly-tidy"] button').trigger("click");
    expect(wrapper.find('[data-test="pay-directly-tidy"]').exists()).toBe(false);
    const again = mountFields({ instructions: "Pay to IE29…" });
    await flushPromises();
    expect(again.find('[data-test="pay-directly-tidy"]').exists()).toBe(false);
  });

  it("points to Settings → Payments when there is no saved method for the currency and no note", async () => {
    api.get.mockResolvedValue({ methods: [eurBank] });
    const wrapper = mountFields({ currency: "USD" });
    await flushPromises();
    const missing = wrapper.get('[data-test="pay-directly-missing"]');
    expect(missing.text()).toContain("no way to get paid in USD");
    expect(missing.get("a").attributes("href")).toBe("/account?section=payments");
  });
});

// Failure modes: "Let them choose" is saved as a third paymentMethod value (which older apps would
// rewrite to card-only), the flag is left on after switching away, or it publishes with no way to pay directly.
describe("Let them choose", () => {
  const mountFields = (props: Record<string, unknown>) => mount(PaymentCollectionFields, {
    props: { modelValue: "stripe", instructions: "", inputId: "offer", currency: "EUR", ...props },
    global: { stubs },
  });

  it("is saved as a card offer plus a flag, and cleared when another option is picked", async () => {
    api.get.mockResolvedValue({ methods: [paypal] });
    const wrapper = mountFields({});
    await flushPromises();
    await wrapper.get('input[value="choose"]').setValue(true);
    expect(wrapper.emitted("update:modelValue")!.at(-1)).toEqual(["stripe"]);
    expect(wrapper.emitted("update:allowPayDirectly")!.at(-1)).toEqual([true]);
    await wrapper.setProps({ allowPayDirectly: true });
    // The buyer may pay directly, so the saved methods and the note show.
    expect(wrapper.get('[data-test="pay-directly-offered"]').text()).toContain("PayPal");
    expect(wrapper.find("textarea").exists()).toBe(true);
    expect((wrapper.get('input[value="choose"]').element as HTMLInputElement).checked).toBe(true);

    await wrapper.get('input[value="manual"]').setValue(true);
    expect(wrapper.emitted("update:modelValue")!.at(-1)).toEqual(["manual"]);
    expect(wrapper.emitted("update:allowPayDirectly")!.at(-1)).toEqual([false]);
    await wrapper.get('input[value="stripe"]').setValue(true);
    expect(wrapper.emitted("update:allowPayDirectly")!.at(-1)).toEqual([false]);
  });

  it("needs a saved method or a note to publish, like a pay-directly offer", () => {
    const wizard = (allowPayDirectly: boolean) => ({
      shopEnabled: true,
      products: [{ title: "Print", available: true, price: 25, currency: "EUR", paymentMethod: "stripe", allowPayDirectly, paymentInstructions: "" }],
      bookingsEnabled: true,
      profile: { booking: { offers: [{ title: "Intro session", pricing: { enabled: true, suggestedAmount: 60, currency: "EUR", paymentMethod: "stripe", allowPayDirectly, paymentInstructions: "" } }], classOffers: [], retreatOffers: [] } },
    }) as never;
    expect(validateManualPaymentInstructions(wizard(true), [])).toContain('Offerings — "Print": add a way to get paid in EUR');
    expect(validateManualPaymentInstructions(wizard(true), [paypal])).toBeNull();
    // A plain card offer needs nothing here.
    expect(validateManualPaymentInstructions(wizard(false), [])).toBeNull();
  });
});

describe("Settings → Payments: Pay me directly", () => {
  async function mountSettings(methods: PaymentMethod[] = []) {
    api.get.mockResolvedValue({ methods });
    const wrapper = mount(PayDirectlySettings, { global: { stubs } });
    await flushPromises();
    return wrapper;
  }

  it("saves a PayPal link and a euro bank account", async () => {
    const wrapper = await mountSettings();
    await wrapper.get(".pay-directly__add").trigger("click");
    await wrapper.get('input[name="link"]').setValue("paypal.me/clara");
    api.post.mockResolvedValueOnce({ method: paypal });
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(api.post).toHaveBeenLastCalledWith("/commerce/payment-methods", { kind: "paypal", link: "paypal.me/clara" });

    await wrapper.get(".pay-directly__add").trigger("click");
    await wrapper.findAll('.pay-directly-segments button').find((button) => button.text() === "Bank")!.trigger("click");
    await wrapper.get('input[name="accountName"]').setValue("Clara Byrne");
    await wrapper.get('input[name="iban"]').setValue("IE29 AIBK 9311 5212 3456 78");
    api.post.mockResolvedValueOnce({ method: eurBank });
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(api.post).toHaveBeenLastCalledWith("/commerce/payment-methods", {
      kind: "bank", accountName: "Clara Byrne", iban: "IE29 AIBK 9311 5212 3456 78", bic: "", currency: "EUR", sortCode: "", accountNumber: "",
    });
    expect(wrapper.findAll(".pay-directly__row").map((row) => row.text())).toEqual([
      expect.stringContaining("paypal.me/clara"), expect.stringContaining("IE29 AIBK 9311 5212 3456 78"),
    ]);
  });

  it("switches the bank form to a UK sort code and account number, clearing the IBAN", async () => {
    const wrapper = await mountSettings([eurBank]);
    await wrapper.get(".pay-directly__quiet").trigger("click");
    await wrapper.findAll('.pay-directly-segments button').find((button) => button.text() === "UK sort code")!.trigger("click");
    expect(wrapper.find('input[name="iban"]').exists()).toBe(false);
    await wrapper.get('input[name="sortCode"]').setValue("40-12-34");
    await wrapper.get('input[name="accountNumber"]').setValue("12345678");
    api.patch.mockResolvedValueOnce({ method: method({ id: "m-eur", kind: "bank", accountName: "Clara Byrne", sortCode: "401234", accountNumber: "12345678", currency: "GBP" }) });
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(api.patch).toHaveBeenLastCalledWith("/commerce/payment-methods/m-eur", {
      accountName: "Clara Byrne", sortCode: "40-12-34", accountNumber: "12345678", iban: "", bic: "", currency: "GBP",
    });
  });

  it("shows the Worker's plain message for a wrong IBAN and keeps the form open", async () => {
    const wrapper = await mountSettings();
    await wrapper.get(".pay-directly__add").trigger("click");
    await wrapper.get('input[name="link"]').setValue("example.com/me");
    api.post.mockRejectedValueOnce(new Error("That doesn't look like a PayPal.me link."));
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe("That doesn't look like a PayPal.me link.");
    expect(wrapper.find('input[name="link"]').exists()).toBe(true);
  });

  it("switches a method off and removes one only after a second tap", async () => {
    const wrapper = await mountSettings([paypal]);
    api.patch.mockResolvedValueOnce({ method: { ...paypal, enabled: false } });
    await wrapper.get('[role="switch"]').trigger("click");
    await flushPromises();
    expect(api.patch).toHaveBeenCalledWith("/commerce/payment-methods/m-paypal", { enabled: false });

    await wrapper.get(".pay-directly__quiet").trigger("click");
    const remove = wrapper.get(".pay-directly-dialog__remove");
    await remove.trigger("click");
    expect(api.delete).not.toHaveBeenCalled();
    api.delete.mockResolvedValueOnce({ ok: true });
    await remove.trigger("click");
    await flushPromises();
    expect(api.delete).toHaveBeenCalledWith("/commerce/payment-methods/m-paypal");
    expect(wrapper.findAll(".pay-directly__row")).toHaveLength(0);
  });

  it("previews what buyers see without claiming every link carries the reference", () => {
    const lines = buyerPreview([paypal, method({ id: "r", kind: "revolut", link: "https://revolut.me/clara" }), eurBank], 6000, "EUR");
    expect(lines.map((line) => line.name)).toEqual(["Pay with PayPal", "Pay with Revolut", "Bank transfer"]);
    expect(lines[0].hint).toBe("Opens PayPal with €60.00 filled in. Add the reference as a note if you can.");
    expect(lines[1].hint).toBe("Opens Revolut. Enter €60.00 and add the reference.");
    expect(lines[2].hint).toContain("QR code");
    expect(buyerPreview([eurBank], 6000, "GBP")).toEqual([]);
  });
});

describe("Accounts → Waiting", () => {
  const item = (over: Partial<WaitingPayment>): WaitingPayment => ({
    kind: "booking", id: "b1", reference: "ME3-4F7K", customerName: "Ana Silva", customerEmail: "ana@example.invalid",
    title: "Intro session", amountCents: 6000, currency: "EUR", createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    saysPaidAt: null, remindedAt: null, bookingType: "one_to_one", startsAt: "2026-11-20T10:00:00.000Z", quantity: 1, ...over,
  });

  it("lists orders, bookings and events with who, what, amount, reference and Says paid", async () => {
    api.get.mockResolvedValue({ waiting: [
      item({}),
      item({ kind: "order", id: "o1", reference: "ME3-9QX2", customerName: "Tom Reilly", title: "Notebook set", amountCents: 2500, startsAt: null, bookingType: null, saysPaidAt: "2026-11-16T10:00:00Z" }),
      item({ kind: "event", id: "e1", reference: "ME3-2LM8", customerName: "Maeve Doyle", title: "Group class", amountCents: 3000, quantity: 2, bookingType: "class" }),
    ] });
    const wrapper = mount(WaitingPayments, { global: { stubs } });
    await flushPromises();
    expect(api.get).toHaveBeenCalledWith("/accounts/waiting");
    const rows = wrapper.findAll(".waiting-payments__row").map((row) => row.text());
    expect(rows[0]).toContain("Ana Silva");
    expect(rows[0]).toContain("ME3-4F7K");
    expect(rows[0]).toContain("Waiting 2 days");
    expect(rows[0]).not.toContain("Says paid");
    expect(rows[1]).toContain("Notebook set");
    expect(rows[1]).toContain("Says paid");
    expect(rows[2]).toContain("2 places");
    expect(wrapper.get(".waiting-payments__note").text()).toMatch(/€115\.00 waiting/);
  });

  it("marks a booking paid on the bookings route and an order on the orders route, after a second tap", async () => {
    api.get.mockResolvedValue({ waiting: [item({}), item({ kind: "order", id: "o1", customerName: "Tom Reilly", title: "Notebook set", startsAt: null, bookingType: null })] });
    api.post.mockResolvedValue({ ok: true });
    const wrapper = mount(WaitingPayments, { global: { stubs } });
    await flushPromises();
    const button = () => wrapper.findAll(".waiting-payments__row")[0].findAll("button").find((candidate) => /Mark paid|Yes, it arrived|Saving/.test(candidate.text()))!;
    await button().trigger("click");
    expect(api.post).not.toHaveBeenCalled();
    expect(button().text()).toBe("Yes, it arrived");
    await button().trigger("click");
    await flushPromises();
    expect(api.post).toHaveBeenLastCalledWith("/accounts/bookings/b1/manual-payment", {});
    expect(wrapper.findAll(".waiting-payments__row")).toHaveLength(1);

    await button().trigger("click");
    await button().trigger("click");
    await flushPromises();
    expect(api.post).toHaveBeenLastCalledWith("/accounts/orders/o1/manual-payment", {});
    expect(wrapper.text()).toContain("Nothing is waiting to be paid");
  });

  it("reminds, keeps holding, releases after a second tap and restores, each by the order's reference", async () => {
    const held = item({ heldUntil: "2026-11-22T10:00:00.000Z", remindedAt: "2026-11-17T10:00:00Z" });
    const stale = item({ id: "b2", reference: "ME3-9QX2", customerName: "Tom Reilly", saysPaidAt: "2026-11-10T10:00:00Z", heldUntil: null, needsDecision: true });
    api.get.mockResolvedValue({
      waiting: [held, stale],
      released: [{ kind: "booking", id: "b3", reference: "ME3-2LM8", customerName: "Maeve Doyle", title: "Group class", amountCents: 1500, currency: "EUR", startsAt: "2026-12-01T10:00:00.000Z", quantity: 1, releasedAt: "2026-11-16T10:00:00Z" }],
      settings: { remindAfterDays: 2, releaseAfterDays: 7 },
    });
    api.post.mockResolvedValue({ ok: true });
    const wrapper = mount(WaitingPayments, { global: { stubs } });
    await flushPromises();
    // The list reloads after each action, so rows are looked up afresh.
    const action = (row: number, label: RegExp) => wrapper.findAll(".waiting-payments__row")[row].findAll("button").find((candidate) => label.test(candidate.text()))!;
    const rows = wrapper.findAll(".waiting-payments__row");
    expect(rows[0].text()).toContain("Held until");
    expect(rows[0].text()).toContain("Reminded");
    expect(rows[1].text()).toContain("Says paid");
    expect(rows[1].text()).not.toContain("Held until");
    expect(rows[1].text()).toContain("Tom said they paid a while ago");
    expect(wrapper.get(".waiting-payments__note").text()).toContain("released after 7 days");

    await action(0, /^Remind Ana$/).trigger("click");
    await flushPromises();
    expect(api.post).toHaveBeenLastCalledWith("/accounts/waiting/ME3-4F7K/remind", {});
    await action(0, /^Keep holding$/).trigger("click");
    await flushPromises();
    expect(api.post).toHaveBeenLastCalledWith("/accounts/waiting/ME3-4F7K/keep", {});
    await action(1, /^Not yet$/).trigger("click");
    await flushPromises();
    expect(api.post).toHaveBeenLastCalledWith("/accounts/waiting/ME3-9QX2/keep", {});

    api.post.mockClear();
    await action(1, /^Release$/).trigger("click");
    expect(api.post).not.toHaveBeenCalled();
    await action(1, /^Release and tell them\?$/).trigger("click");
    await flushPromises();
    expect(api.post).toHaveBeenLastCalledWith("/accounts/waiting/ME3-9QX2/release", {});

    await wrapper.get(".waiting-payments__released").findAll("button").find((candidate) => candidate.text() === "Restore")!.trigger("click");
    await flushPromises();
    expect(api.post).toHaveBeenLastCalledWith("/accounts/waiting/ME3-2LM8/restore", {});
  });
});

// Failure modes: a match is shown as paid rather than as a suggestion; Confirm or Not yet goes to the
// wrong order; an email that fits two orders offers a one-tap Confirm on Home instead of asking which.
describe("a payment email that matches a waiting order", () => {
  const match = { messageId: "m1", provider: "paypal" as const, providerLabel: "PayPal", amountCents: 6000, currency: "EUR", payerName: "Ana Silva", subject: "You've got money", receivedAt: "2026-11-17T14:02:00Z", by: "amount_and_name" as const, alsoFits: [] as string[] };
  const booking = (over: Partial<WaitingPayment>): WaitingPayment => ({
    kind: "booking", id: "b1", reference: "ME3-4F7K", customerName: "Ana Silva", customerEmail: "ana@example.invalid", title: "Intro session",
    amountCents: 6000, currency: "EUR", createdAt: new Date().toISOString(), saysPaidAt: null, remindedAt: null, bookingType: "one_to_one",
    startsAt: "2026-11-20T10:00:00.000Z", quantity: 1, heldUntil: "2026-11-22T10:00:00.000Z", needsYou: true, match, ...over,
  });

  it("shows Match found with the email as evidence in Waiting, and confirms or leaves it by reference", async () => {
    api.get.mockResolvedValue({ waiting: [booking({})] });
    api.post.mockResolvedValue({ ok: true });
    const wrapper = mount(WaitingPayments, { global: { stubs } });
    await flushPromises();
    const row = () => wrapper.get(".waiting-payments__row");
    expect(row().text()).toContain("Match found");
    expect(row().get(".waiting-payments__match p").text()).toMatch(/^From PayPal’s email at .+: €60\.00 from Ana Silva, same amount and a similar name\.$/);
    const button = (label: string) => row().findAll(".waiting-payments__match button").find((candidate) => candidate.text() === label)!;
    await button("Not yet").trigger("click");
    await flushPromises();
    expect(api.post).toHaveBeenLastCalledWith("/accounts/waiting/ME3-4F7K/not-yet", {});
    await button("Confirm").trigger("click");
    await flushPromises();
    expect(api.post).toHaveBeenLastCalledWith("/accounts/waiting/ME3-4F7K/confirm", {});
  });

  it("puts it on Home with Confirm and Not yet, but only asks which when the email fits two orders", async () => {
    const other = booking({ id: "b2", reference: "ME3-2LM8", customerName: "Rita Silva", match: { ...match, alsoFits: ["ME3-4F7K"] } });
    api.get.mockResolvedValue({ waiting: [booking({ match: { ...match, by: "reference" } }), other, booking({ id: "b3", reference: "ME3-ZZZZ", needsYou: false, match: null })] });
    api.post.mockResolvedValue({ ok: true });
    const wrapper = mount(PaymentsNeedYou, { global: { stubs } });
    await flushPromises();
    const items = wrapper.findAll(".payments-need-you__item");
    expect(items).toHaveLength(2);
    expect(items[0].text()).toContain("Ana Silva paid €60.00");
    expect(items[0].text()).toContain("reference ME3-4F7K");
    expect(items[1].text()).toContain("may be Rita Silva’s");
    expect(items[1].text()).toContain("It also fits ME3-4F7K");
    expect(items[1].find(".payments-need-you__actions").exists()).toBe(false);
    await items[0].findAll("button").find((candidate) => candidate.text() === "Confirm")!.trigger("click");
    await flushPromises();
    expect(api.post).toHaveBeenLastCalledWith("/accounts/waiting/ME3-4F7K/confirm", {});
  });
});

describe("Settings → Payments: If they don't pay", () => {
  it("shows the saved days, saves a change, and puts the choice back when the Worker refuses it", async () => {
    api.get.mockImplementation(async (path: string) => path === "/commerce/status"
      ? { payDirectly: { methods: [], remindAfterDays: 3, releaseAfterDays: 7 } }
      : { methods: [] });
    const wrapper = mount(PayDirectlySettings, { global: { stubs } });
    await flushPromises();
    const remind = wrapper.get('select[name="remindAfterDays"]');
    const release = wrapper.get('select[name="releaseAfterDays"]');
    expect((remind.element as HTMLSelectElement).value).toBe("3");
    expect((release.element as HTMLSelectElement).value).toBe("7");

    api.put.mockResolvedValueOnce({ ok: true, remindAfterDays: 3, releaseAfterDays: 10 });
    await release.setValue("10");
    await flushPromises();
    expect(api.put).toHaveBeenLastCalledWith("/commerce/pay-directly-settings", { remindAfterDays: 3, releaseAfterDays: 10 });

    api.put.mockRejectedValueOnce(new Error("Remind buyers before the booking is released."));
    await remind.setValue("12");
    await flushPromises();
    expect(wrapper.get(".pay-directly__hold [role=\"alert\"]").text()).toBe("Remind buyers before the booking is released.");
    expect((remind.element as HTMLSelectElement).value).toBe("3");
  });
});
