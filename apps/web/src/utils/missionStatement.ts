import { api } from "../api";

// The dashboard API falls back to a fill-in-the-blanks template
// ("I am here to help [who/what]…") when the owner has not written a mission.
// Treat that template as no mission so pages prompt for one instead of showing it.
export function ownMissionStatement(statement: string | null | undefined): string {
  const text = statement?.trim() || "";
  return /\[[^\]]+\]/.test(text) ? "" : text;
}

type ProfileSite = { username: string; site_role?: string | null; published_at?: string | null };

// ME3 reads the mission from the profile's me.json (business.positioningStatement), so it saves through the same
// upload the Site editor uses. That upload republishes, so a profile that wasn't published is put back.
export async function saveMissionStatement(statement: string): Promise<void> {
  const { sites } = await api.get<{ sites: ProfileSite[] }>("/sites");
  const site = sites.find(item => item.site_role === "profile");
  const profile = site && (await api.get<{ profile: Record<string, unknown> | null }>(`/sites/${encodeURIComponent(site.username)}/content`)).profile;
  if (!site || !profile) throw new Error("Set up your ME3 profile first, then your mission can be saved.");
  const business = typeof profile.business === "object" && profile.business ? profile.business as Record<string, unknown> : {};
  const form = new FormData();
  form.append("files", new File([JSON.stringify({ ...profile, business: { ...business, positioningStatement: statement.trim() } }, null, 2)], "me.json", { type: "application/json" }));
  await api.upload(`/sites/${encodeURIComponent(site.username)}/upload`, form);
  if (!site.published_at) await api.post(`/sites/${encodeURIComponent(site.username)}/unpublish`);
}
