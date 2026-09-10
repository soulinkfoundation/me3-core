import { discoveryLinks, publicSiteUrl, jsonLd, applyImageMetadata, type SiteImageMetadata } from "@me3-core/site-renderer";
import {
  LANDING_PAGE_DESIGN_PACK_IDS,
  getDefaultLandingPageDesignPackId,
  getLandingPageDesignPack,
  landingPageDesignPackSupportsPurpose,
  normalizeLandingPageDesignPackId,
  type LandingPageDesignPackId,
} from "./design-packs";
import {
  businessSitePageHref,
  type BusinessSiteDocumentV1,
} from "./business-sites";

export {
  BUSINESS_SITE_DOCUMENT_VERSION,
  businessSitePageHref,
  createBusinessSiteDocument,
  normalizeBusinessSiteDocument,
  normalizeBusinessSitePath,
  normalizeBusinessSiteSlug,
  type BusinessSiteDocumentV1,
  type BusinessSiteLink,
  type BusinessSiteNavigationItem,
} from "./business-sites";

export {
  LANDING_PAGE_DESIGN_PACK_IDS,
  LANDING_PAGE_DESIGN_PACKS,
  getDefaultLandingPageDesignPackId,
  getLandingPageDesignPack,
  getSelectableLandingPageDesignPacks,
  isLandingPageDesignPackId,
  landingPageDesignPackSupportsPurpose,
  normalizeLandingPageDesignPackId,
  type LandingPageDesignPackDefinition,
  type LandingPageDesignPackId,
} from "./design-packs";

export const LANDING_PAGES_PLUGIN_ID = "me3.landing-pages";
export const LANDING_PAGES_PLUGIN_VERSION = "0.2.0";
export const AGENT_LANDING_PAGE_SITE_TEMPLATE_ID = "agent-landing-page";

export const LANDING_PAGE_TEMPLATE_IDS = ["event", "service", "waitlist"] as const;
export const LANDING_PAGE_RECIPE_IDS = [
  "service-offer",
  "event-invite",
  "launch-waitlist",
] as const;

export type LandingPageTemplateId = (typeof LANDING_PAGE_TEMPLATE_IDS)[number];
export type LandingPageRecipeId = (typeof LANDING_PAGE_RECIPE_IDS)[number];
export type LandingPageIntent = "event" | "waitlist" | "service";
export type LandingPageThemeId =
  | "quiet-service"
  | "editorial-event"
  | "signal-waitlist";
export const LANDING_PAGE_FONT_PRESET_IDS = [
  "editorial",
  "bold",
  "modern",
] as const;
export type LandingPageFontPreset =
  (typeof LANDING_PAGE_FONT_PRESET_IDS)[number];

export function normalizeLandingPageFontPreset(
  value: unknown,
): LandingPageFontPreset | null {
  return typeof value === "string" &&
    LANDING_PAGE_FONT_PRESET_IDS.includes(value as LandingPageFontPreset)
    ? (value as LandingPageFontPreset)
    : null;
}

export const LANDING_PAGES_RUNTIME = {
  id: LANDING_PAGES_PLUGIN_ID,
  packageName: "@me3-core/plugin-landing-pages",
  bundled: true,
  runtimeStatus: "landing_pages_runtime",
  documentVersions: [1, 2, 3],
  templateIds: LANDING_PAGE_TEMPLATE_IDS,
  recipeIds: LANDING_PAGE_RECIPE_IDS,
  designPackIds: LANDING_PAGE_DESIGN_PACK_IDS,
  routes: [
    "/api/sites/:username/landing-page",
    "/api/sites/:username/pages",
    "/api/agent/landing-pages/generate",
  ],
  notes: [
    "Core bundles landing-page schema, recipe metadata, draft generation, and HTML rendering through a first-party plugin package.",
    "Worker routes keep owner auth, site lookup, persistence, and publish responsibilities.",
    "Hosted ME3 should keep hosted-only Pro gates, domains, and quota behavior outside this package boundary.",
  ],
} as const;

export type SiteType = "profile" | "landing_page";

export type LandingPageSection =
  | {
      type: "text";
      heading: string;
      body: string;
    }
  | {
      type: "list";
      heading: string;
      items: string[];
    }
  | {
      type: "steps";
      heading: string;
      items: string[];
    }
  | {
      type: "pricing";
      heading: string;
      tiers: Array<{
        name: string;
        price: string;
        note?: string;
      }>;
    }
  | {
      type: "faq";
      heading: string;
      items: Array<{
        question: string;
        answer: string;
      }>;
    }
  | {
      type: "signup";
      heading: string;
      body: string;
      buttonLabel: string;
      placeholder?: string;
    }
  | {
      type: "countdown";
      heading: string;
      label: string;
      launchDate: string;
    }
  | {
      type: "profile";
      heading: string;
      body: string;
      profileName?: string;
      profileRole?: string;
      profileImage?: string | null;
      profileLink?: string | null;
    }
  | {
      type: "image";
      heading: string;
      image: string;
      caption?: string;
    }
  | {
      type: "links";
      heading: string;
      items: Array<{
        label: string;
        href: string;
      }>;
    };

export interface LandingPageDocumentV1 {
  version: 1;
  template: LandingPageTemplateId;
  title: string;
  brief: string;
  meta: {
    description: string;
    ogImage?: string | null;
  };
  hero: {
    eyebrow?: string;
    headline: string;
    subheadline: string;
    image?: string | null;
    cta: {
      label: string;
      href: string;
    };
  };
  sections: LandingPageSection[];
  footer: {
    cta?: {
      label: string;
      href: string;
    };
    note?: string;
    profileLink?: string | null;
  };
  style: {
    vibe: "warm" | "natural" | "retro" | "tech" | "minimal" | "me3";
    accentColor: string;
  };
  updatedAt?: string;
}

export type LandingPageCta = {
  label: string;
  href: string;
  style?: "primary" | "secondary";
};

export type LandingPageV2Section =
  | {
      id: string;
      type: "story";
      heading: string;
      body: string;
    }
  | {
      id: string;
      type: "feature-list";
      heading: string;
      body?: string;
      items: Array<{ title: string; body: string }>;
    }
  | {
      id: string;
      type: "details";
      heading: string;
      items: Array<{ label: string; value: string; note?: string }>;
    }
  | {
      id: string;
      type: "steps";
      heading: string;
      items: Array<{ title: string; body: string }>;
    }
  | {
      id: string;
      type: "signup";
      heading: string;
      body: string;
      buttonLabel: string;
      placeholder?: string;
    }
  | {
      id: string;
      type: "profile";
      heading: string;
      body: string;
      profileName?: string;
      profileRole?: string;
      profileImage?: string | null;
      profileLink?: string | null;
    }
  | {
      id: string;
      type: "faq";
      heading: string;
      items: Array<{ question: string; answer: string }>;
    }
  | {
      id: string;
      type: "final-cta";
      heading: string;
      body: string;
      cta: LandingPageCta;
    };

export interface LandingPageDocumentV2 {
  version: 2;
  intent: {
    type: LandingPageIntent;
    audience: string;
    goal: string;
    offerName: string;
  };
  recipe: {
    id: LandingPageRecipeId;
    template: LandingPageTemplateId;
    name: string;
  };
  brief: string;
  seo: {
    title: string;
    description: string;
    socialImage?: string | null;
  };
  hero: {
    headline: string;
    subheadline: string;
    image?: string | null;
    cta: LandingPageCta;
    secondaryCta?: LandingPageCta;
    metadata?: Array<{ label: string; value: string }>;
  };
  content: {
    sections: LandingPageV2Section[];
  };
  design: {
    theme: LandingPageThemeId;
    accentColor: string;
    backgroundColor: string;
    textColor: string;
  };
  assets: {
    heroImage?: string | null;
    sectionImage?: string | null;
  };
  publish: {
    status: "draft" | "published";
  };
  updatedAt?: string;
}

export type LandingPageActionKind =
  | "link"
  | "subscribe"
  | "booking"
  | "product";

export type LandingPageAction = {
  id: string;
  kind: LandingPageActionKind;
  label: string;
  href?: string;
  resourceId?: string;
};

export type LandingPageV3Section =
  | Exclude<LandingPageV2Section, { type: "signup" | "final-cta" }>
  | {
      id: string;
      type: "action";
      heading: string;
      body: string;
      actionId: string;
    }
  | {
      id: string;
      type: "image-text";
      heading: string;
      body: string;
      image: string;
      imageAlt: string;
      imagePosition?: "left" | "right";
    }
  | {
      id: string;
      type: "testimonials";
      heading: string;
      items: Array<{ quote: string; name: string; role?: string }>;
    }
  | {
      id: string;
      type: "team";
      heading: string;
      body?: string;
      items: Array<{
        name: string;
        role: string;
        bio: string;
        image?: string | null;
      }>;
    }
  | {
      id: string;
      type: "pricing";
      heading: string;
      body?: string;
      items: Array<{
        name: string;
        price: string;
        description: string;
        features: string[];
        actionId?: string;
      }>;
    }
  | {
      id: string;
      type: "logo-row";
      heading: string;
      items: Array<{ name: string; image?: string | null; href?: string }>;
    }
  | {
      id: string;
      type: "collection";
      heading: string;
      body?: string;
      items: Array<{
        title: string;
        body: string;
        href?: string;
        image?: string | null;
        label?: string;
      }>;
    }
  | {
      id: string;
      type: "legal";
      heading: string;
      body: string;
    };

export interface LandingPageDocumentV3 {
  event?: LandingPageEvent;
  version: 3;
  intent: LandingPageDocumentV2["intent"];
  recipe: LandingPageDocumentV2["recipe"];
  brief: string;
  seo: LandingPageDocumentV2["seo"];
  hero: {
    headline: string;
    subheadline: string;
    image?: string | null;
    imageLayout?: "split" | "background";
    showActions?: boolean;
    primaryActionId: string;
    secondaryActionId?: string;
    metadata?: Array<{ label: string; value: string }>;
  };
  content: {
    sections: LandingPageV3Section[];
  };
  actions: LandingPageAction[];
  design: LandingPageDocumentV2["design"] & {
    /** Missing on older v3 documents, which intentionally retain the legacy renderer. */
    packId?: LandingPageDesignPackId;
    packVersion?: 1;
    customization?: {
      accentColor?: string;
      backgroundColor?: string;
      textColor?: string;
      fontPreset?: LandingPageFontPreset;
    };
  };
  assets: LandingPageDocumentV2["assets"] & {
    heroImageAttribution?: LandingPageImageAttribution | null;
  };
  updatedAt?: string;
}

export type LandingPageImageAttribution = {
  provider: "pexels";
  photographer: string;
  photographerUrl: string;
  sourceUrl: string;
};

export type LandingPageDocument =
  | LandingPageDocumentV1
  | LandingPageDocumentV2
  | LandingPageDocumentV3;

export interface LandingPageTemplateDefinition {
  id: LandingPageTemplateId;
  name: string;
  shortName: string;
  description: string;
  audience: string;
  defaultCta: string;
}

export interface LandingPageRecipeDefinition {
  id: LandingPageRecipeId;
  template: LandingPageTemplateId;
  name: string;
  shortName: string;
  intent: LandingPageIntent;
  description: string;
  bestFor: string;
  defaultCta: string;
  theme: LandingPageThemeId;
  requiredFields: string[];
  sectionOrder: Array<LandingPageV2Section["type"] | LandingPageV3Section["type"]>;
  defaultAction: LandingPageActionKind;
  qualityChecks: string[];
  sourceNotes: string[];
}

export interface LandingPageCreationPurpose {
  id: LandingPageRecipeId;
  template: LandingPageTemplateId;
  label: string;
  description: string;
  examplePrompt: string;
  defaultSlugSuffix: string;
}

export interface LandingPageProfileInput {
  name: string | null;
  bio: string | null;
  avatar: string | null;
  profileUrl: string | null;
}

export interface LandingPageBuildInput {
  username: string;
  brief: string;
  template: LandingPageTemplateId;
  designPackId?: LandingPageDesignPackId | null;
  heroImage?: string | null;
  heroImageAttribution?: LandingPageImageAttribution | null;
  sectionImage?: string | null;
  feedback?: string | null;
  profile: LandingPageProfileInput;
}

export const LANDING_PAGE_TEMPLATES: LandingPageTemplateDefinition[] = [
  {
    id: "event",
    name: "Event / Workshop / Retreat",
    shortName: "Event",
    description:
      "For time-bound events with a clear date, location, logistics, and booking CTA.",
    audience: "Retreats, workshops, group events",
    defaultCta: "Reserve Your Spot",
  },
  {
    id: "service",
    name: "Service / Offer",
    shortName: "Service",
    description:
      "For focused offer pages that explain a problem, solution, process, and pricing.",
    audience: "Coaching, packages, consulting offers",
    defaultCta: "Book a Call",
  },
  {
    id: "waitlist",
    name: "Waitlist / Coming Soon",
    shortName: "Waitlist",
    description:
      "For launch pages that build anticipation and collect email signups before release.",
    audience: "Courses, launches, products, podcasts",
    defaultCta: "Join the Waitlist",
  },
];

export const LANDING_PAGE_RECIPES: LandingPageRecipeDefinition[] = [
  {
    id: "service-offer",
    template: "service",
    name: "Service Offer",
    shortName: "Service",
    intent: "service",
    description:
      "A focused offer page that explains the outcome, fit, process, and next step.",
    bestFor: "Coaching, consulting, creative services, packages, and focused offers.",
    defaultCta: "Book a Call",
    defaultAction: "booking",
    theme: "quiet-service",
    requiredFields: ["offer name", "audience", "outcome", "process", "primary CTA"],
    sectionOrder: ["story", "feature-list", "steps", "profile", "faq", "action"],
    qualityChecks: [
      "The outcome and ideal customer are clear in the first screen.",
      "The process feels specific enough to trust.",
      "The primary action is repeated after the offer is explained.",
    ],
    sourceNotes: [
      "Built from ME3-owned service-page patterns and shared design tokens.",
      "No third-party template code or image assets are copied into the package.",
    ],
  },
  {
    id: "event-invite",
    template: "event",
    name: "Event Invitation",
    shortName: "Event",
    intent: "event",
    description:
      "A warm invitation page for workshops, retreats, ceremonies, launches, and intimate gatherings.",
    bestFor: "Events with a date, setting, story, logistics, and a clear RSVP or booking action.",
    defaultCta: "Reserve Your Spot",
    defaultAction: "booking",
    theme: "editorial-event",
    requiredFields: ["event name", "audience", "date or timing", "location", "primary CTA"],
    sectionOrder: ["story", "details", "feature-list", "steps", "profile", "faq", "final-cta"],
    qualityChecks: [
      "The date, time, location, and CTA are visible without hunting.",
      "The invitation explains who should attend and why now.",
      "The final CTA repeats the exact action from the hero.",
    ],
    sourceNotes: [
      "Inspired by the local wedding screenshot's spacious invitation rhythm and the MIT template bundle's section density.",
      "No third-party template code or image assets are copied into the package.",
    ],
  },
  {
    id: "launch-waitlist",
    template: "waitlist",
    name: "Launch Waitlist",
    shortName: "Waitlist",
    intent: "waitlist",
    description:
      "A focused launch page that explains what is coming, who it helps, and why joining early matters.",
    bestFor: "Courses, products, communities, apps, newsletters, and pre-launch offers.",
    defaultCta: "Join the Waitlist",
    defaultAction: "subscribe",
    theme: "signal-waitlist",
    requiredFields: ["launch name", "audience", "promise", "why now", "email CTA"],
    sectionOrder: ["story", "feature-list", "steps", "signup", "profile", "faq", "final-cta"],
    qualityChecks: [
      "The promise is specific enough to remember after one read.",
      "The page gives early subscribers a clear reason to join now.",
      "The signup section appears before the page feels complete.",
    ],
    sourceNotes: [
      "Inspired by dark, high-contrast SaaS reference patterns in the local MIT template bundle and Giga style notes.",
      "No third-party template code or image assets are copied into the package.",
    ],
  },
];

export const LANDING_PAGE_CREATION_PURPOSES: LandingPageCreationPurpose[] = [
  {
    id: "service-offer",
    template: "service",
    label: "Service or offer",
    description: "Explain a focused offer and lead people to a booking or purchase.",
    examplePrompt:
      "A four-week positioning sprint for independent consultants who need a clearer offer, stronger sales page, and a practical launch plan.",
    defaultSlugSuffix: "offer",
  },
  {
    id: "event-invite",
    template: "event",
    label: "Event or workshop",
    description: "Invite people to a dated experience with details, agenda, and RSVP.",
    examplePrompt:
      "A Saturday breathwork workshop in Dublin for founders who want to reset before a product launch. Include timing, venue, who it is for, and why the room will be small.",
    defaultSlugSuffix: "event",
  },
  {
    id: "launch-waitlist",
    template: "waitlist",
    label: "Waitlist or launch",
    description: "Collect early interest for a product, course, community, or newsletter.",
    examplePrompt:
      "A waitlist for a private AI workflow studio for coaches. It helps them turn client notes into follow-up emails, resources, and booking prompts.",
    defaultSlugSuffix: "waitlist",
  },
];

const LANDING_PAGE_TEMPLATE_ID_SET = new Set<string>(LANDING_PAGE_TEMPLATE_IDS);
const LANDING_PAGE_RECIPE_ID_SET = new Set<string>(LANDING_PAGE_RECIPE_IDS);

