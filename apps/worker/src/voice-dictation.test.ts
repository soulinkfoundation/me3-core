import { describe, expect, it, vi } from "vitest";
import type { Env } from "./types";
import {
  VoiceDictationInputError,
  transcribeVoiceDictation,
} from "./voice-dictation";

describe("voice dictation", () => {
  it("transcribes with the Cloudflare Whisper provider", async () => {
    const run = vi.fn().mockResolvedValue({
      text: "  Draft a launch note.  ",
      word_count: 4,
      language: "en",
    });
    const env = {
      AI: { run },
    } as unknown as Env;

    const result = await transcribeVoiceDictation(env, new Blob(["audio"], { type: "audio/webm" }));

    expect(run).toHaveBeenCalledWith(
      "@cf/openai/whisper-large-v3-turbo",
      expect.objectContaining({ audio: expect.any(String) }),
      { gateway: { id: "default" } },
    );
    expect(result).toEqual({
      providerId: "cloudflare-whisper",
      model: "@cf/openai/whisper-large-v3-turbo",
      text: "Draft a launch note.",
      wordCount: 4,
      language: "en",
    });
  });

  it("routes Cloudflare Whisper through AI Gateway when configured", async () => {
    const run = vi.fn().mockResolvedValue({
      text: "Gateway transcript.",
      word_count: 2,
      language: "en",
    });
    const env = {
      AI: { run },
      CLOUDFLARE_ACCOUNT_ID: "cf-account",
      CLOUDFLARE_API_TOKEN: "cf-token",
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => null,
          }),
        }),
      },
    } as unknown as Env;

    const result = await transcribeVoiceDictation(env, new Blob(["audio"], { type: "audio/webm" }), {
      ownerId: "owner",
    });

    expect(run).toHaveBeenCalledWith(
      "@cf/openai/whisper-large-v3-turbo",
      expect.objectContaining({ audio: expect.any(String) }),
      {
        gateway: {
          id: "default",
        },
      },
    );
    expect(result.text).toBe("Gateway transcript.");
  });

  it("reports setup required when Workers AI is unavailable", async () => {
    await expect(
      transcribeVoiceDictation({} as Env, new Blob(["audio"], { type: "audio/webm" })),
    ).rejects.toMatchObject({
      name: "VoiceDictationInputError",
      message: "Cloudflare Workers AI is not configured",
      status: 503,
    });
  });

  it("keeps future providers explicit instead of silently falling back", async () => {
    await expect(
      transcribeVoiceDictation(
        { ME3_VOICE_TRANSCRIPTION_PROVIDER: "qwen3-asr" } as Env,
        new Blob(["audio"], { type: "audio/webm" }),
      ),
    ).rejects.toBeInstanceOf(VoiceDictationInputError);
  });
});
