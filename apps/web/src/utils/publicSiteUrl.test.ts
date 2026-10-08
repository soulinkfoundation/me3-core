import { describe, expect, it } from "vitest";
import {
  configuredPublicProfileUrl,
  permanentPublicSitePath,
} from "./publicSiteUrl";

describe("configuredPublicProfileUrl", () => {
  it("uses a configured custom domain", () => {
    expect(configuredPublicProfileUrl({ custom_domain: "example.com" })).toBe(
      "https://example.com",
    );
  });

  it("falls back when no custom domain is configured", () => {
    expect(configuredPublicProfileUrl({ custom_domain: null })).toBeNull();
  });

  it("does not use a custom domain before it is active", () => {
    expect(
      configuredPublicProfileUrl({
        custom_domain: "www.example.com",
        custom_domain_status: "pending",
      }),
    ).toBeNull();
  });

  it("gives each additional site a stable fallback path", () => {
    expect(permanentPublicSitePath("studio", "organization")).toBe(
      "/site/studio/",
    );
    expect(permanentPublicSitePath("owner", "profile")).toBe("/");
  });
});
