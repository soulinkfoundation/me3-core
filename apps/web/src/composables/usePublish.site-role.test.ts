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

  it("claims a new additional site without renaming the profile", async () => {
    const wizard = useWizardStore();
    wizard.username = "studio";
    wizard.setSiteRole("organization");
    wizard.updateProfile({ name: "Studio", handle: "studio" });

    const sites = useSitesStore();
    sites.sites = [
      {
        id: "profile-owner",
        username: "owner",
        user_id: "owner-id",
        site_type: "profile",
        site_role: "profile",
        custom_domain: null,
        custom_domain_status: null,
        created_at: "2026-08-20T09:00:00.000Z",
        updated_at: "2026-08-20T09:00:00.000Z",
        published_at: "2026-08-20T10:00:00.000Z",
      },
    ];
    sites.fetchSites = vi.fn(async () => undefined) as never;
    sites.claimUsername = vi.fn(async () => ({
      id: "site-studio",
      username: "studio",
      user_id: "owner-id",
      site_type: "profile",
      site_role: "organization",
      custom_domain: null,
      custom_domain_status: null,
      created_at: "2026-08-24T09:00:00.000Z",
      updated_at: "2026-08-24T09:00:00.000Z",
      published_at: null,
    })) as never;
    sites.fetchPublishManifest = vi.fn(async () => ({
      version: 1,
      sourceFiles: {},
      assetFiles: {},
      updatedAt: "2026-08-24T09:00:00.000Z",
    })) as never;
    sites.uploadSite = vi.fn(async () => true) as never;

    const { publish } = usePublish();
    const success = await publish({ celebrate: false, openSite: false });

    expect(success).toBe(true);
    expect(sites.claimUsername).toHaveBeenCalledWith("studio", {
      siteType: "profile",
      siteRole: "organization",
    });
    expect(sites.uploadSite).toHaveBeenCalledWith(
      "studio",
      expect.arrayContaining([expect.objectContaining({ name: "me.json" })]),
    );
  });

  it("renames only the selected organization by stable site id", async () => {
    const wizard = useWizardStore();
    wizard.activateDraftContext({
      siteId: "site-studio",
      username: "studio",
      role: "organization",
    });
    wizard.username = "new-studio";
    wizard.updateProfile({ name: "Studio", handle: "new-studio" });

    const sites = useSitesStore();
    sites.sites = [
      {
        id: "profile-owner",
        username: "owner",
        user_id: "owner-id",
        site_type: "profile",
        site_role: "profile",
        custom_domain: null,
        custom_domain_status: null,
        created_at: "2026-08-20T09:00:00.000Z",
        updated_at: "2026-08-20T09:00:00.000Z",
        published_at: "2026-08-20T10:00:00.000Z",
      },
      {
        id: "site-studio",
        username: "studio",
        user_id: "owner-id",
        site_type: "profile",
        site_role: "organization",
        custom_domain: null,
        custom_domain_status: null,
        created_at: "2026-08-21T09:00:00.000Z",
        updated_at: "2026-08-21T09:00:00.000Z",
        published_at: "2026-08-21T10:00:00.000Z",
      },
      {
        id: "site-community",
        username: "community",
        user_id: "owner-id",
        site_type: "profile",
        site_role: "organization",
        custom_domain: null,
        custom_domain_status: null,
        created_at: "2026-08-22T09:00:00.000Z",
        updated_at: "2026-08-22T09:00:00.000Z",
        published_at: "2026-08-22T10:00:00.000Z",
      },
    ];
    sites.fetchSites = vi.fn(async () => undefined) as never;
    sites.claimUsername = vi.fn(async () => ({
      ...sites.sites[1],
      username: "new-studio",
    })) as never;
    sites.fetchPublishManifest = vi.fn(async () => ({
      version: 1,
      sourceFiles: {},
      assetFiles: {},
      updatedAt: "2026-08-24T09:00:00.000Z",
    })) as never;
    sites.uploadSite = vi.fn(async () => true) as never;

    const { publish } = usePublish();
    const success = await publish({ celebrate: false, openSite: false });

    expect(success).toBe(true);
    expect(sites.claimUsername).toHaveBeenCalledWith("new-studio", {
      siteType: "profile",
      siteRole: "organization",
      renameFromSiteId: "site-studio",
    });
    expect(sites.claimUsername).not.toHaveBeenCalledWith(
      "new-studio",
      expect.objectContaining({ renameFromSiteId: "profile-owner" }),
    );
  });
});
