import { API_BASE } from "../api";

/**
 * Contact avatars live on other people's installs. Served through the owner's
 * own Worker, a dead install costs a short timeout once instead of a twenty
 * second wait on every page, and the edge keeps a copy.
 */
export function proxiedAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (!/^https:\/\//i.test(url)) return url;
  try {
    const target = new URL(url);
    if (typeof window !== "undefined" && target.host === window.location.host) return url;
  } catch {
    return url;
  }
  return `${API_BASE}/contacts/avatar?url=${encodeURIComponent(url)}`;
}
