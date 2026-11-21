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