export function isLandingPageTemplateId(
  value: unknown,
): value is LandingPageTemplateId {
  return (
    typeof value === "string" && LANDING_PAGE_TEMPLATE_ID_SET.has(value)
  );
}

export function normalizeLandingTemplate(
  value: unknown,
): LandingPageTemplateId | null {
  return isLandingPageTemplateId(value) ? value : null;
}

export function isLandingPageRecipeId(
  value: unknown,
): value is LandingPageRecipeId {
  return typeof value === "string" && LANDING_PAGE_RECIPE_ID_SET.has(value);
}

export function normalizeLandingRecipe(
  value: unknown,
): LandingPageRecipeId | null {
  return isLandingPageRecipeId(value) ? value : null;
}

export function getLandingPageTemplate(
  templateId: LandingPageTemplateId,
): LandingPageTemplateDefinition {
  return (
    LANDING_PAGE_TEMPLATES.find((template) => template.id === templateId) ||
    LANDING_PAGE_TEMPLATES[1]
  );
}

export function getLandingPageRecipe(
  recipeId: LandingPageRecipeId,
): LandingPageRecipeDefinition {
  return (
    LANDING_PAGE_RECIPES.find((recipe) => recipe.id === recipeId) ||
    LANDING_PAGE_RECIPES[0]
  );
}

export function getLandingPageRecipesForTemplate(
  templateId: LandingPageTemplateId,
): LandingPageRecipeDefinition[] {
  return LANDING_PAGE_RECIPES.filter((recipe) => recipe.template === templateId);
}

export function getDefaultLandingPageRecipe(
  templateId: LandingPageTemplateId,
): LandingPageRecipeDefinition | null {
  return getLandingPageRecipesForTemplate(templateId)[0] || null;
}

export function normalizeLandingPageDocument(
  value: unknown,
): LandingPageDocument | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as
    | Partial<LandingPageDocumentV1>
    | Partial<LandingPageDocumentV2>
    | Partial<LandingPageDocumentV3>;

  if (raw.version === 3) {
    const page = raw as Partial<LandingPageDocumentV3>;
    if (page.event !== undefined && !validLandingPageEvent(page.event)) return null;
    const designPackId = normalizeLandingPageDesignPackId(page.design?.packId);
    const hasDesignPackId = page.design?.packId !== undefined;
    const hasDesignPackVersion = page.design?.packVersion !== undefined;
    const customization = page.design?.customization;
    if (
      !page.intent ||
      !page.recipe ||
      !normalizeLandingTemplate(page.recipe.template) ||
      !normalizeLandingRecipe(page.recipe.id) ||
      typeof page.brief !== "string" ||
      !page.seo ||
      !page.hero ||
      typeof page.hero.primaryActionId !== "string" ||
      !page.content ||
      !Array.isArray(page.content.sections) ||
      !Array.isArray(page.actions) ||
      !page.design ||
      !page.assets
    ) {
      return null;
    }
    if (
      (page.hero.imageLayout !== undefined &&
        !["split", "background"].includes(page.hero.imageLayout)) ||
      (page.hero.showActions !== undefined &&
        typeof page.hero.showActions !== "boolean") ||
      hasDesignPackId !== hasDesignPackVersion ||
      (page.design.packId !== undefined && !designPackId) ||
      (page.design.packVersion !== undefined && page.design.packVersion !== 1) ||
      (designPackId &&
        !landingPageDesignPackSupportsPurpose(
          designPackId,
          page.recipe.template,
        )) ||
      (customization !== undefined &&
        (!customization ||
          typeof customization !== "object" ||
          (customization.accentColor !== undefined &&
            !isLandingPageCustomizationColor(customization.accentColor)) ||
          (customization.backgroundColor !== undefined &&
            !isLandingPageCustomizationColor(customization.backgroundColor)) ||
          (customization.textColor !== undefined &&
            !isLandingPageCustomizationColor(customization.textColor)) ||
          (customization.fontPreset !== undefined &&
            !normalizeLandingPageFontPreset(customization.fontPreset))))
    ) {
      return null;
    }
    const actionIds = new Set(
      page.actions
        .filter(
          (action): action is LandingPageAction =>
            !!action &&
            typeof action.id === "string" &&
            typeof action.label === "string" &&
            ["link", "subscribe", "booking", "product"].includes(action.kind),
        )
        .map((action) => action.id),
    );
    if (
      actionIds.size !== page.actions.length ||
      !actionIds.has(page.hero.primaryActionId)
    ) {
      return null;
    }
    return page as LandingPageDocumentV3;
  }

  if (raw.version === 2) {
    if (
      !raw.intent ||
      !raw.recipe ||
      !normalizeLandingTemplate(raw.recipe.template) ||
      !normalizeLandingRecipe(raw.recipe.id) ||
      typeof raw.brief !== "string" ||
      !raw.seo ||
      !raw.hero ||
      !raw.content ||
      !Array.isArray(raw.content.sections) ||
      !raw.design ||
      !raw.assets ||
      !raw.publish
    ) {
      return null;
    }
    return raw as LandingPageDocumentV2;
  }

  const page = value as Partial<LandingPageDocumentV1>;
  if (
    page.version !== 1 ||
    !normalizeLandingTemplate(page.template) ||
    typeof page.title !== "string" ||
    typeof page.brief !== "string" ||
    !page.hero ||
    !Array.isArray(page.sections)
  ) {
    return null;
  }
  return page as LandingPageDocumentV1;
}

export function getLandingPageTemplateId(
  page: LandingPageDocument,
): LandingPageTemplateId {
  return page.version === 1 ? page.template : page.recipe.template;
}

export function getLandingPageDesignPackId(
  page: LandingPageDocument,
): LandingPageDesignPackId {
  if (page.version !== 3) return "legacy-standard";
  return normalizeLandingPageDesignPackId(page.design.packId) || "legacy-standard";
}

