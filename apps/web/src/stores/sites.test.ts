import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useSitesStore } from "./sites";
import { api } from "../api";
import { ApiError } from "../api";

vi.mock("@/utils/imageVariants", () => ({ appendResponsiveImageVariants: vi.fn().mockResolvedValue(undefined) }));

// Mock the API client
vi.mock("../api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upload: vi.fn(),
  },
  ApiError: class extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

describe("sites store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe("resetSessionState", () => {
    it("clears session-scoped site data", () => {
      const store = useSitesStore();
      store.sites = [
        {
          id: "1",
          username: "testuser",
          user_id: "user1",
          site_role: "profile",
          custom_domain: null,
          custom_domain_status: null,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          published_at: null,
        },
      ];
      store.loading = true;
      store.loaded = true;
      store.error = "boom";

      store.resetSessionState();

      expect(store.sites).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.loaded).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe("fetchSites", () => {
    it("should fetch sites successfully", async () => {
      const mockSites = [
        {
          id: "1",
          username: "testuser",
          user_id: "user1",
          site_role: "profile",
          custom_domain: null,
          custom_domain_status: null,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          published_at: null,
        },
      ];
      vi.mocked(api.get).mockResolvedValue({ sites: mockSites });

      const store = useSitesStore();
      await store.fetchSites();

      expect(store.sites).toEqual(mockSites);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
      expect(api.get).toHaveBeenCalledWith("/sites");
    });

    it("treats draft profile sites as existing profile setup", async () => {
      const store = useSitesStore();
      store.sites = [
        {
          id: "profile-draft",
          username: "owner",
          user_id: "user1",
          site_type: "profile",
          site_role: "profile",
          custom_domain: null,
          custom_domain_status: null,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          published_at: null,
        },
      ];

      expect(store.hasProfileSite).toBe(true);
    });

    it("does not treat landing pages as profile setup", async () => {
      const store = useSitesStore();
      store.sites = [
        {
          id: "landing-page",
          username: "offer",
          user_id: "user1",
          site_type: "landing_page",
          site_role: null,
          template_id: "service" as const,
          custom_domain: null,
          custom_domain_status: null,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          published_at: "2024-01-02T00:00:00Z",
        },
      ];

      expect(store.hasProfileSite).toBe(false);
    });

    it("should handle fetch errors", async () => {
      vi.mocked(api.get).mockRejectedValue(new Error("Network error"));

      const store = useSitesStore();
      await store.fetchSites();

      expect(store.sites).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBe("Failed to load sites");
    });

    it("deduplicates and caches ensureSites requests", async () => {
      vi.mocked(api.get).mockResolvedValue({ sites: [] });
      const store = useSitesStore();

      await Promise.all([store.ensureSites(), store.ensureSites()]);
      await store.ensureSites();

      expect(store.loaded).toBe(true);
      expect(api.get).toHaveBeenCalledTimes(1);
    });

    it("allows fetchSites to refresh an ensured result", async () => {
      vi.mocked(api.get).mockResolvedValue({ sites: [] });
      const store = useSitesStore();

      await store.ensureSites();
      await store.fetchSites();

      expect(api.get).toHaveBeenCalledTimes(2);
    });
  });

  describe("fetchPublishManifest", () => {
    it("should fetch publish manifest successfully", async () => {
      const mockManifest = {
        version: 1 as const,
        sourceFiles: { "me.json": "abc123" },
        assetFiles: { "avatar.jpg": "def456" },
        updatedAt: "2026-03-13T10:00:00.000Z",
      };
      vi.mocked(api.get).mockResolvedValue({ manifest: mockManifest });

      const store = useSitesStore();
      const result = await store.fetchPublishManifest("testuser");

      expect(result).toEqual(mockManifest);
      expect(api.get).toHaveBeenCalledWith("/sites/testuser/publish-manifest");
    });
  });

  describe("sendProductConfirmationTest", () => {
    it("should post the product confirmation draft to the test-send endpoint", async () => {
      vi.mocked(api.post).mockResolvedValue({
        ok: true,
        sentTo: "owner@example.com",
        subject: "[Test] Your download",
        productSlug: "guide",
        preview: {
          buyerName: "Test Buyer",
          buyerNote: "Looking forward to this.",
          productTitle: "Guide",
          siteName: "ME3",
          supportEmail: "owner@example.com",
        },
      });

      const store = useSitesStore();
      const payload = {
        productSlug: "guide",
        productTitle: "Guide",
        siteName: "ME3",
        subject: "Your download",
        message: "Here it is: https://example.com/file",
      };

      const result = await store.sendProductConfirmationTest("testuser", payload);

      expect(result).toMatchObject({
        ok: true,
        sentTo: "owner@example.com",
        subject: "[Test] Your download",
      });
      expect(api.post).toHaveBeenCalledWith(
        "/sites/testuser/products/confirmation-email/test",
        expect.objectContaining({ ...payload, operationId: expect.any(String), startedAt: expect.any(String) }),
      );
    });
  });

  describe("claimUsername", () => {
    it("should claim username successfully", async () => {
      const mockSite = {
        id: "1",
        username: "newuser",
        user_id: "user1",
        custom_domain: null,
        custom_domain_status: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        published_at: null,
      };
      vi.mocked(api.post).mockResolvedValue({ site: mockSite });

      const store = useSitesStore();
      const result = await store.claimUsername("newuser");

      expect(result).toEqual(mockSite);
      expect(store.sites).toContainEqual(mockSite);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
      expect(api.post).toHaveBeenCalledWith("/sites", { username: "newuser" });
    });

    it("should normalize full domain usernames", async () => {
      const mockSite = {
        id: "2",
        username: "business-coach",
        user_id: "user2",
        custom_domain: null,
        custom_domain_status: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        published_at: null,
      };
      vi.mocked(api.post).mockResolvedValue({ site: mockSite });

      const store = useSitesStore();
      const result = await store.claimUsername("business-coach.example.com");

      expect(result).toEqual(mockSite);
      expect(api.post).toHaveBeenCalledWith("/sites", {
        username: "business-coach",
      });
    });

    it("should handle claim errors", async () => {
      vi.mocked(api.post).mockRejectedValue(
        new ApiError("Username taken", 409),
      );

      const store = useSitesStore();
      const result = await store.claimUsername("taken");

      expect(result).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBe("Username taken");
    });

    it("should pass profile rename options when provided", async () => {
      const mockSite = {
        id: "3",
        username: "newuser",
        user_id: "user1",
        site_type: "profile" as const,
        site_role: "profile" as const,
        custom_domain: null,
        custom_domain_status: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        published_at: null,
      };
      vi.mocked(api.post).mockResolvedValue({ site: mockSite });

      const store = useSitesStore();
      const result = await store.claimUsername("newuser", {
        siteType: "profile",
        renameFromUsername: "olduser",
      });

      expect(result).toEqual(mockSite);
      expect(api.post).toHaveBeenCalledWith("/sites", {
        username: "newuser",
        siteType: "profile",
        renameFromUsername: "olduser",
      });
    });

    it("should pass the additional-site role when provided", async () => {
      const mockSite = {
        id: "4",
        username: "studio",
        user_id: "user1",
        site_type: "profile" as const,
        site_role: "organization" as const,
        custom_domain: null,
        custom_domain_status: null,
        created_at: "2026-08-24T08:00:00Z",
        updated_at: "2026-08-24T08:00:00Z",
        published_at: null,
      };
      vi.mocked(api.post).mockResolvedValue({ site: mockSite });

      const store = useSitesStore();
      const result = await store.claimUsername("studio", {
        siteType: "profile",
        siteRole: "organization",
      });

      expect(result).toEqual(mockSite);
      expect(api.post).toHaveBeenCalledWith("/sites", {
        username: "studio",
        siteType: "profile",
        siteRole: "organization",
      });
    });
  });

  describe("uploadSite", () => {
    it("should upload site files successfully", async () => {
      const files = [
        new File(["content"], "me.json", { type: "application/json" }),
        new File(["content"], "index.html", { type: "text/html" }),
      ];
      vi.mocked(api.upload).mockResolvedValue({
        ok: true,
        publishedAt: "2026-08-24T14:00:00.000Z",
      });

      const store = useSitesStore();
      store.sites = [
        {
          id: "1",
          username: "testuser",
          user_id: "user1",
          site_role: "organization",
          custom_domain: null,
          custom_domain_status: null,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          published_at: null,
        },
      ];

      const result = await store.uploadSite("testuser", files);

      expect(result).toBe(true);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.sites[0].published_at).toBeTruthy();
      expect(api.upload).toHaveBeenCalledWith(
        "/sites/testuser/upload",
        expect.any(FormData),
      );
    });

    it("should handle upload errors", async () => {
      const files = [
        new File(["content"], "me.json", { type: "application/json" }),
      ];
      vi.mocked(api.upload).mockRejectedValue(
        new ApiError("Upload failed", 500),
      );

      const store = useSitesStore();
      const result = await store.uploadSite("testuser", files);

      expect(result).toBe(false);
      expect(store.loading).toBe(false);
      expect(store.error).toBe("Upload failed");
    });
  });

  describe("deleteSite", () => {
    it("should delete site successfully", async () => {
      vi.mocked(api.delete).mockResolvedValue({ ok: true });

      const store = useSitesStore();
      store.sites = [
        {
          id: "1",
          username: "testuser",
          user_id: "user1",
          site_role: "profile",
          custom_domain: null,
          custom_domain_status: null,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          published_at: null,
        },
      ];

      const result = await store.deleteSite("testuser");

      expect(result).toBe(true);
      expect(store.sites).toHaveLength(0);
      expect(store.loading).toBe(false);
      expect(api.delete).toHaveBeenCalledWith("/sites/testuser");
    });

    it("should handle delete errors", async () => {
      vi.mocked(api.delete).mockRejectedValue(new ApiError("Not found", 404));

      const store = useSitesStore();
      const result = await store.deleteSite("nonexistent");

      expect(result).toBe(false);
      expect(store.loading).toBe(false);
      expect(store.error).toBe("Not found");
    });
  });

  describe("uploadImage", () => {
    it("should upload avatar image successfully", async () => {
      const blob = new Blob(["image data"], { type: "image/png" });
      const mockResult = {
        ok: true,
        path: "/files/avatar.png",
        url: "https://example.com/files/avatar.png",
        type: "avatar" as const,
      };
      vi.mocked(api.upload).mockResolvedValue(mockResult);

      const store = useSitesStore();
      const result = await store.uploadImage("testuser", blob, "avatar");

      expect(result).toEqual(mockResult);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
      expect(api.upload).toHaveBeenCalledWith(
        "/sites/testuser/upload-image",
        expect.any(FormData),
      );
    });

    it("should upload banner image successfully", async () => {
      const blob = new Blob(["image data"], { type: "image/jpeg" });
      const mockResult = {
        ok: true,
        path: "/files/banner.jpg",
        url: "https://example.com/files/banner.jpg",
        type: "banner" as const,
      };
      vi.mocked(api.upload).mockResolvedValue(mockResult);

      const store = useSitesStore();
      const result = await store.uploadImage("testuser", blob, "banner");

      expect(result).toEqual(mockResult);
    });

    it("should upload a site logo using the shared image path", async () => {
      const blob = new Blob(["logo"], { type: "image/webp" });
      const mockResult = {
        ok: true,
        path: "files/logo.webp",
        url: "files/logo.webp",
        type: "logo" as const,
      };
      vi.mocked(api.upload).mockResolvedValue(mockResult);

      const store = useSitesStore();
      const result = await store.uploadImage("testuser", blob, "logo");

      expect(result).toEqual(mockResult);
      const formData = vi.mocked(api.upload).mock.calls.at(-1)?.[1] as FormData;
      expect(formData.get("type")).toBe("logo");
      expect((formData.get("file") as File).name).toBe("logo.webp");
    });

    it("should handle upload image errors", async () => {
      const blob = new Blob(["image data"], { type: "image/png" });
      vi.mocked(api.upload).mockRejectedValue(
        new ApiError("File too large", 413),
      );

      const store = useSitesStore();
      const result = await store.uploadImage("testuser", blob, "avatar");

      expect(result).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBe("File too large");
    });
  });

  describe("importWebsite", () => {
    it("should import website drafts successfully", async () => {
      const mockDraft = {
        ok: true,
        sourceUrl: "https://example.com",
        canonicalUrl: "https://example.com",
        profile: {
          name: "Example",
        },
        pages: [],
        posts: [],
        products: [],
      };
      vi.mocked(api.post).mockResolvedValue(mockDraft as any);

      const store = useSitesStore();
      const result = await store.importWebsite("testuser", "https://example.com");

      expect(result).toEqual(mockDraft);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
      expect(api.post).toHaveBeenCalledWith(
        "/sites/testuser/import-website",
        { url: "https://example.com" },
      );
    });

    it("should surface import errors", async () => {
      vi.mocked(api.post).mockRejectedValue(new ApiError("Import denied", 403));

      const store = useSitesStore();
      const result = await store.importWebsite("testuser", "https://example.com");

      expect(result).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBe("Import denied");
    });
  });

  describe("uploadPageImage", () => {
    it("should upload page image successfully", async () => {
      const blob = new Blob(["image data"], { type: "image/png" });
      const mockResult = {
        ok: true,
        path: "/files/about-0.png",
        url: "https://example.com/files/about-0.png",
        pageSlug: "about",
        imageIndex: 0,
      };
      vi.mocked(api.upload).mockResolvedValue(mockResult);

      const store = useSitesStore();
      const result = await store.uploadPageImage("testuser", blob, "about", 0);

      expect(result).toEqual(mockResult);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it("should handle different image formats", async () => {
      const webpBlob = new Blob(["image data"], { type: "image/webp" });
      const gifBlob = new Blob(["image data"], { type: "image/gif" });
      const jpgBlob = new Blob(["image data"], { type: "image/jpeg" });

      vi.mocked(api.upload).mockResolvedValue({
        ok: true,
        path: "",
        url: "",
        pageSlug: "test",
        imageIndex: 0,
      });

      const store = useSitesStore();
      await store.uploadPageImage("testuser", webpBlob, "test", 0);
      await store.uploadPageImage("testuser", gifBlob, "test", 1);
      await store.uploadPageImage("testuser", jpgBlob, "test", 2);

      expect(api.upload).toHaveBeenCalledTimes(3);
    });
  });

  describe("uploadContentAsset", () => {
    it("uploads audio with its stable ID and kind", async () => {
      const blob = new Blob(["audio"], { type: "audio/mpeg" });
      const mockResult = {
        ok: true,
        path: "files/content/audio-id.mp3",
        url: "files/content/audio-id.mp3",
        storage: "r2" as const,
        assetId: "audio-id",
        kind: "audio" as const,
        mimeType: "audio/mpeg",
      };
      vi.mocked(api.upload).mockResolvedValue(mockResult);

      const store = useSitesStore();
      const result = await store.uploadContentAsset("testuser", blob, {
        assetId: "audio-id",
        kind: "audio",
        filename: "audio-id.mp3",
      });

      expect(result).toEqual(mockResult);
      expect(api.upload).toHaveBeenCalledWith(
        "/sites/testuser/upload-content-asset",
        expect.any(FormData),
      );
      const formData = vi.mocked(api.upload).mock.calls.at(-1)?.[1] as FormData;
      expect(formData.get("assetId")).toBe("audio-id");
      expect(formData.get("kind")).toBe("audio");
      expect((formData.get("file") as File).name).toBe("audio-id.mp3");
      expect((formData.get("file") as File).type).toBe("audio/mpeg");
    });
  });

  describe("domain management", () => {
    it("should get domain status", async () => {
      const mockStatus = {
        connected: true,
        domain: "example.com",
        status: "active" as const,
        ssl_status: "active",
      };
      vi.mocked(api.get).mockResolvedValue(mockStatus);

      const store = useSitesStore();
      const result = await store.getDomainStatus("testuser");

      expect(result).toEqual(mockStatus);
      expect(api.get).toHaveBeenCalledWith("/domains/testuser");
    });

    it("should connect domain successfully", async () => {
      const mockResult = {
        ok: true,
        domain: "www.example.com",
        status: "pending",
        dns_records: {
          cname: { name: "www.example.com", value: "target.example.com" },
        },
      };
      vi.mocked(api.post).mockResolvedValue(mockResult);

      const store = useSitesStore();
      store.sites = [
        {
          id: "1",
          username: "testuser",
          user_id: "user1",
          site_role: "profile",
          custom_domain: null,
          custom_domain_status: null,
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          published_at: null,
        },
      ];

      const result = await store.connectDomain("testuser", "www.example.com");

      expect(result).toEqual(mockResult);
      expect(store.sites[0].custom_domain).toBe("www.example.com");
      expect(store.sites[0].custom_domain_status).toBe("pending");
    });

    it("should disconnect domain successfully", async () => {
      vi.mocked(api.delete).mockResolvedValue({ ok: true });

      const store = useSitesStore();
      store.sites = [
        {
          id: "1",
          username: "testuser",
          user_id: "user1",
          site_role: "profile",
          custom_domain: "example.com",
          custom_domain_status: "active",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-01T00:00:00Z",
          published_at: null,
        },
      ];

      const result = await store.disconnectDomain("testuser");

      expect(result).toBe(true);
      expect(store.sites[0].custom_domain).toBeNull();
      expect(store.sites[0].custom_domain_status).toBeNull();
    });

    it("should refresh domain status", async () => {
      vi.mocked(api.post).mockResolvedValue({ ok: true });

      const store = useSitesStore();
      const result = await store.refreshDomainStatus("testuser");

      expect(result).toBe(true);
      expect(api.post).toHaveBeenCalledWith("/domains/testuser/refresh", {});
    });
  });

  // Domain purchase tests removed - functionality not supported via Cloudflare API

  describe("getSiteContent", () => {
    it("should get site content successfully", async () => {
      const mockContent = {
        ok: true,
        profile: {
          version: "0.1",
          name: "Test User",
          handle: "testuser",
          bio: "Test bio",
        },
        pages: [],
      };
      vi.mocked(api.get).mockResolvedValue(mockContent);

      const store = useSitesStore();
      const result = await store.getSiteContent("testuser");

      expect(result).toEqual(mockContent);
      expect(api.get).toHaveBeenCalledWith("/sites/testuser/content");
    });

    it("should handle errors gracefully", async () => {
      vi.mocked(api.get).mockRejectedValue(new Error("Not found"));

      const store = useSitesStore();
      const result = await store.getSiteContent("nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("site pages", () => {
    const page = {
      id: "page-1",
      siteId: "site-1",
      slug: "offer",
      kind: "landing_page" as const,
      title: "A focused offer",
      templateId: "service" as const,
      document: {
        version: 3 as const,
        intent: { type: "service" as const, audience: "Consultants", goal: "Book", offerName: "Offer" },
        recipe: { id: "service-offer" as const, template: "service" as const, name: "Service Offer" },
        brief: "A focused offer",
        seo: { title: "A focused offer", description: "A clear offer" },
        hero: { headline: "A focused offer", subheadline: "A clear offer", primaryActionId: "primary-action" },
        content: { sections: [{ id: "action", type: "action" as const, heading: "Book", body: "Choose a time", actionId: "primary-action" }] },
        actions: [{ id: "primary-action", kind: "booking" as const, label: "Book", resourceId: "call" }],
        design: { theme: "quiet-service" as const, accentColor: "#0f766e", backgroundColor: "#fff", textColor: "#111" },
        assets: {},
      },
      publishedRevisionId: null,
      createdAt: "2026-07-10T12:00:00Z",
      updatedAt: "2026-07-10T12:00:00Z",
      publishedAt: null,
    };

    it("creates a page inside the existing site", async () => {
      vi.mocked(api.post).mockResolvedValue({ page });
      const store = useSitesStore();

      const result = await store.createSitePage("owner", {
        slug: "offer",
        brief: "A focused offer",
        templateId: "service",
      });

      expect(result).toEqual(page);
      expect(store.sitePages).toEqual([page]);
      expect(api.post).toHaveBeenCalledWith("/sites/owner/pages", {
        slug: "offer",
        brief: "A focused offer",
        templateId: "service",
      });
    });

    it("updates page state after publishing", async () => {
      const published = {
        ...page,
        publishedRevisionId: "revision-1",
        publishedAt: "2026-07-10T12:05:00Z",
      };
      vi.mocked(api.post).mockResolvedValue({ page: published });
      const store = useSitesStore();
      store.sitePages = [page];

      const result = await store.publishSitePage("owner", page.id);

      expect(result?.publishedRevisionId).toBe("revision-1");
      expect(store.sitePages[0].publishedAt).toBe("2026-07-10T12:05:00Z");
    });
  });
});
