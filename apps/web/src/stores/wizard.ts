import type { ProductDelivery } from "../../../../shared/product-delivery";
import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import {
  SITE_NAVIGATION_STYLE_LINK_KEY,
  normalizeSiteNavigationStyle,
  type Me3SiteProfile,
  type SiteNavigationStyle,
} from "@me3-core/site-renderer";
import { productSendsPurchaseConfirmation } from "../../../../shared/product-purchase-confirmation";
import { API_BASE } from "../api";
import {
  type VibeId,
  defaultVibe,
  normalizeVibeId,
} from "../styles/vibes";
import {
  getStoredTestimonialPlacement,
  normalizeTestimonialPlacement,
  resolveSiteSectionPaths,
  TESTIMONIAL_PLACEMENT_LINK_KEY,
  type TestimonialPlacement,
} from "../utils/site-sections";
import type { SiteContentAsset } from "../utils/siteContentAssets";

export type Me3Button = {
  text: string;
  url: string;
  style?: "primary" | "secondary" | "outline";
  icon?: string;
};

export type WizardSiteRole = "profile" | "organization";

type Me3IntentSubscribe = NonNullable<
  NonNullable<Me3SiteProfile["intents"]>["subscribe"]
>;
type Me3IntentBook = NonNullable<
  NonNullable<Me3SiteProfile["intents"]>["book"]
>;
type Me3ActionDefinition = {
  method: "GET" | "POST";
  url: string;
  requires?: string[];
  description?: string;
};
type Me3Service = {
  id: string;
  title: string;
  description?: string;
  sessionType?: string;
  duration?: number;
  price?: number;
  currency?: WizardBookingPricing["currency"];
  availabilityMode?: "calendar" | "native" | "external" | "manual";
  status?: "active" | "paused" | "draft";
};
type Me3BusinessContext = Partial<WizardBusinessConfig>;
type SiteSourceProduct = NonNullable<Me3SiteProfile["products"]>[number] & {
  confirmationEmail?: WizardProductConfirmationEmail;
};

export interface WizardProfile {
  name: string;
  handle: string;
  visibility: "public" | "private";
  location: string;
  locationData: WizardLocationData | null;
  bio: string;
  logo: string | null; // Site branding URL, data URL, or temporary blob URL
  avatar: string | null; // URL or data URL
  banner: string | null; // URL or data URL
  logoBlob: Blob | null;
  avatarBlob: Blob | null;
  bannerBlob: Blob | null;
  // Original uploaded images (kept in-memory only, not persisted).
  // Used to support re-cropping UX for uploads.
  avatarOriginalBlob: Blob | null;
  bannerOriginalBlob: Blob | null;
  links: Record<string, string>;
  linkOrder: string[]; // Order of link keys for drag-and-drop
  buttons: Me3Button[];
  navigationStyle: SiteNavigationStyle;
  footer: WizardFooterConfig;
  newsletter: WizardNewsletterConfig;
  booking: WizardBookingConfig;
  gift: WizardGiftConfig;
  business: WizardBusinessConfig;
}

export type WizardLocationPrecision =
  | "locality"
  | "city"
  | "district"
  | "county"
  | "region"
  | "country"
  | "unknown";

export interface WizardLocationData {
  label: string;
  latitude: number;
  longitude: number;
  precision: WizardLocationPrecision;
  locality?: string;
  region?: string;
  country?: string;
  countryCode?: string;
  source?: {
    provider: string;
    id?: string;
    osmType?: string;
    osmId?: string | number;
    osmKey?: string;
    osmValue?: string;
  };
}

export interface WizardNewsletterConfig {
  enabled: boolean;
  title: string;
  description: string;
  doubleOptIn: boolean;
}

export interface WizardBookingPricing {
  enabled: boolean;
  suggestedAmount: number;
  currency: "USD" | "GBP" | "EUR" | "CAD" | "AUD" | "CHF" | "SGD" | "INR" | "PKR";
  minimumAmount: 5;
  allowFlexiblePricing?: boolean;
  allowFree: boolean;
  paymentMethod: WizardPaymentMethod;
  paymentInstructions: string;
}

export type WizardPaymentMethod = "stripe" | "manual";

export interface WizardBookingConfirmationEmail {
  message: string;
  sendHostCopy: boolean;
}

export interface WizardGiftConfig {
  enabled: boolean;
  title: string;
  description: string;
  suggestedAmount: number;
  currency: "USD" | "GBP" | "EUR" | "CAD" | "AUD" | "CHF" | "SGD" | "INR" | "PKR";
  minimumAmount: 5;
  icon?: string;
}

export interface WizardBusinessConfig {
  positioningStatement: string;
  audience: string;
  primaryProblem: string;
  solution: string;
  targetMarket: string;
  primaryOutcome: string;
  goals: WizardSiteGoal[];
}

export interface WizardSiteGoal {
  id: string;
  title: string;
  status: "active" | "completed";
}

export type WizardBookingDuration = 15 | 30 | 45 | 60 | 75 | 90 | 120;
export type WizardBookingBufferTime = 0 | 5 | 10 | 15 | 30;
export type WizardBookingType = "one_to_one" | "class" | "retreat";
export type WizardBookingWeekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

const VALID_BOOKING_DURATIONS = [15, 30, 45, 60, 75, 90, 120] as const;

function isWizardBookingDuration(
  value: unknown,
): value is WizardBookingDuration {
  return (
    typeof value === "number" &&
    (VALID_BOOKING_DURATIONS as readonly number[]).includes(value)
  );
}

export interface WizardBookingOffer {
  id: string;
  title: string;
  description: string;
  duration: WizardBookingDuration;
  pricing?: WizardBookingPricing;
}

export interface WizardClassOffer {
  id: string;
  title: string;
  description: string;
  duration: WizardBookingDuration;
  timezone: string;
  recurrence: {
    frequency: "weekly" | "biweekly";
    weekday: WizardBookingWeekday;
    startTime: string;
    startDate: string;
  };
  pricing?: WizardBookingPricing;
  capacity: number | null;
}

/** Fixed-date multi-day offering (wall times in `timezone`). */
export interface WizardRetreatOffer {
  id: string;
  title: string;
  description: string;
  /** Derived display length from the configured window (must be >= 1). */
  durationDays: number;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timezone: string;
  pricing?: WizardBookingPricing;
  capacity: number | null;
}

export interface WizardBookingConfig {
  enabled: boolean;
  oneToOneEnabled: boolean;
  classEnabled: boolean;
  retreatEnabled: boolean;
  offers: WizardBookingOffer[];
  classOffers: WizardClassOffer[];
  retreatOffers: WizardRetreatOffer[];
  title: string;
  description: string;
  duration: WizardBookingDuration;
  bufferTime: WizardBookingBufferTime;
  reminders: {
    enabled: boolean;
    reminder24h: boolean;
    reminder2h: boolean;
  };
  confirmationEmail: WizardBookingConfirmationEmail;
  timezone: string;
  availability: {
    monday: string[];
    tuesday: string[];
    wednesday: string[];
    thursday: string[];
    friday: string[];
    saturday: string[];
    sunday: string[];
  };
  pricing?: WizardBookingPricing;
}

export interface WizardFooterConfig {
  mode: "default" | "custom" | "none";
  text: string;
  linkText: string;
  linkUrl: string;
}

export interface WizardPage {
  title: string;
  slug: string;
  slugCustomized?: boolean;
  navigationGroup?: string;
  content: string;
  /** Legacy field name retained for draft compatibility; contains all editor-owned content assets. */
  images: WizardContentAsset[];
  visible?: boolean;
}

export type WizardContentAsset = SiteContentAsset;
export type WizardPageImage = WizardContentAsset;

type WizardContentAssetInput = Omit<WizardContentAsset, "tempUrl"> & {
  tempUrl?: string;
};

type LegacyWizardImageInput = Pick<
  WizardContentAsset,
  "id" | "blob" | "mimeType" | "ext" | "alt"
>;

export type WizardPostImage = WizardPageImage;

export type WizardPostType = "article" | "video";

export interface WizardPostMedia {
  url?: string;
  duration?: number;
  thumbnail?: string;
  provider?: string;
  id?: string;
}

export interface WizardPost {
  title: string;
  slug: string;
  slugCustomized?: boolean;
  content: string;
  images: WizardPostImage[];
  type?: WizardPostType;
  caption?: string;
  media?: WizardPostMedia;
  mediaFile?: File | null;
  publishedAt?: string;
  excerpt?: string;
  emailedAt?: string;
  draft?: boolean;
}

/**
 * Legacy standalone drafts used `_content-` and `_social-` slugs. Neither
 * belongs in the profile-site blog step.
 */
function isStandaloneContentOrLegacyWizardSocialSlug(slug: string): boolean {
  return slug.startsWith("_social-") || slug.startsWith("_content-");
}

function sanitizeWizardPosts(input: unknown): WizardPost[] {
  if (!Array.isArray(input)) return [];
  const next: WizardPost[] = [];
  for (const post of input) {
    if (!post || typeof post !== "object") continue;
    const entry = post as Record<string, unknown>;
    const title = typeof entry.title === "string" ? entry.title : "";
    const slug = typeof entry.slug === "string" ? entry.slug : "";
    if (!title || !slug) continue;
    if (
      (typeof entry.type === "string" && entry.type === "social") ||
      isStandaloneContentOrLegacyWizardSocialSlug(slug)
    ) {
      continue;
    }
    const type = entry.type === "video" ? "video" : "article";
    next.push({
      title,
      slug,
      slugCustomized: inferSlugCustomized(
        title,
        slug,
        "post",
        entry.slugCustomized,
      ),
      content: typeof entry.content === "string" ? entry.content : "",
      images: [],
      type,
      caption: typeof entry.caption === "string" ? entry.caption : "",
      media:
        entry.media && typeof entry.media === "object"
          ? (entry.media as WizardPostMedia)
          : undefined,
      mediaFile: null,
      publishedAt:
        typeof entry.publishedAt === "string" ? entry.publishedAt : undefined,
      excerpt: typeof entry.excerpt === "string" ? entry.excerpt : undefined,
      emailedAt:
        typeof entry.emailedAt === "string" ? entry.emailedAt : undefined,
      draft: typeof entry.draft === "boolean" ? entry.draft : undefined,
    });
  }
  return next;
}

export type WizardProductImage = WizardPageImage;

export type WizardProductConfirmationEmail = {
  enabled?: boolean;
  subject?: string;
  message?: string;
};

export interface WizardProduct {
  delivery?: ProductDelivery;
  title: string;
  slug: string;
  slugCustomized?: boolean;
  content: string;
  images: WizardProductImage[];
  price: number;
  currency: "USD" | "GBP" | "EUR" | "CAD" | "AUD" | "CHF" | "SGD" | "INR" | "PKR";
  available: boolean;
  paymentMethod: WizardPaymentMethod;
  paymentInstructions: string;
  publishedAt?: string;
  excerpt?: string;
  confirmationEmail?: WizardProductConfirmationEmail;
}

export type WizardStepId =
  | "basics"
  | "avatar"
  | "banner"
  | "mission"
  | "goals"
  | "wheel-of-life"
  | "links"
  | "call-to-action"
  | "pages"
  | "additional-features"
  | "newsletter"
  | "bookings"
  | "blog"
  | "offerings"
  | "testimonials"
  | "publish";

export interface WizardStepDefinition {
  id: WizardStepId;
  name: string;
}

const WIZARD_STEP_IDS: readonly WizardStepId[] = [
  "basics",
  "avatar",
  "banner",
  "mission",
  "goals",
  "wheel-of-life",
  "links",
  "call-to-action",
  "pages",
  "additional-features",
  "newsletter",
  "bookings",
  "blog",
  "offerings",
  "testimonials",
  "publish",
];

const WIZARD_STEP_ID_SET: ReadonlySet<string> = new Set(WIZARD_STEP_IDS);
const WIZARD_STEP_ID_ALIASES: Partial<Record<string, WizardStepId>> = {
  feature: "additional-features",
  features: "additional-features",
  shop: "offerings",
  store: "offerings",
  offering: "offerings",
  product: "offerings",
  products: "offerings",
  cta: "call-to-action",
  wheel: "wheel-of-life",
};

export function normalizeWizardStepId(value: string): WizardStepId | null {
  const normalized = value.toLowerCase().trim().replace(/\s+/g, "-");
  if (!normalized) return null;
  if (WIZARD_STEP_ID_SET.has(normalized)) return normalized as WizardStepId;
  return WIZARD_STEP_ID_ALIASES[normalized] ?? null;
}

function legacyWizardStepIds(state: Record<string, unknown>): WizardStepId[] {
  const ids: WizardStepId[] = [
    "basics",
    "avatar",
    "banner",
    "links",
    "call-to-action",
    "pages",
    "additional-features",
  ];
  if (state.newsletterEnabled === true) ids.push("newsletter");
  if (state.bookingsEnabled === true) ids.push("bookings");
  if (state.blogEnabled === true) ids.push("blog");
  ids.push("offerings");
  if (state.testimonialsEnabled === true) ids.push("testimonials");
  ids.push("publish");
  return ids;
}

function legacyWizardStepId(
  state: Record<string, unknown>,
  storedProfile: Record<string, unknown>,
  value: unknown,
): WizardStepId | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  // Preserve the previous release's one-time migration for drafts saved before
  // Offerings was inserted into the old wizard.
  const hasBusinessContext =
    !!storedProfile.business && typeof storedProfile.business === "object";
  const shouldMigrateOfferingsStep =
    !hasBusinessContext && state.shopEnabled === false;
  const migratedValue =
    shouldMigrateOfferingsStep && value >= 11 ? value + 1 : value;
  const ids = legacyWizardStepIds(state);
  const index = Math.min(Math.max(Math.trunc(migratedValue), 1), ids.length) - 1;
  return ids[index] ?? null;
}

function normalizeProductPriceCents(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.round(numeric);
}

export interface WizardTestimonial {
  name: string;
  handle?: string;
  /** Preview URL (https, site files URL, or temporary blob: URL). Never persisted as data: in me.json. */
  avatar?: string;
  /** In-memory only; uploaded to R2 on publish as files/testimonial-{n}.{ext}. */
  avatarBlob?: Blob | null;
  quote: string;
  profileUrl?: string;
}

type ExtendedMe3Profile = Omit<
  Me3SiteProfile,
  "locationData" | "products" | "business"
> & {
  locationData?: WizardLocationData;
  products?: SiteSourceProduct[];
  blogEnabled?: boolean;
  blogTitle?: string;
  shopTitle?: string;
  testimonialDisplay?: TestimonialPlacement;
  testimonialsTitle?: string;
  business?: Me3BusinessContext;
  services?: Me3Service[];
  actions?: Record<string, Me3ActionDefinition>;
};

type PublishedBookingOffer = {
  id: string;
  title: string;
  description?: string;
  duration?: number;
  pricing?: WizardBookingPricing;
};

type PublishedBookingClass = {
  id: string;
  title: string;
  description?: string;
  duration?: number;
  timezone?: string;
  recurrence?: {
    frequency?: "weekly" | "biweekly";
    weekday?: WizardBookingWeekday;
    startTime?: string;
    startDate?: string;
  };
  pricing?: WizardBookingPricing;
  capacity?: number | null;
};

type PublishedBookingRetreat = {
  id: string;
  title: string;
  description?: string;
  durationDays?: number;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timezone?: string;
  pricing?: WizardBookingPricing;
  capacity?: number | null;
};

type PublishedBookingType = {
  id: WizardBookingType;
  type: WizardBookingType;
  label: string;
  title?: string;
  description?: string;
  offers?: PublishedBookingOffer[];
  availability?: {
    timezone?: string;
    windows?: Record<string, string[]>;
  };
  classes?: PublishedBookingClass[];
  retreats?: PublishedBookingRetreat[];
};

type ExtendedMe3IntentBook = Me3IntentBook & {
  offers?: PublishedBookingOffer[];
  classes?: PublishedBookingClass[];
  retreats?: PublishedBookingRetreat[];
  bookingTypes?: PublishedBookingType[];
  pricing?: WizardBookingPricing;
  reminders?: Partial<WizardBookingConfig["reminders"]>;
  confirmationEmail?: Partial<WizardBookingConfirmationEmail>;
};

const DEFAULT_BLOG_TITLE = "Blog";
const DEFAULT_SHOP_TITLE = "Products";
const DEFAULT_TESTIMONIALS_TITLE = "Testimonials";

const STORAGE_KEY = "me3_wizard_state";
const SCOPED_STORAGE_PREFIX = `${STORAGE_KEY}:v2`;

function normalizeAssetSiteUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/^@/, "");
  if (!trimmed || trimmed === "undefined" || trimmed === "null") return null;
  return trimmed;
}

