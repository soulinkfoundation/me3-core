import type { RouteLocationRaw } from "vue-router";
import { AGENT_LANDING_PAGE_SITE_TEMPLATE_ID } from "@me3-core/plugin-landing-pages";
import type { Site } from "../stores/sites";

/**
 * Where old /sites and /sites/:username links go now that the site dashboard is retired:
 * the site editor for your website, the ME3 builder thread for agent-built sites, and
 * Settings (domain, delete) for older sites that no longer open in the editor.
 */
export function legacySiteDestination(
  site: Pick<Site, "id" | "username" | "site_role" | "template_id" | "builder_thread_id"> | undefined,
  editStep?: string | null,
): RouteLocationRaw {
  if (!site) return { path: "/create", query: editStep ? { step: editStep } : {} };
  if (site.template_id === AGENT_LANDING_PAGE_SITE_TEMPLATE_ID && site.builder_thread_id) {
    return { path: "/assistant", query: { mode: "site-builder", thread: site.builder_thread_id } };
  }
  if (site.site_role === "organization") {
    return { path: "/settings", query: { section: "domain", site: site.username } };
  }
  return {
    path: "/create",
    query: { siteId: site.id, site: site.username, ...(editStep ? { step: editStep } : {}) },
  };
}
