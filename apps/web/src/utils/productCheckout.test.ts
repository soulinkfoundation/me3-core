import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { renderProductCheckout } from "../../../../packages/site-renderer/src/product-checkout";

const product = { username: "test", slug: "book", price: 100, currency: "EUR", enabled: true };
function mount() {
  document.body.innerHTML = renderProductCheckout(product);
  const script = document.querySelector("script")!.textContent!;
  // Exercise the actual serialized browser script, including transpilation.
  new Function(script)();
}
function submit() {
  (document.querySelector('[name="buyerName"]') as HTMLInputElement).value = "Test Buyer";
  (document.querySelector('[name="buyerEmail"]') as HTMLInputElement).value = "test@example.com";
  document.querySelector("form")!.dispatchEvent(new Event("submit", {cancelable: true}));
}
beforeEach(() => { window.history.replaceState(null, "", "/products/book"); });
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });
describe("published product checkout", () => {
  it("shows price and prevents purchases in previews or unavailable products", () => {
    expect(renderProductCheckout(product)).toContain("1.00 EUR");
    for (const changed of [{enabled:false}, {available:false}, {price:0}]) {
      const html = renderProductCheckout({...product, ...changed});
      expect(html).not.toContain("<form");
      expect(html).not.toContain("<script>");
    }
  });
  it("submits buyer details once and never submits client prices", async () => {
    let resolve!: (value: unknown) => void;
    const request = vi.fn((_path: string, _options: RequestInit) => new Promise(r => {resolve = r}));
    vi.stubGlobal("fetch", request); mount(); submit(); submit();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe("/api/shop/test/book/order");
    expect(JSON.parse(request.mock.calls[0][1].body as string)).toEqual({buyerName:"Test Buyer",buyerEmail:"test@example.com",returnUrl: window.location.href});
    resolve({ok:true,json:async()=>({paymentMethod:"manual",message:"Check your email."})});
    await vi.waitFor(() => expect(document.querySelector("details")!.hidden).toBe(true));
  });
  it("allows retry after a failed request", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ok:false,json:async()=>({error:"Unavailable"})}));
    mount(); submit();
    await vi.waitFor(() => expect(document.querySelector('[data-product-status]')!.textContent).toBe("Unavailable"));
    expect((document.querySelector('button') as HTMLButtonElement).disabled).toBe(false);
  });
  it("requires server confirmation on the payment return", async () => {
    window.history.replaceState(null,"","/products/book?purchase=success&session_id=cs_test");
    const request = vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,order:{status:"paid",product_slug:"book"}})});
    vi.stubGlobal("fetch",request); mount();
    await vi.waitFor(() => expect(document.querySelector("[data-product-status]")!.textContent).toContain("Payment received."));
    expect(request.mock.calls[0][0]).toBe("/api/shop/test/complete-checkout");
    expect(window.location.search).toBe("");
  });
  it("does not claim success for another product or enable another purchase", async () => {
    window.history.replaceState(null,"","/products/book?purchase=success&session_id=cs_wrong");
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,order:{status:"paid",product_slug:"other"}})}));
    mount();
    await vi.waitFor(() => expect(document.querySelector('[data-product-status]')!.textContent).toContain("not been confirmed"));
    expect(document.querySelector("details")!.hidden).toBe(true);
  });
  it("shows cancellation without completing an order", () => {
    window.history.replaceState(null,"","/products/book?purchase=cancelled");
    const request = vi.fn(); vi.stubGlobal("fetch",request); mount();
    expect(document.querySelector("details")!.open).toBe(true);
    expect(document.body.textContent).toContain("Checkout cancelled.");
    expect(request).not.toHaveBeenCalled();
  });
});