export function setLandingPageDesignPack(
  page: LandingPageDocumentV3,
  designPackId: LandingPageDesignPackId,
): LandingPageDocumentV3 {
  if (!landingPageDesignPackSupportsPurpose(designPackId, page.intent.type)) {
    throw new Error(
      `${getLandingPageDesignPack(designPackId).name} does not support ${page.intent.type} pages.`,
    );
  }
  return {
    ...page,
    design: {
      ...page.design,
      packId: designPackId,
      packVersion: getLandingPageDesignPack(designPackId).version,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function getLandingPageBrief(page: LandingPageDocument): string {
  return page.brief;
}

export function getLandingPageTitle(page: LandingPageDocument): string {
  return page.version === 1 ? page.title : page.seo.title;
}

export function getLandingPageDescription(page: LandingPageDocument): string {
  return page.version === 1 ? page.meta.description : page.seo.description;
}

export function getLandingPageHero(
  page: LandingPageDocument,
): LandingPageDocumentV1["hero"] {
  if (page.version !== 3) return page.hero;
  const action = page.actions.find(
    (candidate) => candidate.id === page.hero.primaryActionId,
  );
  return {
    headline: page.hero.headline,
    subheadline: page.hero.subheadline,
    image: page.hero.image,
    cta: {
      label: action?.label || "Learn more",
      href: action?.kind === "link" ? action.href || "#" : `#${page.hero.primaryActionId}`,
    },
  };
}

export function getLandingPageSections(
  page: LandingPageDocument,
): LandingPageSection[] {
  if (page.version === 1) return page.sections;
  return page.content.sections.flatMap((section): LandingPageSection[] => {
    if (section.type === "action") {
      return [{ type: "text", heading: section.heading, body: section.body }];
    }
    if (section.type === "story") {
      return [{ type: "text", heading: section.heading, body: section.body }];
    }
    if (section.type === "feature-list") {
      return [
        {
          type: "list",
          heading: section.heading,
          items: section.items.map((item) => `${item.title}: ${item.body}`),
        },
      ];
    }
    if (section.type === "details") {
      return [
        {
          type: "list",
          heading: section.heading,
          items: section.items.map((item) =>
            [item.label, item.value, item.note].filter(Boolean).join(": "),
          ),
        },
      ];
    }
    if (section.type === "steps") {
      return [
        {
          type: "steps",
          heading: section.heading,
          items: section.items.map((item) => `${item.title}: ${item.body}`),
        },
      ];
    }
    if (section.type === "signup") {
      return [
        {
          type: "signup",
          heading: section.heading,
          body: section.body,
          buttonLabel: section.buttonLabel,
          placeholder: section.placeholder,
        },
      ];
    }
    if (section.type === "profile") {
      return [
        {
          type: "profile",
          heading: section.heading,
          body: section.body,
          profileName: section.profileName,
          profileRole: section.profileRole,
          profileImage: section.profileImage,
          profileLink: section.profileLink,
        },
      ];
    }
    if (section.type === "faq") {
      return [
        {
          type: "faq",
          heading: section.heading,
          items: section.items,
        },
      ];
    }
    if (section.type === "testimonials") {
      return [{
        type: "list",
        heading: section.heading,
        items: section.items.map((item) => `${item.quote} — ${item.name}`),
      }];
    }
    if (section.type === "team") {
      return [{
        type: "list",
        heading: section.heading,
        items: section.items.map((item) => `${item.name}, ${item.role}: ${item.bio}`),
      }];
    }
    if (section.type === "pricing") {
      return [{
        type: "list",
        heading: section.heading,
        items: section.items.map((item) => `${item.name} — ${item.price}: ${item.description}`),
      }];
    }
    if (section.type === "logo-row") {
      return [{
        type: "list",
        heading: section.heading,
        items: section.items.map((item) => item.name),
      }];
    }
    if (section.type === "collection") {
      return [{
        type: "list",
        heading: section.heading,
        items: section.items.map((item) => `${item.title}: ${item.body}`),
      }];
    }
    if (section.type === "image-text") {
      return [{
        type: "image",
        heading: section.heading,
        image: section.image,
        caption: section.body,
      }];
    }
    if (section.type === "legal") {
      return [{ type: "text", heading: section.heading, body: section.body }];
    }
    return [{ type: "text", heading: section.heading, body: section.body }];
  });
}

export function getLandingPageSectionImage(
  page: LandingPageDocument | null,
): string | null {
  if (!page) return null;
  if (page.version !== 1) return page.assets.sectionImage || null;
  const imageSection = page.sections.find(
    (section): section is Extract<LandingPageSection, { type: "image" }> =>
      section.type === "image",
  );
  return imageSection?.image || null;
}

export function getLandingPageActions(
  page: LandingPageDocument,
): LandingPageAction[] {
  return page.version === 3 ? page.actions : upgradeLandingPageDocument(page).actions;
}

export function getLandingPageValidationErrors(
  page: LandingPageDocumentV3,
): string[] {
  const errors: string[] = [];
  if (page.event !== undefined && !validLandingPageEvent(page.event)) errors.push("Add valid event dates with a timezone and a location. The end must follow the start.");
  const actionIds = new Set(page.actions.map((action) => action.id));
  if (!page.seo.title.trim()) errors.push("Add a page title.");
  if (!page.seo.description.trim()) errors.push("Add a page description.");
  if (!page.hero.headline.trim()) errors.push("Add a headline.");
  if (!actionIds.has(page.hero.primaryActionId)) {
    errors.push("Choose a valid primary action.");
  }
  for (const action of page.actions) {
    if (!action.id.trim() || !action.label.trim()) {
      errors.push("Every action needs an ID and label.");
    }
    if (action.kind === "link" && !action.href?.trim()) {
      errors.push(`Add a destination for ${action.label || "the link action"}.`);
    }
    if (
      (action.kind === "booking" || action.kind === "product") &&
      !action.resourceId?.trim()
    ) {
      errors.push(`Choose a ${action.kind} for ${action.label || "the action"}.`);
    }
  }
  for (const section of page.content.sections) {
    if (section.type === "action" && !actionIds.has(section.actionId)) {
      errors.push(`Section ${section.heading || section.id} has a missing action.`);
    }
  }
  return [...new Set(errors)];
}

export function upgradeLandingPageDocument(
  page: LandingPageDocument,
): LandingPageDocumentV3 {
  if (page.version === 3) return page;
  const template = getLandingPageTemplateId(page);
  const recipe = getDefaultLandingPageRecipe(template) || LANDING_PAGE_RECIPES[0];
  const legacyHero = getLandingPageHero(page);
  const legacyHref = legacyHero.cta.href;
  const primaryAction: LandingPageAction =
    template === "waitlist"
      ? { id: "primary-action", kind: "subscribe", label: legacyHero.cta.label }
      : {
          id: "primary-action",
          kind: "link",
          label: legacyHero.cta.label,
          href: legacyHref && !legacyHref.startsWith("#") ? legacyHref : "#contact",
        };
  const sections: LandingPageV3Section[] = getLandingPageSections(page).flatMap(
    (section, index): LandingPageV3Section[] => {
      const id = `section-${index + 1}`;
      if (section.type === "text") {
        return [{ id, type: "story", heading: section.heading, body: section.body }];
      }
      if (section.type === "list") {
        return [
          {
            id,
            type: "feature-list",
            heading: section.heading,
            items: section.items.map((item) => ({ title: item, body: "" })),
          },
        ];
      }
      if (section.type === "steps") {
        return [
          {
            id,
            type: "steps",
            heading: section.heading,
            items: section.items.map((item) => ({ title: item, body: "" })),
          },
        ];
      }
      if (section.type === "profile") {
        return [{ id, ...section }];
      }
      if (section.type === "faq") {
        return [{ id, ...section }];
      }
      if (section.type === "signup") {
        return [
          {
            id,
            type: "action",
            heading: section.heading,
            body: section.body,
            actionId: primaryAction.id,
          },
        ];
      }
      return [];
    },
  );
  if (!sections.some((section) => section.type === "action")) {
    sections.push({
      id: "action",
      type: "action",
      heading: template === "waitlist" ? "Join the list" : "Ready for the next step?",
      body: "Take the next step when you are ready.",
      actionId: primaryAction.id,
    });
  }
  return {
    version: 3,
    intent: {
      type: template,
      audience: page.version === 2 ? page.intent.audience : "",
      goal: page.version === 2 ? page.intent.goal : getLandingPageDescription(page),
      offerName: getLandingPageTitle(page),
    },
    recipe: {
      id: recipe.id,
      template,
      name: recipe.name,
    },
    brief: page.brief,
    seo: {
      title: getLandingPageTitle(page),
      description: getLandingPageDescription(page),
      socialImage:
        page.version === 2 ? page.seo.socialImage : page.meta.ogImage || null,
    },
    hero: {
      headline: legacyHero.headline,
      subheadline: legacyHero.subheadline,
      image: legacyHero.image || null,
      primaryActionId: primaryAction.id,
      metadata: page.version === 2 ? page.hero.metadata : undefined,
    },
    content: { sections },
    actions: [primaryAction],
    design:
      page.version === 2
        ? page.design
        : {
            theme:
              template === "event"
                ? "editorial-event"
                : template === "waitlist"
                  ? "signal-waitlist"
                  : "quiet-service",
            accentColor: page.style.accentColor,
            backgroundColor: template === "waitlist" ? "#101312" : "#f8f1eb",
            textColor: template === "waitlist" ? "#f7fbf7" : "#233d35",
          },
    assets: {
      heroImage: legacyHero.image || null,
      sectionImage: getLandingPageSectionImage(page),
    },
    updatedAt: page.updatedAt || new Date().toISOString(),
  };
}

export function buildLandingPageDocument(
  input: LandingPageBuildInput,
): LandingPageDocument {
  const recipe = getDefaultLandingPageRecipe(input.template) || LANDING_PAGE_RECIPES[0];
  return buildLandingPageDocumentV3(input, recipe);
}

function buildLandingPageDocumentV3(
  input: LandingPageBuildInput,
  recipe: LandingPageRecipeDefinition,
): LandingPageDocumentV3 {
  const combined = [input.brief, input.feedback || ""].filter(Boolean).join("\n\n");
  const title = extractLandingTitle(combined, recipe.template);
  const description =
    firstSentence(combined) ||
    (recipe.intent === "event"
      ? "A thoughtful event for the people this invitation was made for."
      : recipe.intent === "waitlist"
        ? "A focused launch for people who want to hear first."
        : "A focused offer for people ready to make meaningful progress.");
  const ctaLabel = extractCta(input.feedback) || recipe.defaultCta;
  const items = deriveLandingItems(combined);
  const profileName = input.profile.name || input.username;
  const requestedDesignPackId = normalizeLandingPageDesignPackId(
    input.designPackId,
  );
  const designPackId =
    requestedDesignPackId &&
    landingPageDesignPackSupportsPurpose(requestedDesignPackId, recipe.intent)
      ? requestedDesignPackId
      : getDefaultLandingPageDesignPackId(recipe.intent);
  const primaryAction: LandingPageAction = {
    id: "primary-action",
    kind: recipe.defaultAction,
    label: ctaLabel,
  };
  const commonSections: LandingPageV3Section[] = [
    {
      id: "story",
      type: "story",
      heading:
        recipe.intent === "service"
          ? "The outcome"
          : recipe.intent === "event"
            ? "Why this gathering matters"
            : "The promise",
      body: description,
    },
    {
      id: "highlights",
      type: "feature-list",
      heading:
        recipe.intent === "service"
          ? "What is included"
          : recipe.intent === "event"
            ? "What to expect"
            : "Why join early",
      items: items.map((item, index) => ({
        title:
          recipe.intent === "service"
            ? ["Clarity", "A practical plan", "Focused support"][index] || `Part ${index + 1}`
            : recipe.intent === "event"
              ? eventFeatureTitle(index)
              : waitlistFeatureTitle(index),
        body: item,
      })),
    },
    {
      id: "steps",
      type: "steps",
      heading:
        recipe.intent === "service"
          ? "How we work"
          : recipe.intent === "event"
            ? "A simple rhythm"
            : "How the launch unfolds",
      items:
        recipe.intent === "service"
          ? [
              { title: "Start with the real need", body: "Clarify the outcome, constraints, and best next move." },
              { title: "Do the focused work", body: "Move through a practical process without unnecessary ceremony." },
              { title: "Leave with momentum", body: "Finish with clear decisions and an executable next step." },
            ]
          : recipe.intent === "event"
            ? [
                { title: "Arrive", body: "Settle in and get oriented to the room." },
                { title: "Experience", body: "Move through the main session, workshop, or gathering." },
                { title: "Continue", body: "Take the next step while the momentum is fresh." },
              ]
            : [
                { title: "Join the private list", body: "Leave your email for the first invitation." },
                { title: "Get the preview", body: "Receive the early details before the public launch." },
                { title: "Choose when it opens", body: "Decide whether the first release is right for you." },
              ],
    },
  ];

  if (recipe.intent === "event") {
    commonSections.splice(1, 0, {
      id: "details",
      type: "details",
      heading: "Event details",
      items: [
        { label: "When", value: extractEventDetail(combined, "when") },
        { label: "Where", value: extractEventDetail(combined, "where") },
        { label: "For", value: "People this invitation was made for" },
      ],
    });
  }

  commonSections.push(
    {
      id: "profile",
      type: "profile",
      heading: recipe.intent === "event" ? "Hosted by" : "From the person behind it",
      body: landingPageProfileBio(input.profile.bio),
      profileName,
      profileImage: input.profile.avatar,
      profileLink: input.profile.profileUrl,
    },
    {
      id: "questions",
      type: "faq",
      heading: "Good to know",
      items: [
        {
          question: "Who is this for?",
          answer: "It is for the people who recognize the need and outcome described on this page.",
        },
        {
          question: "What happens next?",
          answer: `Use the ${ctaLabel} action and follow the next step shown here.`,
        },
      ],
    },
    {
      id: "action",
      type: "action",
      heading:
        recipe.intent === "waitlist"
          ? "Be first to hear"
          : recipe.intent === "event"
            ? "Save your place"
            : "Ready to take the next step?",
      body:
        recipe.intent === "waitlist"
          ? "Join the list and hear when the first invitation is ready."
          : "Choose the next step that feels right for you.",
      actionId: primaryAction.id,
    },
  );

  return {
    version: 3,
    intent: {
      type: recipe.intent,
      audience:
        recipe.intent === "waitlist"
          ? "Early supporters"
          : recipe.intent === "event"
            ? "Invited guests"
            : "People who need this outcome",
      goal:
        recipe.intent === "waitlist"
          ? "Collect qualified early interest."
          : recipe.intent === "event"
            ? "Help the right people understand the event and reserve a place."
            : "Help the right people understand the offer and take the next step.",
      offerName: title,
    },
    recipe: { id: recipe.id, template: recipe.template, name: recipe.name },
    brief: input.brief.trim(),
    seo: { title, description, socialImage: input.heroImage || null },
    hero: {
      headline: title,
      subheadline: description,
      image: input.heroImage || null,
      primaryActionId: primaryAction.id,
      metadata:
        recipe.intent === "event"
          ? [
              { label: "When", value: extractEventDetail(combined, "when") },
              { label: "Where", value: extractEventDetail(combined, "where") },
            ]
          : undefined,
    },
    content: { sections: commonSections },
    actions: [primaryAction],
    design: {
      theme: recipe.theme,
      packId: designPackId,
      packVersion: getLandingPageDesignPack(designPackId).version,
      accentColor:
        recipe.intent === "waitlist"
          ? "#49de80"
          : recipe.intent === "event"
            ? "#f2664a"
            : "#0f766e",
      backgroundColor: recipe.intent === "waitlist" ? "#101312" : "#f8f1eb",
      textColor: recipe.intent === "waitlist" ? "#f7fbf7" : "#233d35",
    },
    assets: {
      heroImage: input.heroImage || null,
      heroImageAttribution: input.heroImageAttribution || null,
      sectionImage: input.sectionImage || null,
    },
    updatedAt: new Date().toISOString(),
  };
}

/** @deprecated Existing v2 drafts are supported for migration only. */
export function buildLandingPageDocumentV2(
  input: LandingPageBuildInput,
  recipe: LandingPageRecipeDefinition,
): LandingPageDocumentV2 {
  const combined = [input.brief, input.feedback || ""].filter(Boolean).join("\n\n");
  const title = extractLandingTitle(combined, recipe.template);
  const description =
    firstSentence(combined) ||
    (recipe.intent === "event"
      ? "A thoughtful event invitation built with ME3."
      : "A focused launch waitlist built with ME3.");
  const ctaLabel = extractCta(input.feedback) || recipe.defaultCta;
  const items = deriveLandingItems(combined);
  const profileName = input.profile.name || input.username;
  const now = new Date().toISOString();

  if (recipe.id === "launch-waitlist") {
    return {
      version: 2,
      intent: {
        type: "waitlist",
        audience: "Early supporters",
        goal: "Collect qualified early interest before launch.",
        offerName: title,
      },
      recipe: {
        id: recipe.id,
        template: recipe.template,
        name: recipe.name,
      },
      brief: input.brief.trim(),
      seo: {
        title,
        description,
        socialImage: input.heroImage || null,
      },
      hero: {
        headline: title,
        subheadline: description,
        image: input.heroImage || null,
        cta: { label: ctaLabel, href: "#signup", style: "primary" },
        secondaryCta: { label: "See what is coming", href: "#inside", style: "secondary" },
        metadata: [
          { label: "Status", value: "Opening soon" },
          { label: "Best for", value: recipe.bestFor },
        ],
      },
      content: {
        sections: [
          {
            id: "inside",
            type: "story",
            heading: "The promise",
            body: description,
          },
          {
            id: "why-join",
            type: "feature-list",
            heading: "Why join early",
            body: "Give people a concrete reason to raise their hand before the public launch.",
            items: items.map((item, index) => ({
              title: waitlistFeatureTitle(index),
              body: item,
            })),
          },
          {
            id: "timeline",
            type: "steps",
            heading: "How the launch unfolds",
            items: [
              {
                title: "Join the private list",
                body: "Leave an email so the first invitation lands in the right place.",
              },
              {
                title: "Get the preview",
                body: "Receive the behind-the-scenes update, early offer, or founding-member details.",
              },
              {
                title: "Choose when it opens",
                body: "Decide whether the first release is right for you before it goes wider.",
              },
            ],
          },
          {
            id: "signup",
            type: "signup",
            heading: "Get the first invitation",
            body: "Join the waitlist and hear when the first spots open.",
            buttonLabel: ctaLabel,
            placeholder: "you@example.com",
          },
          {
            id: "maker",
            type: "profile",
            heading: "From the person building it",
            body: landingPageProfileBio(input.profile.bio),
            profileName,
            profileImage: input.profile.avatar,
            profileLink: input.profile.profileUrl,
          },
          {
            id: "questions",
            type: "faq",
            heading: "Good to know",
            items: [
              {
                question: "What happens after I join?",
                answer: "You will get the earliest update when the first release or invitation is ready.",
              },
              {
                question: "Is joining a commitment?",
                answer: "No. It only means you want first look access before the public launch.",
              },
            ],
          },
          {
            id: "final",
            type: "final-cta",
            heading: "Be first in line",
            body: "The clearest next step is small: leave your email and watch for the first invitation.",
            cta: { label: ctaLabel, href: "#signup", style: "primary" },
          },
        ],
      },
      design: {
        theme: recipe.theme,
        accentColor: "#49de80",
        backgroundColor: "#101312",
        textColor: "#f7fbf7",
      },
      assets: {
        heroImage: input.heroImage || null,
        sectionImage: input.sectionImage || null,
      },
      publish: { status: "draft" },
      updatedAt: now,
    };
  }

  return {
    version: 2,
    intent: {
      type: "event",
      audience: "Invited guests",
      goal: "Help the right people understand the event and RSVP.",
      offerName: title,
    },
    recipe: {
      id: recipe.id,
      template: recipe.template,
      name: recipe.name,
    },
    brief: input.brief.trim(),
    seo: {
      title,
      description,
      socialImage: input.heroImage || null,
    },
    hero: {
      headline: title,
      subheadline: description,
      image: input.heroImage || null,
      cta: { label: ctaLabel, href: "#details", style: "primary" },
      secondaryCta: { label: "Read the invitation", href: "#story", style: "secondary" },
      metadata: [
        { label: "Format", value: "In person or online" },
        { label: "Action", value: ctaLabel },
      ],
    },
    content: {
      sections: [
        {
          id: "story",
          type: "story",
          heading: "Why this gathering matters",
          body: description,
        },
        {
          id: "details",
          type: "details",
          heading: "Event details",
          items: [
            { label: "When", value: extractEventDetail(combined, "when") },
            { label: "Where", value: extractEventDetail(combined, "where") },
            { label: "For", value: "People this invitation was made for" },
          ],
        },
        {
          id: "highlights",
          type: "feature-list",
          heading: "What guests can expect",
          items: items.map((item, index) => ({
            title: eventFeatureTitle(index),
            body: item,
          })),
        },
        {
          id: "agenda",
          type: "steps",
          heading: "A simple rhythm",
          items: [
            { title: "Arrive", body: "Settle in and get oriented to the room." },
            { title: "Experience", body: "Move through the main session, workshop, or ceremony." },
            { title: "Leave with clarity", body: "Take the next step while the momentum is still fresh." },
          ],
        },
        {
          id: "host",
          type: "profile",
          heading: "Hosted by",
          body: landingPageProfileBio(input.profile.bio),
          profileName,
          profileImage: input.profile.avatar,
          profileLink: input.profile.profileUrl,
        },
        {
          id: "questions",
          type: "faq",
          heading: "Before you RSVP",
          items: [
            {
              question: "Who is this for?",
              answer: "It is for the people named in the invitation and anyone who recognizes the promise in the page.",
            },
            {
              question: "What should I do next?",
              answer: `Use the ${ctaLabel} button and follow the details from the host.`,
            },
          ],
        },
        {
          id: "final",
          type: "final-cta",
          heading: "Save your place",
          body: "If this feels like the right room, take the next step now.",
          cta: { label: ctaLabel, href: "#details", style: "primary" },
        },
      ],
    },
    design: {
      theme: recipe.theme,
      accentColor: "#f2664a",
      backgroundColor: "#f8f1eb",
      textColor: "#233d35",
    },
    assets: {
      heroImage: input.heroImage || null,
      sectionImage: input.sectionImage || null,
    },
    publish: { status: "draft" },
    updatedAt: now,
  };
}

export function renderLandingPageHtml(page: LandingPageDocument, username: string, context: LandingPageRenderContext = {}): string {
  let renderedPage = page;
  if (page.version === 3 && page.event && validLandingPageEvent(page.event)) {
    const event = page.event;
    const formatDate = (value: string) => new Intl.DateTimeFormat("en-IE", { dateStyle: "long", timeStyle: "short", timeZone: event.timezone || "UTC" }).format(new Date(value)) + ` ${event.timezone || "UTC"}`;
    const facts = [
      { label: "When", value: `${formatDate(event.startDate)}${event.endDate ? ` – ${formatDate(event.endDate)}` : ""}` },
      { label: "Where", value: event.location.type === "online" ? `Online · ${event.location.url}` : `${event.location.name} · ${event.location.address}` },
    ];
    const mergeFacts = (items: Array<{ label: string; value: string }>) => [...facts, ...items.filter(item => !["when", "where"].includes(item.label.toLowerCase()))];
    const sections: LandingPageV3Section[] = page.content.sections.map(section => section.type === "details" ? { ...section, items: mergeFacts(section.items) } : section);
    if (!sections.some(section => section.type === "details")) sections.unshift({ id: "event-details", type: "details", heading: "Event details", items: facts });
    renderedPage = { ...page, hero: { ...page.hero, metadata: mergeFacts(page.hero.metadata || []) }, content: { ...page.content, sections } };
  }
  const html = renderLandingPageDocumentHtml(renderedPage, username, context);
  const base = context.siteBaseUrl || (context.canonicalUrl ? new URL(context.canonicalUrl).origin : undefined);
  const profileUrl = publicSiteUrl(base, "me.json") || `${context.siteBasePath || ""}/me.json`;
  let metadata = discoveryLinks(profileUrl) + '<meta name="twitter:card" content="summary_large_image">';
  if (context.canonicalUrl && !html.includes('rel="canonical"')) metadata += `<link rel="canonical" href="${escapeHtml(context.canonicalUrl)}"><meta property="og:url" content="${escapeHtml(context.canonicalUrl)}">`;
  if (context.businessSite && !html.includes('"@type":"Organization"')) metadata += renderBusinessSiteOrganizationSchema(context.businessSite, context.canonicalUrl, context);
  if (page.version === 3 && page.event && validLandingPageEvent(page.event)) {
    const event = page.event;
    metadata += jsonLd({ "@context": "https://schema.org", "@type": "Event", name: page.hero.headline,
      description: page.hero.subheadline, startDate: event.startDate, ...(event.endDate ? { endDate: event.endDate } : {}),
      ...(context.canonicalUrl ? { url: context.canonicalUrl } : {}),
      ...(page.hero.image && publicSiteUrl(base, page.hero.image) ? { image: publicSiteUrl(base, page.hero.image) } : {}),
      eventAttendanceMode: `https://schema.org/${event.location.type === "online" ? "OnlineEventAttendanceMode" : "OfflineEventAttendanceMode"}`,
      location: event.location.type === "online" ? { "@type": "VirtualLocation", url: event.location.url } : { "@type": "Place", name: event.location.name, address: event.location.address },
      ...(context.businessSite ? { organizer: { "@type": "Organization", name: context.businessSite.name, url: publicSiteUrl(base) } } : {}),
    });

  }
  return applyImageMetadata(html.replace('</head>', `${metadata}</head>`), context.images || {}, { baseUrl: base, pagePath: context.canonicalUrl || (context.slug ? `${context.slug}/index.html` : "index.html"), sizes: "(max-width: 900px) 100vw, 1200px" });
}

export type LandingPageEvent = {
  /** ISO 8601 date-time including UTC offset; never inferred from prose. */
  startDate: string;
  endDate?: string;
  timezone?: string;
  location: { type: "online"; url: string } | { type: "place"; name: string; address: string };
};

function validLandingPageEvent(value: unknown): value is LandingPageEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as LandingPageEvent;
  const date = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s));
  if (!date(event.startDate) || (event.endDate !== undefined && (!date(event.endDate) || Date.parse(event.endDate) < Date.parse(event.startDate)))) return false;
  if (event.timezone !== undefined) {
    if (typeof event.timezone !== "string") return false;
    try { new Intl.DateTimeFormat("en", { timeZone: event.timezone }); } catch { return false; }
  }
  const validDay = (value: string) => {
    const [year, month, day] = value.slice(0, 10).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === value.slice(0, 10);
  };
  if (!validDay(event.startDate) || (event.endDate && !validDay(event.endDate))) return false;
  const location = event.location;
  if (!location) return false;
  if (location.type === "online") return typeof location.url === "string" && !!publicSiteUrl(location.url);
  return location.type === "place" && typeof location.name === "string" && !!location.name.trim() && typeof location.address === "string" && !!location.address.trim();
}

function renderLandingPageDocumentHtml(
  page: LandingPageDocument,
  username: string,
  context: LandingPageRenderContext = {},
): string {
  if (page.version === 3) {
    const designPackId = getLandingPageDesignPackId(page);
    if (designPackId !== "legacy-standard") {
      return renderStarterLandingPageHtml(
        page,
        username,
        context,
        designPackId,
      );
    }
    return renderLegacyLandingPageHtmlV3(page, username, context);
  }
  if (page.version === 2) return renderLandingPageHtmlV2(page, username);
  return renderLandingPageHtmlV1(page, username);
}

export type LandingPageRenderContext = {
  pageId?: string;
  slug?: string;
  campaign?: string;
  actionUsername?: string;
  bookingPaymentMethods?: Record<string, "free" | "stripe" | "manual">;
  productPaymentMethods?: Record<string, "stripe" | "manual">;
  businessSite?: BusinessSiteDocumentV1;
  canonicalUrl?: string;
  siteBasePath?: string;
  siteBaseUrl?: string;
  images?: SiteImageMetadata;
};

