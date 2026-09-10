import { getEmailTestOperation, finishEmailTestOperation } from "../utils/emailTestOperation";
import { appendResponsiveImageVariants } from "@/utils/imageVariants";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { useWizardStore } from "./wizard";
import { API_BASE, ApiError, api } from "../api";
import type { SiteUploadFile } from "../utils/siteUpload";
import type {
  LandingPageDocument,
  LandingPageDocumentV3,
  LandingPageTemplateId,
  LandingPageDesignPackId,
  SiteType,
} from "@me3-core/plugin-landing-pages";

export interface Site {
  id: string;
  username: string;
  user_id: string;
  site_type?: SiteType;
  site_role: "profile" | "organization" | null;
  profile_site_id?: string | null;
  template_id?: string | null;
  builder_thread_id?: string | null;
  custom_domain: string | null;
  custom_domain_status: "pending" | "active" | "failed" | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  bookings_enabled?: boolean;
  avatar?: string | null;
}

export interface UploadImageResult {
  ok: boolean;
  path: string;
  url: string;
  storage?: "d1" | "r2";
  type: "logo" | "avatar" | "banner" | "favicon" | "hero" | "section" | "testimonial";
}

export interface UploadPageImageResult {
  ok: boolean;
  path: string;
  url: string;
  storage?: "d1" | "r2";
  pageSlug: string;
  imageIndex: number;
}

export interface UploadContentAssetResult {
  ok: boolean;
  path: string;
  url: string;
  storage?: "d1" | "r2";
  assetId: string;
  kind: "image" | "audio";
  mimeType: string;
}

export interface SiteStorageStatus {
  ok: boolean;
  activeMediaStorage: "d1" | "r2";
  d1: {
    files: number;
    bytes: number;
    mediaFiles: number;
    mediaBytes: number;
    maxFileBytes: number;
  };
  r2: {
    available: boolean;
    binding: "SITE_ASSETS";
    files: number;
    bytes: number;
  };
}

export interface SiteStorageMigrationResult {
  ok: boolean;
  migrated: number;
  storage: SiteStorageStatus;
}

export interface PublishManifest {
  version: 1;
  sourceFiles: Record<string, string>;
  assetFiles: Record<string, string>;
  updatedAt: string;
}

export interface StreamUploadRequest {
  uploadURL: string;
  uid: string;
}

export interface StreamVideoDetails {
  uid: string;
  playerUrl?: string | null;
  thumbnail?: string | null;
  duration?: number | null;
}

export interface StreamDeleteResult {
  ok: boolean;
}

export interface DomainStatus {
  connected: boolean;
  domain?: string;
  status?: "pending" | "active" | "failed";
  ssl_status?: string;
  expected_host?: string | null;
  admin_host?: string | null;
  verification_records?: Array<{
    type: "cname" | "txt";
    name: string;
    value: string;
  }>;
  registrar_guides?: Array<{
    name: string;
    url: string;
    icon: string;
  }>;
  url?: string;
  instructions?: string[];
  error?: string;
}

export interface DomainSetupResult {
  ok: boolean;
  domain: string;
  status: string;
  dns_records?: {
    cname: { name: string; value: string };
    txt?: { name: string; value: string };
  };
  registrar_guides?: Array<{
    name: string;
    url: string;
    icon: string;
  }>;
  instructions?: string[];
  error?: string;
}

export interface OnboardingRequest {
  username: string;
  name?: string;
  timezone?: string | null;
  sourceMode?: "scratch" | "import";
  role?: string;
  serviceOffering?: string;
  socialUrls?: string[];
  existingWebsiteUrl?: string | null;
}

export interface OnboardingStep {
  name: string;
  status: "pending" | "running" | "completed" | "failed";
  message: string;
}

export interface OnboardingJobStatus {
  jobId: string;
  status: "pending" | "running" | "completed" | "failed";
  siteId: string | null;
  siteUsername: string | null;
  steps: OnboardingStep[];
  currentStep: string | null;
  errorMessage: string | null;
  result: {
    siteId?: string;
    siteUsername?: string;
    url?: string;
  } | null;
}

// DomainSearchResult interface removed - domain search not supported via API

