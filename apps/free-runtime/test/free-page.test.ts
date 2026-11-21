import { describe, expect, it, vi } from "vitest";
import { freeApiAccess } from "../src/policy";
import { freePageRequest, isFreePagePath, publicPageFromFreePage } from "../src/free-page";

// Failure modes: the editor reaches Cloud routes other than the free page; the service token or the user's
// own ME3 token is sent to the wrong place (the user's token must never reach Cloud, the service token must
// never reach the app); a response hands the app a Cloud cookie; an upload loses its body or content type;
// Cloud being down surfaces as a crash instead of a clear error.
const config = { cloudApiOrigin: "https://api.example.test", serviceToken: "service-secret", userId: "u_1" };

describe("free page editor proxy", () => {
  it("recognises only the editor's paths", () => {
    for (const path of ["/api/free/page", "/api/free/page/handles/ada/available", "/api/free/page/media/avatar", "/api/free/page/media/banner"]) {
      expect(isFreePagePath(path), path).toBe(true);
      expect(freeApiAccess("GET", path, { news: false }), path).toBe("allow");
    }
    for (const path of ["/api/free/page/media/other", "/api/free/pagex", "/api/free", "/api/free/page/handles/a/b/available"]) expect(isFreePagePath(path), path).toBe(false);
  });

  it("forwards to Cloud's starter profile as the user, with the service token and none of the app's credentials", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true, profile: { name: "Ada" } }, { headers: { "set-cookie": "session=abc", "cache-control": "no-store" } }));
    const request = new Request("https://free.example.test/api/free/page", { method: "POST", headers: { authorization: "Bearer me3mat_user", cookie: "x=1", "content-type": "application/json" }, body: JSON.stringify({ name: "Ada" }) });
    const response = await freePageRequest(request, config, fetcher);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/api/profile/starter");
    const sent = new Headers(init.headers);
    expect(sent.get("authorization")).toBe("Bearer service-secret");
    expect(sent.get("x-me3-free-runtime-user")).toBe("u_1");
    expect(sent.get("cookie")).toBeNull();
    const sentValues: string[] = [];
    sent.forEach((value) => sentValues.push(value));
    expect(sentValues.join(" ")).not.toContain("me3mat_user");
    expect(await new Response(init.body as BodyInit).text()).toBe(JSON.stringify({ name: "Ada" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({ ok: true, profile: { name: "Ada" } });
  });

  it("maps the other paths and keeps an upload's content type", async () => {
    const fetcher = vi.fn(async () => Response.json({ ok: true }));
    await freePageRequest(new Request("https://free.example.test/api/free/page/handles/Ada%20L/available"), config, fetcher);
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe("https://api.example.test/api/profile/starter/handles/Ada%20L/available");
    await freePageRequest(new Request("https://free.example.test/api/free/page/media/avatar", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=xyz" }, body: "--xyz--" }), config, fetcher);
    const [url, init] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.example.test/api/profile/starter/media/avatar");
    expect(new Headers(init.headers).get("content-type")).toBe("multipart/form-data; boundary=xyz");
  });

  it("answers plainly when Cloud cannot be reached or the runtime is not set up for it", async () => {
    const down = await freePageRequest(new Request("https://free.example.test/api/free/page"), config, vi.fn(async () => { throw new Error("down"); }));
    expect(down.status).toBe(502);
    expect((await down.json() as { error: string }).error).toMatch(/try again/i);
    const unset = await freePageRequest(new Request("https://free.example.test/api/free/page"), { ...config, serviceToken: "" }, vi.fn());
    expect(unset.status).toBe(503);
  });
});

// Failure modes (owner device test, 21 Nov 2026): after saving a photo in the app, the avatar showed
// nowhere, because this ME3 never learned the photo's address; a page with no photo keeps a stale one; a
// failed or malformed Cloud response wipes the owner's name.
import { ownerFieldsFromFreePage } from "../src/free-page";

describe("owner details taken from the saved page", () => {
  const origin = "https://api.example.test";
  it("takes the name, handle and the public address of the photo", () => {
    const fields = ownerFieldsFromFreePage({ user: { handle: "ada" }, profile: { name: " Ada ", avatar: "/files/avatar.jpg" } }, origin, 1700)!;
    expect(fields).toEqual({ name: "Ada", handle: "ada", avatarUrl: "https://api.example.test/api/profile/public/ada/media/avatar?v=1700" });
  });
  it("clears the photo when the page has none, or no address to serve it from", () => {
    expect(ownerFieldsFromFreePage({ user: { handle: "ada" }, profile: { name: "Ada", avatar: null } }, origin, 1)!.avatarUrl).toBeNull();
    expect(ownerFieldsFromFreePage({ user: { handle: null }, profile: { name: "Ada", avatar: "/files/avatar.jpg" } }, origin, 1)!.avatarUrl).toBeNull();
  });
  it("gives nothing for a response that is not a page", () => {
    expect(ownerFieldsFromFreePage({ error: "nope" }, origin, 1)).toBeNull();
    expect(ownerFieldsFromFreePage(null, origin, 1)).toBeNull();
  });
});

// Failure modes: a private page's bio or town reaches News or the agent; an empty page yields an empty object
// that hides "no page"; a long bio floods the prompt.
describe("the page News may use", () => {
  const page = (profile: Record<string, unknown>) => ({ ok: true, profile });
  const town = { label: "Ennis, Ireland", locality: "Ennis", countryCode: "IE", latitude: 52.8, longitude: -8.98, precision: "locality" };

  it("gives the bio and town of a public page", () => {
    expect(publicPageFromFreePage(page({ visibility: "public", bio: "  Potter in Clare.  ", location: "Ennis, Ireland", locationData: town })))
      .toEqual({ bio: "Potter in Clare.", location: "Ennis, Ireland", locationData: town });
    expect(publicPageFromFreePage(page({ visibility: "public", bio: "x".repeat(900) }))?.bio).toHaveLength(600);
  });

  it("gives nothing for a private page, an empty page, or something that is not a page", () => {
    expect(publicPageFromFreePage(page({ visibility: "private", bio: "Potter", location: "Ennis, Ireland", locationData: town }))).toBeNull();
    expect(publicPageFromFreePage(page({ visibility: "public", bio: " ", location: null, locationData: null }))).toBeNull();
    expect(publicPageFromFreePage({ ok: false })).toBeNull();
    expect(publicPageFromFreePage(null)).toBeNull();
  });
});