function renderLegacyLandingPageHtmlV3(
  page: LandingPageDocumentV3,
  username: string,
  context: LandingPageRenderContext,
): string {
  const theme = getThemeTokens(page);
  const actionUsername = context.actionUsername || username;
  const primaryAction =
    page.actions.find((action) => action.id === page.hero.primaryActionId) ||
    page.actions[0];
  const secondaryAction = page.hero.secondaryActionId
    ? page.actions.find((action) => action.id === page.hero.secondaryActionId)
    : null;
  const actionHref = (action: LandingPageAction | null | undefined) =>
    action?.kind === "link" ? action.href || "#" : action ? `#action-${action.id}` : "#main";
  const heroImage = page.hero.image || page.assets.sectionImage;
  const heroVisual = heroImage
    ? `<img src="${escapeHtml(heroImage)}" alt="" loading="eager" decoding="async" fetchpriority="high">`
    : renderGeneratedVisual(page);
  const metadata = (page.hero.metadata || [])
    .map(
      (item) =>
        `<div class="meta-item"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`,
    )
    .join("");
  const actions = new Map(page.actions.map((action) => [action.id, action]));
  const sections = page.content.sections
    .map((section) =>
      section.type === "action"
        ? renderLandingActionSection(
            section,
            actions.get(section.actionId),
            actionUsername,
            context,
          )
        : renderLegacyV3Section(section),
    )
    .join("");
  const socialImage = page.seo.socialImage
    ? `<meta property="og:image" content="${escapeHtml(publicSiteUrl(context.siteBaseUrl, resolveBusinessSiteAsset(context, page.seo.socialImage)) || resolveBusinessSiteAsset(context, page.seo.socialImage))}">`
    : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(page.seo.title)}</title><meta name="description" content="${escapeHtml(page.seo.description)}"><meta property="og:title" content="${escapeHtml(page.seo.title)}"><meta property="og:description" content="${escapeHtml(page.seo.description)}">${socialImage}<style>${renderLandingPageCssV2(theme)}${renderActionCss()}</style></head><body data-theme="${escapeHtml(page.design.theme)}"><a href="#main" class="skip-link">Skip to content</a><header class="site-top"><div class="shell site-top-inner"><strong>${escapeHtml(username)}</strong>${primaryAction ? `<a class="top-action" href="${escapeHtml(actionHref(primaryAction))}">${escapeHtml(primaryAction.label)}</a>` : ""}</div></header><main id="main"><section class="hero"><div class="shell hero-grid"><div class="hero-copy">${metadata ? `<div class="meta-grid">${metadata}</div>` : ""}<h1>${escapeHtml(page.hero.headline)}</h1><p>${escapeHtml(page.hero.subheadline)}</p><div class="hero-actions">${primaryAction ? `<a class="button primary" href="${escapeHtml(actionHref(primaryAction))}">${escapeHtml(primaryAction.label)}</a>` : ""}${secondaryAction ? `<a class="button secondary" href="${escapeHtml(actionHref(secondaryAction))}">${escapeHtml(secondaryAction.label)}</a>` : ""}</div></div><div class="hero-visual">${heroVisual}</div></div></section>${sections}</main><script>${landingActionScript()}</script></body></html>`;
}

function renderLegacyV3Section(
  section: Exclude<LandingPageV3Section, { type: "action" }>,
): string {
  if (
    section.type === "story" ||
    section.type === "feature-list" ||
    section.type === "details" ||
    section.type === "steps" ||
    section.type === "profile" ||
    section.type === "faq"
  ) {
    return renderLandingSectionV2(section);
  }
  const summary =
    "body" in section && typeof section.body === "string"
      ? section.body
      : "items" in section
        ? `${section.items.length} items`
        : "";
  return `<section id="${escapeHtml(section.id)}" class="section"><div class="shell"><h2>${escapeHtml(section.heading)}</h2>${summary ? `<p>${escapeHtml(summary)}</p>` : ""}</div></section>`;
}

function renderStarterLandingPageHtml(
  page: LandingPageDocumentV3,
  username: string,
  context: LandingPageRenderContext,
  designPackId: LandingPageDesignPackId,
): string {
  const actionUsername = context.actionUsername || username;
  const actions = new Map(page.actions.map((action) => [action.id, action]));
  const primaryAction =
    actions.get(page.hero.primaryActionId) || page.actions[0] || null;
  const secondaryAction = page.hero.secondaryActionId
    ? actions.get(page.hero.secondaryActionId) || null
    : null;
  const actionHref = (action: LandingPageAction | null) =>
    action?.kind === "link"
      ? resolveBusinessSiteHref(context, action.href || "#")
      : action
        ? `#action-${action.id}`
        : "#main";
  const firstSection = page.content.sections[0]?.id || "main";
  const metadata = (page.hero.metadata || [])
    .map(
      (item) =>
        `<div><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`,
    )
    .join("");
  const heroImage = page.hero.image || page.assets.heroImage || page.assets.sectionImage;
  const backgroundHero = page.hero.imageLayout === "background" && !!heroImage;
  const showHeroActions = page.hero.showActions !== false;
  const sections = page.content.sections
    .map((section, index) =>
      renderStarterLandingPageSection(
        section,
        index,
        actions,
        actionUsername,
        context,
      ),
    )
    .join("");
  const socialImage = page.seo.socialImage
    ? `<meta property="og:image" content="${escapeHtml(publicSiteUrl(context.siteBaseUrl, resolveBusinessSiteAsset(context, page.seo.socialImage)) || resolveBusinessSiteAsset(context, page.seo.socialImage))}">`
    : "";
  const pack = getLandingPageDesignPack(designPackId);
  const canonical = context.canonicalUrl
    ? `<link rel="canonical" href="${escapeHtml(context.canonicalUrl)}"><meta property="og:url" content="${escapeHtml(context.canonicalUrl)}">`
    : "";
  const robots = context.businessSite?.seo.indexing === "noindex"
    ? `<meta name="robots" content="noindex,nofollow">`
    : "";
  const organizationSchema = context.businessSite
    ? renderBusinessSiteOrganizationSchema(context.businessSite, context.canonicalUrl, context)
    : "";
  const announcement =
    designPackId === "starter-service-01"
      ? `<div class="pack-announcement" aria-hidden="true"><span>Clear offer · useful work · decisive next step · </span><span>Clear offer · useful work · decisive next step · </span></div>`
      : "";
  const header = context.businessSite
    ? renderBusinessSiteHeader(context.businessSite, primaryAction, actionHref, context)
    : `<header class="pack-header shell"><a class="pack-brand" href="#">${escapeHtml(username)}</a><nav aria-label="Page navigation"><a href="#${escapeHtml(firstSection)}">Explore</a>${primaryAction ? `<a class="pack-nav-action" href="${escapeHtml(actionHref(primaryAction))}">${escapeHtml(primaryAction.label)}</a>` : ""}</nav></header>`;
  const footer = context.businessSite
    ? renderBusinessSiteFooter(context.businessSite, context)
    : `<footer class="pack-footer"><div class="shell"><span>${escapeHtml(username)}</span><span>Built with ME3</span></div></footer>`;
  const heroActions = showHeroActions
    ? `<div class="pack-hero-actions">${primaryAction ? `<a class="button primary" href="${escapeHtml(actionHref(primaryAction))}">${escapeHtml(primaryAction.label)}</a>` : ""}${secondaryAction ? `<a class="button secondary" href="${escapeHtml(actionHref(secondaryAction))}">${escapeHtml(secondaryAction.label)}</a>` : ""}</div>`
    : "";
  const hero = backgroundHero
    ? `<header class="pack-hero pack-hero-background"><figure class="pack-hero-media" aria-hidden="true"><img src="${escapeHtml(resolveBusinessSiteAsset(context, heroImage))}" alt="" loading="eager" decoding="async" fetchpriority="high"></figure><div class="shell pack-hero-grid"><div class="pack-hero-copy"><span class="pack-kicker">${escapeHtml(page.intent.audience)}</span><h1>${renderStarterHeadline(page.hero.headline)}</h1><p>${escapeHtml(page.hero.subheadline)}</p>${heroActions}${metadata ? `<div class="pack-meta">${metadata}</div>` : ""}</div></div></header>`
    : `<header class="pack-hero"><div class="shell pack-hero-grid"><div class="pack-hero-copy"><span class="pack-kicker">${escapeHtml(page.intent.audience)}</span><h1>${renderStarterHeadline(page.hero.headline)}</h1><p>${escapeHtml(page.hero.subheadline)}</p>${heroActions}</div><aside class="pack-hero-aside" aria-label="Page highlights">${renderStarterLandingPageVisual(page, designPackId, context)}${metadata ? `<div class="pack-meta">${metadata}</div>` : ""}</aside></div></header>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(page.seo.title)}</title><meta name="description" content="${escapeHtml(page.seo.description)}"><meta property="og:type" content="website"><meta property="og:title" content="${escapeHtml(page.seo.title)}"><meta property="og:description" content="${escapeHtml(page.seo.description)}">${socialImage}${canonical}${robots}${organizationSchema}${starterLandingPageFontLinks(page, designPackId)}<style>${renderStarterLandingPageCss(page, designPackId)}${renderActionCss()}</style></head><body data-theme="${escapeHtml(page.design.theme)}" data-design-pack="${escapeHtml(designPackId)}" data-design-pack-version="${pack.version}" data-hero-layout="${backgroundHero ? "background" : "split"}"${context.businessSite ? " data-business-site" : ""}><a href="#main" class="skip-link">Skip to content</a>${announcement}${header}<main id="main">${hero}${sections}</main>${footer}<script>${landingNavigationScript()}${landingActionScript()}</script></body></html>`;
}

function renderBusinessSiteHeader(
  site: BusinessSiteDocumentV1,
  primaryAction: LandingPageAction | null,
  actionHref: (action: LandingPageAction | null) => string,
  context: LandingPageRenderContext,
): string {
  const items = site.navigation.items
    .filter((item) => item.visible)
    .map((item) => {
      const href = item.pageSlug
        ? businessSitePageHref(site, item.pageSlug)
        : item.href || "#";
      return `<a href="${escapeHtml(resolveBusinessSiteHref(context, href))}">${escapeHtml(item.label)}</a>`;
    })
    .join("");
  const brand = site.organization.logo
    ? `<img src="${escapeHtml(resolveBusinessSiteAsset(context, site.organization.logo))}" alt="${escapeHtml(site.name)}">`
    : escapeHtml(site.name);
  return `<header class="pack-header shell"><a class="pack-brand" href="${escapeHtml(resolveBusinessSiteHref(context, "/"))}">${brand}</a><button class="pack-menu-toggle" type="button" aria-expanded="false" aria-controls="pack-site-navigation" aria-label="Open site menu"><span aria-hidden="true"></span><span aria-hidden="true"></span><span aria-hidden="true"></span></button><nav id="pack-site-navigation" aria-label="Site navigation">${items}${primaryAction ? `<a class="pack-nav-action" href="${escapeHtml(actionHref(primaryAction))}">${escapeHtml(primaryAction.label)}</a>` : ""}</nav></header>`;
}

function renderBusinessSiteFooter(
  site: BusinessSiteDocumentV1,
  context: LandingPageRenderContext,
): string {
  const links = site.footer.links
    .map((link) => `<a href="${escapeHtml(resolveBusinessSiteHref(context, link.href))}">${escapeHtml(link.label)}</a>`)
    .join("");
  return `<footer class="pack-footer"><div class="shell"><div><strong>${escapeHtml(site.name)}</strong>${site.footer.note ? `<p>${escapeHtml(site.footer.note)}</p>` : ""}</div>${links ? `<nav aria-label="Footer navigation">${links}</nav>` : ""}<span>Built with ME3</span></div></footer>`;
}

function resolveBusinessSiteHref(
  context: LandingPageRenderContext,
  href: string,
): string {
  const basePath = context.siteBasePath?.trim().replace(/\/+$/, "");
  if (
    !context.businessSite ||
    !basePath ||
    !href.startsWith("/") ||
    href.startsWith("//") ||
    href === basePath ||
    href.startsWith(`${basePath}/`)
  ) {
    return href;
  }
  return `${basePath}${href}`;
}

function resolveBusinessSiteAsset(
  context: LandingPageRenderContext,
  source: string,
): string {
  if (
    !context.businessSite ||
    /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(source)
  ) {
    return source;
  }
  return resolveBusinessSiteHref(
    context,
    source.startsWith("/") ? source : `/${source}`,
  );
}

