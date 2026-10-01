import type { Env } from "./types";
import { getAiGatewayRuntimeConfig } from "./ai-gateway";

export type VoiceTranscriptionProviderId =
  | "cloudflare-whisper"
  | "browser-speech"
  | "local-whisper"
  | "qwen3-asr";

export type VoiceTranscriptionResult = {
  providerId: VoiceTranscriptionProviderId;
  model: string;
  text: string;
  wordCount: number | null;
  language: string | null;
};

type CloudflareWhisperResponse = {
  text?: unknown;
  word_count?: unknown;
  language?: unknown;
};

const DEFAULT_PROVIDER_ID: VoiceTranscriptionProviderId = "cloudflare-whisper";
const DEFAULT_CLOUDFLARE_WHISPER_MODEL = "@cf/openai/whisper-large-v3-turbo";
export const VOICE_DICTATION_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

export class VoiceDictationInputError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "VoiceDictationInputError";
  }
}

export async function transcribeVoiceDictation(
  env: Env,
  audio: Blob,
  options: { language?: string | null; ownerId?: string | null } = {},
): Promise<VoiceTranscriptionResult> {
  if (!(audio instanceof Blob)) {
    throw new VoiceDictationInputError("Audio file is required");
  }
  if (audio.size <= 0) {
    throw new VoiceDictationInputError("Audio file is empty");
  }
  if (audio.size > VOICE_DICTATION_MAX_AUDIO_BYTES) {
    throw new VoiceDictationInputError("Audio file is too large", 413);
  }

  const providerId = normalizeProviderId(env.ME3_VOICE_TRANSCRIPTION_PROVIDER);
  if (providerId !== "cloudflare-whisper") {
    throw new VoiceDictationInputError(
      `${providerId} voice transcription is not available in this Core build yet`,
      501,
    );
  }

  return transcribeWithCloudflareWhisper(env, audio, options);
}

function normalizeProviderId(value: unknown): VoiceTranscriptionProviderId {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_PROVIDER_ID;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "cloudflare-whisper" ||
    normalized === "browser-speech" ||
    normalized === "local-whisper" ||
    normalized === "qwen3-asr"
  ) {
    return normalized;
  }
  return DEFAULT_PROVIDER_ID;
}

async function transcribeWithCloudflareWhisper(
  env: Env,
  audio: Blob,
  options: { language?: string | null; ownerId?: string | null },
): Promise<VoiceTranscriptionResult> {
  if (!env.AI) {
    throw new VoiceDictationInputError("Cloudflare Workers AI is not configured", 503);
  }

  const model = normalizeModel(env.ME3_VOICE_TRANSCRIPTION_MODEL);
  const audioBytes = new Uint8Array(await audio.arrayBuffer());
  const input =
    model === "@cf/openai/whisper"
      ? { audio: [...audioBytes] }
      : {
          audio: bytesToBase64(audioBytes),
          ...(options.language ? { language: options.language } : {}),
        };

  const aiGateway = options.ownerId
    ? await getAiGatewayRuntimeConfig(env, options.ownerId).catch(() => null)
    : null;
  const response = await env.AI.run(model, input, {
    gateway: { id: env.ME3_DEPLOYMENT_MODE?.trim().toLowerCase() === "managed"
      ? env.CLOUDFLARE_AI_GATEWAY_ID?.trim() || "default"
      : aiGateway?.gatewayId || "default" },
  }) as CloudflareWhisperResponse;
  const text = normalizeTranscriptText(response.text);
  if (!text) {
    throw new VoiceDictationInputError("Transcription returned no text", 502);
  }

  return {
    providerId: "cloudflare-whisper",
    model,
    text,
    wordCount: typeof response.word_count === "number" ? response.word_count : null,
    language: typeof response.language === "string" ? response.language : null,
  };
}

function normalizeModel(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return DEFAULT_CLOUDFLARE_WHISPER_MODEL;
  return value.trim();
}

function normalizeTranscriptText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim();
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}
