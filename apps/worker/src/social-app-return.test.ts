import { describe, expect, it } from "vitest";
import { socialAppDeepLink, socialAppReturnPage, socialAppReturnPath } from "./social-app-return";

describe("Social app return", () => {
  it("stores a return path the OAuth callback can extend", () => {
    expect(socialAppReturnPath("ios")).toBe("/api/social/oauth/app-return?app=ios");
  });

  it("deep links a connected platform or a safe error code into each app", () => {
    expect(socialAppDeepLink("ios", { connected: "linkedin" })).toBe("me3mobile://social?social_connected=linkedin");
    expect(socialAppDeepLink("android", { error: "access_denied" })).toBe("me3android://social?social_error=access_denied");
    expect(socialAppDeepLink("ios", { connected: "<x>", error: "a b" })).toBe("me3mobile://social?social_error=failed");
    expect(socialAppDeepLink("android", {})).toBe("me3android://social?social_error=failed");
  });

  it("renders a page that redirects and offers a tappable fallback", () => {
    const page = socialAppReturnPage("me3mobile://social?social_connected=x");
    expect(page).toContain('href="me3mobile://social?social_connected=x"');
    expect(page).toContain("Taking you back to ME3.");
    expect(page).not.toContain("Stripe");
  });
});
