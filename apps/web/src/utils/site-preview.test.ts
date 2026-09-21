import { describe, expect, it } from "vitest";
import { sitePreviewFileForView } from "./site-preview";

const paths = {
  blog: "writing",
  shop: "offers",
};

describe("sitePreviewFileForView", () => {
  it("maps regular pages and nested blog views to generated files", () => {
    expect(
      sitePreviewFileForView("about", {
        paths,
      }),
    ).toBe("about.html");
    expect(
      sitePreviewFileForView("writing:hello", {
        paths,
      }),
    ).toBe("writing/hello.html");
  });
});
