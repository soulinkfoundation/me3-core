import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebResearchToolServices } from "./web-research";
import type { Env } from "./types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Worker public web research adapter", () => {
  it("uses the OpenAI Responses web-search tool and normalizes source citations", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const aiRun = vi.fn(async (_model: string, input: unknown) => {
        requestBody = input as Record<string, unknown>;
        return {
          id: "response-123",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "Cloudflare released Browser Run [1].",
                  annotations: [
                    {
                      type: "url_citation",
                      url: "https://developers.cloudflare.com/agents/tools/browser/",
                      title: "Browser Run",
                      start_index: 38,
                      end_index: 41,
                    },
                  ],
                },
              ],
            },
          ],
          usage: { input_tokens: 12, output_tokens: 9 },
        };
      });

    const service = createWebResearchToolServices(
      {
        DB: {} as D1Database,
        AI: { run: aiRun } as unknown as Ai,
      } as Env,
      "owner",
    );
    const result = await service.search({
      query: "What is Cloudflare Browser Run?",
      resultLimit: 3,
      freshness: { kind: "max_age", maxAgeSeconds: 86_400 },
    });

    expect(requestBody).toMatchObject({
      model: "openai/gpt-4o-mini",
      tools: [{ type: "web_search_preview" }],
    });
    expect(aiRun).toHaveBeenCalledWith(
      "openai/gpt-4o-mini",
      expect.any(Object),
      { gateway: { id: "default" } },
    );
    expect(result).toMatchObject({
      status: "success",
      answer: "Cloudflare released Browser Run [1].",
      usage: { inputTokens: 12, outputTokens: 9 },
      trace: {
        providerId: "me3-web-search",
        adapterId: "me3-web-search-v1",
        providerRequestId: "response-123",
      },
    });
    if (result.status !== "success") return;
    expect(result.sources[0]).toMatchObject({
      url: "https://developers.cloudflare.com/agents/tools/browser/",
      title: "Browser Run",
    });
    expect(result.citations[0]).toMatchObject({
      label: "1",
      sourceId: result.sources[0]?.id,
      answerSpan: { start: 32, end: 35 },
    });
  });

  it("uses the configured Workers AI binding through AI Gateway", async () => {
    const aiRun = vi.fn().mockResolvedValue({
      id: "gateway-response-1",
      output_text: "The answer is [1].",
      output: [
        {
          type: "url_citation",
          url: "https://example.com/source",
          title: "Example source",
        },
      ],
    });
    const db = {
      prepare() {
        return {
          bind() {
            return { first: async () => null };
          },
        };
      },
    } as unknown as D1Database;

    const service = createWebResearchToolServices(
      {
        DB: db,
        AI: { run: aiRun } as unknown as Ai,
        CLOUDFLARE_ACCOUNT_ID: "account-test",
        CLOUDFLARE_API_TOKEN: "token-test",
        ME3_WEB_SEARCH_MODEL: "openai/gpt-4o-mini",
      } as Env,
      "owner",
    );
    const result = await service.search({ query: "latest Cloudflare news" });

    expect(aiRun).toHaveBeenCalledWith(
      "openai/gpt-4o-mini",
      expect.objectContaining({ tools: [{ type: "web_search_preview" }] }),
      { gateway: { id: "default" } },
    );
    expect(result.status).toBe("success");
  });

  it("uses the managed AI binding with the default gateway and curated search model", async () => {
    const aiRun = vi.fn().mockResolvedValue({
      id: "managed-response-1",
      output_text: "The managed answer is [1].",
      output: [
        {
          type: "url_citation",
          url: "https://example.com/managed-source",
          title: "Managed source",
        },
      ],
    });
    const db = {
      prepare() {
        return {
          bind() {
            return { first: async () => null };
          },
        };
      },
    } as unknown as D1Database;

    const service = createWebResearchToolServices(
      {
        DB: db,
        AI: { run: aiRun } as unknown as Ai,
        ME3_DEPLOYMENT_MODE: "managed",
      } as Env,
      "owner",
    );
    const result = await service.search({ query: "managed current web question" });

    expect(aiRun).toHaveBeenCalledWith(
      "openai/gpt-5.4-mini",
      expect.objectContaining({ tools: [{ type: "web_search_preview" }] }),
      { gateway: { id: "default" } },
    );
    expect(result.status).toBe("success");
  });

  it("opens a public page with bounded readable content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `<!doctype html><html><head><title>Example article</title><link rel="canonical" href="/canonical"></head><body><main><h1>Example article</h1><p>Readable article content.</p></main></body></html>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        )),
    );

    const service = createWebResearchToolServices(
      { DB: {} as D1Database } as Env,
      "owner",
    );
    const result = await service.open({
      url: "https://example.com/article",
      maxCharacters: 20,
    });

    expect(result).toMatchObject({
      status: "success",
      retrievalMode: "static",
      source: {
        url: "https://example.com/article",
        canonicalUrl: "https://example.com/canonical",
        title: "Example article",
      },
      evidence: {
        text: "Example article\nRead",
      },
      truncated: true,
    });
  });

  it("honors a page's AI-input opt-out and rejects private URLs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("private content", {
          headers: {
            "content-type": "text/plain",
            "content-signal": "ai-input=no",
          },
        })),
    );
    const service = createWebResearchToolServices(
      { DB: {} as D1Database } as Env,
      "owner",
    );

    const optedOut = await service.open({ url: "https://example.com/article" });
    expect(optedOut).toMatchObject({
      status: "error",
      error: { code: "policy_denied" },
    });
    await expect(
      service.open({ url: "http://127.0.0.1/private" }),
    ).rejects.toThrow("request.url");
  });

  it("returns a clear setup error when no search provider is configured", async () => {
    const service = createWebResearchToolServices(
      { DB: {} as D1Database } as Env,
      "owner",
    );
    const result = await service.search({ query: "search without a provider" });

    expect(result).toMatchObject({
      status: "error",
      error: { code: "not_configured" },
    });
  });
});
