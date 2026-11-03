import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePublish } from "./usePublish";
import { useSitesStore } from "../stores/sites";
import { useWizardStore } from "../stores/wizard";
import { api } from "../api";

describe("usePublish site role", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.spyOn(api, "put").mockResolvedValue({ ok: true });
  });

  it("never asks the API for anything but the owner's site", async () => {
    const wizard = useWizardStore();
    wizard.username = "owner";
    wizard.updateProfile({ name: "Owner", handle: "owner" });

    const sites = useSitesStore();
    sites.sites = [];
    sites.fetchSites = vi.fn(async () => undefined) as never;
    sites.claimUsername = vi.fn(async () => siteRecord("site-owner", "owner", "profile")) as never;
    sites.fetchPublishManifest = vi.fn(async () => ({
      version: 1,
      sourceFiles: {},
      assetFiles: {},
      updatedAt: "2026-08-24T09:00:00.000Z",
    })) as never;
    sites.uploadSite = vi.fn(async () => true) as never;

    const { publish } = usePublish();

    expect(await publish({ celebrate: false, openSite: false })).toBe(true);
    expect(sites.claimUsername).toHaveBeenCalledWith("owner", {
      siteType: "profile",
      siteRole: "profile",
    });
  });

  it("refuses to publish a saved draft over an older site", async () => {
    const wizard = useWizardStore();
    wizard.activateDraftContext({ siteId: "site-studio", username: "studio" });
    wizard.updateProfile({ name: "Studio", handle: "studio" });

    const sites = useSitesStore();
    sites.sites = [siteRecord("site-studio", "studio", "organization")];
    sites.fetchSites = vi.fn(async () => undefined) as never;
    sites.claimUsername = vi.fn() as never;
    sites.uploadSite = vi.fn(async () => true) as never;

    const { publish } = usePublish();

    expect(await publish({ celebrate: false, openSite: false })).toBe(false);
    expect(sites.claimUsername).not.toHaveBeenCalled();
    expect(sites.uploadSite).not.toHaveBeenCalled();
  });
});

function siteRecord(id: string, username: string, role: "profile" | "organization") {
  return {
    id,
    username,
    user_id: "owner-id",
    site_type: "profile" as const,
    site_role: role,
    custom_domain: null,
    custom_domain_status: null,
    created_at: "2026-08-20T09:00:00.000Z",
    updated_at: "2026-08-20T09:00:00.000Z",
    published_at: "2026-08-20T10:00:00.000Z",
  };
}
