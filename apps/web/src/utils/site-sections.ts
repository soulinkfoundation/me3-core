type PageLike = {
  slug: string;
};

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
