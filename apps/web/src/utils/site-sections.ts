type PageLike = {
  slug: string;
};

export const TESTIMONIAL_PLACEMENT_LINK_KEY = "_testimonials_placement";
export const BOOKING_PLACEMENT_LINK_KEY = "_booking_placement";

export type SiteSectionPlacement =
  | "homepage"
  | "standalone"
  | "blog"
  | "shop"
  | `page:${string}`;
export type TestimonialPlacement = SiteSectionPlacement;
export type BookingPlacement = SiteSectionPlacement;

const DEFAULT_BLOG_PATH = "blog";
const DEFAULT_SHOP_PATH = "shop";
const DEFAULT_TESTIMONIALS_PATH = "testimonials";

function slugifySectionPath(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  return slug || fallback;
}

function ensureUniquePath(basePath: string, taken: Set<string>): string {
  let candidate = basePath;
  let counter = 1;

  while (taken.has(candidate)) {
    candidate = `${basePath}-${counter++}`;
  }

  taken.add(candidate);
  return candidate;
}

export function resolveSiteSectionPaths(options: {
  pages?: PageLike[];
  blogTitle?: string;
  shopTitle?: string;
  testimonialsTitle?: string;
}): {
  blog: string;
  shop: string;
  testimonials: string;
  bookings: string;
} {
  const taken = new Set(
    (options.pages || [])
      .map((page) => page.slug?.trim())
      .filter((slug): slug is string => Boolean(slug)),
  );

  const blog = ensureUniquePath(
    slugifySectionPath(options.blogTitle || "", DEFAULT_BLOG_PATH),
    taken,
  );
  const shop = ensureUniquePath(
    slugifySectionPath(options.shopTitle || "", DEFAULT_SHOP_PATH),
    taken,
  );
  const testimonials = ensureUniquePath(
    slugifySectionPath(
      options.testimonialsTitle || "",
      DEFAULT_TESTIMONIALS_PATH,
    ),
    taken,
  );

  const bookings = ensureUniquePath("bookings", taken);

  return { blog, shop, testimonials, bookings };
}

export function isPagePlacement(
  placement: string,
): placement is `page:${string}` {
  return placement.startsWith("page:") && placement.length > "page:".length;
}

export function getPlacementPageSlug(
  placement: TestimonialPlacement | string | null | undefined,
): string | null {
  if (!placement || !isPagePlacement(placement)) return null;
  return placement.slice("page:".length) || null;
}

export function normalizeTestimonialPlacement(
  placement: unknown,
  options: {
    blogEnabled?: boolean;
    shopEnabled?: boolean;
    pages?: PageLike[];
  } = {},
): TestimonialPlacement {
  if (placement === "homepage" || placement === "standalone") {
    return placement;
  }

  if (placement === "blog") {
    return options.blogEnabled ? "blog" : "homepage";
  }

  if (placement === "shop") {
    return options.shopEnabled ? "shop" : "homepage";
  }

  if (typeof placement === "string" && isPagePlacement(placement)) {
    const slug = getPlacementPageSlug(placement);
    if (slug && (options.pages || []).some((page) => page.slug === slug)) {
      return placement;
    }
  }

  return "homepage";
}

export function getStoredTestimonialPlacement(
  profile:
    | {
        testimonialDisplay?: unknown;
        links?: Record<string, unknown> | null | undefined;
      }
    | null
    | undefined,
): string | undefined {
  if (!profile) return undefined;

  const extensionPlacement = profile.links?.[TESTIMONIAL_PLACEMENT_LINK_KEY];
  if (typeof extensionPlacement === "string" && extensionPlacement.trim()) {
    return extensionPlacement;
  }

  return typeof profile.testimonialDisplay === "string"
    ? profile.testimonialDisplay
    : undefined;
}

export function normalizeBookingPlacement(
  placement: unknown,
  options: {
    blogEnabled?: boolean;
    shopEnabled?: boolean;
    pages?: PageLike[];
  } = {},
): BookingPlacement {
  return normalizeTestimonialPlacement(placement, options);
}

export function getStoredBookingPlacement(
  links: Record<string, unknown> | null | undefined,
): string | undefined {
  const placement = links?.[BOOKING_PLACEMENT_LINK_KEY];
  return typeof placement === "string" ? placement : undefined;
}
