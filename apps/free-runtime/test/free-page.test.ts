import { describe, expect, it, vi } from "vitest";
import { freeApiAccess } from "../src/policy";
import { freePageRequest, isFreePagePath } from "../src/free-page";

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
