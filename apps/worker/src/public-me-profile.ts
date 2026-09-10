import {
  ME3_SCHEMA_URL,
  ME3_VERSION,
  validateProfile,
  type Me3ActionDefinition,
  type Me3Link,
  type Me3LocationData,
  type Me3Money,
  type Me3Profile,
  type Me3PublicProfile,
  type Me3Service,
} from "me3-protocol";
import {
  resolveSiteSectionPaths,
  type Me3SiteProfile,
} from "@me3-core/site-renderer";

const LOCATION_PRECISIONS = new Set<Me3LocationData["precision"]>([
  "locality",
  "city",
  "district",
  "county",
  "region",
  "country",
  "unknown",
]);

function text(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : undefined;
}

function id(value: unknown, prefix = ""): string | undefined {
  const normalized = text(value, 100)
    ?.replace(/[^A-Za-z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized ? `${prefix}${normalized}`.slice(0, 120) : undefined;
}

function publicAsset(value: unknown): string | undefined {
  const normalized = text(value, 2048);
  return normalized && /^(?:https:\/\/|\.\/|\/)/.test(normalized)
    ? normalized
    : undefined;
}

function publicOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? `${url.origin}${url.pathname.replace(/\/+$/, "")}`
      : undefined;
  } catch {
    return undefined;
  }
}

function currency(value: unknown): string {
  const normalized = text(value, 3)?.toUpperCase();
  return normalized && /^[A-Z]{3}$/.test(normalized) ? normalized : "USD";
}

function productMoney(value: unknown, code: unknown): Me3Money {
  const cents = typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : 0;
  return { amount: (cents / 100).toFixed(2), currency: currency(code) };
}

function serviceMoney(
  pricing: { enabled?: boolean; suggestedAmount?: number; currency?: string } | undefined,
): Me3Money | undefined {
  if (!pricing?.enabled) return undefined;
  const amount = pricing.suggestedAmount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) {
    return undefined;
  }
  return { amount: amount.toFixed(2), currency: currency(pricing.currency) };
}

function legacyLinkHref(platform: string, value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("http://")) return `https://${trimmed.slice("http://".length)}`;
  if (/^(?:https:\/\/|mailto:|tel:)/i.test(trimmed)) return trimmed;

  const cleaned = trimmed.replace(/^@/, "").replace(/\/+$/, "");
  switch (platform.toLowerCase()) {
    case "email":
    case "mail":
      return `mailto:${cleaned}`;
    case "twitter":
    case "x":
      return `https://x.com/${cleaned}`;
    case "instagram":
      return `https://instagram.com/${cleaned}`;
    case "linkedin":
      return `https://linkedin.com/in/${cleaned}`;
    case "github":
      return `https://github.com/${cleaned}`;
    case "substack":
      return `https://${cleaned}.substack.com/`;
    default:
      return `https://${cleaned}`;
  }
}

function publicLinks(profile: Me3SiteProfile): Me3Link[] | undefined {
  const links: Me3Link[] = [];
  for (const [rawRel, rawValue] of Object.entries(profile.links || {})) {
    if (!rawValue || rawRel.startsWith("_") || rawRel.endsWith("_label")) continue;
    const normalizedRel = rawRel.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
    const rel = /^[a-z]/.test(normalizedRel) ? normalizedRel : `link-${normalizedRel}`;
    const href = legacyLinkHref(rel, rawValue);
    if (!rel || !href) continue;
    const label = text(profile.links?.[`${rawRel}_label`], 160);
    links.push({ rel, href, ...(label ? { label } : {}) });
  }

  for (const button of profile.buttons || []) {
    const href = button.url ? legacyLinkHref("cta", button.url) : undefined;
    const label = text(button.text, 160);
    if (href && label) links.push({ rel: "cta", href, label });
  }

  return links.length > 0 ? links : undefined;
}

function publicBusiness(profile: Me3SiteProfile): Me3PublicProfile["business"] {
  const source = profile.business;
  if (!source) return undefined;
  const business = {
    ...(text(source.positioningStatement, 320)
      ? { positioningStatement: text(source.positioningStatement, 320) }
      : {}),
    ...(text(source.audience, 160) ? { audience: text(source.audience, 160) } : {}),
    ...(text(source.primaryProblem, 160)
      ? { primaryProblem: text(source.primaryProblem, 160) }
      : {}),
    ...(text(source.solution, 240) ? { solution: text(source.solution, 240) } : {}),
    ...(text(source.targetMarket, 160)
      ? { targetMarket: text(source.targetMarket, 160) }
      : {}),
    ...(text(source.primaryOutcome, 240)
      ? { primaryOutcome: text(source.primaryOutcome, 240) }
      : {}),
  };
  return Object.keys(business).length > 0 ? business : undefined;
}

