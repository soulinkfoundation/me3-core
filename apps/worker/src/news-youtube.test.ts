import { describe, expect, it, vi } from "vitest";
import { collectNewsYouTube, newsYouTubeDeepLink, newsYouTubeReturnPage, readChannels, startNewsYouTube } from "./news-youtube";
import type { Env } from "./types";

const CLOUD = "https://cloud.example";
const env = { ME3_SOCIAL_OAUTH_ORIGIN: CLOUD, CORE_API_ORIGIN: "https://core.example" } as unknown as Env;
const STATE = "s".repeat(32);

describe("Connect YouTube for News", () => {
  it("sends the app to ME3 Cloud with a state and Core's callback for that app", async () => {
    const { url, state } = await startNewsYouTube(env, "https://core.example/api/news/follow/youtube/start", { app: "ios" });
    const target = new URL(url);
    expect(target.origin + target.pathname).toBe(`${CLOUD}/api/social/youtube/news/authorize`);
    expect(target.searchParams.get("state")).toBe(state);
    expect(state).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(target.searchParams.get("core_callback")).toBe("https://core.example/api/news-connect/youtube/callback/ios");
  });

  it("says plainly when the app isn't named or there is no ME3 Cloud", async () => {
    await expect(startNewsYouTube(env, "https://core.example/x", { app: "web" })).rejects.toThrow("works from the ME3 app");
    const selfHosted = { CORE_API_ORIGIN: "https://core.example" } as unknown as Env;
    await expect(startNewsYouTube(selfHosted, "https://core.example/x", { app: "ios" })).rejects.toThrow("needs ME3 Cloud");
  });

  it("forwards only checked tokens or a short error to the app", () => {
    expect(newsYouTubeDeepLink("ios", { state: STATE, handoff: "nyh_abc12345" })).toBe(`me3mobile://news?youtube_state=${STATE}&youtube_handoff=nyh_abc12345`);
    expect(newsYouTubeDeepLink("android", { state: STATE, error: "youtube_no_subscriptions" })).toBe(`me3android://news?youtube_error=youtube_no_subscriptions&youtube_state=${STATE}`);
    expect(newsYouTubeDeepLink("ios", { state: "<script>", handoff: "nyh_abc12345" })).toBe("me3mobile://news?youtube_error=failed");
    expect(newsYouTubeDeepLink("ios", { state: STATE, handoff: "javascript:x" })).toBe(`me3mobile://news?youtube_error=failed&youtube_state=${STATE}`);
    expect(newsYouTubeReturnPage("web", {})).toBeNull();
    expect(newsYouTubeReturnPage("ios", { state: STATE, handoff: "nyh_abc12345" })).toContain("me3mobile://news?youtube_state=");
  });

  it("collects the channel list from ME3 Cloud once", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ channels: [
      { id: "UCFKE7WVJfvaHW5q283SxchA", title: "Yoga With Adriene", image: "https://yt3.example/a.jpg" },
      { id: "UCFKE7WVJfvaHW5q283SxchA", title: "Twice", image: null },
    ] }));
    const result = await collectNewsYouTube(env, { state: STATE, handoff: "nyh_abc12345" }, fetchImpl as unknown as typeof fetch);
    expect(result.channels).toEqual([{ id: "UCFKE7WVJfvaHW5q283SxchA", title: "Yoga With Adriene", image: "https://yt3.example/a.jpg" }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${CLOUD}/api/social/youtube/news/redeem`);
    expect(JSON.parse(String(init.body))).toEqual({ state: STATE, handoff: "nyh_abc12345" });
  });

  it("says when the sign-in has expired", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ error: "gone" }, { status: 404 }));
    await expect(collectNewsYouTube(env, { state: STATE, handoff: "nyh_abc12345" }, fetchImpl as unknown as typeof fetch)).rejects.toThrow("expired");
    await expect(collectNewsYouTube(env, { state: "short", handoff: "nyh_abc12345" })).rejects.toThrow("didn't come back right");
  });

  it("keeps only real channel ids with names", () => {
    expect(readChannels([{ id: "UCFKE7WVJfvaHW5q283SxchA", title: " A ", image: "http://insecure" }, { id: "nope", title: "B" }, "junk"]))
      .toEqual([{ id: "UCFKE7WVJfvaHW5q283SxchA", title: "A", image: null }]);
  });
});
