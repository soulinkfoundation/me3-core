import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { api } from "../api";
import {
  useSocialStore,
  type PostVersion,
  type Publication,
  type PostingPlan,
  type SocialPostDetail,
  type SocialSuggestion,
} from "./social";

vi.mock("../api", () => ({
  API_BASE: "/api",
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class extends Error {},
}));

describe("social store Post workflow", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads source-backed Posts for one site", async () => {
    vi.mocked(api.get).mockResolvedValue({ posts: [{ post: { id: "post-1" }, versions: [] }] });

    const result = await useSocialStore().fetchSocialPosts("site one");

    expect(result).toHaveLength(1);
    expect(api.get).toHaveBeenCalledWith("/social/posts?siteId=site%20one");
  });

  it("creates a Post from explicit pasted Source text", async () => {
    const input = {
      siteId: "site-1",
      sourceType: "pasted" as const,
      sourceSnapshot: "Owner-authored source",
      sourceText: "Owner-authored source",
      ideaText: "Owner-authored source",
      versions: [{ platform: "linkedin" as const, bodyText: "Owner-authored source" }],
    };
    const post = { post: { id: "post-1" }, versions: [] };
    vi.mocked(api.post).mockResolvedValue({ post });

    expect(await useSocialStore().createSocialPost(input)).toBe(post);
    expect(api.post).toHaveBeenCalledWith("/social/posts", input);
  });

  it("loads and saves text carousel templates and a Post's slides", async () => {
    const template = { id: "t1", siteId: "site-1", name: "My site", settings: {} };
    const carousel = { postId: "post-1", templateId: "t1", slides: [], fileIds: [], updatedAt: "now" };
    vi.mocked(api.get).mockResolvedValueOnce({ templates: [template] }).mockResolvedValueOnce({ carousel });
    vi.mocked(api.patch).mockResolvedValue({ template });
    vi.mocked(api.put).mockResolvedValue({ carousel });
    const store = useSocialStore();

    expect(await store.fetchCarouselTemplates("site 1")).toEqual([template]);
    expect(api.get).toHaveBeenCalledWith("/social/carousel-templates?siteId=site%201");
    expect(await store.fetchTextCarousel("post-1")).toEqual(carousel);
    expect(api.get).toHaveBeenCalledWith("/social/posts/post-1/text-carousel");
    await store.updateCarouselTemplate("t1", { name: "Renamed" });
    expect(api.patch).toHaveBeenCalledWith("/social/carousel-templates/t1", { name: "Renamed" });
    await store.saveTextCarousel("post-1", { templateId: "t1", slides: [], fileIds: ["f1"] });
    expect(api.put).toHaveBeenCalledWith("/social/posts/post-1/text-carousel", { templateId: "t1", slides: [], fileIds: ["f1"] });
  });

  it("searches the Post library and writes or deletes owner drafts through canonical APIs", async () => {
    const item = { postId: "post-1", versionId: "version-1" };
    const post = { post: { id: "post-1" }, versions: [] };
    vi.mocked(api.get).mockResolvedValue({ items: [item] });
    vi.mocked(api.patch).mockResolvedValue({ post });
    const store = useSocialStore();

    expect(await store.searchPostLibrary({
      siteId: "site one",
      query: "launch notes",
      approvalStatus: "approved",
      publishedFrom: "2026-07-01T00:00:00.000Z",
      limit: 100,
    })).toEqual([item]);
    expect(api.get).toHaveBeenCalledWith(
      "/social/library?siteId=site+one&query=launch+notes&approvalStatus=approved&publishedFrom=2026-07-01T00%3A00%3A00.000Z&limit=100",
    );

    expect(await store.updateSocialPost("post one", {
      title: "Launch update",
      tags: ["launch"],
      expectedUpdatedAt: "2026-07-18T08:00:00.000Z",
    })).toBe(post);
    expect(api.patch).toHaveBeenCalledWith("/social/posts/post%20one", {
      title: "Launch update",
      tags: ["launch"],
      expectedUpdatedAt: "2026-07-18T08:00:00.000Z",
    });

    await store.deleteSocialPost("post one", "2026-07-18T08:00:00.000Z");
    expect(api.delete).toHaveBeenCalledWith(
      "/social/posts/post%20one?expectedUpdatedAt=2026-07-18T08%3A00%3A00.000Z",
    );
  });

  it("saves Preferred posting times and keeps plan proposal separate from explicit confirmation", async () => {
    const preference = {
      accountId: "account-1",
      timezone: "Europe/Dublin",
      times: [{ day: "monday", localTime: "09:00" }],
      minimumGapMinutes: 120,
      minimumRepostDays: 30,
    };
    const plan = {
      id: "plan-1",
      updatedAt: "2026-07-18T09:00:00.000Z",
      status: "suggested",
    } as PostingPlan;
    vi.mocked(api.get).mockResolvedValueOnce({ preference }).mockResolvedValueOnce({ plan });
    vi.mocked(api.put).mockResolvedValue({ preference });
    vi.mocked(api.post).mockResolvedValue({ plan });
    const store = useSocialStore();

    expect(await store.fetchPreferredPostingTimes("account one")).toBe(preference);
    expect(api.get).toHaveBeenCalledWith(
      "/social/accounts/account%20one/preferred-posting-times",
    );
    await store.updatePreferredPostingTimes("account-1", {
      timezone: "Europe/Dublin",
      times: [{ day: "monday", localTime: "09:00" }],
      minimumGapMinutes: 120,
      minimumRepostDays: 30,
    });
    expect(api.put).toHaveBeenCalledWith(
      "/social/accounts/account-1/preferred-posting-times",
      expect.objectContaining({ minimumGapMinutes: 120 }),
    );

    const proposal = {
      accountId: "account-1",
      windowStart: "2026-07-20T00:00:00.000Z",
      windowEnd: "2026-07-27T00:00:00.000Z",
      count: 1,
    };
    await store.createPostingPlan(proposal);
    expect(api.post).toHaveBeenCalledWith("/social/posting-plans", proposal);
    expect(await store.fetchPostingPlan("plan one")).toBe(plan);
    expect(api.get).toHaveBeenCalledWith("/social/posting-plans/plan%20one");
    await store.confirmPostingPlan(plan);
    expect(api.post).toHaveBeenCalledWith("/social/posting-plans/plan-1/confirm", {
      confirmed: true,
      expectedUpdatedAt: plan.updatedAt,
    });
  });

  it("loads, edits, discards, and chooses grounded Suggestions", async () => {
    const suggestion = {
      id: "suggestion-1",
      bodyText: "Grounded text",
      updatedAt: "2026-07-18T08:00:00.000Z",
    } as SocialSuggestion;
    const post = {
      post: {
        id: "post-1",
        siteId: "site-1",
        sourceType: "journal",
        sourceRef: "journal:journal-1",
        sourceTitle: "Grounded Source",
        sourceSnapshot: '{"id":"journal-1"}',
        sourceText: "Grounded Source text",
        ideaText: "Grounded text",
        tags: [],
        goal: null,
        status: "ready",
        createdBy: "user",
        createdAt: "2026-07-18T08:00:00.000Z",
        updatedAt: "2026-07-18T08:00:00.000Z",
      },
      versions: [],
    } satisfies SocialPostDetail;
    vi.mocked(api.get).mockResolvedValue({ suggestions: [suggestion] });
    vi.mocked(api.patch).mockResolvedValue({ suggestion });
    vi.mocked(api.delete).mockResolvedValue({ suggestion });
    vi.mocked(api.post).mockResolvedValue({ suggestion, post });
    const store = useSocialStore();

    expect(await store.fetchSocialSuggestions("site one")).toEqual([suggestion]);
    expect(api.get).toHaveBeenCalledWith("/social/suggestions?siteId=site%20one");
    expect(
      await store.updateSocialSuggestion("suggestion one", {
        bodyText: "Grounded text",
        expectedUpdatedAt: suggestion.updatedAt,
      }),
    ).toBe(suggestion);
    expect(api.patch).toHaveBeenCalledWith("/social/suggestions/suggestion%20one", {
      bodyText: "Grounded text",
      expectedUpdatedAt: suggestion.updatedAt,
    });
    expect(
      await store.discardSocialSuggestion("suggestion one", suggestion.updatedAt),
    ).toBe(suggestion);
    expect(api.delete).toHaveBeenCalledWith(
      "/social/suggestions/suggestion%20one?expectedUpdatedAt=2026-07-18T08%3A00%3A00.000Z",
    );
    expect(
      await store.chooseSocialSuggestion(
        "suggestion one",
        ["linkedin", "x"],
        suggestion.updatedAt,
      ),
    ).toEqual({ suggestion, post });
    expect(api.post).toHaveBeenCalledWith("/social/suggestions/suggestion%20one/post", {
      platforms: ["linkedin", "x"],
      expectedUpdatedAt: suggestion.updatedAt,
    });
  });

  it("updates one exact Post Version", async () => {
    const version = {
      id: "version-1",
      postId: "post-1",
      platform: "linkedin",
      approvalStatus: "approved",
    } as PostVersion;
    vi.mocked(api.patch).mockResolvedValue({ version });

    const result = await useSocialStore().updatePostVersion("version-1", {
      targetAccountId: "account-1",
      approvalStatus: "approved",
    });

    expect(result).toBe(version);
    expect(api.patch).toHaveBeenCalledWith("/social/versions/version-1", {
      targetAccountId: "account-1",
      approvalStatus: "approved",
    });
  });

  it("lists Publications for one exact Post Version", async () => {
    const publication = { id: "publication-1", versionId: "version-1" } as Publication;
    vi.mocked(api.get).mockResolvedValue({ publications: [publication] });

    const result = await useSocialStore().listPostVersionPublications("version one");

    expect(result).toEqual([publication]);
    expect(api.get).toHaveBeenCalledWith(
      "/social/versions/version%20one/publications",
    );
  });

  it("creates a scheduled Publication for one exact Post Version", async () => {
    const publication = { id: "publication-1", versionId: "version-1" } as Publication;
    const input = {
      scheduledFor: "2026-08-01T09:00:00.000Z",
      timezone: "Europe/Dublin",
      requestContext: { source: "social-library" },
    };
    vi.mocked(api.post).mockResolvedValue({ publication });

    const result = await useSocialStore().createPostVersionPublication("version-1", input);

    expect(result).toBe(publication);
    expect(api.post).toHaveBeenCalledWith(
      "/social/versions/version-1/publications",
      input,
    );
  });

  it("creates an immediate Publication through the publish action", async () => {
    const publication = { id: "publication-1", versionId: "version-1" } as Publication;
    vi.mocked(api.post).mockResolvedValue({ publication });

    expect(await useSocialStore().publishPostVersion("version-1")).toBe(publication);
    expect(api.post).toHaveBeenCalledWith("/social/versions/version-1/publish", {});
  });

  it("cancels one Publication by Publication id", async () => {
    const publication = { id: "publication-1", versionId: "version-1" } as Publication;
    vi.mocked(api.delete).mockResolvedValue({ publication });

    expect(await useSocialStore().cancelPublication("publication one")).toBe(publication);
    expect(api.delete).toHaveBeenCalledWith("/social/publications/publication%20one");
  });

  it("resolves an ambiguous outcome by Publication id", async () => {
    const publication = { id: "publication-1", versionId: "version-1" } as Publication;
    vi.mocked(api.post).mockResolvedValue({ publication });

    expect(
      await useSocialStore().resolvePublicationOutcome(
        "publication one",
        "published",
        "https://linkedin.example/posts/1",
      ),
    ).toBe(publication);
    expect(api.post).toHaveBeenCalledWith(
      "/social/publications/publication%20one/resolve",
      {
        outcome: "published",
        platformPostUrl: "https://linkedin.example/posts/1",
      },
    );
  });

  it("sends the selected OAuth credential source", async () => {
    vi.mocked(api.post).mockResolvedValue({ url: "https://linkedin.example/oauth" });

    await useSocialStore().startSocialOAuth("linkedin", "site-1", "/social", "byo");

    expect(api.post).toHaveBeenCalledWith("/social/linkedin/authorize", {
      siteId: "site-1",
      returnPath: "/social",
      credentialSource: "byo",
    });
  });
});
