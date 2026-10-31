// The new owner's first site in Chat, matching the iOS/Android first run (me3-5u97.2, me3-56rr):
// ask card -> site draft approval card -> live card -> people rows -> free call booking.
// These are the shapes and messages the cards use; the cards stay thin.

export type FirstSiteApproval = {
  id: string;
  actionId?: string;
  threadId?: string | null;
  status?: string;
  requestedAt?: string;
  resolvedAt?: string | null;
  payload?: Record<string, unknown>;
};

export type SiteDraftView = {
  approvalId: string;
  username: string;
  name: string;
  publicUrl: string;
  theme: string;
  themes: Array<{ id: string; name: string }>;
  searchQuery: string;
  hasPhoto: boolean;
  howItWorks: string;
};

export type FreeCallView = {
  approvalId: string;
  with: string;
  title: string;
  durationMinutes: number | null;
  slotLabel: string;
  publicUrl: string;
  howItWorks: string;
};

export type PersonRow = {
  key: string;
  name: string;
  bio: string;
  location: string;
  url: string;
  avatarUrl: string;
  self: boolean;
  /** A free call (a duration and no price) the assistant can book for the owner. */
  freeCall: { title: string } | null;
};

export const SITE_DRAFT_TOOL = "core_sites_starter_draft";
export const FREE_CALL_TOOL = "core_scheduling_book_free_call";
export const PEOPLE_SEARCH_TOOL = "core_people_search";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function siteBuildMessage(work: string, links = ""): string {
  const about = work.trim();
  const extra = links.trim();
  return `Build my website. About my work: ${about}${extra ? `\nMy website or social links: ${extra}` : ""}`;
}

export function showMeMessage(searchQuery: string): string {
  const query = searchQuery.trim();
  return `Show me how an assistant finds me: search the ME3 network for ${query ? `"${query}"` : "what I offer"}, include my own listing, and show me what they'd see.`;
}

export function findPersonMessage(name: string): string {
  return `Find ${name.trim().replace(/[.\s]+$/, "")} on ME3.`;
}

export function bookCallMessage(callTitle: string, name: string): string {
  return `Book the ${callTitle} with ${name} for me.`;
}

export function siteDraftView(approval: FirstSiteApproval | null | undefined): SiteDraftView | null {
  const card = record(approval?.payload);
  if (!approval || card.kind !== "site_draft" || !text(card.username)) return null;
  const themes = Array.isArray(card.themes)
    ? card.themes.flatMap(theme => { const t = record(theme); return text(t.id) ? [{ id: text(t.id), name: text(t.name) || text(t.id) }] : []; })
    : [];
  return {
    approvalId: approval.id,
    username: text(card.username),
    name: text(card.name),
    publicUrl: text(card.publicUrl),
    theme: text(card.theme) || themes[0]?.id || "warm",
    themes,
    searchQuery: text(card.searchQuery),
    hasPhoto: card.hasPhoto === true,
    howItWorks: text(card.howItWorks),
  };
}

export function freeCallView(approval: FirstSiteApproval | null | undefined): FreeCallView | null {
  const card = record(approval?.payload);
  if (!approval || card.kind !== "free_call_booking") return null;
  const plan = record(card.plan);
  const offering = record(plan.offering);
  const slot = record(plan.slot);
  return {
    approvalId: approval.id,
    with: text(plan.with) || "them",
    title: text(offering.title) || "Free call",
    durationMinutes: typeof offering.durationMinutes === "number" ? offering.durationMinutes : null,
    slotLabel: text(slot.label),
    publicUrl: text(plan.publicUrl),
    howItWorks: text(card.howItWorks),
  };
}

/** Plain text from a short markdown bio: no links, emphasis or headings in a one-line row. */
export function plainBio(value: unknown): string {
  return text(value)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`~>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** People found by core_people_search, from the tool result's data. The owner's own listing is marked self. */
export function peopleRows(data: unknown): PersonRow[] {
  const results = record(data).results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((entry, index) => {
    const person = record(entry);
    const name = text(person.name);
    if (!name) return [];
    const offerings = Array.isArray(person.offerings) ? person.offerings.map(record) : [];
    const free = offerings.find(offering => typeof offering.durationMinutes === "number" && !record(offering.price).amount && text(offering.title));
    return [{
      key: text(person.profileId) || `${name}-${index}`,
      name,
      bio: plainBio(person.bio),
      location: text(record(person.location).label),
      url: text(person.publicUrl) || text(person.profileUrl),
      avatarUrl: text(person.avatarUrl),
      self: person.self === true,
      freeCall: free ? { title: text(free.title) } : null,
    }];
  });
}

export function initials(name: string): string {
  const words = name.replace(/\([^)]*\)/g, " ").trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[words.length - 1][0]}` : (words[0] || "?").slice(0, 2)).toUpperCase();
}

/** Newest first: the latest decision for each kind in this thread wins. */
export function latestFor(approvals: FirstSiteApproval[], tool: string, threadId: string | null) {
  return approvals
    .filter(approval => approval.actionId === tool && (!threadId || approval.threadId === threadId))
    .sort((a, b) => (b.resolvedAt || b.requestedAt || "").localeCompare(a.resolvedAt || a.requestedAt || ""));
}

const FIRST_RUN_KEY = "me3.firstRun.handled.";
/** First landing on web: once per owner and browser, and only while the site has no bio yet. */
export function shouldStartFirstRun(storage: Pick<Storage, "getItem"> | null, ownerKey: string, siteBio: string | null | undefined): boolean {
  if (!ownerKey || text(siteBio)) return false;
  try { return storage?.getItem(FIRST_RUN_KEY + ownerKey) !== "1"; } catch { return false; }
}
export function markFirstRunHandled(storage: Pick<Storage, "setItem"> | null, ownerKey: string) {
  try { storage?.setItem(FIRST_RUN_KEY + ownerKey, "1"); } catch { /* private mode: it may show again */ }
}

type SiteListEntry = { username: string; site_role?: string | null; site_type?: string | null };
type GetJson = <T>(endpoint: string) => Promise<T>;
/** The owner's profile site and its bio, as the Home strip and first landing need them. Null while there is none. */
export async function loadProfileSite(get: GetJson): Promise<{ username: string; bio: string } | null> {
  const { sites } = await get<{ sites: SiteListEntry[] }>("/sites");
  const site = sites.find(entry => entry.site_role === "profile" || (!entry.site_role && (entry.site_type || "profile") === "profile"));
  if (!site) return null;
  const content = await get<{ profile?: { bio?: unknown } | null }>(`/sites/${encodeURIComponent(site.username)}/content`).catch(() => null);
  return { username: site.username, bio: text(content?.profile?.bio) };
}
