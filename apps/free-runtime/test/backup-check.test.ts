import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAnthropicByokPause } from "../../../packages/agent/src/model";
import { backupCheck } from "../src/backup-check";

// Failure modes: the probe reports DeepSeek's API while Workers AI actually answered, or a dead key hides
// behind the Workers AI fallback.
const sse = (events: unknown[]) => new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
const reply = [{ choices: [{ delta: { content: "Lots." } }] }, { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 3 } }];
const env = (workersAi: () => unknown) => ({
  CLOUDFLARE_AI_GATEWAY_ID: "me3-free", CLOUDFLARE_AI_GATEWAY_TOKEN: "aig", DEEPSEEK_BYOK_ALIAS: "me3-free-deepseek",
  ME3_AI_CHAT_MODEL: "claude-haiku-5.5", ME3_AI_CHAT_BACKUP_MODEL: "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
  AI: { run: async () => workersAi(), gateway: () => ({ getUrl: async (provider: string) => `https://gateway.example/v1/acct/me3-free/${provider}/` }) },
}) as never;

describe("backup check", () => {
  afterEach(() => { vi.unstubAllGlobals(); resetAnthropicByokPause(); });
  it("answers a forced Haiku 429 from DeepSeek's own API", async () => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => sse(reply));
    vi.stubGlobal("fetch", fetch);
    const result = await backupCheck(env(() => { throw new Error("Workers AI should not run"); }));
    expect(result).toMatchObject({ ok: true, provider: "deepseek", deepseekKey: true, text: "Lots.", primaryError: expect.stringContaining("429") });
    expect(fetch.mock.calls[0][0]).toBe("https://gateway.example/v1/acct/me3-free/deepseek/chat/completions");
  });
  it("says Workers AI answered when the DeepSeek key fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
    const result = await backupCheck(env(() => sse(reply).body));
    expect(result).toMatchObject({ ok: true, provider: "workers-ai" });
  });
});
