import { afterEach, describe, expect, it } from "vitest";
import { emojiFaviconHref, updateFeatureFavicon } from "./favicon";

describe("favicon utilities", () => {
  afterEach(() => {
    document.head.innerHTML = "";
  });

  it("builds an SVG data URL for an emoji favicon", () => {
    const href = emojiFaviconHref("🚀");

    expect(href).toMatch(/^data:image\/svg\+xml,/);
    expect(decodeURIComponent(href)).toContain("🚀");
  });

  it("adds a dynamic feature favicon for known app paths", () => {
    updateFeatureFavicon("/journal");

    const element = document.querySelector<HTMLLinkElement>(
      "#me3-feature-favicon",
    );
    expect(element).not.toBeNull();
    expect(element?.rel).toBe("icon");
    expect(element?.type).toBe("image/svg+xml");
    expect(element?.getAttribute("sizes")).toBe("any");
    expect(decodeURIComponent(element?.getAttribute("href") || "")).toContain(
      "✍️",
    );
  });

  it("uses the assistant avatar for assistant routes", () => {
    updateFeatureFavicon("/assistant");

    const element = document.querySelector<HTMLLinkElement>(
      "#me3-feature-favicon",
    );
    expect(element?.type).toBe("image/webp");
    expect(element?.href).toBe(
      `${window.location.origin}/me3-dog-head-emoji-smooth.webp`,
    );
  });

  it("removes only the dynamic favicon when a path has no feature icon", () => {
    const staticIcon = document.createElement("link");
    staticIcon.rel = "icon";
    staticIcon.href = "/favicon.ico";
    document.head.appendChild(staticIcon);

    updateFeatureFavicon("/mission-control");
    updateFeatureFavicon("/login");

    expect(document.querySelector("#me3-feature-favicon")).toBeNull();
    expect(document.querySelector('link[href="/favicon.ico"]')).not.toBeNull();
  });
});