function renderBusinessSiteOrganizationSchema(
  site: BusinessSiteDocumentV1,
  canonicalUrl?: string,
  context: LandingPageRenderContext = {},
): string {
  const data = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: site.name,
    ...(site.organization.description ? { description: site.organization.description } : {}),
    ...(site.organization.logo
      ? { logo: resolveBusinessSiteAsset(context, site.organization.logo) }
      : {}),
    ...(site.organization.email ? { email: site.organization.email } : {}),
    ...(site.organization.telephone ? { telephone: site.organization.telephone } : {}),
    ...(site.organization.address ? { address: site.organization.address } : {}),
    ...(context.siteBaseUrl || canonicalUrl ? { url: publicSiteUrl(context.siteBaseUrl || new URL(canonicalUrl!).origin) } : {}),
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

function renderStarterHeadline(headline: string): string {
  const words = headline.trim().split(/\s+/).filter(Boolean);
  const finalWord = words.pop();
  if (!finalWord) return "";
  return `${words.length ? `${escapeHtml(words.join(" "))} ` : ""}<em>${escapeHtml(finalWord)}</em>`;
}

const STARTER_RICH_TEXT_TAGS = new Set([
  "p",
  "strong",
  "em",
  "u",
  "s",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "br",
  "a",
]);

function renderStarterRichTextBody(value: string, className = ""): string {
  if (!/<\/?[a-z][^>]*>/i.test(value)) {
    return `<p${className ? ` class="${className}"` : ""}>${escapeHtml(value)}</p>`;
  }
  const classes = [className, "pack-rich-text"].filter(Boolean).join(" ");
  return `<div class="${classes}">${sanitizeStarterRichText(value)}</div>`;
}

function sanitizeStarterRichText(value: string): string {
  let result = "";
  let cursor = 0;
  while (cursor < value.length) {
    const tagStart = value.indexOf("<", cursor);
    if (tagStart < 0) {
      result += value.slice(cursor);
      break;
    }
    result += value.slice(cursor, tagStart);
    const tagEnd = value.indexOf(">", tagStart + 1);
    if (tagEnd < 0) {
      result += "&lt;";
      cursor = tagStart + 1;
      continue;
    }
    const source = value.slice(tagStart + 1, tagEnd).trim();
    const parsed = source.match(/^(\/)?\s*([a-z0-9-]+)/i);
    if (parsed) {
      const closing = Boolean(parsed[1]);
      const tag = parsed[2].toLowerCase();
      if (STARTER_RICH_TEXT_TAGS.has(tag)) {
        if (closing) {
          if (tag !== "hr" && tag !== "br") result += `</${tag}>`;
        } else if (tag === "a") {
          const hrefMatch = source.match(
            /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
          );
          const href = hrefMatch?.[1] || hrefMatch?.[2] || hrefMatch?.[3] || "#";
          const safeHref = /^(?:https?:|mailto:|tel:|#|\/(?!\/)|\.\.?\/)/i.test(href)
            ? href
            : "#";
          const external = /^https?:\/\//i.test(safeHref)
            ? ' target="_blank" rel="noopener noreferrer"'
            : "";
          result += `<a href="${escapeHtml(safeHref)}"${external}>`;
        } else {
          result += `<${tag}>`;
        }
      }
    }
    cursor = tagEnd + 1;
  }
  return result;
}

function renderStarterLandingPageVisual(
  page: LandingPageDocumentV3,
  designPackId: LandingPageDesignPackId,
  context: LandingPageRenderContext,
): string {
  const image = page.hero.image || page.assets.heroImage || page.assets.sectionImage;
  if (image) {
    return `<figure class="pack-hero-image"><img src="${escapeHtml(resolveBusinessSiteAsset(context, image))}" alt="" loading="eager" decoding="async" fetchpriority="high"></figure>`;
  }
  if (designPackId === "starter-event-01") {
    return `<div class="event-landscape" aria-hidden="true"><span class="event-sun"></span><span class="event-hill event-hill-one"></span><span class="event-hill event-hill-two"></span></div>`;
  }
  if (designPackId === "starter-service-01") {
    return `<div class="service-poster" aria-hidden="true"><span class="service-poster-word">MAKE</span><span class="service-poster-orbit"></span><span class="service-poster-word">IT CLEAR</span><span class="service-poster-note">Useful beats impressive.</span></div>`;
  }
  if (designPackId === "clinical-editorial-01") {
    return `<div class="clinical-field" aria-hidden="true"><span class="clinical-orb"></span><span class="clinical-line clinical-line-one"></span><span class="clinical-line clinical-line-two"></span><strong>${escapeHtml(page.intent.offerName)}</strong></div>`;
  }
  return `<div class="waitlist-orbit" aria-hidden="true"><span class="orbit-ring orbit-ring-one"></span><span class="orbit-ring orbit-ring-two"></span><span class="orbit-ring orbit-ring-three"></span><article><span class="pack-kicker">Signal detected</span><strong>${escapeHtml(page.intent.offerName)}</strong><p>${escapeHtml(page.intent.goal)}</p><div><span>Ready</span><span>Focused</span><span>Early</span></div></article></div>`;
}

function renderStarterLandingPageSection(
  section: LandingPageV3Section,
  index: number,
  actions: Map<string, LandingPageAction>,
  username: string,
  context: LandingPageRenderContext,
): string {
  const sectionNumber = String(index + 1).padStart(2, "0");
  const heading = escapeHtml(section.heading);
  const label = `<span class="pack-section-number">${sectionNumber}</span>`;
  if (section.type === "story") {
    return `<section id="${escapeHtml(section.id)}" class="pack-section pack-story"><div class="shell pack-split">${label}<div><h2>${heading}</h2>${renderStarterRichTextBody(section.body, "pack-lead")}</div></div></section>`;
  }
  if (section.type === "feature-list") {
    return `<section id="${escapeHtml(section.id)}" class="pack-section pack-features"><div class="shell"><header class="pack-section-head">${label}<div><h2>${heading}</h2>${section.body ? `<p>${escapeHtml(section.body)}</p>` : ""}</div></header><div class="pack-card-grid">${section.items.map((item, itemIndex) => `<article><span class="pack-card-number">${String(itemIndex + 1).padStart(2, "0")}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p></article>`).join("")}</div></div></section>`;
  }
  if (section.type === "details") {
    return `<section id="${escapeHtml(section.id)}" class="pack-section pack-details"><div class="shell"><header class="pack-section-head">${label}<h2>${heading}</h2></header><dl>${section.items.map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}</div>`).join("")}</dl></div></section>`;
  }
  if (section.type === "steps") {
    return `<section id="${escapeHtml(section.id)}" class="pack-section pack-steps"><div class="shell"><header class="pack-section-head">${label}<h2>${heading}</h2></header><ol>${section.items.map((item, itemIndex) => `<li><span>${String(itemIndex + 1).padStart(2, "0")}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body)}</p></li>`).join("")}</ol></div></section>`;
  }
  if (section.type === "profile") {
    const profileVisual = section.profileImage
      ? `<img src="${escapeHtml(resolveBusinessSiteAsset(context, section.profileImage))}" alt="${escapeHtml(section.profileName ? `${section.profileName} profile photo` : "Profile photo")}" loading="lazy" decoding="async">`
      : `<span class="pack-profile-shape" aria-hidden="true"></span>`;
    return `<section id="${escapeHtml(section.id)}" class="pack-section pack-profile"><div class="shell pack-profile-grid"><div class="pack-profile-visual">${profileVisual}</div><div>${label}<h2>${heading}</h2>${renderStarterRichTextBody(landingPageProfileBio(section.body), "pack-lead")}${section.profileName ? `<strong class="pack-profile-name">${escapeHtml(section.profileName)}${section.profileRole ? ` · ${escapeHtml(section.profileRole)}` : ""}</strong>` : ""}${section.profileLink ? `<a class="pack-text-link" href="${escapeHtml(resolveBusinessSiteHref(context, section.profileLink))}">Visit profile</a>` : ""}</div></div></section>`;
  }
  if (section.type === "faq") {
    return `<section id="${escapeHtml(section.id)}" class="pack-section pack-faq"><div class="shell pack-split">${label}<div><h2>${heading}</h2><div class="pack-faq-list">${section.items.map((item) => `<details><summary>${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`).join("")}</div></div></div></section>`;
  }
  if (section.type === "image-text") {
    return `<section id="${escapeHtml(section.id)}" class="pack-section pack-image-text"><div class="shell pack-media-grid${section.imagePosition === "right" ? " image-right" : ""}"><figure><img src="${escapeHtml(resolveBusinessSiteAsset(context, section.image))}" alt="${escapeHtml(section.imageAlt)}" loading="lazy" decoding="async"></figure><div>${label}<h2>${heading}</h2>${renderStarterRichTextBody(section.body, "pack-lead")}</div></div></section>`;
  }
  if (section.type === "testimonials") {
    return `<section id="${escapeHtml(section.id)}" class="pack-section pack-testimonials"><div class="shell"><header class="pack-section-head">${label}<h2>${heading}</h2></header><div class="pack-quote-grid">${section.items.map((item) => `<figure><blockquote>${escapeHtml(item.quote)}</blockquote><figcaption>${escapeHtml(item.name)}${item.role ? ` · ${escapeHtml(item.role)}` : ""}</figcaption></figure>`).join("")}</div></div></section>`;
  }
  if (section.type === "team") {
    return `<section id="${escapeHtml(section.id)}" class="pack-section pack-team"><div class="shell"><header class="pack-section-head">${label}<div><h2>${heading}</h2>${section.body ? `<p>${escapeHtml(section.body)}</p>` : ""}</div></header><div class="pack-team-grid">${section.items.map((item) => `<article>${item.image ? `<img src="${escapeHtml(resolveBusinessSiteAsset(context, item.image))}" alt="${escapeHtml(`${item.name} profile photo`)}" loading="lazy" decoding="async">` : ""}<h3>${escapeHtml(item.name)}</h3><strong>${escapeHtml(item.role)}</strong><p>${escapeHtml(item.bio)}</p></article>`).join("")}</div></div></section>`;
  }
  if (section.type === "pricing") {
    return `<section id="${escapeHtml(section.id)}" class="pack-section pack-pricing"><div class="shell"><header class="pack-section-head">${label}<div><h2>${heading}</h2>${section.body ? `<p>${escapeHtml(section.body)}</p>` : ""}</div></header><div class="pack-price-grid">${section.items.map((item) => {
      const itemAction = item.actionId ? actions.get(item.actionId) : undefined;
      const href = itemAction?.kind === "link"
        ? resolveBusinessSiteHref(context, itemAction.href || "#")
        : itemAction
          ? `#action-${itemAction.id}`
          : null;
      return `<article><h3>${escapeHtml(item.name)}</h3><strong class="pack-price">${escapeHtml(item.price)}</strong><p>${escapeHtml(item.description)}</p><ul>${item.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}</ul>${href && itemAction ? `<a class="button secondary" href="${escapeHtml(href)}">${escapeHtml(itemAction.label)}</a>` : ""}</article>`;
    }).join("")}</div></div></section>`;
  }
  if (section.type === "logo-row") {
    return `<section id="${escapeHtml(section.id)}" class="pack-section pack-logos"><div class="shell"><header class="pack-section-head">${label}<h2>${heading}</h2></header><div class="pack-logo-row">${section.items.map((item) => {
      const content = item.image
        ? `<img src="${escapeHtml(resolveBusinessSiteAsset(context, item.image))}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async">`
        : `<strong>${escapeHtml(item.name)}</strong>`;
      return item.href
        ? `<a href="${escapeHtml(resolveBusinessSiteHref(context, item.href))}">${content}</a>`
        : `<span>${content}</span>`;
    }).join("")}</div></div></section>`;
  }
  if (section.type === "collection") {
    return `<section id="${escapeHtml(section.id)}" class="pack-section pack-collection"><div class="shell"><header class="pack-section-head">${label}<div><h2>${heading}</h2>${section.body ? `<p>${escapeHtml(section.body)}</p>` : ""}</div></header><div class="pack-collection-grid">${section.items.map((item) => `<article>${item.image ? `<img src="${escapeHtml(resolveBusinessSiteAsset(context, item.image))}" alt="" loading="lazy" decoding="async">` : ""}${item.label ? `<span class="pack-kicker">${escapeHtml(item.label)}</span>` : ""}<h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p>${item.href ? `<a class="pack-text-link" href="${escapeHtml(resolveBusinessSiteHref(context, item.href))}">Learn more</a>` : ""}</article>`).join("")}</div></div></section>`;
  }
  if (section.type === "legal") {
    return `<section id="${escapeHtml(section.id)}" class="pack-section pack-legal"><div class="shell pack-split">${label}<div><h2>${heading}</h2>${renderStarterRichTextBody(section.body)}</div></div></section>`;
  }
  const action = actions.get(section.actionId);
  const widget = action
    ? renderLandingAction(action, username, context)
    : `<p class="action-error" role="alert">This action is no longer available.</p>`;
  return `<section id="action-${escapeHtml(section.actionId)}" class="pack-section pack-action"><div class="shell pack-action-grid"><div>${label}<h2>${heading}</h2>${renderStarterRichTextBody(section.body)}</div><div class="pack-action-widget">${widget}</div></div></section>`;
}

function starterLandingPageFontLinks(
  page: LandingPageDocumentV3,
  designPackId: LandingPageDesignPackId,
): string {
  const fontPreset = resolveLandingPageFontPreset(page, designPackId);
  const href =
    fontPreset === "editorial"
      ? "https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Newsreader:opsz,wght@6..72,300;6..72,400;6..72,500&display=swap"
      : fontPreset === "bold"
        ? "https://fonts.googleapis.com/css2?family=Archivo+Black&family=IBM+Plex+Mono:wght@400;500&family=Instrument+Serif:ital@0;1&display=swap"
        : "https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&family=Geologica:opsz,wdth,wght@12..72,75..100,300..800&display=swap";
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="${href}" rel="stylesheet">`;
}

function renderStarterLandingPageCss(
  page: LandingPageDocumentV3,
  designPackId: LandingPageDesignPackId,
): string {
  const accent = safeCssColor(
    page.design.customization?.accentColor || page.design.accentColor,
    designPackId === "starter-event-01"
      ? "#b05235"
      : designPackId === "starter-service-01"
        ? "#1847e8"
        : designPackId === "clinical-editorial-01"
          ? "#b66b46"
        : "#d9ff43",
  );
  return `${starterLandingPageBaseCss()}${starterRichTextCss()}${businessSiteShellCss()}${businessSiteOverlayPositionCss()}${
    designPackId === "starter-event-01"
      ? starterEventCss(accent)
      : designPackId === "starter-service-01"
        ? starterServiceCss(accent)
        : designPackId === "clinical-editorial-01"
          ? clinicalEditorialCss(accent)
          : starterWaitlistCss(accent)
  }${designPackId === "clinical-editorial-01" ? naturalEditorialEnhancementCss() : ""}${renderLandingPageCustomizationCss(page, designPackId)}`;
}

function starterRichTextCss(): string {
  return `.pack-rich-text>*:first-child{margin-top:0}.pack-rich-text>*:last-child{margin-bottom:0}.pack-rich-text p{line-height:1.55}.pack-rich-text ul,.pack-rich-text ol{padding-left:1.25em}.pack-rich-text blockquote{margin-left:0;padding-left:18px;border-left:2px solid var(--accent)}.pack-rich-text a{text-decoration-thickness:1px;text-underline-offset:3px}`;
}

function clinicalEditorialCss(accent: string): string {
  return `:root{--bg:#f4f1ea;--surface:#e6ebe5;--text:#18342f;--muted:#536b64;--line:rgba(24,52,47,.2);--accent:${accent};--accent-contrast:${readableTextColor(accent)};--focus:#b66b46;--display-font:"Newsreader",Georgia,serif;--accent-font:"Newsreader",Georgia,serif;--body-font:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--meta-font:"DM Mono",monospace;--shell:1240px;--footer-bg:#18342f;--footer-text:#f4f1ea}.pack-header{min-height:92px}.pack-brand{font-family:var(--display-font);font-size:1.35rem;font-weight:500}.pack-hero-grid{min-height:min(720px,calc(100vh - 92px))}.pack-hero-copy{padding-top:88px;padding-bottom:88px}.pack-hero h1{max-width:11ch;font-size:clamp(4.2rem,8vw,8.2rem);font-weight:350;line-height:.88}.pack-hero h1 em{color:var(--accent);font-style:italic}.clinical-field{position:relative;min-height:520px;overflow:hidden;background:linear-gradient(145deg,#dfe8e1,#f4f1ea)}.clinical-field:before{content:"";position:absolute;inset:8%;border:1px solid var(--line);border-radius:50% 50% 44% 56%}.clinical-orb{position:absolute;width:44%;aspect-ratio:1;left:28%;top:22%;border-radius:50%;background:var(--accent);opacity:.84}.clinical-line{position:absolute;width:70%;height:1px;left:15%;top:50%;background:var(--text);transform-origin:center}.clinical-line-one{transform:rotate(32deg)}.clinical-line-two{transform:rotate(-32deg)}.clinical-field strong{position:absolute;left:32px;bottom:28px;max-width:70%;font-family:var(--display-font);font-size:2rem;font-weight:400}.pack-story,.pack-testimonials{background:#18342f;color:#f4f1ea;--text:#f4f1ea;--muted:rgba(244,241,234,.72);--line:rgba(244,241,234,.22)}.pack-features,.pack-team,.pack-collection{background:#e6ebe5}.pack-image-text{background:#fff}.pack-media-grid{display:grid;grid-template-columns:1fr 1fr;gap:80px;align-items:center}.pack-media-grid.image-right figure{order:2}.pack-media-grid figure{margin:0;min-height:540px}.pack-media-grid img{display:block;width:100%;height:100%;min-height:540px;object-fit:cover}.pack-quote-grid,.pack-team-grid,.pack-price-grid,.pack-collection-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line)}.pack-quote-grid figure,.pack-team-grid article,.pack-price-grid article,.pack-collection-grid article{margin:0;padding:34px;background:var(--bg)}.pack-quote-grid blockquote{margin:0 0 48px;font-family:var(--display-font);font-size:1.65rem;line-height:1.2}.pack-quote-grid figcaption{font-family:var(--meta-font);font-size:.72rem;text-transform:uppercase}.pack-team-grid img,.pack-collection-grid img{width:100%;aspect-ratio:4/3;object-fit:cover;margin-bottom:24px}.pack-team-grid h3,.pack-price-grid h3,.pack-collection-grid h3{font-family:var(--display-font);font-size:2rem;font-weight:400}.pack-team-grid p,.pack-price-grid p,.pack-collection-grid p,.pack-legal p{color:var(--muted);line-height:1.65}.pack-price{display:block;margin:18px 0;font-family:var(--display-font);font-size:2.8rem}.pack-price-grid ul{min-height:130px;padding-left:20px;color:var(--muted)}.pack-logo-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:50px}.pack-logo-row img{display:block;max-width:150px;max-height:54px;filter:grayscale(1)}.pack-footer .shell{align-items:start}.pack-footer p{max-width:520px;margin:.7rem 0 0;color:rgba(244,241,234,.7);text-transform:none;letter-spacing:0}.pack-footer nav{display:flex;flex-wrap:wrap;gap:18px}.pack-footer a{text-decoration:none}@media(max-width:900px){.pack-media-grid{grid-template-columns:1fr;gap:42px}.pack-media-grid.image-right figure{order:0}.pack-quote-grid,.pack-team-grid,.pack-price-grid,.pack-collection-grid{grid-template-columns:1fr 1fr}}@media(max-width:620px){.pack-header nav{max-width:65%;overflow-x:auto}.pack-header nav a:not(.pack-nav-action){display:none}.clinical-field{min-height:380px}.pack-quote-grid,.pack-team-grid,.pack-price-grid,.pack-collection-grid{grid-template-columns:1fr}.pack-media-grid figure,.pack-media-grid img{min-height:360px}}`;
}

function naturalEditorialEnhancementCss(): string {
  return `body[data-design-pack=clinical-editorial-01][data-hero-layout=background]>.pack-header{color:#18342f}body[data-design-pack=clinical-editorial-01][data-hero-layout=background]>.pack-header .pack-brand{font-size:2rem;color:inherit}body[data-design-pack=clinical-editorial-01][data-hero-layout=background]>.pack-header .pack-brand img{filter:brightness(0) invert(1)}body[data-design-pack=clinical-editorial-01] .pack-hero-background .pack-kicker{font-size:.78rem;letter-spacing:.12em}body[data-design-pack=clinical-editorial-01] .pack-hero-background h1{max-width:20ch;margin:18px 0;font-size:clamp(3.3rem,5.4vw,5.7rem);font-weight:350;line-height:1;letter-spacing:-.045em}body[data-design-pack=clinical-editorial-01] .pack-hero-background h1 em{color:inherit}body[data-design-pack=clinical-editorial-01] .pack-hero-background .pack-hero-copy>p{font-family:var(--display-font);font-size:clamp(1.35rem,2.1vw,2rem);line-height:1.2}body[data-design-pack=clinical-editorial-01] .pack-hero-background .button{background:rgba(244,241,234,.78);backdrop-filter:blur(8px)}@media(max-width:900px){body[data-design-pack=clinical-editorial-01] .pack-header #pack-site-navigation{background:#dce7e3}body[data-design-pack=clinical-editorial-01] .pack-hero-background .pack-hero-copy{padding-top:clamp(195px,26vh,245px)}body[data-design-pack=clinical-editorial-01] .pack-hero-background h1{max-width:18ch;font-size:clamp(2.6rem,6.3vw,3.35rem);line-height:1.04}body[data-design-pack=clinical-editorial-01] .pack-hero-background .pack-hero-copy>p{font-size:clamp(1.25rem,3.3vw,1.6rem)}body[data-design-pack=clinical-editorial-01] .pack-hero-background .pack-kicker{font-size:.7rem}}`;
}

function resolveLandingPageFontPreset(
  page: LandingPageDocumentV3,
  designPackId: LandingPageDesignPackId,
): LandingPageFontPreset {
  return (
    normalizeLandingPageFontPreset(page.design.customization?.fontPreset) ||
    (designPackId === "starter-event-01" || designPackId === "clinical-editorial-01"
      ? "editorial"
      : designPackId === "starter-service-01"
        ? "bold"
        : "modern")
  );
}

function renderLandingPageCustomizationCss(
  page: LandingPageDocumentV3,
  designPackId: LandingPageDesignPackId,
): string {
  const customization = page.design.customization;
  if (!customization) return "";
  const declarations: string[] = [];
  const accent = safeCssColor(customization.accentColor, "");
  const background = safeCssColor(customization.backgroundColor, "");
  const text = safeCssColor(customization.textColor, "");
  if (accent) {
    declarations.push(`--accent:${accent}`);
    declarations.push(`--accent-contrast:${readableTextColor(accent)}`);
  }
  if (background) declarations.push(`--bg:${background}`);
  if (text) {
    declarations.push(`--text:${text}`);
    declarations.push(`--muted:color-mix(in srgb,${text} 68%,${background || "var(--bg)"})`);
    declarations.push(`--line:color-mix(in srgb,${text} 24%,transparent)`);
  }

  const fontPreset = resolveLandingPageFontPreset(page, designPackId);
  if (fontPreset === "editorial") {
    declarations.push('--display-font:"Newsreader",Georgia,serif');
    declarations.push('--accent-font:"Newsreader",Georgia,serif');
    declarations.push('--body-font:"Newsreader",Georgia,serif');
    declarations.push('--meta-font:"DM Mono",monospace');
  } else if (fontPreset === "bold") {
    declarations.push('--display-font:"Archivo Black",sans-serif');
    declarations.push('--accent-font:"Instrument Serif",Georgia,serif');
    declarations.push('--body-font:"Instrument Serif",Georgia,serif');
    declarations.push('--meta-font:"IBM Plex Mono",monospace');
  } else {
    declarations.push('--display-font:"Geologica",sans-serif');
    declarations.push('--accent-font:"Geologica",sans-serif');
    declarations.push('--body-font:"Geologica",sans-serif');
    declarations.push('--meta-font:"Fira Code",monospace');
  }
  return declarations.length ? `:root{${declarations.join(";")}}` : "";
}

function readableTextColor(color: string): "#111111" | "#ffffff" {
  const value = color.slice(1);
  if (!/^[0-9a-f]{6}$/i.test(value)) return "#ffffff";
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return (red * 299 + green * 587 + blue * 114) / 1000 > 150
    ? "#111111"
    : "#ffffff";
}

const DEFAULT_LANDING_PAGE_PROFILE_BIO =
  "Add a short bio to introduce the person behind this page.";

function landingPageProfileBio(value: string | null | undefined): string {
  const bio = value?.trim();
  if (!bio) return DEFAULT_LANDING_PAGE_PROFILE_BIO;
  const normalized = bio.replace(/\s+/g, " ");
  if (
    /^Personal AI assistant powered by ME3(?: Core)?\.?$/i.test(normalized) ||
    /^.+ (?:created this page with|is shaping this launch through|is hosting this event through) ME3\.?$/i.test(
      normalized,
    )
  ) {
    return DEFAULT_LANDING_PAGE_PROFILE_BIO;
  }
  return bio;
}

function isLandingPageCustomizationColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value.trim());
}

