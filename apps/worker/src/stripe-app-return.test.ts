import { describe, expect, it } from "vitest";
import {
  parseStripeReturnApp,
  stripeAppDeepLink,
  stripeAppReturnPage,
  stripeAppReturnUrl,
} from "./stripe-app-return";

describe("Stripe app return", () => {
  it("accepts only the two phone apps", () => {
    expect(parseStripeReturnApp("ios")).toBe("ios");
    expect(parseStripeReturnApp("android")).toBe("android");
    expect(parseStripeReturnApp("web")).toBeNull();
    expect(parseStripeReturnApp(undefined)).toBeNull();
  });

  it("returns to the installation's web origin so ME3 Cloud accepts it", () => {
    expect(stripeAppReturnUrl("https://ana.me3.app", "ios")).toBe(
      "https://ana.me3.app/api/commerce/connect/return?app=ios",
    );
  });

  it("deep links into each app with a fixed result", () => {
    expect(stripeAppDeepLink("ios", "success")).toBe("me3mobile://payments?stripe_connect=success");
    expect(stripeAppDeepLink("android", "refresh")).toBe("me3android://payments?stripe_connect=refresh");
    expect(stripeAppDeepLink("android", "<script>")).toBe("me3android://payments?stripe_connect=refresh");
  });

  it("renders a page that redirects and offers a tappable fallback", () => {
    const page = stripeAppReturnPage("me3mobile://payments?stripe_connect=success");
    expect(page).toContain('href="me3mobile://payments?stripe_connect=success"');
    expect(page).toContain('window.location.replace("me3mobile://payments?stripe_connect=success")');
  });
});
