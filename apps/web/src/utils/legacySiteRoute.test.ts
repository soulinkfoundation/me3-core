import { describe, expect, it } from "vitest";
import { AGENT_LANDING_PAGE_SITE_TEMPLATE_ID } from "@me3-core/plugin-landing-pages";
import { legacySiteDestination } from "./legacySiteRoute";

const site = { id: "s1", username: "kieran", site_role: "profile" as const, template_id: null, builder_thread_id: null };

describe("legacySiteDestination", () => {
  it("opens your website in the site editor, keeping the step", () => {
    expect(legacySiteDestination(site, "publish")).toEqual({
      path: "/create",
      query: { siteId: "s1", site: "kieran", step: "publish" },
    });
  });

  it("sends older sites to their domain settings", () => {
    expect(legacySiteDestination({ ...site, site_role: "organization" })).toEqual({
      path: "/settings",
      query: { section: "domain", site: "kieran" },
    });
  });

  it("reopens the ME3 builder thread for agent-built sites", () => {
    expect(legacySiteDestination({ ...site, site_role: null, template_id: AGENT_LANDING_PAGE_SITE_TEMPLATE_ID, builder_thread_id: "t1" }))
      .toEqual({ path: "/assistant", query: { mode: "site-builder", thread: "t1" } });
  });

  it("starts the editor when there is no site", () => {
    expect(legacySiteDestination(undefined)).toEqual({ path: "/create", query: {} });
  });
});