export interface SiteContent {
  ok: boolean;
  profile: Parameters<
    ReturnType<typeof useWizardStore>["loadFromSiteContent"]
  >[0] | null;
  pages: Array<{ slug: string; title: string; content: string }>;
  posts: Array<{
    slug: string;
    title: string;
    content: string;
    type?: "article" | "note" | "video" | "audio" | "image" | "link";
    media?: {
      url?: string;
      duration?: number;
      thumbnail?: string;
      provider?: string;
      id?: string;
    };
    publishedAt?: string;
    excerpt?: string;
  }>;
  products: Array<{
    slug: string;
    title: string;
    content: string;
    price: number;
    currency: "USD" | "GBP" | "EUR" | "CAD" | "AUD" | "CHF" | "SGD" | "INR" | "PKR";
    available?: boolean;
    publishedAt?: string;
    excerpt?: string;
    confirmationEmail?: {
      enabled?: boolean;
      subject?: string;
      message?: string;
    };
  }>;
}

export interface LandingPageProfileSummary {
  name: string | null;
  bio: string | null;
  location: string | null;
  avatar: string | null;
  profileUrl: string | null;
  tagline: string | null;
  socialLinks: Array<{ label: string; href: string }>;
}

export interface LandingPageSiteRecord {
  id: string;
  username: string;
  siteType: SiteType;
  templateId: LandingPageTemplateId | null;
  publishedAt: string | null;
}

export interface LandingPageDraftResponse {
  ok: boolean;
  site: LandingPageSiteRecord;
  profile: LandingPageProfileSummary;
  page: LandingPageDocument | null;
}