function publicLocation(profile: Me3SiteProfile): Me3LocationData | undefined {
  const source = profile.locationData;
  if (!source || typeof source !== "object") return undefined;
  const label = text(source.label, 160) || text(profile.location, 160);
  const latitude = source.latitude;
  const longitude = source.longitude;
  const precision = text(source.precision, 20) as Me3LocationData["precision"] | undefined;
  if (
    !label ||
    typeof latitude !== "number" ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    typeof longitude !== "number" ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    !precision ||
    !LOCATION_PRECISIONS.has(precision)
  ) {
    return undefined;
  }

  const countryCode = text(source.countryCode, 2)?.toUpperCase();
  return {
    label,
    latitude,
    longitude,
    precision,
    ...(text(source.locality, 160) ? { locality: text(source.locality, 160) } : {}),
    ...(text(source.region, 160) ? { region: text(source.region, 160) } : {}),
    ...(text(source.country, 160) ? { country: text(source.country, 160) } : {}),
    ...(countryCode && /^[A-Z]{2}$/.test(countryCode) ? { countryCode } : {}),
  };
}

function bookingServices(profile: Me3SiteProfile): Me3Service[] {
  const book = profile.intents?.book;
  if (!book?.enabled) return [];

  const offers = [
    ...(book.offers || []),
    ...(book.bookingTypes || []).flatMap((type) => [
      ...(type.offers || []),
      ...(type.classes || []),
      ...(type.retreats || []),
    ]),
  ];
  const services = new Map<string, Me3Service>();

  for (const offer of offers) {
    const sourceId = id(offer.id || offer.title);
    const title = text(offer.title, 160);
    if (!sourceId || !title) continue;
    const serviceId = `service:${sourceId}`;
    const price = serviceMoney(offer.pricing);
    services.set(serviceId, {
      id: serviceId,
      title,
      ...(text(offer.description, 1000)
        ? { description: text(offer.description, 1000) }
        : {}),
      ...(typeof offer.duration === "number" && offer.duration > 0
        ? { durationMinutes: offer.duration }
        : {}),
      ...(price ? { price } : {}),
      availability: book.url ? "external" : "calendar",
      status: "active",
    });
  }

  if (services.size === 0 && (book.title || book.duration)) {
    const fallbackId = "service:book-session";
    const price = serviceMoney(book.pricing);
    services.set(fallbackId, {
      id: fallbackId,
      title: text(book.title, 160) || "Book a session",
      ...(text(book.description, 1000)
        ? { description: text(book.description, 1000) }
        : {}),
      ...(typeof book.duration === "number" && book.duration > 0
        ? { durationMinutes: book.duration }
        : {}),
      ...(price ? { price } : {}),
      availability: book.url ? "external" : "calendar",
      status: "active",
    });
  }

  return Array.from(services.values());
}