function starterLandingPageBaseCss(): string {
  return `*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font-family:var(--body-font);font-size:18px}a{color:inherit}button,input,textarea{font:inherit}.shell{width:min(var(--shell,1240px),calc(100% - 48px));margin:0 auto}.skip-link{position:fixed;left:16px;top:-80px;z-index:100;padding:12px 18px;background:var(--accent);color:var(--accent-contrast)}.skip-link:focus{top:16px}.pack-header{display:flex;align-items:center;justify-content:space-between;min-height:82px;border-bottom:1px solid var(--line)}.pack-brand{font-family:var(--display-font);font-weight:700;text-decoration:none}.pack-header nav{display:flex;align-items:center;gap:24px;font-family:var(--meta-font);font-size:.72rem;letter-spacing:.08em;text-transform:uppercase}.pack-header nav a{text-decoration:none}.pack-nav-action{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border:1px solid currentColor}.pack-hero{overflow:hidden;border-bottom:1px solid var(--line)}.pack-hero-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.72fr);min-height:min(780px,calc(100vh - 82px))}.pack-hero-copy{display:flex;flex-direction:column;justify-content:center;padding:70px 64px 70px 0;border-right:1px solid var(--line)}.pack-kicker,.pack-section-number,.pack-card-number,.pack-meta span,.pack-footer,.pack-details dt,.pack-steps li>span{font-family:var(--meta-font);font-size:.7rem;line-height:1.4;letter-spacing:.1em;text-transform:uppercase}.pack-hero h1{max-width:10ch;margin:30px 0;font-family:var(--display-font);font-size:clamp(4.6rem,10vw,10rem);font-weight:400;line-height:.82;letter-spacing:-.07em}.pack-hero h1 em{font-family:var(--accent-font);font-weight:400}.pack-hero-copy>p{max-width:650px;margin:0;color:var(--muted);font-size:clamp(1.15rem,2vw,1.45rem);line-height:1.5}.pack-hero-actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:36px}.button{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 20px;border:1px solid var(--line);text-decoration:none;font-family:var(--meta-font);font-size:.76rem;font-weight:700;letter-spacing:.04em}.button.primary{border-color:var(--accent);background:var(--accent);color:var(--accent-contrast)}.button.secondary{background:transparent;color:var(--text)}.pack-hero-aside{display:grid;grid-template-rows:minmax(320px,1fr) auto;padding:38px 0 42px 38px}.pack-hero-image{min-height:420px;margin:0;overflow:hidden}.pack-hero-image img{width:100%;height:100%;object-fit:cover;display:block}.pack-meta{display:grid;gap:0;margin-top:24px}.pack-meta div{display:flex;justify-content:space-between;gap:18px;padding:12px 0;border-top:1px solid var(--line)}.pack-meta strong{font-weight:600}.pack-section{padding:110px 0;border-bottom:1px solid var(--line)}.pack-split,.pack-section-head{display:grid;grid-template-columns:minmax(100px,.35fr) minmax(0,1.65fr);gap:50px}.pack-section h2{max-width:980px;margin:0 0 34px;font-family:var(--display-font);font-size:clamp(3.2rem,7vw,7rem);font-weight:400;line-height:.9;letter-spacing:-.055em}.pack-lead{max-width:980px;margin:0;color:var(--muted);font-size:clamp(1.7rem,3.6vw,3.7rem);line-height:1.1;letter-spacing:-.025em}.pack-section-head{align-items:start;margin-bottom:54px}.pack-section-head p{max-width:600px;color:var(--muted);line-height:1.55}.pack-card-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid var(--line);border-left:1px solid var(--line)}.pack-card-grid article{min-height:310px;padding:28px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}.pack-card-grid h3{margin:80px 0 16px;font-family:var(--display-font);font-size:clamp(1.6rem,3vw,2.8rem);line-height:1}.pack-card-grid p,.pack-steps p,.pack-faq p,.pack-action p{color:var(--muted);line-height:1.55}.pack-details dl{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:0;border-top:1px solid var(--line);border-left:1px solid var(--line)}.pack-details dl>div{min-height:190px;padding:28px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}.pack-details dd{margin:32px 0 0;font-family:var(--display-font);font-size:clamp(1.6rem,3vw,3rem);line-height:1}.pack-details dl p{color:var(--muted)}.pack-steps ol{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}.pack-steps li{display:grid;grid-template-columns:90px .8fr 1.2fr;gap:36px;align-items:start;padding:30px 0;border-bottom:1px solid var(--line)}.pack-steps li strong{font-family:var(--display-font);font-size:1.6rem}.pack-steps li p{margin:0}.pack-profile-grid{display:grid;grid-template-columns:1fr 1fr;gap:90px;align-items:center}.pack-profile-visual{position:relative;min-height:590px;overflow:hidden;background:var(--surface)}.pack-profile-visual img{width:100%;height:100%;position:absolute;inset:0;object-fit:cover}.pack-profile-shape{position:absolute;width:54%;height:75%;left:23%;bottom:-5%;border-radius:48% 48% 12% 12%;background:var(--accent)}.pack-profile-shape:after{content:"";position:absolute;width:62%;aspect-ratio:1;left:19%;top:-20%;border-radius:48%;background:var(--profile-face,#c18564);box-shadow:-24px -20px 0 5px var(--text)}.pack-profile-name{display:block;margin-top:34px;font-family:var(--meta-font);font-size:.78rem;text-transform:uppercase}.pack-text-link{display:inline-flex;margin-top:28px;padding-bottom:6px;border-bottom:1px solid currentColor;text-decoration:none}.pack-faq-list{border-top:1px solid var(--line)}.pack-faq details{border-bottom:1px solid var(--line);padding:24px 0}.pack-faq summary{cursor:pointer;font-family:var(--display-font);font-size:1.45rem}.pack-faq details p{max-width:720px}.pack-action-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:80px;align-items:start}.pack-action h2{margin-top:24px}.pack-action-widget{padding-top:34px}.pack-footer{padding:28px 0;background:var(--footer-bg,var(--text));color:var(--footer-text,var(--bg))}.pack-footer .shell{display:flex;justify-content:space-between;gap:24px}.pack-announcement{display:flex;overflow:hidden;border-bottom:1px solid #12120f;background:#dfff39;color:#12120f;font-family:"IBM Plex Mono",monospace;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase}.pack-announcement span{flex:none;padding:9px 18px;white-space:nowrap;animation:packTicker 18s linear infinite}@keyframes packTicker{to{transform:translateX(-100%)}}:focus-visible{outline:3px solid var(--focus,var(--accent));outline-offset:4px}@media(max-width:900px){.pack-hero-grid,.pack-profile-grid,.pack-action-grid{grid-template-columns:1fr}.pack-hero-copy{padding-right:0;border-right:0;border-bottom:1px solid var(--line)}.pack-hero-aside{padding-left:0}.pack-split,.pack-section-head{grid-template-columns:1fr;gap:20px}.pack-card-grid,.pack-details dl{grid-template-columns:1fr 1fr}.pack-steps li{grid-template-columns:60px 1fr}.pack-steps li p{grid-column:2}.pack-profile-grid{gap:48px}}@media(max-width:620px){.shell{width:min(100% - 28px,var(--shell,1240px))}.pack-header nav>a:first-child{display:none}.pack-hero-grid{min-height:auto}.pack-hero-copy{padding:54px 0}.pack-hero h1{font-size:clamp(4rem,22vw,6.8rem)}.pack-hero-aside{min-width:0}.pack-section{padding:76px 0}.pack-card-grid,.pack-details dl{grid-template-columns:1fr}.pack-card-grid article{min-height:240px}.pack-card-grid h3{margin-top:48px}.pack-steps li{grid-template-columns:1fr;gap:10px}.pack-steps li p{grid-column:auto}.pack-profile-visual{min-height:430px}.pack-action-grid{gap:30px}.pack-footer .shell{display:grid}.page-action-form .button{width:100%}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.pack-announcement span,.orbit-ring{animation:none!important}}`;
}

function businessSiteShellCss(): string {
  return `.pack-brand img{display:block;width:auto;max-width:112px;height:52px;object-fit:contain}.pack-menu-toggle{display:none;width:48px;height:48px;padding:10px;border:0;background:transparent;color:inherit;cursor:pointer}.pack-menu-toggle span{display:block;width:28px;height:1px;margin:6px auto;background:currentColor;transition:transform .2s ease,opacity .2s ease}.pack-hero-background{position:relative;isolation:isolate;min-height:max(720px,100svh);border:0}.pack-hero-media{position:absolute;z-index:-2;inset:0;margin:0;overflow:hidden}.pack-hero-media img{display:block;width:100%;height:100%;object-fit:cover}.pack-hero-background:after{content:"";position:absolute;z-index:-1;inset:0;background:linear-gradient(180deg,rgba(244,241,234,.44) 0%,rgba(244,241,234,.18) 46%,rgba(24,52,47,.08) 100%);pointer-events:none}.pack-hero-background .pack-hero-grid{display:flex;min-height:max(720px,100svh);align-items:flex-start;justify-content:center}.pack-hero-background .pack-hero-copy{width:min(920px,100%);padding:clamp(190px,24vh,270px) 0 90px;border:0;text-align:center;align-items:center}.pack-hero-background .pack-hero-copy>p{max-width:840px;color:var(--text)}.pack-hero-background .pack-hero-actions{justify-content:center}.pack-hero-background .pack-meta{width:min(520px,100%);margin-top:30px}.pack-hero-background .pack-meta div{border-color:currentColor}.pack-hero-background .pack-meta span,.pack-hero-background .pack-meta strong{color:inherit}body[data-hero-layout=background]>.pack-header{position:absolute;z-index:20;top:0;left:50%;width:min(var(--shell,1240px),calc(100% - 48px));transform:translateX(-50%);border-bottom-color:transparent}body.pack-menu-active{overflow:hidden}@media(max-width:900px){.pack-header{position:relative;z-index:20}.pack-header .pack-brand,.pack-menu-toggle{position:relative;z-index:22}.pack-menu-toggle{display:block}.pack-header #pack-site-navigation{position:fixed;z-index:21;inset:0;display:none;max-width:none;overflow:auto;flex-direction:column;align-items:center;justify-content:center;gap:24px;padding:118px 24px 42px;background:var(--surface);color:var(--text);font-family:var(--display-font);font-size:clamp(1.7rem,8vw,3rem);letter-spacing:-.02em;text-align:center;text-transform:none}.pack-header[data-menu-open] #pack-site-navigation{display:flex}.pack-header #pack-site-navigation>a,.pack-header #pack-site-navigation>a:first-child{display:flex}.pack-header #pack-site-navigation .pack-nav-action{min-height:48px;margin-top:14px;padding:0 22px;border-radius:999px;font-family:var(--meta-font);font-size:.72rem;letter-spacing:.08em;text-transform:uppercase}.pack-header[data-menu-open] .pack-menu-toggle span:nth-child(1){transform:translateY(7px) rotate(45deg)}.pack-header[data-menu-open] .pack-menu-toggle span:nth-child(2){opacity:0}.pack-header[data-menu-open] .pack-menu-toggle span:nth-child(3){transform:translateY(-7px) rotate(-45deg)}body[data-hero-layout=background]>.pack-header{width:min(var(--shell,1240px),calc(100% - 28px))}.pack-hero-background,.pack-hero-background .pack-hero-grid{min-height:100svh}.pack-hero-background .pack-hero-copy{padding:clamp(174px,24vh,220px) 0 48px}.pack-hero-background .pack-kicker{max-width:32ch}.pack-hero-background .pack-hero-actions{margin-top:26px}}@media(prefers-reduced-motion:reduce){.pack-menu-toggle span{transition:none}}`;
}

function businessSiteOverlayPositionCss(): string {
  return `body[data-hero-layout=background]>.pack-header{left:0;right:0;margin-inline:auto;transform:none}body[data-design-pack=clinical-editorial-01][data-hero-layout=background]>.pack-header[data-menu-open] .pack-brand img{filter:brightness(0)}`;
}

function starterEventCss(accent: string): string {
  const actionText = readableTextColor(accent);
  const actionContrast = actionText === "#111111" ? "#ffffff" : "#111111";
  const actionMuted =
    actionText === "#111111" ? "rgba(17,17,17,.72)" : "rgba(255,255,255,.78)";
  const actionLine =
    actionText === "#111111" ? "rgba(17,17,17,.42)" : "rgba(255,255,255,.5)";
  return `:root{--bg:#f2ead8;--surface:#dfd2ba;--text:#22251e;--muted:#596052;--line:rgba(34,37,30,.24);--accent:${accent};--accent-contrast:${readableTextColor(accent)};--focus:#e6b85c;--display-font:"Newsreader",Georgia,serif;--accent-font:"Newsreader",Georgia,serif;--body-font:"Newsreader",Georgia,serif;--meta-font:"DM Mono",monospace;--shell:1240px;--footer-bg:#22251e;--footer-text:#f2ead8}body{background:linear-gradient(rgba(34,37,30,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(34,37,30,.035) 1px,transparent 1px),var(--bg);background-size:28px 28px}.pack-brand{font-weight:400}.pack-hero h1{font-weight:300}.pack-hero h1 em{color:var(--accent);font-style:italic}.event-landscape{position:relative;min-height:440px;overflow:hidden}.event-sun{position:absolute;top:14%;left:43%;width:138px;aspect-ratio:1;border-radius:50%;background:#e6b85c}.event-hill{position:absolute;left:-20%;width:145%;border-radius:50% 50% 0 0}.event-hill-one{bottom:0;height:58%;background:#566148;transform:rotate(-6deg)}.event-hill-two{bottom:-18%;height:58%;background:#31382c;transform:rotate(11deg)}.pack-story .pack-lead em{color:var(--accent)}.pack-features,.pack-steps{background:#22251e;color:#f2ead8;--text:#f2ead8;--muted:rgba(242,234,216,.68);--line:rgba(242,234,216,.22);--surface:#31382c}.pack-features .pack-card-grid article:nth-child(2){background:#31382c}.pack-details dd,.pack-steps li strong{font-weight:400}.pack-action{background:${accent};color:${actionText};--text:${actionText};--muted:${actionMuted};--line:${actionLine};--surface:#fffaf0;--field-text:#22251e;--field-border:#22251e;--accent:${actionText};--accent-contrast:${actionContrast}}.pack-action h2{font-weight:300}.pack-profile h2{font-weight:300}.pack-profile-visual{background:#dfd2ba}@media(max-width:620px){.event-landscape{min-height:330px}.event-sun{width:108px}}`;
}