function resolveWizardSiteAssetUrl(
  value: string | null | undefined,
  siteUsername: string | null | undefined,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const fallbackUsername = normalizeAssetSiteUsername(siteUsername);
  const previewAsset = trimmed.match(
    /^(?:https?:\/\/[^/]+)?(?:\.?\/)?preview\/([^/]+)\/((?:files\/[^?#\s]+)|favicon\.png)([?#][^\s]*)?$/i,
  );
  if (previewAsset) {
    const assetUsername =
      fallbackUsername || normalizeAssetSiteUsername(previewAsset[1]);
    const assetPath = `${previewAsset[2]}${previewAsset[3] || ""}`;
    return assetUsername
      ? `/preview/${encodeURIComponent(assetUsername)}/${assetPath}`
      : `./${assetPath}`;
  }

  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;

  const normalized = trimmed
    .replace(/^\.?\//, "")
    .replace(/^(\.\.\/)+/, "");
  if (normalized.startsWith("files/") || normalized === "favicon.png") {
    return fallbackUsername
      ? `/preview/${encodeURIComponent(fallbackUsername)}/${normalized}`
      : `./${normalized}`;
  }

  return trimmed;
}

function imageBlobFromDataUrl(value: unknown): Blob | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i);
  if (!match) return null;
  try {
    const decoded = atob(match[2]);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return new Blob([bytes], { type: match[1].toLowerCase() });
  } catch {
    return null;
  }
}

function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function defaultWizardBookingPricing(): WizardBookingPricing {
  return {
    enabled: false,
    suggestedAmount: 50,
    currency: "USD",
    minimumAmount: 5,
    allowFlexiblePricing: true,
    allowFree: false,
    paymentMethod: "stripe",
    paymentInstructions: "",
  };
}

function normalizeWizardPaymentMethod(value: unknown): WizardPaymentMethod {
  return value === "manual" ? "manual" : "stripe";
}

function normalizeWizardPaymentInstructions(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeWizardBookingPricing(
  input: Partial<WizardBookingPricing> | undefined,
): WizardBookingPricing {
  return {
    ...defaultWizardBookingPricing(),
    ...(input || {}),
    paymentMethod: normalizeWizardPaymentMethod(input?.paymentMethod),
    paymentInstructions: normalizeWizardPaymentInstructions(
      input?.paymentInstructions,
    ),
  };
}

function defaultWizardBookingConfirmationEmail(): WizardBookingConfirmationEmail {
  return {
    message: "",
    sendHostCopy: true,
  };
}

function createDefaultBookingOffer(
  overrides: Partial<WizardBookingOffer> = {},
): WizardBookingOffer {
  const title = typeof overrides.title === "string" ? overrides.title : "";
  const fallbackId = generateSlug(title) || "book-session";
  const pricing =
    overrides.pricing === undefined
      ? undefined
      : normalizeWizardBookingPricing(overrides.pricing);

  return {
    id:
      typeof overrides.id === "string" && overrides.id.trim().length > 0
        ? overrides.id
        : fallbackId,
    title,
    description:
      typeof overrides.description === "string" ? overrides.description : "",
    duration: (overrides.duration as WizardBookingDuration) || 30,
    ...(pricing ? { pricing } : {}),
  };
}

function createDefaultClassOffer(
  overrides: Partial<WizardClassOffer> = {},
): WizardClassOffer {
  const title = typeof overrides.title === "string" ? overrides.title : "";
  const fallbackId = generateSlug(title) || "weekly-class";
  const pricing =
    overrides.pricing === undefined
      ? undefined
      : normalizeWizardBookingPricing(overrides.pricing);
  const recurrence =
    overrides.recurrence && typeof overrides.recurrence === "object"
      ? overrides.recurrence
      : undefined;

  return {
    id:
      typeof overrides.id === "string" && overrides.id.trim().length > 0
        ? overrides.id
        : fallbackId,
    title,
    description:
      typeof overrides.description === "string" ? overrides.description : "",
    duration: (overrides.duration as WizardBookingDuration) || 60,
    timezone:
      typeof overrides.timezone === "string" && overrides.timezone.trim().length > 0
        ? overrides.timezone
        : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    recurrence: {
      frequency: recurrence?.frequency === "biweekly" ? "biweekly" : "weekly",
      weekday:
        recurrence?.weekday &&
        [
          "monday",
          "tuesday",
          "wednesday",
          "thursday",
          "friday",
          "saturday",
          "sunday",
        ].includes(recurrence.weekday)
          ? recurrence.weekday
          : "monday",
      startTime:
        typeof recurrence?.startTime === "string" &&
        /^\d{2}:\d{2}$/.test(recurrence.startTime)
          ? recurrence.startTime
          : "18:00",
      startDate:
        typeof recurrence?.startDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(recurrence.startDate)
          ? recurrence.startDate
          : "",
    },
    ...(pricing ? { pricing } : {}),
    capacity: (() => {
      if (typeof overrides.capacity === "number") {
        return overrides.capacity > 0 ? Math.round(overrides.capacity) : null;
      }
      if (overrides.capacity === null) {
        return null;
      }
      return 12;
    })(),
  };
}

function createDefaultRetreatOffer(
  overrides: Partial<WizardRetreatOffer> = {},
): WizardRetreatOffer {
  const title = typeof overrides.title === "string" ? overrides.title : "";
  const fallbackId = generateSlug(title) || "retreat";
  const pricing =
    overrides.pricing === undefined
      ? undefined
      : normalizeWizardBookingPricing(overrides.pricing);

  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const todayStr = `${y}-${m}-${day}`;

  const startDate =
    typeof overrides.startDate === "string" && overrides.startDate.trim().length > 0
      ? overrides.startDate
      : todayStr;
  const startTime =
    typeof overrides.startTime === "string" && /^\d{2}:\d{2}$/.test(overrides.startTime)
      ? overrides.startTime
      : "09:00";
  const endDate =
    typeof overrides.endDate === "string" && overrides.endDate.trim().length > 0
      ? overrides.endDate
      : todayStr;
  const endTime =
    typeof overrides.endTime === "string" && /^\d{2}:\d{2}$/.test(overrides.endTime)
      ? overrides.endTime
      : "17:00";

  return {
    id:
      typeof overrides.id === "string" && overrides.id.trim().length > 0
        ? overrides.id
        : fallbackId,
    title,
    description:
      typeof overrides.description === "string" ? overrides.description : "",
    durationDays: deriveRetreatDurationDays({
      startDate,
      startTime,
      endDate,
      endTime,
      durationDays: overrides.durationDays,
    }),
    startDate,
    startTime,
    endDate,
    endTime,
    timezone:
      typeof overrides.timezone === "string" && overrides.timezone.trim().length > 0
        ? overrides.timezone
        : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    ...(pricing ? { pricing } : {}),
    capacity: (() => {
      if (typeof overrides.capacity === "number") {
        return overrides.capacity > 0 ? Math.round(overrides.capacity) : null;
      }
      if (overrides.capacity === null) {
        return null;
      }
      return 12;
    })(),
  };
}

function parseRetreatWallDateTime(
  date: string | undefined,
  time: string | undefined,
): number | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!time || !/^\d{2}:\d{2}$/.test(time)) return null;

  const timestamp = Date.parse(`${date}T${time}:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function deriveRetreatDurationDays(input: {
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
  durationDays?: number;
}): number {
  const startMs = parseRetreatWallDateTime(input.startDate, input.startTime);
  const endMs = parseRetreatWallDateTime(input.endDate, input.endTime);

  if (startMs !== null && endMs !== null && endMs > startMs) {
    return Math.max(1, Math.ceil((endMs - startMs) / (24 * 60 * 60 * 1000)));
  }

  if (
    typeof input.durationDays === "number" &&
    Number.isFinite(input.durationDays) &&
    input.durationDays >= 1
  ) {
    return Math.round(input.durationDays);
  }

  return 1;
}

function normalizeWizardBookingOffers(input: unknown): WizardBookingOffer[] {
  if (!Array.isArray(input)) return [];

  const offers: WizardBookingOffer[] = [];
  const usedIds = new Set<string>();

  for (const rawOffer of input) {
    if (!rawOffer || typeof rawOffer !== "object") continue;
    const offer = rawOffer as Partial<WizardBookingOffer>;
    const normalized = createDefaultBookingOffer({
      id:
        typeof offer.id === "string" && offer.id.trim().length > 0
          ? offer.id.trim()
          : generateSlug(typeof offer.title === "string" ? offer.title : "") ||
            "book-session",
      title: typeof offer.title === "string" ? offer.title : "",
      description:
        typeof offer.description === "string" ? offer.description : "",
    duration: isWizardBookingDuration(offer.duration) ? offer.duration : 30,
      pricing:
        offer.pricing && typeof offer.pricing === "object"
          ? normalizeWizardBookingPricing(offer.pricing)
          : undefined,
    });

    const baseId = normalized.id || "book-session";
    let nextId = baseId;
    let counter = 1;
    while (usedIds.has(nextId)) {
      nextId = `${baseId}-${counter++}`;
    }
    normalized.id = nextId;
    usedIds.add(nextId);
    offers.push(normalized);
  }

  return offers;
}

function normalizeWizardClassOffers(input: unknown): WizardClassOffer[] {
  if (!Array.isArray(input)) return [];

  const offers: WizardClassOffer[] = [];
  const usedIds = new Set<string>();

  for (const rawClass of input) {
    if (!rawClass || typeof rawClass !== "object") continue;
    const classOffer = rawClass as Partial<WizardClassOffer>;
    const normalized = createDefaultClassOffer({
      id:
        typeof classOffer.id === "string" && classOffer.id.trim().length > 0
          ? classOffer.id.trim()
          : generateSlug(
                typeof classOffer.title === "string" ? classOffer.title : "",
              ) || "weekly-class",
      title: typeof classOffer.title === "string" ? classOffer.title : "",
      description:
        typeof classOffer.description === "string" ? classOffer.description : "",
      duration: isWizardBookingDuration(classOffer.duration)
        ? classOffer.duration
        : 60,
      timezone:
        typeof classOffer.timezone === "string" ? classOffer.timezone : undefined,
      recurrence:
        classOffer.recurrence && typeof classOffer.recurrence === "object"
          ? classOffer.recurrence
          : undefined,
      pricing:
        classOffer.pricing && typeof classOffer.pricing === "object"
          ? normalizeWizardBookingPricing(classOffer.pricing)
          : undefined,
      capacity:
        "capacity" in classOffer
          ? typeof classOffer.capacity === "number" && classOffer.capacity > 0
            ? Math.round(classOffer.capacity)
            : null
          : undefined,
    });

    const baseId = normalized.id || "weekly-class";
    let nextId = baseId;
    let counter = 1;
    while (usedIds.has(nextId)) {
      nextId = `${baseId}-${counter++}`;
    }
    normalized.id = nextId;
    usedIds.add(nextId);
    offers.push(normalized);
  }

  return offers;
}

function normalizeWizardRetreatOffers(input: unknown): WizardRetreatOffer[] {
  if (!Array.isArray(input)) return [];

  const offers: WizardRetreatOffer[] = [];
  const usedIds = new Set<string>();

  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const retreat = raw as Partial<WizardRetreatOffer>;
    const normalized = createDefaultRetreatOffer({
      id:
        typeof retreat.id === "string" && retreat.id.trim().length > 0
          ? retreat.id.trim()
          : generateSlug(typeof retreat.title === "string" ? retreat.title : "") ||
            "retreat",
      title: typeof retreat.title === "string" ? retreat.title : "",
      description:
        typeof retreat.description === "string" ? retreat.description : "",
      durationDays:
        typeof retreat.durationDays === "number" && retreat.durationDays >= 1
          ? Math.round(retreat.durationDays)
          : undefined,
      startDate: typeof retreat.startDate === "string" ? retreat.startDate : undefined,
      startTime: typeof retreat.startTime === "string" ? retreat.startTime : undefined,
      endDate: typeof retreat.endDate === "string" ? retreat.endDate : undefined,
      endTime: typeof retreat.endTime === "string" ? retreat.endTime : undefined,
      timezone: typeof retreat.timezone === "string" ? retreat.timezone : undefined,
      pricing:
        retreat.pricing && typeof retreat.pricing === "object"
          ? normalizeWizardBookingPricing(retreat.pricing)
          : undefined,
      capacity:
        "capacity" in retreat
          ? typeof retreat.capacity === "number" && retreat.capacity > 0
            ? Math.round(retreat.capacity)
            : null
          : undefined,
    });

    const baseId = normalized.id || "retreat";
    let nextId = baseId;
    let counter = 1;
    while (usedIds.has(nextId)) {
      nextId = `${baseId}-${counter++}`;
    }
    normalized.id = nextId;
    usedIds.add(nextId);
    offers.push(normalized);
  }

  return offers;
}

function legacyBookingToDefaultOffer(input: {
  title?: unknown;
  description?: unknown;
  duration?: unknown;
  pricing?: unknown;
}): WizardBookingOffer {
  const pricing =
    input.pricing && typeof input.pricing === "object"
      ? normalizeWizardBookingPricing(
          input.pricing as Partial<WizardBookingPricing>,
        )
      : undefined;

  return createDefaultBookingOffer({
    title: typeof input.title === "string" ? input.title : "",
    description:
      typeof input.description === "string" ? input.description : "",
    duration: isWizardBookingDuration(input.duration) ? input.duration : 30,
    pricing,
  });
}

function normalizeWizardBookingConfig(input: unknown): WizardBookingConfig {
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const offers = normalizeWizardBookingOffers(record.offers);
  const classOffers = normalizeWizardClassOffers(record.classOffers);
  const retreatOffers = normalizeWizardRetreatOffers(record.retreatOffers);
  const oneToOneEnabled =
    typeof record.oneToOneEnabled === "boolean"
      ? record.oneToOneEnabled
      : offers.length > 0 ||
        typeof record.title === "string" ||
        typeof record.description === "string" ||
        record.pricing !== undefined;
  const classEnabled =
    typeof record.classEnabled === "boolean"
      ? record.classEnabled
      : classOffers.length > 0 ||
        Array.isArray((record as { classes?: unknown[] }).classes);
  const retreatEnabled =
    typeof record.retreatEnabled === "boolean"
      ? record.retreatEnabled
      : retreatOffers.length > 0 ||
        Array.isArray((record as { retreats?: unknown[] }).retreats);
  const normalizedOffers = offers.length > 0
    ? offers
    : [legacyBookingToDefaultOffer(record)];
  const normalizedClassOffers = classOffers.length > 0
    ? classOffers
    : [createDefaultClassOffer()];
  const normalizedRetreatOffers = retreatOffers.length > 0
    ? retreatOffers
    : [createDefaultRetreatOffer()];
  const primaryOffer = normalizedOffers[0];
  const rawConfirmationEmail =
    record.confirmationEmail && typeof record.confirmationEmail === "object"
      ? (record.confirmationEmail as Record<string, unknown>)
      : {};

  // Heading title/description are separate from per-offer copy; do not mirror from offers[0].
  const headingTitle =
    typeof record.title === "string" ? record.title : primaryOffer?.title || "";
  const headingDescription =
    typeof record.description === "string"
      ? record.description
      : primaryOffer?.description || "";

  return {
    enabled: typeof record.enabled === "boolean" ? record.enabled : true,
    oneToOneEnabled,
    classEnabled,
    retreatEnabled,
    offers: normalizedOffers,
    classOffers: normalizedClassOffers,
    retreatOffers: normalizedRetreatOffers,
    title: headingTitle,
    description: headingDescription,
    duration: primaryOffer?.duration || 30,
    bufferTime:
      record.bufferTime === 0 ||
      record.bufferTime === 5 ||
      record.bufferTime === 10 ||
      record.bufferTime === 15 ||
      record.bufferTime === 30
        ? record.bufferTime
        : 0,
    reminders: {
      enabled:
        record.reminders &&
        typeof record.reminders === "object" &&
        typeof (record.reminders as Record<string, unknown>).enabled === "boolean"
          ? Boolean((record.reminders as Record<string, unknown>).enabled)
          : true,
      reminder24h:
        record.reminders &&
        typeof record.reminders === "object" &&
        typeof (record.reminders as Record<string, unknown>).reminder24h ===
          "boolean"
          ? Boolean(
              (record.reminders as Record<string, unknown>).reminder24h,
            )
          : true,
      reminder2h:
        record.reminders &&
        typeof record.reminders === "object" &&
        typeof (record.reminders as Record<string, unknown>).reminder2h ===
          "boolean"
          ? Boolean((record.reminders as Record<string, unknown>).reminder2h)
          : true,
    },
    confirmationEmail: {
      message:
        typeof rawConfirmationEmail.message === "string"
          ? rawConfirmationEmail.message
          : "",
      sendHostCopy:
        typeof rawConfirmationEmail.sendHostCopy === "boolean"
          ? rawConfirmationEmail.sendHostCopy
          : true,
    },
    timezone:
      typeof record.timezone === "string" && record.timezone.trim().length > 0
        ? record.timezone
        : Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    availability: {
      monday: Array.isArray((record.availability as any)?.monday)
        ? ((record.availability as any).monday as string[])
        : ["09:00-17:00"],
      tuesday: Array.isArray((record.availability as any)?.tuesday)
        ? ((record.availability as any).tuesday as string[])
        : ["09:00-17:00"],
      wednesday: Array.isArray((record.availability as any)?.wednesday)
        ? ((record.availability as any).wednesday as string[])
        : ["09:00-17:00"],
      thursday: Array.isArray((record.availability as any)?.thursday)
        ? ((record.availability as any).thursday as string[])
        : ["09:00-17:00"],
      friday: Array.isArray((record.availability as any)?.friday)
        ? ((record.availability as any).friday as string[])
        : ["09:00-17:00"],
      saturday: Array.isArray((record.availability as any)?.saturday)
        ? ((record.availability as any).saturday as string[])
        : [],
      sunday: Array.isArray((record.availability as any)?.sunday)
        ? ((record.availability as any).sunday as string[])
        : [],
    },
    pricing: primaryOffer?.pricing || defaultWizardBookingPricing(),
  };
}

function syncBookingLegacyFields(
  booking: Omit<WizardBookingConfig, "title" | "description" | "duration" | "pricing"> &
    Partial<Pick<WizardBookingConfig, "title" | "description" | "duration" | "pricing">>,
): WizardBookingConfig {
  const primaryOffer = booking.offers[0] || createDefaultBookingOffer();
  return {
    ...booking,
    oneToOneEnabled:
      typeof booking.oneToOneEnabled === "boolean"
        ? booking.oneToOneEnabled
        : true,
    classEnabled:
      typeof booking.classEnabled === "boolean" ? booking.classEnabled : false,
    retreatEnabled:
      typeof booking.retreatEnabled === "boolean" ? booking.retreatEnabled : false,
    classOffers:
      Array.isArray(booking.classOffers) && booking.classOffers.length > 0
        ? booking.classOffers
        : [createDefaultClassOffer()],
    retreatOffers:
      Array.isArray(booking.retreatOffers) && booking.retreatOffers.length > 0
        ? booking.retreatOffers
        : [createDefaultRetreatOffer()],
    // `title` / `description` stay as stored booking-level heading copy; not mirrored from offers.
    title: booking.title ?? "",
    description: booking.description ?? "",
    duration: primaryOffer.duration,
    pricing: primaryOffer.pricing || defaultWizardBookingPricing(),
    confirmationEmail: {
      ...defaultWizardBookingConfirmationEmail(),
      ...(booking.confirmationEmail || {}),
      message:
        typeof booking.confirmationEmail?.message === "string"
          ? booking.confirmationEmail.message
          : "",
      sendHostCopy: booking.confirmationEmail?.sendHostCopy !== false,
    },
  };
}

function ensureUniqueSlug(
  baseSlug: string,
  isTaken: (candidate: string) => boolean,
): string {
  let slug = baseSlug;
  let counter = 1;

  while (isTaken(slug)) {
    slug = `${baseSlug}-${counter++}`;
  }

  return slug;
}

function inferSlugCustomized(
  title: string,
  slug: string,
  fallback: string,
  stored?: unknown,
): boolean {
  if (typeof stored === "boolean") return stored;
  return slug !== (generateSlug(title) || fallback);
}

function normalizeNavigationGroup(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ").slice(0, 40);
  return normalized || undefined;
}

function normalizeBusinessField(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeBusinessGoals(value: unknown): WizardSiteGoal[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((goal, index) => {
      const record =
        goal && typeof goal === "object"
          ? (goal as Record<string, unknown>)
          : {};
      const title = normalizeBusinessField(record.title).trim().slice(0, 600);
      if (!title) return null;
      const id = normalizeBusinessField(record.id).trim();
      return {
        id: id || `site-goal-${index + 1}`,
        title,
        status: record.status === "completed" ? "completed" : "active",
      } satisfies WizardSiteGoal;
    })
    .filter((goal): goal is WizardSiteGoal => Boolean(goal));
}

function normalizeBusinessConfig(input: unknown): WizardBusinessConfig {
  const record =
    input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const audience =
    normalizeBusinessField(record.audience).trim() ||
    normalizeBusinessField(record.whoIServe).trim();
  const primaryProblem = normalizeBusinessField(record.primaryProblem).trim();
  const solution = normalizeBusinessField(record.solution).trim();
  const positioningStatement = normalizeBusinessField(
    record.positioningStatement,
  ).trim();

  return {
    positioningStatement,
    audience,
    primaryProblem,
    solution,
    targetMarket: normalizeBusinessField(record.targetMarket).trim(),
    primaryOutcome: normalizeBusinessField(record.primaryOutcome).trim(),
    goals: normalizeBusinessGoals(record.goals),
  };
}

const LOCATION_PRECISIONS = new Set<WizardLocationPrecision>([
  "locality",
  "city",
  "district",
  "county",
  "region",
  "country",
  "unknown",
]);

function normalizeLocationText(value: unknown, maxLength = 100): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : undefined;
}

function normalizeLocationCoordinate(
  value: unknown,
  min: number,
  max: number,
): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) return null;
  return Number(numeric.toFixed(5));
}

function normalizeLocationData(input: unknown): WizardLocationData | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const record = input as Record<string, unknown>;
  const label = normalizeLocationText(record.label);
  const latitude = normalizeLocationCoordinate(record.latitude, -90, 90);
  const longitude = normalizeLocationCoordinate(record.longitude, -180, 180);
  if (!label || latitude === null || longitude === null) return null;

  const precision = LOCATION_PRECISIONS.has(record.precision as WizardLocationPrecision)
    ? (record.precision as WizardLocationPrecision)
    : "unknown";
  const countryCode = normalizeLocationText(record.countryCode, 2)?.toUpperCase();
  const source =
    record.source && typeof record.source === "object" && !Array.isArray(record.source)
      ? (record.source as Record<string, unknown>)
      : null;
  const locality = normalizeLocationText(record.locality);
  const region = normalizeLocationText(record.region);
  const country = normalizeLocationText(record.country);
  const sourceProvider = normalizeLocationText(source?.provider, 80);
  const sourceId = normalizeLocationText(source?.id, 80);
  const osmType = normalizeLocationText(source?.osmType, 80);
  const osmKey = normalizeLocationText(source?.osmKey, 80);
  const osmValue = normalizeLocationText(source?.osmValue, 80);

  return {
    label,
    latitude,
    longitude,
    precision,
    ...(locality ? { locality } : {}),
    ...(region ? { region } : {}),
    ...(country ? { country } : {}),
    ...(countryCode && /^[A-Z]{2}$/.test(countryCode) ? { countryCode } : {}),
    ...(sourceProvider
      ? {
          source: {
            provider: sourceProvider,
            ...(sourceId ? { id: sourceId } : {}),
            ...(osmType ? { osmType } : {}),
            ...(typeof source?.osmId === "string" || typeof source?.osmId === "number"
              ? { osmId: source.osmId }
              : {}),
            ...(osmKey ? { osmKey } : {}),
            ...(osmValue ? { osmValue } : {}),
          },
        }
      : {}),
  };
}

const defaultProfile: WizardProfile = {
  name: "",
  handle: "",
  visibility: "private",
  location: "",
  locationData: null,
  bio: "",
  logo: null,
  avatar: null,
  banner: null,
  logoBlob: null,
  avatarBlob: null,
  bannerBlob: null,
  avatarOriginalBlob: null,
  bannerOriginalBlob: null,
  links: {},
  linkOrder: [],
  buttons: [],
  navigationStyle: "standard",
  footer: {
    mode: "default",
    text: "",
    linkText: "",
    linkUrl: "",
  },
  newsletter: {
    enabled: true,
    title: "",
    description: "",
    doubleOptIn: true,
  },
  booking: normalizeWizardBookingConfig({
    enabled: true,
    oneToOneEnabled: false,
    classEnabled: false,
    retreatEnabled: false,
    offers: [],
    classOffers: [],
    retreatOffers: [],
  }),
  gift: {
    enabled: false,
    title: "",
    description: "",
    suggestedAmount: 10,
    currency: "USD",
    minimumAmount: 5,
    icon: "Gift",
  },
  business: {
    positioningStatement: "",
    audience: "",
    primaryProblem: "",
    solution: "",
    targetMarket: "",
    primaryOutcome: "",
    goals: [],
  },
};

export const useWizardStore = defineStore("wizard", () => {
  const sessionUserId = ref<string | null>(null);
  const persistedOwnerUserId = ref<string | null>(null);
  const selectedSiteId = ref<string | null>(null);
  const selectedSiteUsername = ref("");
  const activeStorageKey = ref(STORAGE_KEY);

  // Current step (1-indexed for display)
  const currentStep = ref(1);
  const furthestStep = ref(1);

  // Profile data
  const profile = ref<WizardProfile>({ ...defaultProfile });

  // Pages (optional, for advanced users)
  const pages = ref<WizardPage[]>([]);

  // Blog posts (optional)
  const posts = ref<WizardPost[]>([]);

  // Products (optional)
  const products = ref<WizardProduct[]>([]);

  // Testimonials (optional)
  const testimonials = ref<WizardTestimonial[]>([]);

  // Optional step visibility
  const linksEnabled = ref(false);
  const callToActionEnabled = ref(false);
  const pagesEnabled = ref(false);
  const newsletterEnabled = ref(false);
  const blogEnabled = ref(false);
  const bookingsEnabled = ref(false);
  const shopEnabled = ref(false);
  const testimonialsEnabled = ref(false);
  const blogTitle = ref<string>(DEFAULT_BLOG_TITLE);
  const shopTitle = ref<string>(DEFAULT_SHOP_TITLE);

  // Testimonials placement (renderer hint)
  const testimonialsPlacement = ref<TestimonialPlacement>("homepage");
  const testimonialsTitle = ref<string>(DEFAULT_TESTIMONIALS_TITLE);
  const sectionPaths = computed(() =>
    resolveSiteSectionPaths({
      pages: pagesEnabled.value ? pages.value : [],
      blogTitle: blogTitle.value,
      shopTitle: shopTitle.value,
      testimonialsTitle: testimonialsTitle.value,
    }),
  );
  const blogPath = computed(() => sectionPaths.value.blog);
  const shopPath = computed(() => sectionPaths.value.shop);
  const testimonialsPath = computed(() => sectionPaths.value.testimonials);

  // Username for publishing
  const username = ref("");
  const siteRole = ref<WizardSiteRole>("profile");
  const draftContextId = computed(() =>
    selectedSiteId.value
      ? `site:${selectedSiteId.value}`
      : `new:${siteRole.value}`,
  );
  const isUsernameAvailable = ref<boolean | null>(null);
  const isCheckingUsername = ref(false);

  // Selected vibe (theme)
  const vibe = ref<VibeId>(defaultVibe);

  // Theme customization
  const accentOverride = ref<string | null>(null);

  // Publishing state
  const isPublishing = ref(false);
  const publishError = ref<string | null>(null);
  const lastPublishedAt = ref<string | null>(null);
  const lastLocalEditAt = ref<string>(new Date().toISOString());
  const lastSiteEditAt = ref<string>(new Date().toISOString());
  const draftSourceUrl = ref<string | null>(null);

  const steps = computed<WizardStepDefinition[]>(() => {
    const visibleSteps: WizardStepDefinition[] = [
      { id: "basics", name: "Basics" },
      {
        id: "avatar",
        name: siteRole.value === "organization" ? "Logo" : "Avatar",
      },
      { id: "banner", name: "Banner" },
      {
        id: "mission",
        name: "Mission",
      },
      { id: "goals", name: "Goals" },
      ...(siteRole.value === "profile"
        ? [{ id: "wheel-of-life" as const, name: "Wheel of Life" }]
        : []),
      { id: "additional-features", name: "Additional Features" },
    ];

    // Website features are selected on Additional Features, then appended here.
    if (linksEnabled.value) visibleSteps.push({ id: "links", name: "Links" });
    if (callToActionEnabled.value) {
      visibleSteps.push({ id: "call-to-action", name: "Call-to-action" });
    }
    if (pagesEnabled.value) visibleSteps.push({ id: "pages", name: "Pages" });
    if (newsletterEnabled.value) {
      visibleSteps.push({ id: "newsletter", name: "Newsletter" });
    }
    if (bookingsEnabled.value) {
      visibleSteps.push({ id: "bookings", name: "Bookings" });
    }
    if (blogEnabled.value) visibleSteps.push({ id: "blog", name: "Blog" });
    if (shopEnabled.value) {
      visibleSteps.push({ id: "offerings", name: "Products" });
    }
    if (testimonialsEnabled.value) {
      visibleSteps.push({ id: "testimonials", name: "Testimonials" });
    }

    visibleSteps.push({ id: "publish", name: "Publish" });
    return visibleSteps;
  });

  // Step names for display
  const stepNames = computed(() => steps.value.map((step) => step.name));
  const stepIds = computed(() => steps.value.map((step) => step.id));
  const totalSteps = computed(() => stepNames.value.length);
  const currentStepDefinition = computed(
    () => steps.value[currentStep.value - 1],
  );
  const currentStepId = computed(() => currentStepDefinition.value?.id ?? null);
  const currentStepName = computed(() => currentStepDefinition.value?.name ?? "");

  watch(
    stepIds,
    (nextStepIds, previousStepIds) => {
      if (!previousStepIds?.length) return;

      const previousCurrentId = previousStepIds[currentStep.value - 1];
      const previousFurthestId = previousStepIds[furthestStep.value - 1];
      const nextCurrentIndex = previousCurrentId
        ? nextStepIds.indexOf(previousCurrentId)
        : -1;
      const nextFurthestIndex = previousFurthestId
        ? nextStepIds.indexOf(previousFurthestId)
        : -1;

      currentStep.value =
        nextCurrentIndex >= 0
          ? nextCurrentIndex + 1
          : Math.min(currentStep.value, nextStepIds.length);
      furthestStep.value = Math.max(
        currentStep.value,
        nextFurthestIndex >= 0
          ? nextFurthestIndex + 1
          : Math.min(furthestStep.value, nextStepIds.length),
      );
    },
    { flush: "sync" },
  );

  // Check if site needs publishing
  const needsPublish = computed(() => {
    // If never published, definitely needs publish
    if (!lastPublishedAt.value) return true;

    // If local edits are newer than last publish, needs republish
    const lastEdit = new Date(lastSiteEditAt.value).getTime();
    const lastPublish = new Date(lastPublishedAt.value).getTime();
    return lastEdit > lastPublish;
  });

  // Can proceed to next step?
  const canProceed = computed(() => {
    if (currentStepId.value === "basics") {
      return (
        profile.value.name.trim().length >= 2 &&
        profile.value.handle.trim().length >= 3 &&
        isUsernameAvailable.value === true
      );
    }

    return true;
  });

  watch(
    [
      linksEnabled,
      callToActionEnabled,
      pagesEnabled,
      newsletterEnabled,
      blogEnabled,
      bookingsEnabled,
      shopEnabled,
      testimonialsEnabled,
    ],
    () => {
      profile.value.newsletter = {
        ...profile.value.newsletter,
        enabled: newsletterEnabled.value,
      };
      if (currentStep.value > totalSteps.value) {
        currentStep.value = totalSteps.value;
      }
      if (furthestStep.value > totalSteps.value) {
        furthestStep.value = totalSteps.value;
      }
      if (furthestStep.value < currentStep.value) {
        furthestStep.value = currentStep.value;
      }
      markAsEdited();
      saveToStorage();
    },
    { flush: "sync" },
  );

  watch(
    products,
    () => {
      saveToStorage();
    },
    { deep: true },
  );

  watch(
    testimonials,
    () => {
      saveToStorage();
    },
    { deep: true },
  );

  watch(
    [pages, pagesEnabled, blogEnabled, shopEnabled, products],
    () => {
      const normalizedPlacement = normalizeTestimonialPlacement(
        testimonialsPlacement.value,
        {
          blogEnabled: blogEnabled.value,
          shopEnabled: shopEnabled.value && products.value.length > 0,
          pages: pagesEnabled.value ? pages.value : [],
        },
      );

      if (normalizedPlacement !== testimonialsPlacement.value) {
        testimonialsPlacement.value = normalizedPlacement;
      }
    },
    { deep: true },
  );

  watch(testimonialsPlacement, () => {
    markAsEdited();
    saveToStorage();
  });

  watch(testimonialsTitle, () => {
    markAsEdited();
    saveToStorage();
  });

  watch(blogTitle, () => {
    markAsEdited();
    saveToStorage();
  });

  watch(shopTitle, () => {
    markAsEdited();
    saveToStorage();
  });

  // Navigation
  function nextStep() {
    if (currentStep.value < totalSteps.value && canProceed.value) {
      currentStep.value++;
      if (furthestStep.value < currentStep.value) {
        furthestStep.value = currentStep.value;
      }
      saveToStorage();
    }
  }

  function prevStep() {
    if (currentStep.value > 1) {
      currentStep.value--;
      saveToStorage();
    }
  }

  function goToStep(step: number) {
    if (step >= 1 && step <= totalSteps.value) {
      currentStep.value = step;
      if (furthestStep.value < currentStep.value) {
        furthestStep.value = currentStep.value;
      }
      saveToStorage();
      return true;
    }
    return false;
  }

  function enableStep(stepId: WizardStepId) {
    if (stepId === "links") linksEnabled.value = true;
    if (stepId === "call-to-action") callToActionEnabled.value = true;
    if (stepId === "pages") pagesEnabled.value = true;
    if (stepId === "newsletter") newsletterEnabled.value = true;
    if (stepId === "bookings") bookingsEnabled.value = true;
    if (stepId === "blog") blogEnabled.value = true;
    if (stepId === "offerings") shopEnabled.value = true;
    if (stepId === "testimonials") testimonialsEnabled.value = true;
  }

  function goToStepId(
    value: string,
    options: { enableOptional?: boolean } = {},
  ) {
    const stepId = normalizeWizardStepId(value);
    if (!stepId) return false;
    if (options.enableOptional) enableStep(stepId);

    const stepIndex = steps.value.findIndex((step) => step.id === stepId);
    if (stepIndex < 0) return false;
    return goToStep(stepIndex + 1);
  }

  // Update profile
  function updateProfile(updates: Partial<WizardProfile>) {
    const nextProfile = { ...profile.value, ...updates };
    if ("navigationStyle" in updates) {
      nextProfile.navigationStyle = normalizeSiteNavigationStyle(
        updates.navigationStyle,
      );
    }
    if ("location" in updates && !("locationData" in updates)) {
      const locationLabel = nextProfile.location.trim();
      nextProfile.locationData =
        nextProfile.locationData?.label.trim() === locationLabel
          ? nextProfile.locationData
          : null;
    } else if ("locationData" in updates) {
      nextProfile.locationData = normalizeLocationData(updates.locationData);
    }
    profile.value = nextProfile;
    markAsEdited();
    saveToStorage();
  }

  function setFooter(updates: Partial<WizardFooterConfig>) {
    profile.value = {
      ...profile.value,
      footer: { ...profile.value.footer, ...updates },
    };
    markAsEdited();
    saveToStorage();
  }

  function setNewsletter(updates: Partial<WizardNewsletterConfig>) {
    profile.value = {
      ...profile.value,
      newsletter: { ...profile.value.newsletter, ...updates },
    };
    markAsEdited();
    saveToStorage();
  }

  function setBooking(
    updates: Partial<WizardBookingConfig> & {
      title?: string;
      description?: string;
      duration?: WizardBookingDuration;
      pricing?: WizardBookingPricing;
    },
  ) {
    const nextOffers =
      updates.offers !== undefined
        ? normalizeWizardBookingOffers(updates.offers)
        : [...profile.value.booking.offers];
    const nextClassOffers =
      updates.classOffers !== undefined
        ? normalizeWizardClassOffers(updates.classOffers)
        : [...profile.value.booking.classOffers];
    const nextRetreatOffers =
      updates.retreatOffers !== undefined
        ? normalizeWizardRetreatOffers(updates.retreatOffers)
        : [...profile.value.booking.retreatOffers];

    if (nextOffers.length === 0) {
      nextOffers.push(createDefaultBookingOffer());
    }
    if (nextClassOffers.length === 0) {
      nextClassOffers.push(createDefaultClassOffer());
    }
    if (nextRetreatOffers.length === 0) {
      nextRetreatOffers.push(createDefaultRetreatOffer());
    }

    if (updates.title !== undefined && nextOffers.length === 1) {
      const nextId =
        generateSlug(updates.title) || nextOffers[0].id || "book-session";
      nextOffers[0] = { ...nextOffers[0], id: nextId, title: updates.title };
    }
    // Do not mirror booking.description into offers[0].description — short intro and
    // per-offer descriptions (e.g. rich HTML) are edited separately.
    if (updates.duration !== undefined) {
      nextOffers[0] = { ...nextOffers[0], duration: updates.duration };
    }
    if (updates.pricing !== undefined) {
      nextOffers[0] = { ...nextOffers[0], pricing: updates.pricing };
    }

    profile.value = {
      ...profile.value,
      booking: syncBookingLegacyFields({
        ...profile.value.booking,
        ...updates,
        offers: nextOffers,
        classOffers: nextClassOffers,
        retreatOffers: nextRetreatOffers,
      }),
    };
    markAsEdited();
    saveToStorage();
  }

  function enableBookingType(type: WizardBookingType) {
    if (type === "one_to_one") {
      setBooking({ oneToOneEnabled: true });
      return;
    }

    if (type === "class") {
      setBooking({ classEnabled: true });
      return;
    }

    if (type === "retreat") {
      setBooking({ retreatEnabled: true });
    }
  }

  function disableBookingType(type: WizardBookingType) {
    if (type === "one_to_one") {
      setBooking({ oneToOneEnabled: false });
      return;
    }

    if (type === "class") {
      setBooking({ classEnabled: false });
      return;
    }

    if (type === "retreat") {
      setBooking({ retreatEnabled: false });
    }
  }

  function addBookingOffer() {
    const baseId = "book-session";
    const existingIds = new Set(profile.value.booking.offers.map((offer) => offer.id));
    let nextId = baseId;
    let counter = 2;
    while (existingIds.has(nextId)) {
      nextId = `${baseId}-${counter++}`;
    }

    profile.value = {
      ...profile.value,
      booking: syncBookingLegacyFields({
        ...profile.value.booking,
        offers: [
          ...profile.value.booking.offers,
          createDefaultBookingOffer({ id: nextId }),
        ],
      }),
    };
    markAsEdited();
    saveToStorage();
    return nextId;
  }

  function updateBookingOffer(
    offerId: string,
    updates: Partial<WizardBookingOffer>,
  ) {
    profile.value = {
      ...profile.value,
      booking: syncBookingLegacyFields({
        ...profile.value.booking,
        offers: profile.value.booking.offers.map((offer) => {
          if (offer.id !== offerId) return offer;

          const nextTitle =
            typeof updates.title === "string" ? updates.title : offer.title;
          const nextId =
            typeof updates.id === "string" && updates.id.trim().length > 0
              ? updates.id.trim()
              : offer.id;
          // `pricing: undefined` must clear pricing (e.g. free offer). Plain
          // `updates.pricing === undefined` is also true when `pricing` is omitted,
          // so use `in` to tell "clear" vs "leave unchanged".
          const nextPricing = !("pricing" in updates)
            ? offer.pricing
            : updates.pricing
              ? {
                  ...defaultWizardBookingPricing(),
                  ...offer.pricing,
                  ...updates.pricing,
                }
              : undefined;

          return {
            ...offer,
            ...updates,
            id: nextId,
            title: nextTitle,
            pricing: nextPricing,
          };
        }),
      }),
    };
    markAsEdited();
    saveToStorage();
  }

  function removeBookingOffer(offerId: string) {
    const remainingOffers = profile.value.booking.offers.filter(
      (offer) => offer.id !== offerId,
    );

    profile.value = {
      ...profile.value,
      booking: syncBookingLegacyFields({
        ...profile.value.booking,
        offers:
          remainingOffers.length > 0
            ? remainingOffers
            : [createDefaultBookingOffer()],
      }),
    };
    markAsEdited();
    saveToStorage();
  }

  function setBookingAvailability(
    day: keyof WizardBookingConfig["availability"],
    windows: string[],
  ) {
    profile.value = {
      ...profile.value,
      booking: syncBookingLegacyFields({
        ...profile.value.booking,
        availability: {
          ...profile.value.booking.availability,
          [day]: windows,
        },
      }),
    };
    markAsEdited();
    saveToStorage();
  }

  function setBookingOfferPricing(
    offerId: string,
    updates: Partial<WizardBookingPricing> | null,
  ) {
    updateBookingOffer(offerId, {
      pricing:
        updates === null
          ? undefined
          : {
              ...defaultWizardBookingPricing(),
              ...profile.value.booking.offers.find((offer) => offer.id === offerId)
                ?.pricing,
              ...updates,
            },
    });
  }

  function addClassOffer() {
    const baseId = "weekly-class";
    const existingIds = new Set(
      profile.value.booking.classOffers.map((offer) => offer.id),
    );
    let nextId = baseId;
    let counter = 2;
    while (existingIds.has(nextId)) {
      nextId = `${baseId}-${counter++}`;
    }

    profile.value = {
      ...profile.value,
      booking: syncBookingLegacyFields({
        ...profile.value.booking,
        classOffers: [
          ...profile.value.booking.classOffers,
          createDefaultClassOffer({ id: nextId }),
        ],
      }),
    };
    markAsEdited();
    saveToStorage();
    return nextId;
  }

  function addRetreatOffer() {
    const baseId = "retreat";
    const existingIds = new Set(
      profile.value.booking.retreatOffers.map((offer) => offer.id),
    );
    let nextId = baseId;
    let counter = 2;
    while (existingIds.has(nextId)) {
      nextId = `${baseId}-${counter++}`;
    }

    profile.value = {
      ...profile.value,
      booking: syncBookingLegacyFields({
        ...profile.value.booking,
        retreatOffers: [
          ...profile.value.booking.retreatOffers,
          createDefaultRetreatOffer({ id: nextId }),
        ],
      }),
    };
    markAsEdited();
    saveToStorage();
    return nextId;
  }

  function updateClassOffer(
    offerId: string,
    updates: Partial<WizardClassOffer>,
  ) {
    profile.value = {
      ...profile.value,
      booking: syncBookingLegacyFields({
        ...profile.value.booking,
        classOffers: profile.value.booking.classOffers.map((offer) => {
          if (offer.id !== offerId) return offer;

          const nextPricing = !("pricing" in updates)
            ? offer.pricing
            : updates.pricing
              ? {
                  ...defaultWizardBookingPricing(),
                  ...offer.pricing,
                  ...updates.pricing,
                }
              : undefined;

          return {
            ...offer,
            ...updates,
            id:
              typeof updates.id === "string" && updates.id.trim().length > 0
                ? updates.id.trim()
                : offer.id,
            title:
              typeof updates.title === "string" ? updates.title : offer.title,
            recurrence: {
              ...offer.recurrence,
              ...(updates.recurrence || {}),
            },
            pricing: nextPricing,
            capacity:
              typeof updates.capacity === "number"
                ? Math.max(1, Math.round(updates.capacity))
                : updates.capacity === null
                  ? null
                  : offer.capacity,
          };
        }),
      }),
    };
    markAsEdited();
    saveToStorage();
  }

  function removeClassOffer(offerId: string) {
    const remainingOffers = profile.value.booking.classOffers.filter(
      (offer) => offer.id !== offerId,
    );

    profile.value = {
      ...profile.value,
      booking: syncBookingLegacyFields({
        ...profile.value.booking,
        classOffers:
          remainingOffers.length > 0
            ? remainingOffers
            : [createDefaultClassOffer()],
      }),
    };
    markAsEdited();
    saveToStorage();
  }

  function updateRetreatOffer(
    offerId: string,
    updates: Partial<WizardRetreatOffer>,
  ) {
    profile.value = {
      ...profile.value,
      booking: syncBookingLegacyFields({
        ...profile.value.booking,
        retreatOffers: profile.value.booking.retreatOffers.map((offer) => {
          if (offer.id !== offerId) return offer;

          const nextPricing = !("pricing" in updates)
            ? offer.pricing
            : updates.pricing
              ? {
                  ...defaultWizardBookingPricing(),
                  ...offer.pricing,
                  ...updates.pricing,
                }
              : undefined;

          return {
            ...offer,
            ...updates,
            id:
              typeof updates.id === "string" && updates.id.trim().length > 0
                ? updates.id.trim()
                : offer.id,
            title:
              typeof updates.title === "string" ? updates.title : offer.title,
            pricing: nextPricing,
            capacity:
              typeof updates.capacity === "number"
                ? Math.max(1, Math.round(updates.capacity))
                : updates.capacity === null
                  ? null
                  : offer.capacity,
            durationDays: deriveRetreatDurationDays({
              startDate:
                typeof updates.startDate === "string"
                  ? updates.startDate
                  : offer.startDate,
              startTime:
                typeof updates.startTime === "string"
                  ? updates.startTime
                  : offer.startTime,
              endDate:
                typeof updates.endDate === "string"
                  ? updates.endDate
                  : offer.endDate,
              endTime:
                typeof updates.endTime === "string"
                  ? updates.endTime
                  : offer.endTime,
              durationDays:
                typeof updates.durationDays === "number"
                  ? updates.durationDays
                  : offer.durationDays,
            }),
          };
        }),
      }),
    };
    markAsEdited();
    saveToStorage();
  }

  function removeRetreatOffer(offerId: string) {
    const remainingOffers = profile.value.booking.retreatOffers.filter(
      (offer) => offer.id !== offerId,
    );

    profile.value = {
      ...profile.value,
      booking: syncBookingLegacyFields({
        ...profile.value.booking,
        retreatOffers:
          remainingOffers.length > 0
            ? remainingOffers
            : [createDefaultRetreatOffer()],
      }),
    };
    markAsEdited();
    saveToStorage();
  }

  function setClassOfferPricing(
    offerId: string,
    updates: Partial<WizardBookingPricing> | null,
  ) {
    updateClassOffer(offerId, {
      pricing:
        updates === null
          ? undefined
          : {
              ...defaultWizardBookingPricing(),
              ...profile.value.booking.classOffers.find((offer) => offer.id === offerId)
                ?.pricing,
              ...updates,
            },
    });
  }

  function setRetreatOfferPricing(
    offerId: string,
    updates: Partial<WizardBookingPricing> | null,
  ) {
    updateRetreatOffer(offerId, {
      pricing:
        updates === null
          ? undefined
          : {
              ...defaultWizardBookingPricing(),
              ...profile.value.booking.retreatOffers.find((offer) => offer.id === offerId)
                ?.pricing,
              ...updates,
            },
    });
  }

  function setBookingPricing(updates: Partial<WizardBookingPricing>) {
    const primaryOfferId = profile.value.booking.offers[0]?.id;
    if (!primaryOfferId) return;
    setBookingOfferPricing(primaryOfferId, updates);
  }

  function setPaidBookingOffersPricing(updates: Partial<WizardBookingPricing>) {
    const paidOfferIds = profile.value.booking.offers
      .filter((offer) => offer.pricing?.enabled)
      .map((offer) => offer.id);
    const paidClassOfferIds = profile.value.booking.classOffers
      .filter((offer) => offer.pricing?.enabled)
      .map((offer) => offer.id);
    const paidRetreatOfferIds = profile.value.booking.retreatOffers
      .filter((offer) => offer.pricing?.enabled)
      .map((offer) => offer.id);

    if (
      paidOfferIds.length === 0 &&
      paidClassOfferIds.length === 0 &&
      paidRetreatOfferIds.length === 0
    ) {
      return;
    }

    const nextOffers = profile.value.booking.offers.map((offer) => {
      if (!paidOfferIds.includes(offer.id) || !offer.pricing) {
        return offer;
      }

      return {
        ...offer,
        pricing: {
          ...defaultWizardBookingPricing(),
          ...offer.pricing,
          ...updates,
        },
      };
    });
    const nextClassOffers = profile.value.booking.classOffers.map((offer) => {
      if (!paidClassOfferIds.includes(offer.id) || !offer.pricing) {
        return offer;
      }

      return {
        ...offer,
        pricing: {
          ...defaultWizardBookingPricing(),
          ...offer.pricing,
          ...updates,
        },
      };
    });
    const nextRetreatOffers = profile.value.booking.retreatOffers.map((offer) => {
      if (!paidRetreatOfferIds.includes(offer.id) || !offer.pricing) {
        return offer;
      }

      return {
        ...offer,
        pricing: {
          ...defaultWizardBookingPricing(),
          ...offer.pricing,
          ...updates,
        },
      };
    });

    profile.value = {
      ...profile.value,
      booking: syncBookingLegacyFields({
        ...profile.value.booking,
        offers: nextOffers,
        classOffers: nextClassOffers,
        retreatOffers: nextRetreatOffers,
      }),
    };
    markAsEdited();
    saveToStorage();
  }

  function setGift(updates: Partial<WizardGiftConfig>) {
    profile.value = {
      ...profile.value,
      gift: { ...profile.value.gift, ...updates },
    };
    markAsEdited();
    saveToStorage();
  }

  // Links helpers
  function setLink(platform: string, value: string) {
    profile.value.links = { ...profile.value.links, [platform]: value };
    // Add to linkOrder if not already present (but not _label keys)
    if (
      !platform.endsWith("_label") &&
      !profile.value.linkOrder.includes(platform)
    ) {
      profile.value.linkOrder = [...profile.value.linkOrder, platform];
    }
    markAsEdited();
    saveToStorage();
  }

  function removeLink(platform: string) {
    const { [platform]: _, ...rest } = profile.value.links;
    profile.value.links = rest;
    // Remove from linkOrder
    profile.value.linkOrder = profile.value.linkOrder.filter(
      (k) => k !== platform,
    );
    markAsEdited();
    saveToStorage();
  }

  function setLinkOrder(order: string[]) {
    profile.value.linkOrder = order;
    markAsEdited();
    saveToStorage();
  }

  // Buttons helpers
  function addButton(button: Me3Button) {
    profile.value.buttons = [...profile.value.buttons, button];
    markAsEdited();
    saveToStorage();
  }

  function updateButton(index: number, button: Me3Button) {
    const buttons = [...profile.value.buttons];
    buttons[index] = button;
    profile.value.buttons = buttons;
    markAsEdited();
    saveToStorage();
  }

  function removeButton(index: number) {
    profile.value.buttons = profile.value.buttons.filter((_, i) => i !== index);
    markAsEdited();
    saveToStorage();
  }

  function setButtons(buttons: Me3Button[]) {
    profile.value.buttons = [...buttons];
    markAsEdited();
    saveToStorage();
  }

  // Pages helpers
  const MAX_PAGES = 50;

  function addPage(title: string = "New Page", options?: { visible?: boolean }) {
    if (pages.value.length >= MAX_PAGES) return null;

    const baseSlug = generateSlug(title) || "page";
    const slug = ensureUniqueSlug(
      baseSlug,
      (candidate) => pages.value.some((p) => p.slug === candidate),
    );

    const newPage: WizardPage = {
      title,
      slug,
      slugCustomized: false,
      content: "",
      images: [],
      visible: options?.visible ?? true,
    };

    pages.value = [...pages.value, newPage];
    markAsEdited();
    saveToStorage();
    return newPage;
  }

  function updatePage(index: number, updates: Partial<WizardPage>) {
    if (index < 0 || index >= pages.value.length) return;

    const updatedPages = [...pages.value];
    const current = updatedPages[index];
    const previousSlug = current.slug;
    const nextTitle =
      typeof updates.title === "string" ? updates.title : current.title;
    const autoSlugBase = generateSlug(nextTitle) || "page";
    const hasExplicitSlug = Object.prototype.hasOwnProperty.call(updates, "slug");

    let nextSlug = current.slug;
    let nextSlugCustomized = Boolean(current.slugCustomized);

    if (hasExplicitSlug) {
      const requestedSlug = generateSlug(updates.slug || "") || autoSlugBase;
      nextSlug = ensureUniqueSlug(
        requestedSlug,
        (candidate) =>
          pages.value.some(
            (page, pageIndex) =>
              pageIndex !== index && page.slug === candidate,
          ),
      );
      nextSlugCustomized = nextSlug !== autoSlugBase;
    } else if (updates.title && !current.slugCustomized) {
      nextSlug = ensureUniqueSlug(
        autoSlugBase,
        (candidate) =>
          pages.value.some(
            (page, pageIndex) =>
              pageIndex !== index && page.slug === candidate,
          ),
      );
      nextSlugCustomized = false;
    }

    const nextPage = {
      ...current,
      ...updates,
      navigationGroup: Object.prototype.hasOwnProperty.call(
        updates,
        "navigationGroup",
      )
        ? normalizeNavigationGroup(updates.navigationGroup)
        : normalizeNavigationGroup(current.navigationGroup),
      slug: nextSlug,
      slugCustomized: nextSlugCustomized,
    };
    updatedPages[index] = nextPage;
    pages.value = updatedPages;
    if (
      nextPage.slug !== previousSlug &&
      testimonialsPlacement.value === `page:${previousSlug}`
    ) {
      testimonialsPlacement.value = `page:${nextPage.slug}`;
    }
    markAsEdited();
    saveToStorage();
  }

  function movePage(fromIndex: number, toIndex: number) {
    if (
      fromIndex < 0 ||
      fromIndex >= pages.value.length ||
      toIndex < 0 ||
      toIndex >= pages.value.length ||
      fromIndex === toIndex
    ) {
      return;
    }

    const updatedPages = [...pages.value];
    const [movedPage] = updatedPages.splice(fromIndex, 1);
    if (!movedPage) return;

    updatedPages.splice(toIndex, 0, movedPage);
    pages.value = updatedPages;
    markAsEdited();
    saveToStorage();
  }

  function addPageContentAsset(
    pageIndex: number,
    asset: WizardContentAssetInput,
  ): WizardContentAsset | null {
    if (pageIndex < 0 || pageIndex >= pages.value.length) return null;

    const page = pages.value[pageIndex];
    if (!page.images) page.images = [];

    if (page.images.some((item) => item.id === asset.id)) return null;

    const pageAsset: WizardContentAsset = {
      ...asset,
      tempUrl: asset.tempUrl || URL.createObjectURL(asset.blob),
    };

    const updatedPages = [...pages.value];
    updatedPages[pageIndex] = { ...page, images: [...page.images, pageAsset] };
    pages.value = updatedPages;
    markAsEdited();
    saveToStorage();

    return pageAsset;
  }

  function addPageImage(
    pageIndex: number,
    image: LegacyWizardImageInput,
  ): WizardPageImage | null {
    return addPageContentAsset(pageIndex, {
      ...image,
      kind: "image",
      filename: `image.${image.ext}`,
    });
  }

  function removePageImage(pageIndex: number, imageId: string): void {
    if (pageIndex < 0 || pageIndex >= pages.value.length) return;

    const page = pages.value[pageIndex];
    if (!page.images || page.images.length === 0) return;

    const img = page.images.find((i) => i.id === imageId);
    if (img?.tempUrl) {
      try {
        URL.revokeObjectURL(img.tempUrl);
      } catch {
        // ignore
      }
    }

    const updatedPages = [...pages.value];
    updatedPages[pageIndex] = {
      ...page,
      images: page.images.filter((i) => i.id !== imageId),
    };
    pages.value = updatedPages;
    markAsEdited();
    saveToStorage();
  }

  /**
   * Keep `page.images` aligned to what's actually referenced in the editor content.
   * Any unreferenced images are removed and their blob URLs revoked.
   */
  function syncPageContentAssets(
    pageIndex: number,
    activeAssetIds: Set<string>,
  ): void {
    if (pageIndex < 0 || pageIndex >= pages.value.length) return;

    const page = pages.value[pageIndex];
    const images = page.images || [];
    if (images.length === 0) return;

    const removed = images.filter((item) => !activeAssetIds.has(item.id));
    for (const img of removed) {
      if (img.tempUrl) {
        try {
          URL.revokeObjectURL(img.tempUrl);
        } catch {
          // ignore
        }
      }
    }

    const kept = images.filter((item) => activeAssetIds.has(item.id));
    if (kept.length === images.length) return;

    const updatedPages = [...pages.value];
    updatedPages[pageIndex] = { ...page, images: kept };
    pages.value = updatedPages;
    markAsEdited();
    saveToStorage();
  }

  const syncPageImages = syncPageContentAssets;

  function removePage(index: number) {
    if (index < 0 || index >= pages.value.length) return;
    const page = pages.value[index];
    if (page?.images?.length) {
      for (const img of page.images) {
        if (img.tempUrl) {
          try {
            URL.revokeObjectURL(img.tempUrl);
          } catch {
            // ignore
          }
        }
      }
    }
    pages.value = pages.value.filter((_, i) => i !== index);
    if (page && testimonialsPlacement.value === `page:${page.slug}`) {
      testimonialsPlacement.value = "homepage";
    }
    markAsEdited();
    saveToStorage();
  }

  // Blog helpers
  const MAX_POSTS = 50;
  function markAsEdited(options: { siteAffecting?: boolean } = {}) {
    const now = new Date().toISOString();
    lastLocalEditAt.value = now;
    if (options.siteAffecting !== false) {
      lastSiteEditAt.value = now;
    }
  }

  function addPost(
    title: string = "New Post",
    type: WizardPostType = "article",
    options: { siteAffecting?: boolean } = {},
  ) {
    if (posts.value.length >= MAX_POSTS) return null;

    const normalizedTitle =
      title.trim() ||
      (type === "video" ? "New Video" : "New Post");
    const baseSlug = generateSlug(normalizedTitle) || "post";
    const slug = ensureUniqueSlug(
      baseSlug,
      (candidate) => posts.value.some((p) => p.slug === candidate),
    );

    const newPost: WizardPost = {
      title: normalizedTitle,
      slug,
      slugCustomized: false,
      content: "",
      images: [],
      type,
      caption: "",
      mediaFile: null,
      draft: true,
    };

    posts.value = [...posts.value, newPost];
    markAsEdited(options);
    saveToStorage();
    return newPost;
  }

  function updatePost(
    index: number,
    updates: Partial<WizardPost>,
    options: { siteAffecting?: boolean } = {},
  ) {
    if (index < 0 || index >= posts.value.length) return;

    const updatedPosts = [...posts.value];
    const current = updatedPosts[index];
    const nextTitle =
      typeof updates.title === "string" ? updates.title : current.title;
    const autoSlugBase = generateSlug(nextTitle) || "post";
    const hasExplicitSlug = Object.prototype.hasOwnProperty.call(updates, "slug");

    let nextSlug = current.slug;
    let nextSlugCustomized = Boolean(current.slugCustomized);

    if (hasExplicitSlug) {
      const requestedSlug = generateSlug(updates.slug || "") || autoSlugBase;
      nextSlug = ensureUniqueSlug(
        requestedSlug,
        (candidate) =>
          posts.value.some(
            (post, postIndex) =>
              postIndex !== index && post.slug === candidate,
          ),
      );
      nextSlugCustomized = nextSlug !== autoSlugBase;
    } else if (updates.title && !current.slugCustomized) {
      nextSlug = ensureUniqueSlug(
        autoSlugBase,
        (candidate) =>
          posts.value.some(
            (post, postIndex) =>
              postIndex !== index && post.slug === candidate,
          ),
      );
      nextSlugCustomized = false;
    }

    updatedPosts[index] = {
      ...current,
      ...updates,
      slug: nextSlug,
      slugCustomized: nextSlugCustomized,
    };
    posts.value = updatedPosts;
    markAsEdited(options);
    saveToStorage();
  }

  function addPostContentAsset(
    postIndex: number,
    asset: WizardContentAssetInput,
    options: { siteAffecting?: boolean } = {},
  ): WizardContentAsset | null {
    if (postIndex < 0 || postIndex >= posts.value.length) return null;

    const post = posts.value[postIndex];
    if (!post.images) post.images = [];

    if (post.images.some((item) => item.id === asset.id)) return null;

    const postAsset: WizardContentAsset = {
      ...asset,
      tempUrl: asset.tempUrl || URL.createObjectURL(asset.blob),
    };

    const updatedPosts = [...posts.value];
    updatedPosts[postIndex] = { ...post, images: [...post.images, postAsset] };
    posts.value = updatedPosts;
    markAsEdited(options);
    saveToStorage();

    return postAsset;
  }

  function addPostImage(
    postIndex: number,
    image: LegacyWizardImageInput,
    options: { siteAffecting?: boolean } = {},
  ): WizardPostImage | null {
    return addPostContentAsset(
      postIndex,
      {
        ...image,
        kind: "image",
        filename: `image.${image.ext}`,
      },
      options,
    );
  }

  function removePostImage(
    postIndex: number,
    imageId: string,
    options: { siteAffecting?: boolean } = {},
  ): void {
    if (postIndex < 0 || postIndex >= posts.value.length) return;

    const post = posts.value[postIndex];
    if (!post.images || post.images.length === 0) return;

    const img = post.images.find((i) => i.id === imageId);
    if (img?.tempUrl) {
      try {
        URL.revokeObjectURL(img.tempUrl);
      } catch {
        // ignore
      }
    }

    const updatedPosts = [...posts.value];
    updatedPosts[postIndex] = {
      ...post,
      images: post.images.filter((i) => i.id !== imageId),
    };
    posts.value = updatedPosts;
    markAsEdited(options);
    saveToStorage();
  }

  /**
   * Keep `post.images` aligned to what's actually referenced in the editor content.
   * Any unreferenced images are removed and their blob URLs revoked.
   */
  function syncPostContentAssets(
    postIndex: number,
    activeAssetIds: Set<string>,
    options: { siteAffecting?: boolean } = {},
  ): void {
    if (postIndex < 0 || postIndex >= posts.value.length) return;

    const post = posts.value[postIndex];
    const images = post.images || [];
    if (images.length === 0) return;

    const removed = images.filter((item) => !activeAssetIds.has(item.id));
    for (const img of removed) {
      if (img.tempUrl) {
        try {
          URL.revokeObjectURL(img.tempUrl);
        } catch {
          // ignore
        }
      }
    }

    const kept = images.filter((item) => activeAssetIds.has(item.id));
    if (kept.length === images.length) return;

    const updatedPosts = [...posts.value];
    updatedPosts[postIndex] = { ...post, images: kept };
    posts.value = updatedPosts;
    markAsEdited(options);
    saveToStorage();
  }

  const syncPostImages = syncPostContentAssets;

  function reorderPostImages(
    postIndex: number,
    fromIndex: number,
    toIndex: number,
    options: { siteAffecting?: boolean } = {},
  ): void {
    if (postIndex < 0 || postIndex >= posts.value.length) return;

    const post = posts.value[postIndex];
    const images = [...(post.images || [])];
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= images.length ||
      toIndex >= images.length ||
      fromIndex === toIndex
    ) {
      return;
    }

    const [movedImage] = images.splice(fromIndex, 1);
    images.splice(toIndex, 0, movedImage);

    const updatedPosts = [...posts.value];
    updatedPosts[postIndex] = { ...post, images };
    posts.value = updatedPosts;
    markAsEdited(options);
    saveToStorage();
  }

  function removePost(
    index: number,
    options: { siteAffecting?: boolean } = {},
  ) {
    if (index < 0 || index >= posts.value.length) return;
    const post = posts.value[index];
    if (post?.images?.length) {
      for (const img of post.images) {
        if (img.tempUrl) {
          try {
            URL.revokeObjectURL(img.tempUrl);
          } catch {
            // ignore
          }
        }
      }
    }
    posts.value = posts.value.filter((_, i) => i !== index);
    markAsEdited(options);
    saveToStorage();
  }

  // Product helpers
  const MAX_PRODUCTS = 20;
  function addProduct(title: string = "New Product") {
    if (products.value.length >= MAX_PRODUCTS) return null;

    const baseSlug = generateSlug(title) || "product";
    const slug = ensureUniqueSlug(
      baseSlug,
      (candidate) => products.value.some((p) => p.slug === candidate),
    );

    const newProduct: WizardProduct = {
      title,
      slug,
      slugCustomized: false,
      content: "",
      images: [],
      price: 2500,
      currency: "USD",
      available: true,
      paymentMethod: "stripe",
      paymentInstructions: "",
    };

    products.value = [...products.value, newProduct];
    markAsEdited();
    saveToStorage();
    return newProduct;
  }

  function updateProduct(index: number, updates: Partial<WizardProduct>) {
    if (index < 0 || index >= products.value.length) return;

    const updatedProducts = [...products.value];
    const current = updatedProducts[index];
    const nextTitle =
      typeof updates.title === "string" ? updates.title : current.title;
    const autoSlugBase = generateSlug(nextTitle) || "product";
    const hasExplicitSlug = Object.prototype.hasOwnProperty.call(updates, "slug");

    let nextSlug = current.slug;
    let nextSlugCustomized = Boolean(current.slugCustomized);

    if (hasExplicitSlug) {
      const requestedSlug = generateSlug(updates.slug || "") || autoSlugBase;
      nextSlug = ensureUniqueSlug(
        requestedSlug,
        (candidate) =>
          products.value.some(
            (product, productIndex) =>
              productIndex !== index && product.slug === candidate,
          ),
      );
      nextSlugCustomized = nextSlug !== autoSlugBase;
    } else if (updates.title && !current.slugCustomized) {
      nextSlug = ensureUniqueSlug(
        autoSlugBase,
        (candidate) =>
          products.value.some(
            (product, productIndex) =>
              productIndex !== index && product.slug === candidate,
          ),
      );
      nextSlugCustomized = false;
    }

    updatedProducts[index] = {
      ...current,
      ...updates,
      ...(Object.prototype.hasOwnProperty.call(updates, "price")
        ? { price: normalizeProductPriceCents(updates.price) }
        : {}),
      slug: nextSlug,
      slugCustomized: nextSlugCustomized,
    };
    products.value = updatedProducts;
    markAsEdited();
    saveToStorage();
  }

  function addProductContentAsset(
    productIndex: number,
    asset: WizardContentAssetInput,
  ): WizardContentAsset | null {
    if (productIndex < 0 || productIndex >= products.value.length) return null;

    const product = products.value[productIndex];
    if (!product.images) product.images = [];

    if (product.images.some((item) => item.id === asset.id)) return null;

    const productAsset: WizardContentAsset = {
      ...asset,
      tempUrl: asset.tempUrl || URL.createObjectURL(asset.blob),
    };

    const updatedProducts = [...products.value];
    updatedProducts[productIndex] = {
      ...product,
      images: [...product.images, productAsset],
    };
    products.value = updatedProducts;
    markAsEdited();
    saveToStorage();

    return productAsset;
  }

  function addProductImage(
    productIndex: number,
    image: LegacyWizardImageInput,
  ): WizardProductImage | null {
    return addProductContentAsset(productIndex, {
      ...image,
      kind: "image",
      filename: `image.${image.ext}`,
    });
  }

  function removeProductImage(productIndex: number, imageId: string): void {
    if (productIndex < 0 || productIndex >= products.value.length) return;

    const product = products.value[productIndex];
    if (!product.images || product.images.length === 0) return;

    const img = product.images.find((i) => i.id === imageId);
    if (img?.tempUrl) {
      try {
        URL.revokeObjectURL(img.tempUrl);
      } catch {
        // ignore
      }
    }

    const updatedProducts = [...products.value];
    updatedProducts[productIndex] = {
      ...product,
      images: product.images.filter((i) => i.id !== imageId),
    };
    products.value = updatedProducts;
    markAsEdited();
    saveToStorage();
  }

  function syncProductContentAssets(
    productIndex: number,
    activeAssetIds: Set<string>,
  ): void {
    if (productIndex < 0 || productIndex >= products.value.length) return;

    const product = products.value[productIndex];
    const images = product.images || [];
    if (images.length === 0) return;

    const removed = images.filter((item) => !activeAssetIds.has(item.id));
    for (const img of removed) {
      if (img.tempUrl) {
        try {
          URL.revokeObjectURL(img.tempUrl);
        } catch {
          // ignore
        }
      }
    }

    const kept = images.filter((item) => activeAssetIds.has(item.id));
    if (kept.length === images.length) return;

    const updatedProducts = [...products.value];
    updatedProducts[productIndex] = { ...product, images: kept };
    products.value = updatedProducts;
    markAsEdited();
    saveToStorage();
  }

  const syncProductImages = syncProductContentAssets;

  function removeProduct(index: number) {
    if (index < 0 || index >= products.value.length) return;
    const product = products.value[index];
    if (product?.images?.length) {
      for (const img of product.images) {
        if (img.tempUrl) {
          try {
            URL.revokeObjectURL(img.tempUrl);
          } catch {
            // ignore
          }
        }
      }
    }
    products.value = products.value.filter((_, i) => i !== index);
    markAsEdited();
    saveToStorage();
  }

  // Testimonials helpers
  const MAX_TESTIMONIALS = 6;

  function addTestimonial(testimonial: WizardTestimonial) {
    if (testimonials.value.length >= MAX_TESTIMONIALS) return null;
    testimonials.value = [...testimonials.value, testimonial];
    markAsEdited();
    saveToStorage();
    return testimonial;
  }

  function revokeTestimonialObjectUrl(url: string | undefined) {
    if (url?.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
    }
  }

  function updateTestimonial(
    index: number,
    updates: Partial<WizardTestimonial>,
  ) {
    if (index < 0 || index >= testimonials.value.length) return;
    const updatedTestimonials = [...testimonials.value];
    const current = updatedTestimonials[index];
    const next = { ...current, ...updates };
    const prevAvatar = current.avatar;
    if (prevAvatar && prevAvatar !== next.avatar) {
      revokeTestimonialObjectUrl(prevAvatar);
    }
    updatedTestimonials[index] = next;
    testimonials.value = updatedTestimonials;
    markAsEdited();
    saveToStorage();
  }

  function removeTestimonial(index: number) {
    if (index < 0 || index >= testimonials.value.length) return;
    const removed = testimonials.value[index];
    revokeTestimonialObjectUrl(removed?.avatar);
    testimonials.value = testimonials.value.filter((_, i) => i !== index);
    markAsEdited();
    saveToStorage();
  }

  function blobImageExt(blob: Blob): string {
    if (blob.type === "image/png") return "png";
    if (blob.type === "image/webp") return "webp";
    if (blob.type === "image/gif") return "gif";
    return "jpg";
  }

  /** Convert our hosted /files/… URLs to ./files/… for me.json. */
  function fileReferenceToRelativePath(url: string | null): string | null {
    if (!url) return null;
    const trimmed = url.trim();
    const m = trimmed.match(
      /\/files\/(logo|avatar|banner|testimonial-\d+)\.([a-z0-9]+)$/i,
    );
    if (m) {
      return `./files/${m[1]}.${m[2]}`;
    }
    if (trimmed.startsWith("./files/")) return trimmed;
    if (trimmed.startsWith("/files/")) return `.${trimmed}`;
    return null;
  }

  function publishableTestimonials(): WizardTestimonial[] {
    return testimonials.value.filter(
      (t) => t.name.trim().length > 0 && t.quote.trim().length > 0,
    );
  }

  // Generate me.json content
  function generateMe3Json(): ExtendedMe3Profile {
    const me3: ExtendedMe3Profile = {
      version: "0.1",
      name: profile.value.name.trim(),
    };

    if (siteRole.value === "profile") {
      me3.visibility = profile.value.visibility;
    }

    if (profile.value.handle) {
      me3.handle = profile.value.handle.trim();
    }

    if (profile.value.location && profile.value.location.trim()) {
      me3.location = profile.value.location.trim();
    }

    const locationData = normalizeLocationData(profile.value.locationData);
    if (locationData) {
      me3.locationData = locationData;
    }

    if (profile.value.bio) {
      me3.bio = profile.value.bio.trim();
    }

    if (profile.value.logo) {
      me3.logo = profile.value.logoBlob
        ? `./files/logo.${blobImageExt(profile.value.logoBlob)}`
        : fileReferenceToRelativePath(profile.value.logo) ||
          profile.value.logo;
    }

    const cleanedBusiness = {
      positioningStatement: profile.value.business.positioningStatement.trim(),
      audience: profile.value.business.audience.trim(),
      primaryProblem: profile.value.business.primaryProblem.trim(),
      solution: profile.value.business.solution.trim(),
      targetMarket: profile.value.business.targetMarket.trim(),
      primaryOutcome: profile.value.business.primaryOutcome.trim(),
      goals: normalizeBusinessGoals(profile.value.business.goals),
    };

    if (
      cleanedBusiness.positioningStatement ||
      cleanedBusiness.audience ||
      cleanedBusiness.primaryProblem ||
      cleanedBusiness.solution ||
      cleanedBusiness.targetMarket ||
      cleanedBusiness.primaryOutcome ||
      cleanedBusiness.goals.length > 0
    ) {
      me3.business = Object.fromEntries(
        Object.entries(cleanedBusiness).filter(([, value]) =>
          Array.isArray(value) ? value.length > 0 : Boolean(value),
        ),
      ) as Me3BusinessContext;
    }

    if (profile.value.avatar) {
      // Use relative path so images work on /preview/:username/ (localhost) and subdomains
      // If there's a blob, use standard path. Otherwise convert URL to relative path.
      me3.avatar = profile.value.avatarBlob
        ? "./files/avatar.jpg"
        : fileReferenceToRelativePath(profile.value.avatar) ||
          profile.value.avatar;
    }

    if (profile.value.banner) {
      me3.banner = profile.value.bannerBlob
        ? "./files/banner.jpg"
        : fileReferenceToRelativePath(profile.value.banner) ||
          profile.value.banner;
    }

    // Only include links that have values
    const validLinks = Object.entries(profile.value.links)
      .filter(([_, value]) => value && value.trim())
      .reduce((acc, [key, value]) => ({ ...acc, [key]: value.trim() }), {});

    if (linksEnabled.value && Object.keys(validLinks).length > 0) {
      me3.links = validLinks;
    }

    if (callToActionEnabled.value && profile.value.buttons.length > 0) {
      me3.buttons = profile.value.buttons;
    }

    if (pagesEnabled.value && pages.value.length > 0) {
      me3.pages = pages.value.map((p) => ({
        slug: p.slug,
        title: p.title,
        file: `${p.slug}.md`,
        visible: p.visible !== false,
        ...(normalizeNavigationGroup(p.navigationGroup)
          ? { navigationGroup: normalizeNavigationGroup(p.navigationGroup) }
          : {}),
      }));
    }

    if (blogEnabled.value) {
      me3.blogEnabled = true;
      const cleanedBlogTitle = blogTitle.value.trim();
      if (cleanedBlogTitle && cleanedBlogTitle !== DEFAULT_BLOG_TITLE) {
        me3.blogTitle = cleanedBlogTitle;
      }
    }

    if (blogEnabled.value && posts.value.length > 0) {
      me3.posts = posts.value.map((p) => {
        const post: {
          slug: string;
          title: string;
          file: string;
          type?: WizardPostType;
          media?: WizardPostMedia;
          publishedAt?: string;
          excerpt?: string;
          draft?: boolean;
        } = {
          slug: p.slug,
          title: p.title,
          file: `blog/${p.slug}.md`,
        };
        if (p.type) post.type = p.type;
        if (p.media && Object.keys(p.media).length > 0) {
          post.media = p.media;
        }
        if (p.publishedAt) post.publishedAt = p.publishedAt;
        if (p.excerpt) post.excerpt = p.excerpt;
        if (p.draft) post.draft = p.draft;
        return post;
      });
    }

    if (shopEnabled.value && products.value.length > 0) {
      me3.products = products.value.map((p) => {
          const product: SiteSourceProduct = {
            delivery: p.delivery,
            slug: p.slug,
            title: p.title,
            file: `shop/${p.slug}.md`,
            price: normalizeProductPriceCents(p.price),
            currency: p.currency,
            images: undefined,
            available: undefined,
            publishedAt: undefined,
            excerpt: undefined,
            paymentMethod: p.paymentMethod,
            paymentInstructions:
              p.paymentMethod === "manual"
                ? p.paymentInstructions.trim()
                : undefined,
          };
          if (typeof p.available === "boolean") {
            product.available = p.available;
          }
          if (p.publishedAt) product.publishedAt = p.publishedAt;
          if (p.excerpt) product.excerpt = p.excerpt;
          if (productSendsPurchaseConfirmation(p.confirmationEmail)) {
            product.confirmationEmail = {
              enabled: true,
              subject: p.confirmationEmail!.subject.trim(),
              message: p.confirmationEmail!.message.trim(),
            };
          }
          return product;
        }) as SiteSourceProduct[];
      const cleanedShopTitle = shopTitle.value.trim();
      if (cleanedShopTitle) {
        me3.shopTitle = cleanedShopTitle;
      }
    }

    const publishableT = publishableTestimonials();
    if (testimonialsEnabled.value && publishableT.length > 0) {
      const cleaned = publishableT.map((t, idx) => {
        const slot = idx + 1;
        const name = t.name.trim();
        const quote = t.quote.trim();
        const handle = t.handle?.trim();
        const profileUrl = t.profileUrl?.trim();

        let avatarOut: string | undefined;
        if (t.avatarBlob) {
          avatarOut = `./files/testimonial-${slot}.${blobImageExt(t.avatarBlob)}`;
        } else if (t.avatar?.trim()) {
          const raw = t.avatar.trim();
          if (!raw.startsWith("data:") && !raw.startsWith("blob:")) {
            const rel = fileReferenceToRelativePath(raw);
            avatarOut = rel ?? raw;
          }
        }

        return {
          name,
          quote,
          ...(handle ? { handle: handle.replace(/^@/, "") } : {}),
          ...(avatarOut ? { avatar: avatarOut } : {}),
          ...(profileUrl ? { profileUrl } : {}),
        } as WizardTestimonial;
      });

      if (cleaned.length > 0) {
        me3.testimonials = cleaned;
        const normalizedPlacement = normalizeTestimonialPlacement(
          testimonialsPlacement.value,
          {
            blogEnabled: blogEnabled.value,
            shopEnabled: shopEnabled.value && products.value.length > 0,
            pages: pagesEnabled.value ? pages.value : [],
          },
        );
        if (normalizedPlacement !== "homepage") {
          if (normalizedPlacement === "standalone") {
            me3.testimonialDisplay = normalizedPlacement;
          } else {
            me3.links = {
              ...(me3.links || {}),
              [TESTIMONIAL_PLACEMENT_LINK_KEY]: normalizedPlacement,
            };
          }
        }
        const cleanedTitle = testimonialsTitle.value.trim();
        if (
          cleanedTitle &&
          cleanedTitle !== DEFAULT_TESTIMONIALS_TITLE
        ) {
          me3.testimonialsTitle = cleanedTitle;
        }
      }
    }

    // Store vibe and theme customization as extensions under links (not protocol top-level fields)
    if (vibe.value && vibe.value !== defaultVibe) {
      me3.links = {
        ...(me3.links || {}),
        _vibe: vibe.value,
      };
    }

    // Store accent override if set
    if (accentOverride.value) {
      me3.links = {
        ...(me3.links || {}),
        _accent: accentOverride.value,
      };
    }

    if (profile.value.navigationStyle === "compact") {
      me3.links = {
        ...(me3.links || {}),
        [SITE_NAVIGATION_STYLE_LINK_KEY]: "compact",
      };
    }

    // Footer (Pro feature; enforced server-side)
    if (profile.value.footer?.mode === "none") {
      (me3 as any).footer = false;
    } else if (profile.value.footer?.mode === "custom") {
      const text = profile.value.footer.text.trim();
      const linkText = profile.value.footer.linkText.trim();
      const linkUrl = profile.value.footer.linkUrl.trim();

      const footer: any = {};
      if (text) footer.text = text;
      if (linkText && linkUrl) footer.link = { text: linkText, url: linkUrl };

      if (footer.text || footer.link) {
        (me3 as any).footer = footer;
      }
    }

    // Intents (newsletter, booking)
    const intents: {
      subscribe?: Me3IntentSubscribe;
      book?: Me3IntentBook;
      shop?: {
        enabled: boolean;
        title?: string;
        description?: string;
        currency: "USD" | "GBP" | "EUR" | "CAD" | "AUD" | "CHF" | "SGD" | "INR" | "PKR";
      };
      gift?: {
        enabled: boolean;
        title?: string;
        description?: string;
        suggestedAmount: number;
        currency: "USD" | "GBP" | "EUR" | "CAD" | "AUD" | "CHF" | "SGD" | "INR" | "PKR";
        minimumAmount: 5;
        icon?: string;
      };
    } = {};

    if (profile.value.newsletter?.enabled) {
      const subscribe: Me3IntentSubscribe = {
        enabled: true,
      };

      if (profile.value.newsletter.title.trim()) {
        subscribe.title = profile.value.newsletter.title.trim();
      }
      if (profile.value.newsletter.description.trim()) {
        subscribe.description = profile.value.newsletter.description.trim();
      }
      subscribe.doubleOptIn = profile.value.newsletter.doubleOptIn;

      intents.subscribe = subscribe;
    }

    if (profile.value.booking?.enabled) {
      // Build availability windows, only include days with time slots
      const windows: Record<string, string[]> = {};
      const days = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ] as const;

      for (const day of days) {
        const dayWindows = profile.value.booking.availability[day];
        if (dayWindows && dayWindows.length > 0) {
          windows[day] = dayWindows;
        }
      }

      const oneToOneEnabled =
        profile.value.booking.oneToOneEnabled &&
        Object.keys(windows).length > 0;
      const classEnabled = profile.value.booking.classEnabled;
      const retreatEnabled = profile.value.booking.retreatEnabled;

      if (oneToOneEnabled || classEnabled || retreatEnabled) {
        const sourceBookingOffers = profile.value.booking.offers;
        const bookingOffers = profile.value.booking.offers.map((offer, index) => {
          const normalizedTitle =
            offer.title.trim() || `${offer.duration}-min Session`;
          return {
            id:
              offer.id.trim() ||
              generateSlug(normalizedTitle) ||
              `book-session-${index + 1}`,
            title: normalizedTitle,
            description: offer.description.trim(),
            duration: offer.duration,
            pricing: offer.pricing
              ? {
                  enabled: offer.pricing.enabled,
                  suggestedAmount: offer.pricing.suggestedAmount,
                  currency: offer.pricing.currency as "USD" | "GBP" | "EUR",
                  minimumAmount: offer.pricing.minimumAmount,
                  allowFlexiblePricing: offer.pricing.allowFlexiblePricing,
                  allowFree: offer.pricing.allowFree,
                  paymentMethod: offer.pricing.paymentMethod,
                  paymentInstructions: offer.pricing.paymentInstructions,
                }
              : undefined,
          };
        });
        const bookingClasses = profile.value.booking.classOffers.map((offer, index) => {
          const normalizedTitle = offer.title.trim() || `Class ${index + 1}`;
          return {
            id:
              offer.id.trim() ||
              generateSlug(normalizedTitle) ||
              `booking-class-${index + 1}`,
            title: normalizedTitle,
            description: offer.description.trim(),
            duration: offer.duration,
            timezone: offer.timezone,
            recurrence: { ...offer.recurrence },
            pricing: offer.pricing
              ? {
                  enabled: offer.pricing.enabled,
                  suggestedAmount: offer.pricing.suggestedAmount,
                  currency: offer.pricing.currency as "USD" | "GBP" | "EUR",
                  minimumAmount: offer.pricing.minimumAmount,
                  allowFlexiblePricing: offer.pricing.allowFlexiblePricing,
                  allowFree: offer.pricing.allowFree,
                  paymentMethod: offer.pricing.paymentMethod,
                  paymentInstructions: offer.pricing.paymentInstructions,
                }
              : undefined,
            capacity: offer.capacity,
          };
        });
        const bookingRetreats = profile.value.booking.retreatOffers.map((offer, index) => {
          const normalizedTitle = offer.title.trim() || `Retreat ${index + 1}`;
          return {
            id:
              offer.id.trim() ||
              generateSlug(normalizedTitle) ||
              `booking-retreat-${index + 1}`,
            title: normalizedTitle,
            description: offer.description.trim(),
            durationDays: deriveRetreatDurationDays(offer),
            startDate: offer.startDate,
            startTime: offer.startTime,
            endDate: offer.endDate,
            endTime: offer.endTime,
            timezone: offer.timezone,
            pricing: offer.pricing
              ? {
                  enabled: offer.pricing.enabled,
                  suggestedAmount: offer.pricing.suggestedAmount,
                  currency: offer.pricing.currency as "USD" | "GBP" | "EUR",
                  minimumAmount: offer.pricing.minimumAmount,
                  allowFlexiblePricing: offer.pricing.allowFlexiblePricing,
                  allowFree: offer.pricing.allowFree,
                  paymentMethod: offer.pricing.paymentMethod,
                  paymentInstructions: offer.pricing.paymentInstructions,
                }
              : undefined,
            capacity: offer.capacity,
          };
        });
        const primaryOffer = bookingOffers[0] || {
          id: "book-session",
          title: "Book a session",
          description: "",
          duration: 30,
          pricing: undefined,
        };
        const primarySourceOffer = sourceBookingOffers[0];

        const book: ExtendedMe3IntentBook = {
          enabled: true,
          reminders: { ...profile.value.booking.reminders },
          bookingTypes: [],
        };
        const confirmationMessage =
          profile.value.booking.confirmationEmail.message.trim();
        const sendHostCopy =
          profile.value.booking.confirmationEmail.sendHostCopy !== false;
        if (confirmationMessage || !sendHostCopy) {
          book.confirmationEmail = {
            ...(confirmationMessage ? { message: confirmationMessage } : {}),
            sendHostCopy,
          };
        }

        if (oneToOneEnabled) {
          book.duration = primaryOffer.duration;
          book.bufferTime = profile.value.booking.bufferTime || 0;
          book.availability = {
            timezone: profile.value.booking.timezone,
            windows: windows,
          };
          book.offers = bookingOffers.map((offer): PublishedBookingOffer => {
            const bookingOffer: PublishedBookingOffer = {
              id: offer.id,
              title: offer.title,
              duration: offer.duration,
            };
            if (offer.description) {
              bookingOffer.description = offer.description;
            }
            if (offer.pricing) {
              bookingOffer.pricing = offer.pricing;
            }
            return bookingOffer;
          });

          const headingTitle = profile.value.booking.title?.trim();
          const headingDescription = profile.value.booking.description?.trim();
          if (headingTitle) {
            book.title = headingTitle;
          } else if (primarySourceOffer?.title.trim()) {
            book.title = primarySourceOffer.title.trim();
          }
          if (headingDescription) {
            book.description = headingDescription;
          } else if (primarySourceOffer?.description.trim()) {
            book.description = primarySourceOffer.description.trim();
          }

          if (primaryOffer.pricing) {
            const pricing = primaryOffer.pricing;
            const bookWithPricing = book as Me3IntentBook & {
              pricing?: WizardBookingPricing;
            };
            bookWithPricing.pricing = {
              enabled: pricing.enabled,
              suggestedAmount: pricing.suggestedAmount,
              currency: pricing.currency as "USD" | "GBP" | "EUR",
              minimumAmount: pricing.minimumAmount,
              allowFlexiblePricing: pricing.allowFlexiblePricing,
              allowFree: pricing.allowFree,
              paymentMethod: pricing.paymentMethod,
              paymentInstructions: pricing.paymentInstructions,
            };
          }

          book.bookingTypes!.push({
            id: "one_to_one",
            type: "one_to_one",
            label: "1:1",
            ...(book.title ? { title: book.title } : {}),
            ...(book.description ? { description: book.description } : {}),
            availability: {
              timezone: profile.value.booking.timezone,
              windows: windows,
            },
            offers: book.offers,
          });
        }

        if (classEnabled) {
          book.classes = bookingClasses.map((offer): PublishedBookingClass => {
            const bookingClass: PublishedBookingClass = {
              id: offer.id,
              title: offer.title,
              duration: offer.duration,
              timezone: offer.timezone,
              recurrence: { ...offer.recurrence },
              capacity: offer.capacity,
            };
            if (offer.description) {
              bookingClass.description = offer.description;
            }
            if (offer.pricing) {
              bookingClass.pricing = offer.pricing;
            }
            return bookingClass;
          });

          book.bookingTypes!.push({
            id: "class",
            type: "class",
            label: "Classes",
            classes: book.classes,
          });
        }

        if (retreatEnabled) {
          book.retreats = bookingRetreats.map((offer): PublishedBookingRetreat => {
            const r: PublishedBookingRetreat = {
              id: offer.id,
              title: offer.title,
              durationDays: deriveRetreatDurationDays(offer),
              startDate: offer.startDate,
              startTime: offer.startTime,
              endDate: offer.endDate,
              endTime: offer.endTime,
              timezone: offer.timezone,
              capacity: offer.capacity,
            };
            if (offer.description) {
              r.description = offer.description;
            }
            if (offer.pricing) {
              r.pricing = offer.pricing;
            }
            return r;
          });

          book.bookingTypes!.push({
            id: "retreat",
            type: "retreat",
            label: "Retreats",
            retreats: book.retreats,
          });
        }

        if (book.bookingTypes && book.bookingTypes.length > 0) {
          intents.book = book;
        }
      }
    }

    if (shopEnabled.value && products.value.length > 0) {
      const productCurrency = products.value[0]?.currency;
      if (productCurrency) {
        intents.shop = {
          enabled: true,
          currency: productCurrency as "USD" | "GBP" | "EUR",
        };
      }
    }

    if (profile.value.gift?.enabled) {
      const gift = profile.value.gift;
      intents.gift = {
        enabled: true,
        suggestedAmount: gift.suggestedAmount,
        currency: gift.currency as "USD" | "GBP" | "EUR",
        minimumAmount: gift.minimumAmount,
      };
      if (gift.title.trim()) intents.gift.title = gift.title.trim();
      if (gift.description.trim()) {
        intents.gift.description = gift.description.trim();
      }
      if (gift.icon && gift.icon.trim()) {
        intents.gift.icon = gift.icon.trim();
      }
    }

    if (Object.keys(intents).length > 0) {
      me3.intents = intents as Me3SiteProfile["intents"];
    }

    const handle = me3.handle?.trim();
    const publicApiBase = getPublicApiBase();
    const actions: Record<string, Me3ActionDefinition> = {};
    const services: Me3Service[] = [];

    if (handle && intents.subscribe?.enabled) {
      actions.subscribe = {
        method: "POST",
        url: `${publicApiBase}/sites/${handle}/subscribe`,
        requires: ["email"],
        description: "Subscribe someone to this site's newsletter.",
      };
    }

    if (
      handle &&
      intents.book?.enabled &&
      intents.book.availability &&
      Object.keys(intents.book.availability.windows || {}).length > 0
    ) {
      const bookingOffers =
        (intents.book as ExtendedMe3IntentBook).offers &&
        (intents.book as ExtendedMe3IntentBook).offers!.length > 0
          ? (intents.book as ExtendedMe3IntentBook).offers!
          : [
              {
                id: generateSlug(intents.book.title?.trim() || "Book a session") ||
                  "book-session",
                title: intents.book.title?.trim() || "Book a session",
                description: intents.book.description?.trim(),
                duration: intents.book.duration,
                pricing: intents.book.pricing as WizardBookingPricing | undefined,
              },
            ];
      const requiresOfferId = bookingOffers.length > 1;
      const hasStripeBookingOffer = bookingOffers.some(
        (offer) =>
          offer.pricing?.enabled &&
          offer.pricing.paymentMethod !== "manual",
      );

      for (const offer of bookingOffers) {
        const service: Me3Service = {
          id: offer.id,
          title: offer.title,
          sessionType: "1:1",
          duration: offer.duration,
          availabilityMode: "native",
          status: "active",
        };

        if (offer.description?.trim()) {
          service.description = offer.description.trim();
        }

        if (offer.pricing?.enabled) {
          service.price = offer.pricing.suggestedAmount;
          service.currency = offer.pricing.currency as "USD" | "GBP" | "EUR";
        }

        services.push(service);
      }

      if (
        bookingOffers.length === 1 &&
        bookingOffers[0]?.pricing?.enabled &&
        bookingOffers[0].pricing.allowFree
      ) {
        services.push({
          id: "free-intro-session",
          title: "Free Intro Session",
          description:
            "A free introductory session to explore fit and next steps.",
          sessionType: "1:1",
          duration: bookingOffers[0].duration,
          price: 0,
          currency: bookingOffers[0].pricing.currency as "USD" | "GBP" | "EUR",
          availabilityMode: "native",
          status: "active",
        });
      }

      actions.checkAvailability = {
        method: "GET",
        url: `${publicApiBase}/book/${handle}/slots{?date}`,
        requires: requiresOfferId ? ["date", "offerId"] : ["date"],
        description: "Return available booking slots for a given date.",
      };

      const bookingRequires = [
        "slotStart",
        "slotEnd",
        "guestName",
        "guestEmail",
      ];

      if (requiresOfferId) {
        bookingRequires.unshift("offerId");
      }

      if (
        bookingOffers.length === 1 &&
        bookingOffers[0]?.pricing?.enabled &&
        bookingOffers[0].pricing.paymentMethod !== "manual" &&
        !bookingOffers[0].pricing.allowFree
      ) {
        bookingRequires.push("paymentIntentId");
      }

      actions.createBooking = {
        method: "POST",
        url: `${publicApiBase}/book/${handle}/confirm`,
        requires: bookingRequires,
        description: "Create a confirmed booking for a selected slot.",
      };

      if (hasStripeBookingOffer) {
        const checkoutRequires = [
          "localDate",
          "localTime",
          "guestName",
          "guestEmail",
        ];

        if (requiresOfferId) {
          checkoutRequires.unshift("offerId");
        }

        actions.createBookingCheckout = {
          method: "POST",
          url: `${publicApiBase}/book/${handle}/checkout-session`,
          requires: checkoutRequires,
          description: "Create a checkout session for a paid booking offer.",
        };
      }
    }

    if (services.length > 0) {
      me3.services = services;
    }

    if (Object.keys(actions).length > 0) {
      me3.actions = actions;
    }

    return me3;
  }

  // LocalStorage persistence
  function saveToStorage() {
    try {
      // Don't save blobs to localStorage
      const state = {
        optionalWebsiteFeaturesVersion: 1,
        ownerUserId: sessionUserId.value,
        currentStep: currentStep.value,
        furthestStep: furthestStep.value,
        currentStepId: currentStepId.value,
        furthestStepId: stepIds.value[furthestStep.value - 1] || null,
        profile: {
          ...profile.value,
          logoBlob: null,
          avatarBlob: null,
          bannerBlob: null,
          avatarOriginalBlob: null,
          bannerOriginalBlob: null,
        },
        pages: pages.value.map((p) => ({
          ...p,
          images: [],
        })),
        posts: sanitizeWizardPosts(posts.value).map((p) => ({
          ...p,
          images: [],
          mediaFile: null,
        })),
        products: products.value.map((p) => ({
          ...p,
          images: [],
        })),
        testimonials: testimonials.value.map((t) => {
          const { avatarBlob: _ab, ...rest } = t;
          const av = rest.avatar;
          const avatar =
            typeof av === "string" &&
            (av.startsWith("data:") || av.startsWith("blob:"))
              ? undefined
              : av;
          return { ...rest, ...(avatar !== undefined ? { avatar } : {}) };
        }),
        username: username.value,
        siteRole: siteRole.value,
        selectedSiteId: selectedSiteId.value,
        vibe: vibe.value,
        accentOverride: accentOverride.value,
        linksEnabled: linksEnabled.value,
        callToActionEnabled: callToActionEnabled.value,
        pagesEnabled: pagesEnabled.value,
        newsletterEnabled: newsletterEnabled.value,
        blogEnabled: blogEnabled.value,
        bookingsEnabled: bookingsEnabled.value,
        shopEnabled: shopEnabled.value,
        testimonialsEnabled: testimonialsEnabled.value,
        blogTitle: blogTitle.value,
        shopTitle: shopTitle.value,
        testimonialsPlacement: testimonialsPlacement.value,
        testimonialsTitle: testimonialsTitle.value,
        lastPublishedAt: lastPublishedAt.value,
        lastLocalEditAt: lastLocalEditAt.value,
        lastSiteEditAt: lastSiteEditAt.value,
        draftSourceUrl: draftSourceUrl.value,
      };
      localStorage.setItem(activeStorageKey.value, JSON.stringify(state));
    } catch (e) {
      console.warn("Failed to save wizard state:", e);
    }
  }

  function loadFromStorage(storageKey = activeStorageKey.value): boolean {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const state = JSON.parse(saved);
        const storedOwnerUserId =
          typeof state.ownerUserId === "string" ? state.ownerUserId : null;
        if (
          sessionUserId.value &&
          storedOwnerUserId &&
          storedOwnerUserId !== sessionUserId.value
        ) {
          localStorage.removeItem(storageKey);
          return false;
        }
        persistedOwnerUserId.value = storedOwnerUserId;
        const storedProfile = state.profile || {};
        const storedBooking = storedProfile.booking || {};
        const storedUsername = normalizeAssetSiteUsername(state.username);
        const storedAssetUsername =
          storedUsername || normalizeAssetSiteUsername(storedProfile.handle);
        profile.value = {
          ...defaultProfile,
          ...storedProfile,
          navigationStyle: normalizeSiteNavigationStyle(
            storedProfile.navigationStyle,
          ),
          logo: resolveWizardSiteAssetUrl(
            storedProfile.logo,
            storedAssetUsername,
          ),
          avatar: resolveWizardSiteAssetUrl(
            storedProfile.avatar,
            storedAssetUsername,
          ),
          banner: resolveWizardSiteAssetUrl(
            storedProfile.banner,
            storedAssetUsername,
          ),
          logoBlob: imageBlobFromDataUrl(storedProfile.logo),
          locationData: normalizeLocationData(storedProfile.locationData),
          business: normalizeBusinessConfig(storedProfile.business),
          booking: normalizeWizardBookingConfig(storedBooking),
          newsletter: {
            ...defaultProfile.newsletter,
            ...(storedProfile.newsletter || {}),
            doubleOptIn:
              storedProfile.newsletter
                ? storedProfile.newsletter.doubleOptIn === true
                : defaultProfile.newsletter.doubleOptIn,
          },
          gift: {
            ...defaultProfile.gift,
            ...(storedProfile.gift || {}),
          },
          footer: {
            ...defaultProfile.footer,
            ...(storedProfile.footer || {}),
          },
        };
        pages.value = (state.pages || []).map((p: any) => ({
          ...p,
          navigationGroup: normalizeNavigationGroup(p.navigationGroup),
          slugCustomized: inferSlugCustomized(
            typeof p.title === "string" ? p.title : "",
            typeof p.slug === "string" ? p.slug : "",
            "page",
            p.slugCustomized,
          ),
          images: [],
        }));
        posts.value = sanitizeWizardPosts(state.posts || []);
        products.value = (state.products || []).map((p: any) => ({
          ...p,
          slugCustomized: inferSlugCustomized(
            typeof p.title === "string" ? p.title : "",
            typeof p.slug === "string" ? p.slug : "",
            "product",
            p.slugCustomized,
          ),
          paymentMethod: normalizeWizardPaymentMethod(p.paymentMethod),
          paymentInstructions: normalizeWizardPaymentInstructions(
            p.paymentInstructions,
          ),
          images: [],
        }));
        testimonials.value = (state.testimonials || []).map((t: any) => {
          const av = t.avatar;
          const avatar =
            typeof av === "string" &&
            (av.startsWith("data:") || av.startsWith("blob:"))
              ? undefined
              : resolveWizardSiteAssetUrl(av, storedAssetUsername) || undefined;
          return {
            ...t,
            avatarBlob: null,
            avatar,
          };
        });
        username.value = storedUsername || "";
        siteRole.value =
          state.siteRole === "organization" ? "organization" : "profile";
        vibe.value = normalizeVibeId(state.vibe);
        accentOverride.value = state.accentOverride || null;
        const hasOptionalWebsiteFeatureState =
          state.optionalWebsiteFeaturesVersion === 1;
        linksEnabled.value = hasOptionalWebsiteFeatureState
          ? state.linksEnabled === true
          : Object.values(storedProfile.links || {}).some(
              (value) => typeof value === "string" && value.trim().length > 0,
            );
        callToActionEnabled.value = hasOptionalWebsiteFeatureState
          ? state.callToActionEnabled === true
          : Array.isArray(storedProfile.buttons) &&
            storedProfile.buttons.length > 0;
        pagesEnabled.value = hasOptionalWebsiteFeatureState
          ? state.pagesEnabled === true
          : pages.value.length > 0;
        newsletterEnabled.value =
          typeof state.newsletterEnabled === "boolean"
            ? state.newsletterEnabled
            : false;
        blogEnabled.value =
          typeof state.blogEnabled === "boolean"
            ? state.blogEnabled
            : sanitizeWizardPosts(state.posts || []).length > 0;
        bookingsEnabled.value =
          typeof state.bookingsEnabled === "boolean"
            ? state.bookingsEnabled
            : false;
        shopEnabled.value = hasOptionalWebsiteFeatureState
          ? state.shopEnabled === true
          : products.value.length > 0;
        testimonialsEnabled.value =
          typeof state.testimonialsEnabled === "boolean"
            ? state.testimonialsEnabled
            : (state.testimonials || []).length > 0;
        blogTitle.value =
          typeof state.blogTitle === "string" && state.blogTitle.trim().length > 0
            ? state.blogTitle
            : DEFAULT_BLOG_TITLE;
        shopTitle.value =
          typeof state.shopTitle === "string" && state.shopTitle.trim().length > 0
            ? state.shopTitle
            : DEFAULT_SHOP_TITLE;
        testimonialsTitle.value =
          typeof state.testimonialsTitle === "string" &&
          state.testimonialsTitle.trim().length > 0
            ? state.testimonialsTitle
            : DEFAULT_TESTIMONIALS_TITLE;
        testimonialsPlacement.value = normalizeTestimonialPlacement(
          state.testimonialsPlacement,
          {
            blogEnabled: blogEnabled.value,
            shopEnabled: shopEnabled.value && products.value.length > 0,
            pages: pagesEnabled.value ? pages.value : [],
          },
        );
        lastPublishedAt.value = state.lastPublishedAt || null;
        lastLocalEditAt.value =
          state.lastLocalEditAt || new Date().toISOString();
        lastSiteEditAt.value = state.lastSiteEditAt || lastLocalEditAt.value;
        draftSourceUrl.value =
          typeof state.draftSourceUrl === "string" &&
          state.draftSourceUrl.trim().length > 0
            ? state.draftSourceUrl
            : null;

        const explicitCurrentStepId = normalizeWizardStepId(
          typeof state.currentStepId === "string" ? state.currentStepId : "",
        );
        const savedCurrentStepId =
          explicitCurrentStepId ||
          (!hasOptionalWebsiteFeatureState
            ? legacyWizardStepId(state, storedProfile, state.currentStep)
            : null);
        const explicitFurthestStepId = normalizeWizardStepId(
          typeof state.furthestStepId === "string" ? state.furthestStepId : "",
        );
        const savedFurthestStepId =
          explicitFurthestStepId ||
          (!hasOptionalWebsiteFeatureState
            ? legacyWizardStepId(
                state,
                storedProfile,
                state.furthestStep ?? state.currentStep,
              )
            : null);

        // A saved draft can be sitting on an editor that is optional now. Keep
        // that editor visible so upgrading never silently changes its identity.
        if (savedCurrentStepId) enableStep(savedCurrentStepId);
        if (savedFurthestStepId) enableStep(savedFurthestStepId);

        const savedCurrentStepIndex = savedCurrentStepId
          ? stepIds.value.indexOf(savedCurrentStepId)
          : -1;
        const savedCurrentStep =
          savedCurrentStepIndex >= 0
            ? savedCurrentStepIndex + 1
            : typeof state.currentStep === "number"
              ? state.currentStep
              : 1;
        currentStep.value = Math.min(Math.max(savedCurrentStep, 1), totalSteps.value);

        const savedFurthestStepIndex = savedFurthestStepId
          ? stepIds.value.indexOf(savedFurthestStepId)
          : -1;
        const savedFurthestStep =
          savedFurthestStepIndex >= 0
            ? savedFurthestStepIndex + 1
            : typeof state.furthestStep === "number"
              ? state.furthestStep
              : currentStep.value;
        furthestStep.value = Math.min(
          Math.max(savedFurthestStep, currentStep.value, 1),
          totalSteps.value,
        );

        profile.value.newsletter = {
          ...profile.value.newsletter,
          enabled: newsletterEnabled.value,
        };
        return true;
      } else {
        persistedOwnerUserId.value = null;
      }
    } catch (e) {
      console.warn("Failed to load wizard state:", e);
    }
    return false;
  }

  function reconcileSession(userId: string | null) {
    sessionUserId.value = userId;
    if (persistedOwnerUserId.value === userId) {
      return;
    }
    reset();
  }

  function resetState(clearStorage: boolean) {
    // Revoke any temp image URLs before dropping state
    for (const page of pages.value) {
      if (page.images?.length) {
        for (const img of page.images) {
          if (img.tempUrl) {
            try {
              URL.revokeObjectURL(img.tempUrl);
            } catch {
              // ignore
            }
          }
        }
      }
    }
    for (const post of posts.value) {
      if (post.images?.length) {
        for (const img of post.images) {
          if (img.tempUrl) {
            try {
              URL.revokeObjectURL(img.tempUrl);
            } catch {
              // ignore
            }
          }
        }
      }
    }
    for (const product of products.value) {
      if (product.images?.length) {
        for (const img of product.images) {
          if (img.tempUrl) {
            try {
              URL.revokeObjectURL(img.tempUrl);
            } catch {
              // ignore
            }
          }
        }
      }
    }
    currentStep.value = 1;
    furthestStep.value = 1;
    profile.value = { ...defaultProfile };
    pages.value = [];
    posts.value = [];
    products.value = [];
    testimonials.value = [];
    username.value = "";
    siteRole.value = "profile";
    vibe.value = defaultVibe;
    accentOverride.value = null;
    isUsernameAvailable.value = null;
    publishError.value = null;
    lastPublishedAt.value = null;
    lastLocalEditAt.value = new Date().toISOString();
    lastSiteEditAt.value = lastLocalEditAt.value;
    draftSourceUrl.value = null;
    linksEnabled.value = false;
    callToActionEnabled.value = false;
    pagesEnabled.value = false;
    newsletterEnabled.value = false;
    blogEnabled.value = false;
    bookingsEnabled.value = false;
    shopEnabled.value = false;
    testimonialsEnabled.value = false;
    blogTitle.value = DEFAULT_BLOG_TITLE;
    shopTitle.value = DEFAULT_SHOP_TITLE;
    testimonialsPlacement.value = "homepage";
    testimonialsTitle.value = DEFAULT_TESTIMONIALS_TITLE;
    persistedOwnerUserId.value = sessionUserId.value;
    if (clearStorage) localStorage.removeItem(activeStorageKey.value);
  }

  function reset() {
    resetState(true);
  }

  function scopedStorageKey(siteId: string | null, role: WizardSiteRole): string {
    const owner = encodeURIComponent(sessionUserId.value || "anonymous");
    const context = siteId
      ? `site:${encodeURIComponent(siteId)}`
      : `new:${role}`;
    return `${SCOPED_STORAGE_PREFIX}:${owner}:${context}`;
  }

  function legacyDraftMatchesContext(input: {
    siteId: string | null;
    username: string;
    role: WizardSiteRole;
  }): boolean {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return false;
    try {
      const state = JSON.parse(saved);
      const owner = typeof state.ownerUserId === "string" ? state.ownerUserId : null;
      if (sessionUserId.value && owner && owner !== sessionUserId.value) return false;
      const role: WizardSiteRole =
        state.siteRole === "organization" ? "organization" : "profile";
      if (role !== input.role) return false;
      if (!input.siteId) return true;
      // Core permits exactly one profile site, so a legacy profile draft can
      // safely follow that stable record even when it contains a pending rename.
      if (input.role === "profile") return true;
      const storedUsername = normalizeAssetSiteUsername(state.username);
      return storedUsername === normalizeAssetSiteUsername(input.username);
    } catch {
      return false;
    }
  }

  function activateDraftContext(input: {
    siteId?: string | null;
    username?: string | null;
    role: WizardSiteRole;
  }): { restored: boolean; migratedLegacy: boolean } {
    const siteId =
      typeof input.siteId === "string" && input.siteId.trim()
        ? input.siteId.trim()
        : null;
    const siteUsername = normalizeAssetSiteUsername(input.username) || "";
    const targetStorageKey = scopedStorageKey(siteId, input.role);

    if (activeStorageKey.value === targetStorageKey) {
      return {
        restored: localStorage.getItem(targetStorageKey) !== null,
        migratedLegacy: false,
      };
    }

    if (activeStorageKey.value !== STORAGE_KEY) saveToStorage();

    const shouldMigrateLegacy = legacyDraftMatchesContext({
      siteId,
      username: siteUsername,
      role: input.role,
    });
    const legacyDraft = shouldMigrateLegacy
      ? localStorage.getItem(STORAGE_KEY)
      : null;

    activeStorageKey.value = targetStorageKey;
    selectedSiteId.value = siteId;
    selectedSiteUsername.value = siteUsername;
    resetState(false);
    siteRole.value = input.role;
    username.value = siteUsername;
    profile.value.handle = siteUsername;

    let migratedLegacy = false;
    if (!localStorage.getItem(targetStorageKey) && legacyDraft) {
      localStorage.setItem(targetStorageKey, legacyDraft);
      migratedLegacy = true;
    }

    const restored = loadFromStorage(targetStorageKey);
    selectedSiteId.value = siteId;
    selectedSiteUsername.value = siteUsername;
    if (!restored) {
      persistedOwnerUserId.value = sessionUserId.value;
      siteRole.value = input.role;
      username.value = siteUsername;
      profile.value.handle = siteUsername;
    }
    if (migratedLegacy && restored) {
      siteRole.value = input.role;
      saveToStorage();
      localStorage.removeItem(STORAGE_KEY);
    }
    return { restored, migratedLegacy };
  }

  function bindDraftToSite(siteId: string) {
    const normalizedSiteId = siteId.trim();
    if (!normalizedSiteId) return;
    if (selectedSiteId.value === normalizedSiteId) {
      selectedSiteUsername.value = username.value;
      saveToStorage();
      return;
    }
    const previousStorageKey = activeStorageKey.value;
    const nextStorageKey = scopedStorageKey(normalizedSiteId, siteRole.value);
    selectedSiteId.value = normalizedSiteId;
    selectedSiteUsername.value = username.value;
    activeStorageKey.value = nextStorageKey;
    saveToStorage();
    if (
      previousStorageKey !== STORAGE_KEY &&
      previousStorageKey !== nextStorageKey
    ) {
      localStorage.removeItem(previousStorageKey);
    }
  }

  // Set vibe
  function setVibe(newVibe: VibeId) {
    vibe.value = newVibe;
    markAsEdited();
    saveToStorage();
  }

  // Set accent color override
  function setAccentOverride(color: string | null) {
    accentOverride.value = color;
    markAsEdited();
    saveToStorage();
  }

  function setSiteRole(role: WizardSiteRole) {
    siteRole.value = role;
    saveToStorage();
  }

  // Mark site as published
  function markAsPublished() {
    const now = new Date().toISOString();
    lastPublishedAt.value = now;
    lastSiteEditAt.value = now;
    saveToStorage();
  }

  function restorePublishedBaseline(publishedAt: string) {
    const normalized = publishedAt.trim();
    if (!normalized || lastPublishedAt.value) return;
    lastPublishedAt.value = normalized;
    saveToStorage();
  }

  /**
   * Load wizard state from existing site content (for editing)
   */
  function loadFromSiteContent(
    siteProfile: {
      name: string;
      handle?: string;
      visibility?: "public" | "private";
      bio?: string;
      logo?: string;
      avatar?: string;
      banner?: string;
      links?: Record<string, string | undefined>;
      pages?: Array<{
        slug: string;
        title: string;
        file: string;
        visible: boolean;
        navigationGroup?: string;
      }>;
      footer?: any;
      buttons?: Array<{
        text: string;
        url: string;
        style?: string;
        icon?: string;
      }>;
      intents?: {
        subscribe?: {
          enabled?: boolean;
          title?: string;
          description?: string;
          doubleOptIn?: boolean;
        };
        book?: {
          enabled?: boolean;
          title?: string;
          description?: string;
          duration?: number;
          bufferTime?: number;
          pricing?: WizardBookingPricing;
          offers?: PublishedBookingOffer[];
          classes?: PublishedBookingClass[];
          retreats?: PublishedBookingRetreat[];
          bookingTypes?: PublishedBookingType[];
          availability?: {
            timezone?: string;
            windows?: Record<string, string[]>;
          };
        };
        shop?: {
          enabled?: boolean;
          title?: string;
          description?: string;
          currency?: "USD" | "GBP" | "EUR" | "CAD" | "AUD" | "CHF" | "SGD" | "INR" | "PKR";
        };
        gift?: {
          enabled?: boolean;
          title?: string;
          description?: string;
          suggestedAmount?: number;
          currency?: "USD" | "GBP" | "EUR" | "CAD" | "AUD" | "CHF" | "SGD" | "INR" | "PKR";
          icon?: string;
        };
      };
      testimonials?: WizardTestimonial[];
      blogEnabled?: boolean;
      blogTitle?: string;
      shopTitle?: string;
      testimonialDisplay?: TestimonialPlacement;
      testimonialsTitle?: string;
    },
    sitePages: Array<{ slug: string; title: string; content: string }>,
    sitePosts: Array<{
      slug: string;
      title: string;
      content: string;
      /** Legacy wizard standalone social; stripped when hydrating the blog step. */
      type?: "article" | "note" | "video" | "audio" | "image" | "link" | "social";
      media?: {
        url?: string;
        duration?: number;
        thumbnail?: string;
        provider?: string;
        id?: string;
      };
      publishedAt?: string;
      excerpt?: string;
      draft?: boolean;
    }>,
    siteProducts: Array<{
      slug: string;
      title: string;
      content: string;
      price: number;
      currency: "USD" | "GBP" | "EUR" | "CAD" | "AUD" | "CHF" | "SGD" | "INR" | "PKR";
      available?: boolean;
      publishedAt?: string;
      excerpt?: string;
      delivery?: ProductDelivery;
      confirmationEmail?: WizardProductConfirmationEmail;
      paymentMethod?: WizardPaymentMethod;
      paymentInstructions?: string;
    }>,
    siteUsername: string | null | undefined,
    sitePublishedAt?: string | null,
    siteSourceUrl?: string | null,
    loadedSiteRole: WizardSiteRole = "profile",
  ) {
    const resolvedSiteUsername =
      normalizeAssetSiteUsername(siteUsername) ||
      normalizeAssetSiteUsername(siteProfile.handle) ||
      normalizeAssetSiteUsername(username.value) ||
      "";

    // Reset the selected site's in-memory content without deleting its draft key.
    resetState(false);
    siteRole.value = loadedSiteRole;

    // Set username
    username.value = resolvedSiteUsername;
    isUsernameAvailable.value = true; // Already claimed by this user

    const resolveLoadedSiteAssetUrl = (value: string | null | undefined): string | null => {
      return resolveWizardSiteAssetUrl(value, resolvedSiteUsername);
    };
    const resolveLoadedContentAssetUrls = (content: string): string =>
      content.replace(
        /\b(src|href|data-src)=["']((?:\.\.?\/)*files\/[^"']+)["']/g,
        (_match, attr: string, rawUrl: string) => {
          const resolved = resolveLoadedSiteAssetUrl(rawUrl) || rawUrl;
          return `${attr}="${resolved}"`;
        },
      );

    // Map profile data - cast buttons to proper type
    const buttons: Me3Button[] = (siteProfile.buttons || []).map((b) => ({
      text: b.text,
      url: b.url,
      style: b.style as "primary" | "secondary" | "outline" | undefined,
      icon: b.icon,
    }));

    // Extract link order from existing links (preserve order from object keys)
    // Also extract vibe and accent override from special _ prefixed keys
    const links = siteProfile.links || {};

    // Extract vibe and accent override before filtering
    const savedVibe = links._vibe as string | undefined;
    const savedAccent = links._accent as string | undefined;
    const savedNavigationStyle =
      links[SITE_NAVIGATION_STYLE_LINK_KEY] as string | undefined;

    // Filter out special keys and empty values for regular links
    const filteredLinks: Record<string, string> = {};
    const linkOrder: string[] = [];
    for (const [key, value] of Object.entries(links)) {
      if (!key.startsWith("_") && value) {
        filteredLinks[key] = value;
        linkOrder.push(key);
      }
    }

    // Retired vibe names are upgraded to their selectable replacement.
    vibe.value = normalizeVibeId(savedVibe);

    // Set accent override if present
    accentOverride.value = savedAccent || null;

    const rawFooter = (siteProfile as any).footer as
      | false
      | { text?: string; link?: { text?: string; url?: string } }
      | undefined;

    const footer: WizardFooterConfig =
      rawFooter === false
        ? { mode: "none", text: "", linkText: "", linkUrl: "" }
        : rawFooter && typeof rawFooter === "object"
          ? {
              mode: "custom",
              text: (rawFooter.text || "").toString(),
              linkText: (rawFooter.link?.text || "").toString(),
              linkUrl: (rawFooter.link?.url || "").toString(),
            }
          : { ...defaultProfile.footer };

    // Extract newsletter/intents config
    const rawIntents = siteProfile.intents;
    const newsletter: WizardNewsletterConfig = rawIntents?.subscribe?.enabled
      ? {
          enabled: true,
          title: rawIntents.subscribe.title || "",
          description: rawIntents.subscribe.description || "",
          doubleOptIn: rawIntents.subscribe.doubleOptIn === true,
        }
      : { ...defaultProfile.newsletter, enabled: false };

    // Extract booking config
    const rawBook = rawIntents?.book as
      | ExtendedMe3IntentBook
      | undefined;
    const rawOneToOneType = rawBook?.bookingTypes?.find(
      (entry) => entry.type === "one_to_one",
    );
    const rawClassType = rawBook?.bookingTypes?.find(
      (entry) => entry.type === "class",
    );
    const rawRetreatType = rawBook?.bookingTypes?.find(
      (entry) => entry.type === "retreat",
    );
    const rawClassOffers =
      rawClassType?.classes && rawClassType.classes.length > 0
        ? rawClassType.classes
        : rawBook?.classes || [];
    const rawRetreatOffers =
      rawRetreatType?.retreats && rawRetreatType.retreats.length > 0
        ? rawRetreatType.retreats
        : rawBook?.retreats || [];
    const booking: WizardBookingConfig = rawBook?.enabled
      ? normalizeWizardBookingConfig({
          enabled: true,
          title: rawOneToOneType?.title ?? rawBook.title,
          description: rawOneToOneType?.description ?? rawBook.description,
          oneToOneEnabled:
            rawOneToOneType !== undefined
              ? true
              : (rawBook.offers && rawBook.offers.length > 0) ||
                !!rawBook.availability?.windows,
          classEnabled:
            rawClassType !== undefined || rawClassOffers.length > 0,
          retreatEnabled:
            rawRetreatType !== undefined || rawRetreatOffers.length > 0,
          offers:
            rawOneToOneType?.offers && rawOneToOneType.offers.length > 0
              ? rawOneToOneType.offers.map((offer) => ({
                  id: offer.id,
                  title: offer.title,
                  description: offer.description || "",
                  duration: (offer.duration as WizardBookingDuration) || 30,
                  pricing: offer.pricing
                    ? {
                        ...defaultWizardBookingPricing(),
                        ...offer.pricing,
                        allowFlexiblePricing:
                          offer.pricing.allowFlexiblePricing ?? true,
                        allowFree: offer.pricing.allowFree ?? false,
                      }
                    : undefined,
                }))
              : rawBook.offers && rawBook.offers.length > 0
                ? rawBook.offers.map((offer) => ({
                  id: offer.id,
                  title: offer.title,
                  description: offer.description || "",
                  duration: (offer.duration as WizardBookingDuration) || 30,
                  pricing: offer.pricing
                    ? {
                        ...defaultWizardBookingPricing(),
                        ...offer.pricing,
                        allowFlexiblePricing:
                          offer.pricing.allowFlexiblePricing ?? true,
                        allowFree: offer.pricing.allowFree ?? false,
                      }
                    : undefined,
                }))
              : [
                  legacyBookingToDefaultOffer({
                    title: rawBook.title,
                    description: rawBook.description,
                    duration: rawBook.duration,
                    pricing: rawBook.pricing,
                  }),
                ],
          classOffers: rawClassOffers.map((offer) => ({
            id: offer.id,
            title: offer.title,
            description: offer.description || "",
            duration: (offer.duration as WizardBookingDuration) || 60,
            timezone:
              offer.timezone ||
              rawClassType?.availability?.timezone ||
              Intl.DateTimeFormat().resolvedOptions().timeZone ||
              "UTC",
            recurrence: {
              frequency:
                offer.recurrence?.frequency === "biweekly"
                  ? "biweekly"
                  : "weekly",
              weekday: offer.recurrence?.weekday || "monday",
              startTime: offer.recurrence?.startTime || "18:00",
              startDate: offer.recurrence?.startDate || "",
            },
            pricing: offer.pricing
              ? {
                  ...defaultWizardBookingPricing(),
                  ...offer.pricing,
                  allowFlexiblePricing:
                    offer.pricing.allowFlexiblePricing ?? true,
                  allowFree: offer.pricing.allowFree ?? false,
                }
              : undefined,
            capacity:
              typeof offer.capacity === "number" ? offer.capacity : null,
          })),
          retreatOffers: rawRetreatOffers.map((offer) => ({
            id: offer.id,
            title: offer.title,
            description: offer.description || "",
            startDate: offer.startDate || "",
            startTime: offer.startTime || "09:00",
            endDate: offer.endDate || "",
            endTime: offer.endTime || "17:00",
            timezone:
              offer.timezone ||
              rawRetreatType?.availability?.timezone ||
              Intl.DateTimeFormat().resolvedOptions().timeZone ||
              "UTC",
            durationDays: deriveRetreatDurationDays({
              startDate: offer.startDate || "",
              startTime: offer.startTime || "09:00",
              endDate: offer.endDate || "",
              endTime: offer.endTime || "17:00",
              durationDays: offer.durationDays,
            }),
            pricing: offer.pricing
              ? {
                  ...defaultWizardBookingPricing(),
                  ...offer.pricing,
                  allowFlexiblePricing:
                    offer.pricing.allowFlexiblePricing ?? true,
                  allowFree: offer.pricing.allowFree ?? false,
                }
              : undefined,
            capacity:
              typeof offer.capacity === "number" ? offer.capacity : null,
          })),
          bufferTime: rawBook.bufferTime,
          reminders: rawBook.reminders,
          confirmationEmail: rawBook.confirmationEmail,
          timezone:
            rawOneToOneType?.availability?.timezone || rawBook.availability?.timezone,
          availability: {
            monday:
              rawOneToOneType?.availability?.windows?.monday ||
              rawBook.availability?.windows?.monday ||
              [],
            tuesday:
              rawOneToOneType?.availability?.windows?.tuesday ||
              rawBook.availability?.windows?.tuesday ||
              [],
            wednesday:
              rawOneToOneType?.availability?.windows?.wednesday ||
              rawBook.availability?.windows?.wednesday ||
              [],
            thursday:
              rawOneToOneType?.availability?.windows?.thursday ||
              rawBook.availability?.windows?.thursday ||
              [],
            friday:
              rawOneToOneType?.availability?.windows?.friday ||
              rawBook.availability?.windows?.friday ||
              [],
            saturday:
              rawOneToOneType?.availability?.windows?.saturday ||
              rawBook.availability?.windows?.saturday ||
              [],
            sunday:
              rawOneToOneType?.availability?.windows?.sunday ||
              rawBook.availability?.windows?.sunday ||
              [],
          },
        })
      : { ...defaultProfile.booking };

    const rawGift = rawIntents?.gift as Partial<WizardGiftConfig> | undefined;
    const gift: WizardGiftConfig = rawGift?.enabled
      ? {
          enabled: true,
          title: rawGift.title || "",
          description: rawGift.description || "",
          suggestedAmount: rawGift.suggestedAmount ?? 10,
          currency: (rawGift.currency || "USD") as WizardGiftConfig["currency"],
          minimumAmount: 5,
          icon: rawGift.icon || "Gift",
        }
      : { ...defaultProfile.gift };

    profile.value = {
      name: siteProfile.name || "",
      handle: siteProfile.handle || resolvedSiteUsername,
      visibility:
        loadedSiteRole === "profile" && siteProfile.visibility === "private"
          ? "private"
          : loadedSiteRole === "profile" &&
              (siteProfile.visibility === "public" || Boolean(sitePublishedAt))
            ? "public"
            : "private",
      location: (siteProfile as any).location || "",
      locationData: normalizeLocationData((siteProfile as any).locationData),
      bio: siteProfile.bio || "",
      logo: resolveLoadedSiteAssetUrl(siteProfile.logo),
      avatar: resolveLoadedSiteAssetUrl(siteProfile.avatar),
      banner: resolveLoadedSiteAssetUrl(siteProfile.banner),
      logoBlob: null,
      avatarBlob: null, // Can't restore blobs from server
      bannerBlob: null,
      avatarOriginalBlob: null,
      bannerOriginalBlob: null,
      links: filteredLinks,
      linkOrder,
      buttons,
      navigationStyle: normalizeSiteNavigationStyle(savedNavigationStyle),
      footer,
      newsletter,
      booking,
      gift,
      business: {
        ...normalizeBusinessConfig(
          (siteProfile as {
            business?: Partial<WizardBusinessConfig> | null;
          }).business,
        ),
      },
    };

    // Map pages
    const pageMetadata = new Map<
      string,
      { visible: boolean; navigationGroup?: string }
    >();
    if (Array.isArray(siteProfile.pages)) {
      for (const page of siteProfile.pages) {
        if (page?.slug) {
          pageMetadata.set(page.slug, {
            visible: page.visible !== false,
            navigationGroup: normalizeNavigationGroup(page.navigationGroup),
          });
        }
      }
    }

    const orderedSitePages: typeof sitePages = [];
    const seenPageSlugs = new Set<string>();

    if (Array.isArray(siteProfile.pages)) {
      const sitePagesBySlug = new Map(sitePages.map((page) => [page.slug, page]));
      for (const pageMeta of siteProfile.pages) {
        const matchingPage = pageMeta?.slug
          ? sitePagesBySlug.get(pageMeta.slug)
          : undefined;
        if (!matchingPage) continue;
        orderedSitePages.push(matchingPage);
        seenPageSlugs.add(matchingPage.slug);
      }
    }

    for (const page of sitePages) {
      if (seenPageSlugs.has(page.slug)) continue;
      orderedSitePages.push(page);
    }

    pages.value = orderedSitePages.map((p) => ({
      title: p.title,
      slug: p.slug,
      slugCustomized: inferSlugCustomized(p.title, p.slug, "page"),
      content: resolveLoadedContentAssetUrls(p.content),
      images: [],
      visible: pageMetadata.get(p.slug)?.visible ?? true,
      navigationGroup: pageMetadata.get(p.slug)?.navigationGroup,
    }));

    const siteBlogPosts = sitePosts.filter(
      (p) =>
        !isStandaloneContentOrLegacyWizardSocialSlug(p.slug) && p.type !== "social",
    );

    posts.value = siteBlogPosts.map((p) => {
      const type: WizardPostType = p.type === "video" ? "video" : "article";
      return {
        title: p.title,
        slug: p.slug,
        slugCustomized: inferSlugCustomized(p.title, p.slug, "post"),
        content: resolveLoadedContentAssetUrls(p.content),
        images: [],
        type,
        caption: "",
        media: type === "video" ? p.media : undefined,
        mediaFile: null,
        publishedAt: p.publishedAt,
        excerpt: p.excerpt,
        draft: p.draft,
      };
    });

    products.value = siteProducts.map((p) => {
      const rawCe = p.confirmationEmail;
      let confirmationEmail: WizardProductConfirmationEmail | undefined;
      if (rawCe && typeof rawCe === "object") {
        confirmationEmail = {
          enabled: rawCe.enabled === true,
          subject:
            typeof rawCe.subject === "string" ? rawCe.subject : undefined,
          message:
            typeof rawCe.message === "string" ? rawCe.message : undefined,
        };
      }
      return {
        title: p.title,
        slug: p.slug,
        slugCustomized: inferSlugCustomized(p.title, p.slug, "product"),
        content: resolveLoadedContentAssetUrls(p.content),
        images: [],
        price: normalizeProductPriceCents(p.price),
        currency: p.currency,
        available: p.available ?? true,
        paymentMethod: normalizeWizardPaymentMethod(p.paymentMethod),
        paymentInstructions: normalizeWizardPaymentInstructions(
          p.paymentInstructions,
        ),
        publishedAt: p.publishedAt,
        excerpt: p.excerpt,
        delivery: p.delivery,
        ...(confirmationEmail ? { confirmationEmail } : {}),
      };
    });

    testimonials.value = (siteProfile.testimonials || []).map((t) => ({
      name: t.name,
      quote: t.quote,
      handle: t.handle?.replace(/^@/, ""),
      avatar: resolveLoadedSiteAssetUrl(t.avatar) || undefined,
      avatarBlob: null,
      profileUrl: t.profileUrl,
    }));
    blogTitle.value =
      typeof siteProfile.blogTitle === "string" &&
      siteProfile.blogTitle.trim().length > 0
        ? siteProfile.blogTitle
        : DEFAULT_BLOG_TITLE;
    shopTitle.value =
      typeof siteProfile.shopTitle === "string" &&
      siteProfile.shopTitle.trim().length > 0
        ? siteProfile.shopTitle
        : DEFAULT_SHOP_TITLE;
    testimonialsTitle.value =
      typeof siteProfile.testimonialsTitle === "string" &&
      siteProfile.testimonialsTitle.trim().length > 0
        ? siteProfile.testimonialsTitle
        : DEFAULT_TESTIMONIALS_TITLE;

    // Restore enabled states from site content
    linksEnabled.value = Object.values(filteredLinks).some(
      (value) => typeof value === "string" && value.trim().length > 0,
    );
    callToActionEnabled.value = buttons.length > 0;
    pagesEnabled.value = pages.value.length > 0;
    newsletterEnabled.value = Boolean(siteProfile.intents?.subscribe?.enabled);
    blogEnabled.value = Boolean(siteProfile.blogEnabled) || siteBlogPosts.length > 0;
    bookingsEnabled.value = Boolean(siteProfile.intents?.book?.enabled);
    shopEnabled.value = products.value.length > 0;
    testimonialsEnabled.value = (siteProfile.testimonials || []).length > 0;
    testimonialsPlacement.value = normalizeTestimonialPlacement(
      getStoredTestimonialPlacement(siteProfile as {
        testimonialDisplay?: unknown;
        links?: Record<string, unknown>;
      }),
      {
        blogEnabled: blogEnabled.value,
        shopEnabled: shopEnabled.value && products.value.length > 0,
        pages: pagesEnabled.value ? pages.value : [],
      },
    );
    furthestStep.value = totalSteps.value;

    // Set last published timestamp if site was published
    if (sitePublishedAt) {
      lastPublishedAt.value = sitePublishedAt;
      // Mirror published timestamp as local edit baseline to avoid
      // marking freshly-loaded content as needing publish.
      lastLocalEditAt.value = sitePublishedAt;
      lastSiteEditAt.value = sitePublishedAt;
    }

    draftSourceUrl.value =
      typeof siteSourceUrl === "string" && siteSourceUrl.trim().length > 0
        ? siteSourceUrl.trim()
        : null;

    // Save to storage so it persists
    saveToStorage();
  }

  // Load state on init
  loadFromStorage();

  return {
    // State
    currentStep,
    furthestStep,
    totalSteps,
    profile,
    pages,
    maxPages: MAX_PAGES,
    posts,
    products,
    testimonials,
    username,
    siteRole,
    selectedSiteId,
    selectedSiteUsername,
    draftContextId,
    isUsernameAvailable,
    isCheckingUsername,
    isPublishing,
    publishError,
    lastPublishedAt,
    lastLocalEditAt,
    lastSiteEditAt,
    draftSourceUrl,
    vibe,
    accentOverride,
    linksEnabled,
    callToActionEnabled,
    pagesEnabled,
    newsletterEnabled,
    blogEnabled,
    bookingsEnabled,
    shopEnabled,
    testimonialsEnabled,
    blogTitle,
    shopTitle,
    blogPath,
    shopPath,
    testimonialsPlacement,
    testimonialsTitle,
    testimonialsPath,

    // Computed
    steps,
    stepIds,
    stepNames,
    currentStepId,
    currentStepName,
    canProceed,
    needsPublish,

    // Actions
    nextStep,
    prevStep,
    goToStep,
    goToStepId,
    normalizeWizardStepId,
    updateProfile,
    setFooter,
    setNewsletter,
    setBooking,
    enableBookingType,
    disableBookingType,
    addBookingOffer,
    updateBookingOffer,
    removeBookingOffer,
    addClassOffer,
    updateClassOffer,
    removeClassOffer,
    addRetreatOffer,
    updateRetreatOffer,
    removeRetreatOffer,
    setBookingAvailability,
    setBookingPricing,
    setPaidBookingOffersPricing,
    setBookingOfferPricing,
    setClassOfferPricing,
    setRetreatOfferPricing,
    setGift,
    setLink,
    removeLink,
    setLinkOrder,
    addButton,
    updateButton,
    removeButton,
    setButtons,
    addPage,
    updatePage,
    movePage,
    removePage,
    addPageContentAsset,
    addPageImage,
    removePageImage,
    syncPageContentAssets,
    syncPageImages,
    addPost,
    updatePost,
    removePost,
    addPostContentAsset,
    addPostImage,
    removePostImage,
    syncPostContentAssets,
    syncPostImages,
    reorderPostImages,
    addProduct,
    updateProduct,
    removeProduct,
    addProductContentAsset,
    addProductImage,
    removeProductImage,
    syncProductContentAssets,
    syncProductImages,
    addTestimonial,
    updateTestimonial,
    removeTestimonial,
    publishableTestimonials,
    generateMe3Json,
    saveToStorage,
    loadFromStorage,
    reconcileSession,
    reset,
    activateDraftContext,
    bindDraftToSite,
    loadFromSiteContent,
    setVibe,
    setAccentOverride,
    setSiteRole,
    markAsPublished,
    restorePublishedBaseline,
  };
});

function getPublicApiBase(): string {
  const configured = import.meta.env.VITE_PUBLIC_API_BASE || API_BASE;
  if (/^https?:\/\//.test(configured)) return configured.replace(/\/$/, "");
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
  return `${origin}${configured}`.replace(/\/$/, "");
}