export function buildPublicMe3Profile(
  source: Me3SiteProfile,
  siteOrigin?: string,
): Me3Profile {
  const origin = publicOrigin(siteOrigin);
  const profileName = text(source.name, 100) || text(source.handle, 100) || "ME3 owner";
  if (source.visibility === "private") {
    const privateProfile: Me3Profile = {
      $schema: ME3_SCHEMA_URL,
      version: ME3_VERSION,
      kind: "person",
      visibility: "private",
      name: profileName,
      ...(id(source.handle) ? { handle: id(source.handle) } : {}),
      ...(publicAsset(source.avatar) ? { avatar: publicAsset(source.avatar) } : {}),
      ...(publicAsset(source.banner) ? { banner: publicAsset(source.banner) } : {}),
    };
    const result = validateProfile(privateProfile);
    if (!result.valid || !result.profile) {
      throw new Error(`Invalid private me.json projection: ${JSON.stringify(result.errors)}`);
    }
    return result.profile;
  }

  const sectionPaths = resolveSiteSectionPaths(source);
  const services = bookingServices(source);
  const products = (source.products || [])
    .filter((product) => product.slug && product.title)
    .map((product) => ({
      id: id(product.slug, "product:") || "product:unknown",
      title: text(product.title, 160) || product.slug || "Product",
      ...(text(product.excerpt, 1000) ? { description: text(product.excerpt, 1000) } : {}),
      url: `./${sectionPaths.shop}/${product.slug}.html`,
      price: productMoney(product.price, product.currency),
      ...(typeof product.available === "boolean" ? { available: product.available } : {}),
    }));

  const actions: Record<string, Me3ActionDefinition> = {};
  const capabilities: NonNullable<Me3PublicProfile["capabilities"]> = {};

  if (origin && source.intents?.subscribe?.enabled) {
    actions.subscribe = {
      type: "link",
      url: `${origin}/#newsletter`,
      ...(text(source.intents.subscribe.description, 1000)
        ? { description: text(source.intents.subscribe.description, 1000) }
        : {}),
    };
    capabilities.subscribe = {
      action: "subscribe",
      ...(text(source.intents.subscribe.title, 160)
        ? { title: text(source.intents.subscribe.title, 160) }
        : {}),
    };
  }

  if (origin && source.intents?.book?.enabled) {
    const external = source.intents.book.url
      ? legacyLinkHref("booking", source.intents.book.url)
      : undefined;
    actions.book = {
      type: "link",
      url: external?.startsWith("https://") ? external : `${origin}/#booking`,
      ...(text(source.intents.book.description, 1000)
        ? { description: text(source.intents.book.description, 1000) }
        : {}),
    };
    capabilities.book = {
      action: "book",
      ...(text(source.intents.book.title, 160)
        ? { title: text(source.intents.book.title, 160) }
        : {}),
      ...(services.length > 0
        ? { offeringIds: services.map((service) => service.id) }
        : {}),
    };
  }

  if (origin && products.length > 0) {
    actions.purchase = {
      type: "link",
      url: `${origin}/${sectionPaths.shop}/`,
      description: "Open the public products and checkout flow.",
    };
    capabilities.purchase = {
      action: "purchase",
      offeringIds: products.map((product) => product.id),
    };
  }

  const profile: Me3PublicProfile = {
    $schema: ME3_SCHEMA_URL,
    version: ME3_VERSION,
    kind: "person",
    visibility: "public",
    name: profileName,
    ...(origin ? { id: `${origin}/me.json`, url: `${origin}/` } : {}),
    ...(id(source.handle) ? { handle: id(source.handle) } : {}),
    ...(text(source.bio, 500) ? { bio: text(source.bio, 500) } : {}),
    ...(publicAsset(source.avatar) ? { avatar: publicAsset(source.avatar) } : {}),
    ...(publicAsset(source.banner) ? { banner: publicAsset(source.banner) } : {}),
    ...(text(source.location, 160) ? { location: text(source.location, 160) } : {}),
    ...(publicLocation(source) ? { locationData: publicLocation(source) } : {}),
    ...(publicLinks(source) ? { links: publicLinks(source) } : {}),
    ...(source.pages?.some((page) => page.visible !== false && page.slug && page.title)
      ? {
          pages: source.pages
            .filter((page) => page.visible !== false && page.slug && page.title)
            .map((page) => ({
              id: id(page.slug) || "page",
              title: text(page.title, 160) || page.slug || "Page",
              url: `./${page.slug}.html`,
            })),
        }
      : {}),
    ...(source.posts?.some((post) => !post.draft && post.slug && post.title)
      ? {
          posts: source.posts
            .filter((post) => !post.draft && post.slug && post.title)
            .map((post) => ({
              id: id(post.slug) || "post",
              title: text(post.title, 160) || post.slug || "Post",
              url: `./${sectionPaths.blog}/${post.slug}.html`,
              ...(post.type && ["article", "note", "video", "audio", "image", "link"].includes(post.type)
                ? { type: post.type as NonNullable<Me3PublicProfile["posts"]>[number]["type"] }
                : {}),
              ...(post.media?.url && publicAsset(post.media.url)
                ? {
                    media: {
                      url: publicAsset(post.media.url)!,
                      ...(typeof post.media.duration === "number" && post.media.duration >= 0
                        ? { durationSeconds: post.media.duration }
                        : {}),
                      ...(publicAsset(post.media.thumbnail)
                        ? { thumbnail: publicAsset(post.media.thumbnail) }
                        : {}),
                    },
                  }
                : {}),
              ...(text(post.publishedAt, 80) ? { publishedAt: text(post.publishedAt, 80) } : {}),
              ...(text(post.excerpt, 500) ? { excerpt: text(post.excerpt, 500) } : {}),
            })),
        }
      : {}),
    ...(products.length > 0 ? { products } : {}),
    ...(publicBusiness(source) ? { business: publicBusiness(source) } : {}),
    ...(services.length > 0 ? { services } : {}),
    ...(Object.keys(actions).length > 0 ? { actions } : {}),
    ...(Object.keys(capabilities).length > 0 ? { capabilities } : {}),
  };

  const result = validateProfile(profile);
  if (!result.valid || !result.profile) {
    throw new Error(`Invalid public me.json: ${JSON.stringify(result.errors)}`);
  }
  return result.profile;
}