function starterServiceCss(accent: string): string {
  return `:root{--bg:#f4f0e8;--surface:#dfff39;--text:#12120f;--muted:#4d4b43;--line:#12120f;--accent:${accent};--accent-contrast:#fff;--focus:#dfff39;--display-font:"Archivo Black",sans-serif;--accent-font:"Instrument Serif",Georgia,serif;--body-font:"Instrument Serif",Georgia,serif;--meta-font:"IBM Plex Mono",monospace;--shell:1380px;--footer-bg:#12120f;--footer-text:#f4f0e8}body{font-size:19px}.pack-header{border-left:1px solid var(--line);border-right:1px solid var(--line);padding:0 24px}.pack-brand{text-transform:uppercase}.pack-hero-grid{border-left:1px solid var(--line);border-right:1px solid var(--line)}.pack-hero h1{max-width:9ch;text-transform:uppercase;font-size:clamp(4.4rem,9vw,9rem);line-height:.84}.pack-hero h1 em{color:var(--accent);text-transform:none}.button,.pack-nav-action{box-shadow:5px 5px 0 #12120f}.button:hover,.pack-nav-action:hover{transform:translate(2px,2px);box-shadow:3px 3px 0 #12120f}.service-poster{position:relative;display:flex;min-height:520px;flex-direction:column;justify-content:space-between;padding:34px;overflow:hidden;background:#12120f;color:#f4f0e8}.service-poster-word{position:relative;z-index:2;font-family:"Archivo Black",sans-serif;font-size:clamp(3rem,6vw,6.4rem);line-height:.8}.service-poster-word:nth-of-type(2){align-self:flex-end;color:#dfff39}.service-poster-orbit{position:absolute;width:68%;aspect-ratio:1;left:16%;top:15%;border:2px solid #f0563d;border-radius:50%}.service-poster-orbit:before,.service-poster-orbit:after{content:"";position:absolute;inset:18%;border:2px solid ${accent};border-radius:50%}.service-poster-orbit:after{inset:38%;background:#dfff39}.service-poster-note{position:relative;z-index:2;align-self:flex-end;font-family:"IBM Plex Mono",monospace;font-size:.7rem;text-transform:uppercase}.pack-story{background:#12120f;color:#f4f0e8;--text:#f4f0e8;--muted:#d2cfc7;--line:#f4f0e8}.pack-story h2{color:#dfff39;text-transform:uppercase}.pack-features{background:${accent};color:#fff;--text:#fff;--muted:rgba(255,255,255,.78);--line:rgba(255,255,255,.55)}.pack-card-grid article:nth-child(2){background:#dfff39;color:#12120f;--muted:#4d4b43}.pack-steps{background:#dfff39}.pack-profile-visual{border:1px solid #12120f}.pack-action{background:#f0563d;color:#12120f;--text:#12120f;--muted:#36221d;--surface:#f4f0e8;--accent:#12120f;--accent-contrast:#f4f0e8}.pack-action h2{text-transform:uppercase}.page-action-form input,.page-action-form textarea,.booking-action input{border-color:#12120f;border-radius:0}.pack-faq summary{font-family:"Archivo Black",sans-serif;text-transform:uppercase}@media(max-width:620px){.pack-header,.pack-hero-grid{border-left:0;border-right:0}.service-poster{min-height:390px}}`;
}

function starterWaitlistCss(accent: string): string {
  return `:root{color-scheme:dark;--bg:#070a12;--surface:#141b2b;--text:#eef2eb;--muted:#8b95a8;--line:rgba(238,242,235,.16);--accent:${accent};--accent-contrast:#070a12;--focus:#ff6e3d;--display-font:"Geologica",sans-serif;--accent-font:"Geologica",sans-serif;--body-font:"Geologica",sans-serif;--meta-font:"Fira Code",monospace;--shell:1280px;--footer-bg:#070a12;--footer-text:#8b95a8}body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.23;background-image:radial-gradient(rgba(255,255,255,.18) .7px,transparent .7px);background-size:9px 9px;mask-image:linear-gradient(to bottom,black,transparent 70%)}.pack-header{position:relative;z-index:2}.pack-brand:before{content:"";display:inline-block;width:12px;height:12px;margin-right:12px;border:1px solid var(--accent);border-radius:50%;box-shadow:0 0 16px color-mix(in srgb,var(--accent) 60%,transparent)}.pack-hero{position:relative}.pack-hero:before{content:"";position:absolute;width:900px;height:600px;left:55%;top:-22%;border-radius:50%;background:radial-gradient(circle,rgba(94,130,255,.22),transparent 66%);filter:blur(12px)}.pack-hero-grid{position:relative;z-index:1}.pack-hero h1{font-weight:410;font-stretch:80%}.pack-hero h1 em{color:var(--accent);font-style:normal}.waitlist-orbit{position:relative;min-height:580px;display:grid;place-items:center}.orbit-ring{position:absolute;border:1px solid var(--line);border-radius:50%;animation:packSpin 28s linear infinite}.orbit-ring:after{content:"";position:absolute;width:11px;height:11px;left:50%;top:-6px;border-radius:50%;background:var(--accent);box-shadow:0 0 20px color-mix(in srgb,var(--accent) 70%,transparent)}.orbit-ring-one{width:500px;height:500px}.orbit-ring-two{width:370px;height:370px;animation-direction:reverse;animation-duration:21s}.orbit-ring-two:after{background:#ff6e3d}.orbit-ring-three{width:230px;height:230px;animation-duration:16s}.orbit-ring-three:after{background:#5e82ff}.waitlist-orbit article{position:relative;z-index:3;width:min(380px,76%);padding:26px;border:1px solid color-mix(in srgb,var(--accent) 40%,transparent);background:rgba(13,18,32,.94);box-shadow:0 40px 100px rgba(0,0,0,.45);backdrop-filter:blur(18px)}.waitlist-orbit article strong{display:block;margin:24px 0 12px;font-size:1.8rem}.waitlist-orbit article p{color:var(--muted);line-height:1.5}.waitlist-orbit article div{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:24px}.waitlist-orbit article div span{padding:10px 4px;border:1px solid var(--line);text-align:center;font-family:var(--meta-font);font-size:.62rem;text-transform:uppercase}@keyframes packSpin{to{transform:rotate(360deg)}}.pack-story h2 em{color:#ff6e3d}.pack-features{background:#0d1220}.pack-card-grid article{background:#070a12}.pack-card-grid article:nth-child(2){background:linear-gradient(145deg,rgba(94,130,255,.18),#070a12)}.pack-card-grid h3{font-weight:430}.pack-details{background:#0d1220}.pack-steps li strong{font-weight:430}.pack-profile-visual{background:#141b2b}.pack-profile-shape{background:#5e82ff}.pack-action{position:relative;overflow:hidden;background:var(--accent);color:#070a12;--text:#070a12;--muted:#30351d;--line:rgba(7,10,18,.35);--surface:#eef2eb;--accent:#070a12;--accent-contrast:#eef2eb}.pack-action:after{content:"N";position:absolute;right:-4vw;bottom:-18vw;font-family:var(--display-font);font-size:43vw;font-weight:800;line-height:1;color:rgba(7,10,18,.06);pointer-events:none}.pack-action-grid{position:relative;z-index:1}.pack-action h2{font-weight:450}.page-action-form input,.page-action-form textarea,.booking-action input{border-color:#070a12;background:transparent}.pack-faq details{background:#0d1220;padding:24px;margin-bottom:10px;border:1px solid var(--line)}@media(max-width:620px){.waitlist-orbit{min-height:440px;margin-inline:-30px}.orbit-ring-one{width:370px;height:370px}.orbit-ring-two{width:285px;height:285px}.orbit-ring-three{width:180px;height:180px}}`;
}

function safeCssColor(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && /^#[0-9a-f]{3,8}$/i.test(normalized)
    ? normalized
    : fallback;
}

function renderLandingActionSection(
  section: Extract<LandingPageV3Section, { type: "action" }>,
  action: LandingPageAction | undefined,
  username: string,
  context: LandingPageRenderContext,
): string {
  const widget = action
    ? renderLandingAction(action, username, context)
    : `<p class="action-error" role="alert">This action is no longer available.</p>`;
  return `<section id="action-${escapeHtml(section.actionId)}" class="section section-band page-action"><div class="shell section-grid"><div><h2>${escapeHtml(section.heading)}</h2><p>${escapeHtml(section.body)}</p></div><div>${widget}</div></div></section>`;
}

function renderLandingAction(
  action: LandingPageAction,
  username: string,
  context: LandingPageRenderContext,
): string {
  if (action.kind === "link") {
    return `<a class="button primary" href="${escapeHtml(resolveBusinessSiteHref(context, action.href || "#"))}">${escapeHtml(action.label)}</a>`;
  }
  const attribution = `<input type="hidden" name="pageId" value="${escapeHtml(context.pageId || "")}"><input type="hidden" name="actionId" value="${escapeHtml(action.id)}"><input type="hidden" name="campaign" value="${escapeHtml(context.campaign || context.slug || "")}">`;
  if (action.kind === "subscribe") {
    return `<form class="page-action-form" data-subscribe-form action="/api/sites/${encodeURIComponent(username)}/subscribe">${attribution}<label>Email address<input type="email" name="email" autocomplete="email" placeholder="you@example.com" required></label><label class="honeypot" aria-hidden="true">Website<input name="website" tabindex="-1" autocomplete="off"></label><button class="button primary" type="submit">${escapeHtml(action.label)}</button><p class="action-status" role="status" aria-live="polite"></p></form>`;
  }
  if (!action.resourceId) {
    return `<p class="action-error" role="alert">Choose a ${escapeHtml(action.kind)} before publishing this page.</p>`;
  }
  if (action.kind === "product") {
    const paymentMethod =
      context.productPaymentMethods?.[action.resourceId] || "stripe";
    const paymentNote =
      paymentMethod === "manual"
        ? `<p class="payment-later-note">Payment is not taken now. You’ll receive payment details by email after ordering.</p>`
        : "";
    return `<form class="page-action-form" data-product-form data-payment-method="${paymentMethod}" data-username="${escapeHtml(username)}" data-product="${escapeHtml(action.resourceId)}">${attribution}<label>Your name<input name="buyerName" autocomplete="name" required></label><label>Email address<input type="email" name="buyerEmail" autocomplete="email" required></label><label>Note <span>(optional)</span><textarea name="buyerNote" rows="3"></textarea></label>${paymentNote}<button class="button primary" type="submit">${escapeHtml(action.label)}</button><p class="action-status" role="status" aria-live="polite"></p></form>`;
  }
  const paymentMethod =
    context.bookingPaymentMethods?.[action.resourceId] || "stripe";
  const paymentNote =
    paymentMethod === "manual"
      ? `<p class="payment-later-note">Payment is not taken now. You’ll receive payment details by email after booking.</p>`
      : "";
  return `<div class="booking-action" data-booking-action data-payment-method="${paymentMethod}" data-username="${escapeHtml(username)}" data-offer="${escapeHtml(action.resourceId)}" data-page-id="${escapeHtml(context.pageId || "")}" data-action-id="${escapeHtml(action.id)}" data-campaign="${escapeHtml(context.campaign || context.slug || "")}"><label>Choose a date<input type="date" data-booking-date required></label><div class="booking-slots" data-booking-slots aria-live="polite"></div><form class="page-action-form" data-booking-form hidden><label>Your name<input name="guestName" autocomplete="name" required></label><label>Email address<input type="email" name="guestEmail" autocomplete="email" required></label><label>Anything we should know? <span>(optional)</span><textarea name="notes" rows="3"></textarea></label>${paymentNote}<button class="button primary" type="submit">${escapeHtml(action.label)}</button></form><p class="action-status" role="status" aria-live="polite"></p></div>`;
}

function renderActionCss(): string {
  return `.page-action-form,.booking-action{display:grid;gap:14px;max-width:520px}.page-action-form label,.booking-action>label{display:grid;gap:7px;font-weight:700}.page-action-form label span{font-weight:400;color:var(--muted,var(--text-muted))}.page-action-form input,.page-action-form textarea,.booking-action input{width:100%;min-height:48px;border:2px solid var(--field-border,var(--line,var(--border)));border-radius:8px;background:var(--surface);color:var(--field-text,var(--text,#111));padding:12px 14px;font:inherit}.page-action-form input::placeholder,.page-action-form textarea::placeholder{color:color-mix(in srgb,var(--field-text,var(--text,#111)) 62%,transparent);opacity:1}.page-action-form textarea{resize:vertical}.page-action-form .button{width:fit-content;min-height:50px;padding-inline:22px;border:2px solid var(--accent);background:var(--accent);color:var(--accent-contrast);box-shadow:0 3px 0 color-mix(in srgb,var(--text) 42%,transparent);cursor:pointer}.payment-later-note{margin:0;padding:12px 14px;border:1px solid var(--line,var(--border));border-radius:8px;color:var(--text);font-size:.95rem;line-height:1.5}.action-status{min-height:1.5em;margin:0;color:var(--muted,var(--text-muted))}.action-status.is-error,.action-error{color:#b42318}.honeypot{position:absolute!important;width:1px!important;height:1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important}.booking-slots{display:flex;flex-wrap:wrap;gap:8px}.booking-slot{min-height:44px;border:1px solid var(--line,var(--border));border-radius:999px;background:transparent;color:var(--text);padding:0 14px;font:inherit;cursor:pointer}.booking-slot[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:var(--accent-contrast)}button:focus-visible,a:focus-visible,input:focus-visible,textarea:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 72%,white);outline-offset:3px}@media(max-width:640px){.page-action .section-grid{gap:22px}.page-action-form .button{width:100%}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto!important}}`;
}

function landingNavigationScript(): string {
  return `(()=>{document.querySelectorAll('.pack-menu-toggle').forEach(button=>{const header=button.closest('.pack-header');const navigation=header?.querySelector('#pack-site-navigation');if(!header||!navigation)return;const setOpen=open=>{header.toggleAttribute('data-menu-open',open);button.setAttribute('aria-expanded',String(open));button.setAttribute('aria-label',open?'Close site menu':'Open site menu');document.body.classList.toggle('pack-menu-active',open)};button.addEventListener('click',()=>setOpen(button.getAttribute('aria-expanded')!=='true'));navigation.querySelectorAll('a').forEach(link=>link.addEventListener('click',()=>setOpen(false)));document.addEventListener('keydown',event=>{if(event.key==='Escape'&&button.getAttribute('aria-expanded')==='true'){setOpen(false);button.focus()}});const desktop=window.matchMedia('(min-width:901px)');desktop.addEventListener?.('change',event=>{if(event.matches)setOpen(false)})})})();`;
}

function landingActionScript(): string {
  return `(()=>{const status=(root,message,error=false)=>{const el=root.querySelector('.action-status');if(!el)return;el.textContent=message;el.classList.toggle('is-error',error)};document.querySelectorAll('[data-subscribe-form]').forEach(form=>form.addEventListener('submit',async event=>{event.preventDefault();status(form,'Joining…');try{const response=await fetch(form.action,{method:'POST',body:new FormData(form)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not join the list.');form.reset();status(form,data.message||'You are on the list.')}catch(error){status(form,error.message||'Could not join the list.',true)}}));document.querySelectorAll('[data-booking-action]').forEach(root=>{const username=root.dataset.username;const offerId=root.dataset.offer;const date=root.querySelector('[data-booking-date]');const slots=root.querySelector('[data-booking-slots]');const form=root.querySelector('[data-booking-form]');let selected=null;date.addEventListener('change',async()=>{selected=null;form.hidden=true;slots.textContent='Loading times…';try{const response=await fetch('/api/book/'+encodeURIComponent(username)+'/slots?date='+encodeURIComponent(date.value)+'&offerId='+encodeURIComponent(offerId));const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not load times.');slots.textContent='';if(!data.slots.length){slots.textContent='No times available on this date.';return}data.slots.forEach(slot=>{const button=document.createElement('button');button.type='button';button.className='booking-slot';button.textContent=slot.localTime;button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>{selected=slot;slots.querySelectorAll('button').forEach(item=>item.setAttribute('aria-pressed',String(item===button)));form.hidden=false;form.querySelector('input')?.focus()});slots.appendChild(button)})}catch(error){slots.textContent='';status(root,error.message||'Could not load times.',true)}});form.addEventListener('submit',async event=>{event.preventDefault();if(!selected)return;status(root,'Confirming…');const values=Object.fromEntries(new FormData(form));const payload={offerId,slotStart:selected.slotStart,slotEnd:selected.slotEnd,guestName:values.guestName,guestEmail:values.guestEmail,notes:values.notes,pageId:root.dataset.pageId,actionId:root.dataset.actionId,campaign:root.dataset.campaign};try{let response=await fetch('/api/book/'+encodeURIComponent(username)+'/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});let data=await response.json();if(response.status===402){response=await fetch('/api/book/'+encodeURIComponent(username)+'/checkout-session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,localDate:selected.localDate,localTime:selected.localTime,returnUrl:location.href})});data=await response.json();if(!response.ok)throw new Error(data.error||'Could not start checkout.');location.href=data.url;return}if(!response.ok)throw new Error(data.error||'Could not confirm the booking.');form.reset();form.hidden=true;slots.textContent='';date.value='';status(root,root.dataset.paymentMethod==='manual'?'Your booking is confirmed. Check your email for payment details.':'Your booking is confirmed.')}catch(error){status(root,error.message||'Could not confirm the booking.',true)}});const params=new URLSearchParams(location.search);if(params.get('booking')==='success'&&params.get('session_id')){status(root,'Confirming your payment…');fetch('/api/book/'+encodeURIComponent(username)+'/complete-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:params.get('session_id')})}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not confirm payment.');status(root,'Payment received. Your booking is confirmed.')}).catch(error=>status(root,error.message||'Could not confirm payment.',true))}});document.querySelectorAll('[data-product-form]').forEach(form=>{form.addEventListener('submit',async event=>{event.preventDefault();status(form,form.dataset.paymentMethod==='manual'?'Confirming your request…':'Opening secure checkout…');const values=Object.fromEntries(new FormData(form));try{const response=await fetch('/api/shop/'+encodeURIComponent(form.dataset.username)+'/'+encodeURIComponent(form.dataset.product)+'/order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...values,returnUrl:location.href})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not place your order.');if(data.paymentMethod==='manual'){form.reset();status(form,data.message||'Your request is confirmed. Check your email for payment details.');return}if(data.url){location.href=data.url;return}throw new Error('Checkout URL missing.')}catch(error){status(form,error.message||'Could not place your order.',true)}});const params=new URLSearchParams(location.search);if(params.get('purchase')==='success'&&params.get('session_id')){status(form,'Confirming your payment…');fetch('/api/shop/'+encodeURIComponent(form.dataset.username)+'/complete-checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:params.get('session_id')})}).then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not confirm payment.');status(form,'Payment received. Thank you for your purchase.')}).catch(error=>status(form,error.message||'Could not confirm payment.',true))}})})();`;
}

