export const LANDING_PAGE_DESIGN_PACK_IDS = [
  "retreat-01",
  "legacy-standard",
  "starter-event-01",
  "starter-service-01",
  "starter-waitlist-01",
  "clinical-editorial-01",
] as const;

export type LandingPageDesignPackId =
  (typeof LANDING_PAGE_DESIGN_PACK_IDS)[number];

export type LandingPageDesignPackPurpose = "event" | "service" | "waitlist";

export type LandingPageDesignPackDefinition = {
  id: LandingPageDesignPackId;
  version: 1;
  name: string;
  description: string;
  bestFor: string;
  purposes: readonly LandingPageDesignPackPurpose[];
  status: "starter" | "legacy";
  selectable: boolean;
  previewPath: string | null;
};

export const LANDING_PAGE_DESIGN_PACKS: readonly LandingPageDesignPackDefinition[] = [
  {
    id: "legacy-standard",
    version: 1,
    name: "Classic",
    description: "The original ME3 landing-page renderer retained for existing pages.",
    bestFor: "Existing landing pages that should keep their current appearance.",
    purposes: ["event", "service", "waitlist"],
    status: "legacy",
    selectable: false,
    previewPath: null,
  },
  {
    id: "starter-event-01",
    version: 1,
    name: "Event Starter 01",
    description: "A tactile editorial layout with strong event details and a warm invitation.",
    bestFor: "Retreats, workshops, gatherings, and small in-person experiences.",
    purposes: ["event"],
    status: "starter",
    selectable: true,
    previewPath: "/landing-page-lab/field-notes/index.html",
  },
  {
    id: "starter-service-01",
    version: 1,
    name: "Service Starter 01",
    description: "A bold print-led layout that makes a focused offer feel decisive.",
    bestFor: "Consulting, positioning, coaching, creative services, and fixed-scope offers.",
    purposes: ["service"],
    status: "starter",
    selectable: true,
    previewPath: "/landing-page-lab/room-to-think/index.html",
  },
  {
    id: "starter-waitlist-01",
    version: 1,
    name: "Waitlist Starter 01",
    description: "A dark, kinetic product layout designed around one memorable signup action.",
    bestFor: "Software, products, communities, courses, and early-access launches.",
    purposes: ["waitlist"],
    status: "starter",
    selectable: true,
    previewPath: "/landing-page-lab/northstar/index.html",
  },
  {
    id: "clinical-editorial-01",
    version: 1,
    name: "Natural Editorial",
    description: "A calm, image-led editorial system for expert services and information-rich Business Sites.",
    bestFor: "Practices, retreats, specialists, trusted advisors, and thoughtful service businesses.",
    purposes: ["event", "service", "waitlist"],
    status: "starter",
    selectable: true,
    previewPath: null,
  },
  {
    id: "retreat-01", version: 1, name: "Retreat",
    description: "Immersive photography, warm cream and burgundy, and expressive serif headings.",
    bestFor: "Retreats, experiential training, nature and wellbeing businesses.",
    purposes: ["event", "service", "waitlist"], status: "starter", selectable: true, previewPath: null,
  },
] as const;

const LANDING_PAGE_DESIGN_PACK_ID_SET = new Set<string>(
  LANDING_PAGE_DESIGN_PACK_IDS,
);

export function isLandingPageDesignPackId(
  value: unknown,
): value is LandingPageDesignPackId {
  return (
    typeof value === "string" && LANDING_PAGE_DESIGN_PACK_ID_SET.has(value)
  );
}

export function normalizeLandingPageDesignPackId(
  value: unknown,
): LandingPageDesignPackId | null {
  return isLandingPageDesignPackId(value) ? value : null;
}

export function getLandingPageDesignPack(
  designPackId: LandingPageDesignPackId,
): LandingPageDesignPackDefinition {
  return (
    LANDING_PAGE_DESIGN_PACKS.find((pack) => pack.id === designPackId) ||
    LANDING_PAGE_DESIGN_PACKS[0]
  );
}

export function getSelectableLandingPageDesignPacks(): LandingPageDesignPackDefinition[] {
  return LANDING_PAGE_DESIGN_PACKS.filter((pack) => pack.selectable);
}

export function landingPageDesignPackSupportsPurpose(
  designPackId: LandingPageDesignPackId,
  purpose: LandingPageDesignPackPurpose,
): boolean {
  return getLandingPageDesignPack(designPackId).purposes.includes(purpose);
}

export function getDefaultLandingPageDesignPackId(
  purpose: LandingPageDesignPackPurpose,
): LandingPageDesignPackId {
  if (purpose === "event") return "starter-event-01";
  if (purpose === "waitlist") return "starter-waitlist-01";
  return "starter-service-01";
}