export interface SitePage {
  id: string;
  siteId: string;
  slug: string;
  kind: "landing_page" | "standard";
  title: string;
  templateId: LandingPageTemplateId | null;
  document: LandingPageDocumentV3;
  publishedRevisionId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface SitePageRevision {
  id: string;
  createdAt: string;
  document: LandingPageDocumentV3;
}

export interface WebsiteImportDraft {
  ok: boolean;
  sourceUrl: string;
  canonicalUrl: string;
  profile: NonNullable<SiteContent["profile"]>;
  pages: SiteContent["pages"];
  posts: SiteContent["posts"];
  products: SiteContent["products"];
}

export interface SiteQuota {
  current: number;
  limit: number;
  tier: string;
  profile: SiteRoleQuota;
  additional_sites: SiteRoleQuota;
  remaining_additional_sites: number;
  can_create_profile: boolean;
  can_create_additional_site: boolean;
  capabilities: Record<string, unknown>;
  can_create: boolean;
}

interface SiteRoleQuota {
  current: number;
  limit: number;
  remaining: number;
  can_create: boolean;
}

export interface SubscriberCount {
  count: number;
}

export interface Subscriber {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  source: string;
  subscribed_at: string;
  page_id?: string | null;
  action_id?: string | null;
  campaign?: string | null;
}

export interface SubscriberList {
  subscribers: Subscriber[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface ProductConfirmationTestRequest {
  productSlug?: string;
  productTitle: string;
  siteName?: string;
  subject: string;
  message: string;
}

export interface ProductConfirmationTestResponse {
  ok: boolean;
  sentTo: string;
  subject: string;
  productSlug: string | null;
  preview: {
    buyerName: string;
    buyerNote: string;
    productTitle: string;
    siteName: string;
    supportEmail: string;
  };
}

export interface BookingConfirmationTestRequest {
  to?: string;
  bookingTitle: string;
  siteName?: string;
  message?: string;
  durationMinutes?: number;
  timezone?: string;
  paymentMethod?: "stripe" | "manual";
  amountDue?: number;
  currency?: string;
  paymentInstructions?: string;
}

export interface BookingConfirmationTestResponse {
  ok: boolean;
  sentTo: string;
  providerMessageId: string | null;
}

export const useSitesStore = defineStore("sites", () => {
  const sites = ref<Site[]>([]);
  const sitePages = ref<SitePage[]>([]);
  const loading = ref(false);
  const loaded = ref(false);
  const error = ref<string | null>(null);
  let sessionGeneration = 0;
  let activeSitesRequest:
    | {
        generation: number;
        promise: Promise<void>;
      }
    | null = null;
  const hasProfileSite = computed(() =>
    sites.value.some((site) => (site.site_type || "profile") === "profile"),
  );

  function resetSessionState() {
    sessionGeneration += 1;
    activeSitesRequest = null;
    sites.value = [];
    sitePages.value = [];
    loading.value = false;
    loaded.value = false;
    error.value = null;
  }

  function normalizeUsername(raw: string): string {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) return trimmed;

    let candidate = trimmed;

    const parseHostname = (value: string): string | null => {
      try {
        return new URL(value).hostname;
      } catch {
        return null;
      }
    };

    const directHostname = parseHostname(trimmed);
    if (directHostname) {
      candidate = directHostname;
    } else if (trimmed.includes("/")) {
      const guessedHostname = parseHostname(`https://${trimmed}`);
      if (guessedHostname) candidate = guessedHostname;
    }

    if (candidate.endsWith(".example.com")) {
      candidate = candidate.slice(0, -".example.com".length);
    }

    return candidate;
  }

  async function loadSites(force: boolean): Promise<void> {
    if (!force && loaded.value) return;
    if (activeSitesRequest?.generation === sessionGeneration) {
      return activeSitesRequest.promise;
    }

    const generation = sessionGeneration;
    loading.value = true;
    error.value = null;

    const promise = (async () => {
      try {
        const response = await api.get<{ sites: Site[] }>("/sites");
        if (generation !== sessionGeneration) return;
        sites.value = response.sites;
        loaded.value = true;
      } catch (e) {
        if (generation !== sessionGeneration) return;
        loaded.value = false;
        error.value = "Failed to load sites";
        console.error("Fetch sites error:", e);
      } finally {
        if (generation === sessionGeneration) loading.value = false;
        if (activeSitesRequest?.generation === generation) {
          activeSitesRequest = null;
        }
      }
    })();
    activeSitesRequest = { generation, promise };
    return promise;
  }

  async function fetchSites(): Promise<void> {
    return loadSites(true);
  }

  async function ensureSites(): Promise<void> {
    return loadSites(false);
  }

  async function fetchPublishManifest(
    username: string,
  ): Promise<PublishManifest | null> {
    try {
      const response = await api.get<{ manifest: PublishManifest }>(
        `/sites/${username}/publish-manifest`,
      );
      return response.manifest;
    } catch (e: any) {
      error.value = e.message || "Failed to load publish manifest";
      console.error("Fetch publish manifest error:", e);
      return null;
    }
  }

  async function claimUsername(
    username: string,
    options: {
      siteType?: SiteType;
      siteRole?: "profile" | "organization";
      templateId?: LandingPageTemplateId | null;
      renameFromSiteId?: string;
      renameFromUsername?: string;
    } = {},
  ): Promise<Site | null> {
    loading.value = true;
    error.value = null;

    try {
      const normalized = normalizeUsername(username);
      const response = await api.post<{ site: Site }>("/sites", {
        username: normalized,
        ...(options.siteType ? { siteType: options.siteType } : {}),
        ...(options.siteRole ? { siteRole: options.siteRole } : {}),
        ...(options.templateId !== undefined
          ? { templateId: options.templateId }
          : {}),
        ...(options.renameFromSiteId
          ? { renameFromSiteId: options.renameFromSiteId }
          : {}),
        ...(options.renameFromUsername
          ? { renameFromUsername: options.renameFromUsername }
          : {}),
      });
      const newSite = response.site;
      const existingIndex = sites.value.findIndex((site) => site.id === newSite.id);
      if (existingIndex >= 0) sites.value.splice(existingIndex, 1, newSite);
      else sites.value.unshift(newSite);
      return newSite;
    } catch (e: any) {
      error.value = e.message || "Failed to claim username";
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function uploadSite(
    username: string,
    files: Array<File | SiteUploadFile>,
  ): Promise<boolean> {
    loading.value = true;
    error.value = null;

    try {
      const formData = new FormData();
      files.forEach((file) => {
        if (file instanceof File) {
          formData.append("files", file, file.name);
          return;
        }

        formData.append(
          "files",
          file.blob,
          file.name,
        );
      });

      const response = await api.upload<{ ok: boolean; publishedAt: string | null }>(
        `/sites/${username}/upload`,
        formData,
      );

      // Update the site's published_at
      const site = sites.value.find((s) => s.username === username);
      if (site) {
        site.published_at = response.publishedAt;
      }

      return true;
    } catch (e: any) {
      error.value = e.message || "Failed to upload site";
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function deleteSite(username: string): Promise<boolean> {
    loading.value = true;
    error.value = null;

    try {
      await api.delete(`/sites/${username}`);
      sites.value = sites.value.filter((s) => s.username !== username);
      const normalized = username.trim().toLowerCase();
      try {
        const wizard = useWizardStore();
        const wizardHandle = (wizard.profile.handle || "").trim().toLowerCase();
        const wizardUser = (wizard.username || "").trim().toLowerCase();
        if (wizardUser === normalized || wizardHandle === normalized) {
          wizard.reset();
        }
      } catch {
        /* Pinia may be unavailable outside an app context (tests). */
      }
      return true;
    } catch (e: any) {
      error.value = e.message || "Failed to delete site";
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function uploadImage(
    username: string,
    file: Blob,
    type: "logo" | "avatar" | "banner" | "hero" | "section" | "testimonial",
    options: { variant?: number; testimonialIndex?: number } = {},
  ): Promise<UploadImageResult | null> {
    loading.value = true;
    error.value = null;

    try {
      const formData = new FormData();
      // Convert blob to file with proper extension
      const ext =
        file.type === "image/png"
          ? "png"
          : file.type === "image/webp"
            ? "webp"
            : file.type === "image/gif"
              ? "gif"
              : "jpg";
      const baseName =
        type === "testimonial" && options.testimonialIndex != null
          ? `testimonial-${options.testimonialIndex}`
          : type;
      const imageFile = new File([file], `${baseName}.${ext}`, {
        type: file.type,
      });
      formData.append("file", imageFile);
      formData.append("type", type);
      await appendResponsiveImageVariants(formData, file);
      if (options.variant) {
        formData.append("variant", String(options.variant));
      }
      if (type === "testimonial" && options.testimonialIndex != null) {
        formData.append("index", String(options.testimonialIndex));
      }

      const result = await api.upload<UploadImageResult>(
        `/sites/${username}/upload-image`,
        formData,
      );
      return result;
    } catch (e: any) {
      error.value = e.message || "Failed to upload image";
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function uploadFavicon(
    username: string,
    file: Blob,
  ): Promise<UploadImageResult | null> {
    loading.value = true;
    error.value = null;

    try {
      const formData = new FormData();
      // Favicon is always PNG at 192x192
      const imageFile = new File([file], "favicon.png", { type: "image/png" });
      formData.append("file", imageFile);
      formData.append("type", "favicon");

      const result = await api.upload<UploadImageResult>(
        `/sites/${username}/upload-image`,
        formData,
      );
      return result;
    } catch (e: any) {
      error.value = e.message || "Failed to upload favicon";
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function uploadPageImage(
    username: string,
    file: Blob,
    pageSlug: string,
    imageIndex: number,
  ): Promise<UploadPageImageResult | null> {
    loading.value = true;
    error.value = null;

    try {
      const formData = new FormData();
      const ext =
        file.type === "image/png"
          ? "png"
          : file.type === "image/webp"
            ? "webp"
            : file.type === "image/gif"
              ? "gif"
              : "jpg";
      const imageFile = new File([file], `${pageSlug}-${imageIndex}.${ext}`, {
        type: file.type,
      });
      formData.append("file", imageFile);
      formData.append("pageSlug", pageSlug);
      formData.append("imageIndex", String(imageIndex));
      await appendResponsiveImageVariants(formData, file);

      const result = await api.upload<UploadPageImageResult>(
        `/sites/${username}/upload-page-image`,
        formData,
      );
      return result;
    } catch (e: any) {
      error.value = e.message || "Failed to upload page image";
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function uploadContentAsset(
    username: string,
    file: Blob,
    asset: {
      assetId: string;
      kind: "image" | "audio";
      filename: string;
    },
  ): Promise<UploadContentAssetResult | null> {
    loading.value = true;
    error.value = null;

    try {
      const formData = new FormData();
      formData.append(
        "file",
        new File([file], asset.filename, {
          type: file.type || "application/octet-stream",
        }),
      );
      formData.append("assetId", asset.assetId);
      formData.append("kind", asset.kind);
      if (asset.kind === "image") await appendResponsiveImageVariants(formData, file);

      return await api.upload<UploadContentAssetResult>(
        `/sites/${username}/upload-content-asset`,
        formData,
      );
    } catch (e: any) {
      error.value = e.message || "Failed to upload content asset";
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function createStreamUpload(
    username: string,
    maxDurationSeconds = 3600,
  ): Promise<StreamUploadRequest | null> {
    loading.value = true;
    error.value = null;

    try {
      return await api.post<StreamUploadRequest>(
        `/sites/${username}/stream/upload`,
        { maxDurationSeconds },
      );
    } catch (e: any) {
      error.value = e.message || "Failed to create Stream upload";
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function finalizeStreamUpload(
    username: string,
    uid: string,
  ): Promise<StreamVideoDetails | null> {
    loading.value = true;
    error.value = null;

    try {
      return await api.post<StreamVideoDetails>(
        `/sites/${username}/stream/finalize`,
        { uid },
      );
    } catch (e: any) {
      error.value = e.message || "Failed to finalize Stream upload";
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function deleteStreamVideo(
    username: string,
    uid: string,
  ): Promise<StreamDeleteResult | null> {
    loading.value = true;
    error.value = null;

    try {
      return await api.post<StreamDeleteResult>(
        `/sites/${username}/stream/delete`,
        { uid },
      );
    } catch (e: any) {
      error.value = e.message || "Failed to delete Stream video";
      return null;
    } finally {
      loading.value = false;
    }
  }

  // Domain management
  async function getDomainStatus(
    username: string,
  ): Promise<DomainStatus | null> {
    try {
      return await api.get<DomainStatus>(`/domains/${username}`);
    } catch (e: any) {
      console.error("Get domain status error:", e);
      return null;
    }
  }

  async function connectDomain(
    username: string,
    domain: string,
  ): Promise<DomainSetupResult | null> {
    loading.value = true;
    error.value = null;

    try {
      const result = await api.post<DomainSetupResult>(`/domains/${username}`, {
        domain,
      });

      // Update local site data
      const site = sites.value.find((s) => s.username === username);
      if (site) {
        site.custom_domain = domain;
        site.custom_domain_status = "pending";
      }

      return result;
    } catch (e: any) {
      error.value = e.message || "Failed to connect domain";
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function disconnectDomain(username: string): Promise<boolean> {
    loading.value = true;
    error.value = null;

    try {
      await api.delete(`/domains/${username}`);

      // Update local site data
      const site = sites.value.find((s) => s.username === username);
      if (site) {
        site.custom_domain = null;
        site.custom_domain_status = null;
      }

      return true;
    } catch (e: any) {
      error.value = e.message || "Failed to disconnect domain";
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function refreshDomainStatus(username: string): Promise<boolean> {
    try {
      await api.post(`/domains/${username}/refresh`, {});
      return true;
    } catch {
      return false;
    }
  }

  async function getSiteStorageStatus(
    username: string,
  ): Promise<SiteStorageStatus | null> {
    try {
      return await api.get<SiteStorageStatus>(`/sites/${username}/storage`);
    } catch (e: any) {
      error.value = e.message || "Failed to load storage status";
      return null;
    }
  }

  async function migrateSiteMediaToR2(
    username: string,
  ): Promise<SiteStorageMigrationResult | null> {
    loading.value = true;
    error.value = null;

    try {
      return await api.post<SiteStorageMigrationResult>(
        `/sites/${username}/storage/migrate-media`,
        {},
      );
    } catch (e: any) {
      error.value = e.message || "Failed to migrate media to R2";
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function startOnboarding(
    payload: OnboardingRequest,
  ): Promise<OnboardingJobStatus | null> {
    loading.value = true;
    error.value = null;

    try {
      return await api.post<OnboardingJobStatus>("/agent/onboard", payload);
    } catch (e: any) {
      error.value = e.message || "Failed to start onboarding";
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function getOnboardingStatus(
    jobId: string,
  ): Promise<OnboardingJobStatus | null> {
    try {
      return await api.get<OnboardingJobStatus>(`/agent/onboard/${jobId}/status`);
    } catch (e: any) {
      error.value = e.message || "Failed to load onboarding status";
      return null;
    }
  }

  // Domain purchase functions removed - Cloudflare API doesn't support
  // domain availability checking or programmatic purchases

  async function getSiteContent(username: string): Promise<SiteContent | null> {
    try {
      return await api.get<SiteContent>(`/sites/${username}/content`);
    } catch (e: any) {
      console.error("Get site content error:", e);
      return null;
    }
  }

  async function getLandingPageDraft(
    username: string,
  ): Promise<LandingPageDraftResponse | null> {
    try {
      return await api.get<LandingPageDraftResponse>(
        `/sites/${username}/landing-page`,
      );
    } catch (e: any) {
      error.value = e.message || "Failed to load landing page";
      return null;
    }
  }

  async function generateLandingPage(
    username: string,
    payload: {
      brief: string;
      templateId?: LandingPageTemplateId;
      heroImage?: string | null;
      sectionImage?: string | null;
      feedback?: string | null;
    },
  ): Promise<LandingPageDocument | null> {
    loading.value = true;
    error.value = null;

    try {
      const response = await api.post<{
        ok: boolean;
        jobId: string;
        jobType: "landing_page_builder";
        page: LandingPageDocument;
      }>("/agent/landing-pages/generate", {
        username,
        ...payload,
      });
      return response.page;
    } catch (e: any) {
      error.value = e.message || "Failed to generate landing page";
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function saveLandingPage(
    username: string,
    page: LandingPageDocument,
  ): Promise<LandingPageDocument | null> {
    loading.value = true;
    error.value = null;

    try {
      const response = await api.put<{ ok: boolean; page: LandingPageDocument }>(
        `/sites/${username}/landing-page`,
        { page },
      );
      return response.page;
    } catch (e: any) {
      error.value = e.message || "Failed to save landing page";
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function fetchPreviewHtml(username: string): Promise<string | null> {
    try {
      const response = await fetch(`${API_BASE}/sites/${username}/preview-html`, {
        credentials: "include",
      });
      if (response.status === 204) return "";
      if (!response.ok) {
        throw new ApiError("Failed to load preview", response.status);
      }
      return response.text();
    } catch (e: any) {
      error.value = e.message || "Failed to load preview";
      return null;
    }
  }

  async function publishLandingPage(username: string): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      await api.post<{ ok: boolean }>(`/sites/${username}/publish`, {});
      const site = sites.value.find((entry) => entry.username === username);
      if (site) {
        site.published_at = new Date().toISOString();
      }
      return true;
    } catch (e: any) {
      error.value = e.message || "Failed to publish landing page";
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function unpublishLandingPage(username: string): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      await api.post<{ ok: boolean }>(`/sites/${username}/unpublish`, {});
      const site = sites.value.find((entry) => entry.username === username);
      if (site) {
        site.published_at = null;
      }
      return true;
    } catch (e: any) {
      error.value = e.message || "Failed to unpublish landing page";
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function fetchSitePages(username: string): Promise<SitePage[]> {
    try {
      const response = await api.get<{ pages: SitePage[] }>(
        `/sites/${username}/pages`,
      );
      sitePages.value = response.pages;
      return response.pages;
    } catch (e: any) {
      error.value = e.message || "Failed to load pages";
      return [];
    }
  }

  async function createSitePage(
    username: string,
    payload: {
      slug: string;
      brief: string;
      templateId: LandingPageTemplateId;
      designPackId?: LandingPageDesignPackId;
    },
  ): Promise<SitePage | null> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post<{ page: SitePage }>(
        `/sites/${username}/pages`,
        payload,
      );
      sitePages.value = [response.page, ...sitePages.value];
      return response.page;
    } catch (e: any) {
      error.value = e.message || "Failed to create page";
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function migrateLegacySitePages(username: string): Promise<number> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post<{ migrated: number; pages: SitePage[] }>(
        `/sites/${username}/pages/migrate-legacy`,
        {},
      );
      for (const page of response.pages) replaceSitePage(page);
      return response.migrated;
    } catch (e: any) {
      error.value = e.message || "Failed to import legacy pages";
      return 0;
    } finally {
      loading.value = false;
    }
  }

  async function getSitePage(
    username: string,
    pageId: string,
  ): Promise<SitePage | null> {
    try {
      const response = await api.get<{ page: SitePage }>(
        `/sites/${username}/pages/${pageId}`,
      );
      const index = sitePages.value.findIndex((page) => page.id === pageId);
      if (index >= 0) sitePages.value[index] = response.page;
      else sitePages.value.push(response.page);
      return response.page;
    } catch (e: any) {
      error.value = e.message || "Failed to load page";
      return null;
    }
  }

  async function saveSitePage(
    username: string,
    pageId: string,
    document: LandingPageDocumentV3,
  ): Promise<SitePage | null> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.put<{ page: SitePage }>(
        `/sites/${username}/pages/${pageId}`,
        { document },
      );
      replaceSitePage(response.page);
      return response.page;
    } catch (e: any) {
      error.value = e.message || "Failed to save page";
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function fetchSitePagePreview(
    username: string,
    pageId: string,
  ): Promise<string | null> {
    try {
      const response = await fetch(
        `${API_BASE}/sites/${username}/pages/${pageId}/preview-html`,
        { credentials: "include" },
      );
      if (!response.ok) throw new ApiError("Failed to load preview", response.status);
      return response.text();
    } catch (e: any) {
      error.value = e.message || "Failed to load preview";
      return null;
    }
  }

  async function publishSitePage(
    username: string,
    pageId: string,
  ): Promise<SitePage | null> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post<{ page: SitePage }>(
        `/sites/${username}/pages/${pageId}/publish`,
        {},
      );
      replaceSitePage(response.page);
      return response.page;
    } catch (e: any) {
      error.value = e.message || "Failed to publish page";
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function unpublishSitePage(
    username: string,
    pageId: string,
  ): Promise<SitePage | null> {
    loading.value = true;
    error.value = null;
    try {
      const response = await api.post<{ page: SitePage }>(
        `/sites/${username}/pages/${pageId}/unpublish`,
        {},
      );
      replaceSitePage(response.page);
      return response.page;
    } catch (e: any) {
      error.value = e.message || "Failed to unpublish page";
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function getSitePageRevisions(
    username: string,
    pageId: string,
  ): Promise<SitePageRevision[]> {
    try {
      const response = await api.get<{ revisions: SitePageRevision[] }>(
        `/sites/${username}/pages/${pageId}/revisions`,
      );
      return response.revisions;
    } catch (e: any) {
      error.value = e.message || "Failed to load page history";
      return [];
    }
  }

  async function restoreSitePageRevision(
    username: string,
    pageId: string,
    revisionId: string,
  ): Promise<SitePage | null> {
    try {
      const response = await api.post<{ page: SitePage }>(
        `/sites/${username}/pages/${pageId}/revisions/${revisionId}/restore`,
        {},
      );
      replaceSitePage(response.page);
      return response.page;
    } catch (e: any) {
      error.value = e.message || "Failed to restore page version";
      return null;
    }
  }

  async function deleteSitePage(username: string, pageId: string): Promise<boolean> {
    try {
      await api.delete(`/sites/${username}/pages/${pageId}`);
      sitePages.value = sitePages.value.filter((page) => page.id !== pageId);
      return true;
    } catch (e: any) {
      error.value = e.message || "Failed to delete page";
      return false;
    }
  }

  function replaceSitePage(page: SitePage) {
    const index = sitePages.value.findIndex((candidate) => candidate.id === page.id);
    if (index >= 0) sitePages.value[index] = page;
    else sitePages.value.unshift(page);
  }

  async function importWebsite(
    username: string,
    url: string,
  ): Promise<WebsiteImportDraft | null> {
    loading.value = true;
    error.value = null;

    try {
      return await api.post<WebsiteImportDraft>(
        `/sites/${username}/import-website`,
        { url },
      );
    } catch (e: any) {
      error.value = e.message || "Failed to import website";
      console.error("Import website error:", e);
      return null;
    } finally {
      loading.value = false;
    }
  }

  async function getSiteQuota(): Promise<SiteQuota | null> {
    try {
      return await api.get<SiteQuota>("/sites/quota");
    } catch (e: any) {
      console.error("Get site quota error:", e);
      return null;
    }
  }

  async function sendProductConfirmationTest(
    username: string,
    payload: ProductConfirmationTestRequest,
  ): Promise<ProductConfirmationTestResponse> {
    loading.value = true;
    error.value = null;

    try {
      const scope = JSON.stringify([username, "products", payload]);
      const operation = getEmailTestOperation(localStorage, scope);
      const result = await api.post<ProductConfirmationTestResponse>(
        `/sites/${username}/products/confirmation-email/test`,
        { ...payload, ...operation },
      );
      finishEmailTestOperation(localStorage, scope);
      return result;
    } catch (e: any) {
      error.value = e.message || "Failed to send test email";
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function sendBookingConfirmationTest(
    username: string,
    payload: BookingConfirmationTestRequest,
  ): Promise<BookingConfirmationTestResponse> {
    loading.value = true;
    error.value = null;

    try {
      const scope = JSON.stringify([username, "bookings", payload]);
      const operation = getEmailTestOperation(localStorage, scope);
      const result = await api.post<BookingConfirmationTestResponse>(
        `/sites/${username}/bookings/confirmation-email/test`,
        { ...payload, ...operation },
      );
      finishEmailTestOperation(localStorage, scope);
      return result;
    } catch (e: any) {
      error.value = e.message || "Failed to send test email";
      throw e;
    } finally {
      loading.value = false;
    }
  }

  // Subscriber management
  async function getSubscriberCount(username: string): Promise<number> {
    try {
      const result = await api.get<SubscriberCount>(
        `/sites/${username}/subscribers/count`,
      );
      return result.count;
    } catch (e: any) {
      console.error("Get subscriber count error:", e);
      return 0;
    }
  }

  async function getSubscribers(
    username: string,
    page = 1,
    limit = 50,
  ): Promise<SubscriberList | null> {
    try {
      return await api.get<SubscriberList>(
        `/sites/${username}/subscribers?page=${page}&limit=${limit}`,
      );
    } catch (e: any) {
      console.error("Get subscribers error:", e);
      return null;
    }
  }

  async function exportSubscribers(username: string): Promise<void> {
    try {
      // Use fetch directly for file download
      const response = await fetch(
        `${API_BASE}/sites/${username}/subscribers/export`,
        {
          credentials: "include",
        },
      );

      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${username}-audience.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      error.value = e.message || "Failed to export subscribers";
      console.error("Export subscribers error:", e);
    }
  }

  async function deleteSubscriber(
    username: string,
    subscriberId: number,
  ): Promise<boolean> {
    try {
      await api.delete(`/sites/${username}/subscribers/${subscriberId}`);
      return true;
    } catch (e: any) {
      error.value = e.message || "Failed to delete subscriber";
      return false;
    }
  }

  async function addSubscriber(
    username: string,
    email: string,
    firstName?: string,
    lastName?: string,
  ): Promise<{ ok: boolean; resubscribed?: boolean } | null> {
    try {
      const result = await api.post<{ ok: boolean; resubscribed: boolean }>(
        `/sites/${username}/subscribers`,
        { email, firstName: firstName || undefined, lastName: lastName || undefined },
      );
      return result;
    } catch (e: any) {
      error.value = e.message || "Failed to add subscriber";
      return null;
    }
  }

  async function importSubscribers(
    username: string,
    file: File,
  ): Promise<{ imported: number; skipped: number; total: number } | null> {
    try {
      const formData = new FormData();
      formData.append("file", file);

      const result = await api.upload<{
        ok: boolean;
        imported: number;
        skipped: number;
        total: number;
      }>(`/sites/${username}/subscribers/import`, formData);

      return {
        imported: result.imported,
        skipped: result.skipped,
        total: result.total,
      };
    } catch (e: any) {
      error.value = e.message || "Failed to import subscribers";
      console.error("Import subscribers error:", e);
      return null;
    }
  }

  return {
    sites,
    sitePages,
    loading,
    loaded,
    error,
    hasProfileSite,
    resetSessionState,
    fetchSites,
    ensureSites,
    fetchPublishManifest,
    claimUsername,
    uploadSite,
    uploadImage,
    uploadFavicon,
    uploadPageImage,
    uploadContentAsset,
    createStreamUpload,
    finalizeStreamUpload,
    deleteStreamVideo,
    deleteSite,
    // Domain management
    getDomainStatus,
    connectDomain,
    disconnectDomain,
    refreshDomainStatus,
    getSiteStorageStatus,
    migrateSiteMediaToR2,
    startOnboarding,
    getOnboardingStatus,
    // Site content
    getSiteContent,
    getLandingPageDraft,
    generateLandingPage,
    saveLandingPage,
    fetchPreviewHtml,
    publishLandingPage,
    unpublishLandingPage,
    fetchSitePages,
    createSitePage,
    migrateLegacySitePages,
    getSitePage,
    saveSitePage,
    fetchSitePagePreview,
    publishSitePage,
    unpublishSitePage,
    getSitePageRevisions,
    restoreSitePageRevision,
    deleteSitePage,
    importWebsite,
    // Site quota
    getSiteQuota,
    sendProductConfirmationTest,
    sendBookingConfirmationTest,
    // Subscriber management
    getSubscriberCount,
    getSubscribers,
    exportSubscribers,
    addSubscriber,
    importSubscribers,
    deleteSubscriber,
  };
});
