/**
 * The free me3.app page editor. A free user's public page (name, handle, bio, photo, buttons, links)
 * lives in ME3 Cloud. The apps stay signed in to the user's ME3 here, not to Cloud, so they edit the page
 * through these paths and this runtime forwards to Cloud's starter profile as that user. Nothing about
 * the page is stored here beyond the owner's name and handle.
 */
const FREE_PAGE_PATH = /^\/api\/free\/page(?:\/handles\/[^/]+\/available|\/media\/(?:avatar|banner))?$/;

export const isFreePagePath = (path: string) => FREE_PAGE_PATH.test(path);

export type FreePageConfig = { cloudApiOrigin: string; serviceToken: string; userId: string };

export async function freePageRequest(request: Request, config: FreePageConfig, fetcher: typeof fetch = fetch): Promise<Response> {
  if (!config.serviceToken || !config.userId) return Response.json({ ok: false, error: "Your page can't be edited here yet." }, { status: 503 });
  const url = new URL(request.url);
  const target = `${config.cloudApiOrigin}/api/profile/starter${url.pathname.slice("/api/free/page".length)}${url.search}`;
  // Only what Cloud needs: never the app's own token or cookies.
  const headers = new Headers({ authorization: `Bearer ${config.serviceToken}`, "x-me3-free-runtime-user": config.userId });
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  const hasBody = !["GET", "HEAD"].includes(request.method);
  let response: Response;
  try {
    response = await fetcher(target, { method: request.method, headers, body: hasBody ? await request.arrayBuffer() : undefined, signal: AbortSignal.timeout(20_000) });
  } catch {
    return Response.json({ ok: false, error: "Your page couldn't be reached. Try again in a moment." }, { status: 502 });
  }
  const outgoing = new Headers();
  for (const name of ["content-type", "cache-control", "retry-after"]) {
    const value = response.headers.get(name);
    if (value) outgoing.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers: outgoing });
}

/**
 * What this ME3 keeps about its owner from their page in ME3 Cloud: the name and handle, and the public
 * address of the photo so the apps can show it. Null when the response is not a page.
 */
export function ownerFieldsFromFreePage(body: unknown, cloudApiOrigin: string, version: number): { name: string; handle: string; avatarUrl: string | null } | null {
  const page = body as { user?: { handle?: unknown }; profile?: { name?: unknown; avatar?: unknown } } | null;
  if (!page || typeof page !== "object" || !page.profile || typeof page.profile !== "object") return null;
  const name = typeof page.profile.name === "string" ? page.profile.name.trim() : "";
  const handle = typeof page.user?.handle === "string" ? page.user.handle.trim() : "";
  const hasPhoto = typeof page.profile.avatar === "string" && page.profile.avatar.trim() !== "";
  return { name, handle, avatarUrl: hasPhoto && handle ? `${cloudApiOrigin}/api/profile/public/${encodeURIComponent(handle)}/media/avatar?v=${version}` : null };
}