function renderLandingPageHtmlV1(
  page: LandingPageDocumentV1,
  username: string,
): string {
  const accent = page.style.accentColor || "#0f766e";
  const sections = page.sections
    .map((section) => renderLandingSection(section))
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(page.title)}</title><meta name="description" content="${escapeHtml(page.meta.description)}"><style>:root{--accent:${escapeHtml(accent)};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#151c19;background:#fbfcfb}body{margin:0}.shell{width:min(1080px,calc(100vw - 32px));margin:0 auto}.top{border-bottom:1px solid rgba(21,28,25,.12);padding:16px 0}.hero{padding:56px 0;display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.8fr);gap:24px;align-items:center}.hero-copy,.media,.card{border:1px solid rgba(21,28,25,.12);border-radius:22px;background:#fff;padding:28px;box-shadow:0 18px 48px rgba(16,24,20,.06)}h1{font-size:clamp(2.4rem,6vw,5rem);line-height:1;margin:0 0 18px}.eyebrow{color:var(--accent);font-weight:800;text-transform:uppercase;font-size:12px;letter-spacing:.12em}p,li{color:#52615b;line-height:1.65}.button,button{display:inline-flex;border:0;border-radius:999px;background:var(--accent);color:white;padding:12px 18px;text-decoration:none;font-weight:800}.section{padding:28px 0}.media{min-height:280px;display:grid;place-items:center;overflow:hidden}.media img{width:100%;height:100%;object-fit:cover}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}input{padding:12px 14px;border:1px solid rgba(21,28,25,.18);border-radius:12px}@media(max-width:760px){.hero{grid-template-columns:1fr}}</style></head><body><header class="top"><div class="shell"><strong>${escapeHtml(username)}</strong></div></header><main><section class="shell hero"><div class="hero-copy"><p class="eyebrow">${escapeHtml(page.hero.eyebrow || "")}</p><h1>${escapeHtml(page.hero.headline)}</h1><p>${escapeHtml(page.hero.subheadline)}</p><a class="button" href="${escapeHtml(page.hero.cta.href)}">${escapeHtml(page.hero.cta.label)}</a></div><div class="media">${page.hero.image ? `<img src="${escapeHtml(page.hero.image)}" alt="">` : `<span class="eyebrow">ME3</span>`}</div></section>${sections}</main></body></html>`;
}

function renderLandingPageHtmlV2(
  page: LandingPageDocumentV2,
  username: string,
): string {
  const theme = getThemeTokens(page);
  const heroImage = page.hero.image || page.assets.sectionImage;
  const heroVisual = heroImage
    ? `<img src="${escapeHtml(heroImage)}" alt="" loading="eager" decoding="async" fetchpriority="high">`
    : renderGeneratedVisual(page);
  const metadata = (page.hero.metadata || [])
    .map(
      (item) =>
        `<div class="meta-item"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong></div>`,
    )
    .join("");
  const sections = page.content.sections
    .map((section) => renderLandingSectionV2(section))
    .join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(page.seo.title)}</title><meta name="description" content="${escapeHtml(page.seo.description)}"><style>${renderLandingPageCssV2(theme)}</style></head><body data-theme="${escapeHtml(page.design.theme)}"><header class="site-top"><a href="#main" class="skip-link">Skip to content</a><div class="shell site-top-inner"><strong>${escapeHtml(username)}</strong><a class="top-action" href="${escapeHtml(page.hero.cta.href)}">${escapeHtml(page.hero.cta.label)}</a></div></header><main id="main"><section class="hero"><div class="shell hero-grid"><div class="hero-copy">${metadata ? `<div class="meta-grid">${metadata}</div>` : ""}<h1>${escapeHtml(page.hero.headline)}</h1><p>${escapeHtml(page.hero.subheadline)}</p><div class="hero-actions"><a class="button primary" href="${escapeHtml(page.hero.cta.href)}">${escapeHtml(page.hero.cta.label)}</a>${page.hero.secondaryCta ? `<a class="button secondary" href="${escapeHtml(page.hero.secondaryCta.href)}">${escapeHtml(page.hero.secondaryCta.label)}</a>` : ""}</div></div><div class="hero-visual">${heroVisual}</div></div></section>${sections}</main></body></html>`;
}

function extractLandingTitle(text: string, template: LandingPageTemplateId): string {
  const firstLine = text
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line.length > 8);
  if (firstLine) return firstLine.slice(0, 90);
  if (template === "event") return "A focused event page";
  if (template === "waitlist") return "A clear waitlist page";
  return "A focused offer page";
}

function extractEventDetail(text: string, kind: "when" | "where"): string {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
  const pattern =
    kind === "when"
      ? /\b(date|when|time|starts?|opens?)\b\s*:?\s*(.+)/i
      : /\b(where|venue|location|place|online)\b\s*:?\s*(.+)/i;
  const match = lines.map((line) => line.match(pattern)).find(Boolean);
  if (match?.[2]) return match[2].trim().slice(0, 96);
  return kind === "when" ? "Add the event date and time" : "Add the event location";
}

function eventFeatureTitle(index: number): string {
  return ["Reason to attend", "What is included", "What changes after"][index] || "Highlight";
}

function waitlistFeatureTitle(index: number): string {
  return ["Early access", "Built for you", "Launch advantage"][index] || "Benefit";
}

function firstSentence(text: string): string {
  return (
    text
      .replace(/\s+/g, " ")
      .trim()
      .split(/(?<=[.!?])\s+/)[0]
      ?.slice(0, 180) || ""
  );
}

function deriveLandingItems(text: string): string[] {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter((line) => line.length > 0 && line.length < 96)
    .slice(1, 4);
  return lines.length > 0
    ? lines
    : [
        "A clear promise",
        "A simple next step",
        "A page connected to your ME3 profile",
      ];
}

function extractCta(feedback: string | null | undefined): string | null {
  const match = feedback?.match(/cta\s+(?:to|as)\s+["']?([^"'\n.]+)/i);
  return match?.[1]?.trim() || null;
}

type LandingPageThemeTokens = {
  bg: string;
  bgMuted: string;
  surface: string;
  text: string;
  textMuted: string;
  accent: string;
  accentContrast: string;
  border: string;
};

function getThemeTokens(
  page: LandingPageDocumentV2 | LandingPageDocumentV3,
): LandingPageThemeTokens {
  if (page.design.theme === "signal-waitlist") {
    return {
      bg: page.design.backgroundColor || "#101312",
      bgMuted: "#171c1a",
      surface: "#f7fbf7",
      text: page.design.textColor || "#f7fbf7",
      textMuted: "#b7c4bd",
      accent: page.design.accentColor || "#49de80",
      accentContrast: "#0e1512",
      border: "rgba(247,251,247,.18)",
    };
  }

  return {
    bg: page.design.backgroundColor || "#f8f1eb",
    bgMuted: "#e7f1df",
    surface: "#fffaf4",
    text: page.design.textColor || "#233d35",
    textMuted: "#66746c",
    accent: page.design.accentColor || "#f2664a",
    accentContrast: "#fffaf4",
    border: "rgba(35,61,53,.18)",
  };
}

function renderLandingPageCssV2(theme: LandingPageThemeTokens): string {
  return `:root{color-scheme:light;--bg:${theme.bg};--bg-muted:${theme.bgMuted};--surface:${theme.surface};--text:${theme.text};--text-muted:${theme.textMuted};--accent:${theme.accent};--accent-contrast:${theme.accentContrast};--border:${theme.border};font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--text)}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text)}a{color:inherit}.skip-link{position:absolute;left:16px;top:-48px;background:var(--accent);color:var(--accent-contrast);padding:10px 14px;border-radius:999px;z-index:10}.skip-link:focus{top:16px}.shell{width:min(1120px,calc(100vw - 32px));margin:0 auto}.site-top{border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--bg) 86%,transparent);position:sticky;top:0;z-index:2;backdrop-filter:blur(18px)}.site-top-inner{min-height:64px;display:flex;align-items:center;justify-content:space-between;gap:16px}.site-top strong{font-size:15px}.top-action{display:inline-flex;align-items:center;min-height:38px;padding:0 14px;border:1px solid var(--border);border-radius:999px;text-decoration:none;font-weight:700}.hero{padding:56px 0 40px}.hero-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,.86fr);gap:32px;align-items:center}.hero-copy h1{font-size:clamp(3rem,8vw,6.6rem);line-height:.96;margin:22px 0 18px;letter-spacing:0;max-width:10ch}.hero-copy p{font-size:clamp(1.05rem,2vw,1.32rem);line-height:1.55;color:var(--text-muted);max-width:680px}.meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;max-width:560px}.meta-item{border-top:1px solid var(--border);padding-top:10px}.meta-item span{display:block;color:var(--text-muted);font-size:13px}.meta-item strong{display:block;margin-top:3px;font-size:15px}.hero-actions,.section-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:28px}.button{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:0 18px;border-radius:999px;text-decoration:none;font-weight:800;border:1px solid var(--border)}.button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-contrast)}.button.secondary{background:transparent;color:var(--text)}.hero-visual{min-height:420px;border:1px solid var(--border);border-radius:8px;overflow:hidden;background:var(--surface);display:grid;place-items:center}.hero-visual img{width:100%;height:100%;object-fit:cover;display:block}.generated-visual{width:100%;height:100%;min-height:420px;display:grid;grid-template-rows:1fr auto;background:linear-gradient(180deg,var(--surface),var(--bg-muted))}.generated-visual-lines{display:grid;grid-template-columns:repeat(7,1fr);gap:10px;padding:28px}.generated-visual-lines span{display:block;border-radius:999px;background:var(--accent);opacity:.22}.generated-visual-lines span:nth-child(2n){opacity:.4}.generated-visual-caption{padding:24px 28px;border-top:1px solid var(--border);font-size:clamp(1.2rem,3vw,2.2rem);line-height:1.08}.section{padding:42px 0}.section-band{background:var(--bg-muted);border-top:1px solid var(--border);border-bottom:1px solid var(--border)}.section-grid{display:grid;grid-template-columns:minmax(0,.72fr) minmax(0,1fr);gap:36px;align-items:start}.section h2{font-size:clamp(2rem,4vw,4rem);line-height:1;margin:0;letter-spacing:0}.section p,.section li{color:var(--text-muted);line-height:1.65}.section-body{font-size:1.16rem;margin:0}.feature-grid,.faq-grid,.details-grid,.steps-grid{display:grid;gap:14px}.feature-grid{grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}.faq-grid,.details-grid{grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}.feature-card,.faq-card,.detail-card,.step-card{border:1px solid var(--border);border-radius:8px;padding:18px;background:color-mix(in srgb,var(--surface) 70%,transparent)}.feature-card strong,.faq-card strong,.detail-card strong,.step-card strong{display:block;font-size:1.02rem}.detail-card span{display:block;color:var(--text-muted);font-size:13px;margin-bottom:6px}.step-card{display:grid;grid-template-columns:auto 1fr;gap:14px}.step-number{width:34px;height:34px;border-radius:999px;display:grid;place-items:center;background:var(--accent);color:var(--accent-contrast);font-weight:800}.signup-form{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}.signup-form input{min-height:48px;min-width:min(100%,280px);flex:1;border:1px solid var(--border);border-radius:999px;background:var(--surface);color:#111;padding:0 16px;font:inherit}.final-cta{text-align:center}.final-cta h2{margin-inline:auto;max-width:760px}.final-cta p{max-width:640px;margin:18px auto 0}@media(max-width:820px){.hero-grid,.section-grid{grid-template-columns:1fr}.hero-copy h1{max-width:11ch}.hero-visual{min-height:300px}.generated-visual{min-height:300px}.site-top{position:static}}`;
}

function renderGeneratedVisual(
  page: LandingPageDocumentV2 | LandingPageDocumentV3,
): string {
  const words = page.recipe.id === "event-invite" ? "Save the date" : "First access";
  return `<div class="generated-visual" aria-hidden="true"><div class="generated-visual-lines">${Array.from({ length: 21 })
    .map((_, index) => `<span style="min-height:${48 + (index % 5) * 28}px"></span>`)
    .join("")}</div><div class="generated-visual-caption">${escapeHtml(words)}</div></div>`;
}

function renderLandingSectionV2(section: LandingPageV2Section): string {
  if (section.type === "story") {
    return `<section id="${escapeHtml(section.id)}" class="section"><div class="shell section-grid"><h2>${escapeHtml(section.heading)}</h2><p class="section-body">${escapeHtml(section.body)}</p></div></section>`;
  }
  if (section.type === "feature-list") {
    return `<section id="${escapeHtml(section.id)}" class="section section-band"><div class="shell"><div class="section-grid"><div><h2>${escapeHtml(section.heading)}</h2>${section.body ? `<p>${escapeHtml(section.body)}</p>` : ""}</div><div class="feature-grid">${section.items.map((item) => `<article class="feature-card"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body)}</p></article>`).join("")}</div></div></div></section>`;
  }
  if (section.type === "details") {
    return `<section id="${escapeHtml(section.id)}" class="section"><div class="shell"><div class="section-grid"><h2>${escapeHtml(section.heading)}</h2><div class="details-grid">${section.items.map((item) => `<article class="detail-card"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}</article>`).join("")}</div></div></div></section>`;
  }
  if (section.type === "steps") {
    return `<section id="${escapeHtml(section.id)}" class="section"><div class="shell"><div class="section-grid"><h2>${escapeHtml(section.heading)}</h2><div class="steps-grid">${section.items.map((item, index) => `<article class="step-card"><span class="step-number">${index + 1}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.body)}</p></div></article>`).join("")}</div></div></div></section>`;
  }
  if (section.type === "signup") {
    return `<section id="${escapeHtml(section.id)}" class="section section-band"><div class="shell section-grid"><div><h2>${escapeHtml(section.heading)}</h2><p>${escapeHtml(section.body)}</p></div><form class="signup-form"><input type="email" placeholder="${escapeHtml(section.placeholder || "you@example.com")}"><button class="button primary" type="button">${escapeHtml(section.buttonLabel)}</button></form></div></section>`;
  }
  if (section.type === "profile") {
    return `<section id="${escapeHtml(section.id)}" class="section"><div class="shell section-grid"><h2>${escapeHtml(section.heading)}</h2><div><p class="section-body">${escapeHtml(section.body)}</p>${section.profileLink ? `<div class="section-actions"><a class="button secondary" href="${escapeHtml(section.profileLink)}">Visit profile</a></div>` : ""}</div></div></section>`;
  }
  if (section.type === "faq") {
    return `<section id="${escapeHtml(section.id)}" class="section"><div class="shell"><div class="section-grid"><h2>${escapeHtml(section.heading)}</h2><div class="faq-grid">${section.items.map((item) => `<article class="faq-card"><strong>${escapeHtml(item.question)}</strong><p>${escapeHtml(item.answer)}</p></article>`).join("")}</div></div></div></section>`;
  }
  return `<section id="${escapeHtml(section.id)}" class="section final-cta section-band"><div class="shell"><h2>${escapeHtml(section.heading)}</h2><p>${escapeHtml(section.body)}</p><div class="section-actions" style="justify-content:center"><a class="button primary" href="${escapeHtml(section.cta.href)}">${escapeHtml(section.cta.label)}</a></div></div></section>`;
}

function renderLandingSection(section: LandingPageSection): string {
  if (section.type === "text") {
    return `<section class="shell section"><div class="card"><h2>${escapeHtml(section.heading)}</h2><p>${escapeHtml(section.body)}</p></div></section>`;
  }
  if (section.type === "list" || section.type === "steps") {
    return `<section class="shell section"><div class="card"><h2>${escapeHtml(section.heading)}</h2><ul>${section.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div></section>`;
  }
  if (section.type === "image") {
    return `<section class="shell section"><div class="media"><img src="${escapeHtml(section.image)}" alt="${escapeHtml(section.heading)}"></div></section>`;
  }
  if (section.type === "signup") {
    return `<section id="signup" class="shell section"><div class="card"><h2>${escapeHtml(section.heading)}</h2><p>${escapeHtml(section.body)}</p><form><input type="email" placeholder="${escapeHtml(section.placeholder || "Email")}"> <button type="button">${escapeHtml(section.buttonLabel)}</button></form></div></section>`;
  }
  if (section.type === "profile") {
    return `<section id="contact" class="shell section"><div class="card"><h2>${escapeHtml(section.heading)}</h2><p>${escapeHtml(section.body)}</p>${section.profileLink ? `<a href="${escapeHtml(section.profileLink)}">Visit profile</a>` : ""}</div></section>`;
  }
  if (section.type === "pricing") {
    return `<section class="shell section"><div class="card"><h2>${escapeHtml(section.heading)}</h2><div class="grid">${section.tiers.map((tier) => `<article><strong>${escapeHtml(tier.name)}</strong><p>${escapeHtml(tier.price)}</p></article>`).join("")}</div></div></section>`;
  }
  if (section.type === "faq") {
    return `<section class="shell section"><div class="card"><h2>${escapeHtml(section.heading)}</h2><div class="grid">${section.items.map((item) => `<article><strong>${escapeHtml(item.question)}</strong><p>${escapeHtml(item.answer)}</p></article>`).join("")}</div></div></section>`;
  }
  return `<section class="shell section"><div class="card"><h2>${escapeHtml(section.heading)}</h2></div></section>`;
}

function escapeHtml(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
