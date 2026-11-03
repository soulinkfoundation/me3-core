import {
  isLandingPageDesignPackId,
  type LandingPageDesignPackId,
} from "./design-packs";

/**
 * Reads the settings file of a Business Site that is already published, so its redirects and noindex setting keep
 * working. Business Sites can no longer be created or edited.
 */
const BUSINESS_SITE_DOCUMENT_VERSION = 1 as const;

type BusinessSiteNavigationItem = {
  id: string;
  label: string;
  pageSlug?: string;
  href?: string;
  visible: boolean;
};

type BusinessSiteLink = {
  id: string;
  label: string;
  href: string;
};

export type BusinessSiteDocumentV1 = {
  version: 1;
  name: string;
  homepageSlug: string;
  navigation: {
    items: BusinessSiteNavigationItem[];
  };
  footer: {
    note: string;
    links: BusinessSiteLink[];
  };
  seo: {
    titleSuffix: string;
    description: string;
    socialImage?: string | null;
    indexing: "index" | "noindex";
  };
  organization: {
    description?: string;
    logo?: string | null;
    email?: string;
    telephone?: string;
    address?: string;
  };
  redirects: Array<{
    id: string;
    from: string;
    to: string;
  }>;
  connectedResources: {
    collectionIds: string[];
    productIds: string[];
    bookingOfferIds: string[];
  };
  design: {
    packId: LandingPageDesignPackId;
    packVersion: 1;
    customization?: {
      accentColor?: string;
      backgroundColor?: string;
      textColor?: string;
    };
  };
  updatedAt: string;
};

export function normalizeBusinessSiteDocument(
  value: unknown,
): BusinessSiteDocumentV1 | null {
  if (!value || typeof value !== "object") return null;
  const document = value as Partial<BusinessSiteDocumentV1>;
  if (
    document.version !== BUSINESS_SITE_DOCUMENT_VERSION ||
    typeof document.name !== "string" ||
    !normalizeBusinessSiteSlug(document.homepageSlug) ||
    !document.navigation ||
    !Array.isArray(document.navigation.items) ||
    !document.footer ||
    !Array.isArray(document.footer.links) ||
    !document.seo ||
    !["index", "noindex"].includes(document.seo.indexing || "") ||
    !document.organization ||
    !Array.isArray(document.redirects) ||
    !document.connectedResources ||
    !Array.isArray(document.connectedResources.collectionIds) ||
    !Array.isArray(document.connectedResources.productIds) ||
    !Array.isArray(document.connectedResources.bookingOfferIds) ||
    !document.design ||
    !isLandingPageDesignPackId(document.design.packId) ||
    document.design.packVersion !== 1 ||
    typeof document.updatedAt !== "string"
  ) {
    return null;
  }
  if (
    !document.navigation.items.every(isNavigationItem) ||
    !document.footer.links.every(isLink) ||
    !document.redirects.every(
      (redirect) =>
        !!redirect &&
        typeof redirect.id === "string" &&
        !!normalizeBusinessSitePath(redirect.from) &&
        !!normalizeBusinessSitePath(redirect.to),
    )
  ) {
    return null;
  }
  return document as BusinessSiteDocumentV1;
}

function normalizeBusinessSiteSlug(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const slug = value.trim().toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : null;
}

function normalizeBusinessSitePath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = `/${value.trim().replace(/^\/+|\/+$/g, "")}`;
  return /^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*\/?)*$/.test(path)
    ? path
    : null;
}

function isNavigationItem(value: unknown): value is BusinessSiteNavigationItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<BusinessSiteNavigationItem>;
  return (
    typeof item.id === "string" &&
    typeof item.label === "string" &&
    typeof item.visible === "boolean" &&
    ((!!normalizeBusinessSiteSlug(item.pageSlug) && item.href === undefined) ||
      (typeof item.href === "string" && !!item.href.trim() && item.pageSlug === undefined))
  );
}

function isLink(value: unknown): value is BusinessSiteLink {
  if (!value || typeof value !== "object") return false;
  const link = value as Partial<BusinessSiteLink>;
  return (
    typeof link.id === "string" &&
    typeof link.label === "string" &&
    typeof link.href === "string" &&
    !!link.href.trim()
  );
}
