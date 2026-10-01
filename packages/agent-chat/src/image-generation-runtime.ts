import type { AgentChatAiRoute } from "./model-runtime";

export const DEFAULT_ASSISTANT_IMAGE_QUALITY = "medium";

export type AssistantImageGenerationUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AssistantImageGenerationResult = {
  bytes: Uint8Array;
  mimeType: string;
  revisedPrompt: string | null;
  usage: AssistantImageGenerationUsage | null;
};

export type AssistantImageUsageEstimate = {
  width: number;
  height: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  pricing: string;
  metadata: Record<string, unknown>;
};

export async function runAssistantImageProviderGeneration(
  route: AgentChatAiRoute,
  prompt: string,
  input: { width: number; height: number },
): Promise<AssistantImageGenerationResult> {
  if (route.providerId === "workers-ai") {
    return runWorkersAiImageGeneration(route, prompt, input);
  }

  throw new Error(`${route.providerId} image generation is not supported yet.`);
}

export function estimateAssistantImageUsage(
  providerId: AgentChatAiRoute["providerId"],
  model: string,
  input: {
    width: number;
    height: number;
    usage: AssistantImageGenerationUsage | null;
  },
): AssistantImageUsageEstimate {
  const width = Math.max(1, Math.trunc(input.width));
  const height = Math.max(1, Math.trunc(input.height));
  const normalizedModel = model.trim().toLowerCase();

  if (normalizedModel === "gpt-image-2" || normalizedModel === "openai/gpt-image-2") {
    const inputTokens = Math.max(0, Math.trunc(input.usage?.inputTokens || 0));
    const outputTokens = Math.max(0, Math.trunc(input.usage?.outputTokens || 0));
    const usageReported = inputTokens > 0 || outputTokens > 0;
    const providerCostUsd = usageReported
      ? (inputTokens * 5 + outputTokens * 30) / 1_000_000
      : 0.053;
    return {
      width,
      height,
      inputTokens,
      outputTokens,
      costUsd: providerId === "workers-ai" ? providerCostUsd * 1.05 : providerCostUsd,
      pricing: usageReported
        ? "openai-gpt-image-2-token-rates-2026-07"
        : "openai-gpt-image-2-medium-1024x1024-estimate-2026-07",
      metadata: {
        quality: DEFAULT_ASSISTANT_IMAGE_QUALITY,
        usageReported,
        totalTokens: Math.max(0, Math.trunc(input.usage?.totalTokens || 0)),
        textInputUsdPerMillionTokens: 5,
        imageOutputUsdPerMillionTokens: 30,
        billingFeeRate: providerId === "workers-ai" ? 0.05 : 0,
      },
    };
  }

  const outputTiles = Math.max(
    1,
    Math.ceil(width / 512) * Math.ceil(height / 512),
  );
  if (
    providerId === "workers-ai" &&
    normalizedModel === "@cf/black-forest-labs/flux-2-klein-4b"
  ) {
    return {
      width,
      height,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: outputTiles * 0.000287,
      pricing: "workers-ai-flux-2-klein-4b-output-tiles",
      metadata: {
        outputTiles,
        neurons: outputTiles * 26.05,
      },
    };
  }

  if (
    providerId === "workers-ai" &&
    normalizedModel === "@cf/black-forest-labs/flux-2-dev"
  ) {
    const assumedSteps = 25;
    return {
      width,
      height,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: outputTiles * assumedSteps * 0.00041,
      pricing: "workers-ai-flux-2-dev-output-tiles-assumed-25-steps",
      metadata: {
        outputTiles,
        neurons: outputTiles * assumedSteps * 37.5,
        assumedSteps,
      },
    };
  }

  return {
    width,
    height,
    inputTokens: Math.max(0, Math.trunc(input.usage?.inputTokens || 0)),
    outputTokens: Math.max(0, Math.trunc(input.usage?.outputTokens || 0)),
    costUsd: 0,
    pricing: `unknown-${providerId}-image-model`,
    metadata: {},
  };
}

async function runWorkersAiImageGeneration(
  route: AgentChatAiRoute,
  prompt: string,
  input: { width: number; height: number },
): Promise<AssistantImageGenerationResult> {
  if (!route.ai) throw new Error("Workers AI binding is not configured.");
  if (route.model.startsWith("openai/")) {
    const result = await route.ai.run(
      route.model,
      {
        prompt,
        size: `${input.width}x${input.height}`,
        quality: DEFAULT_ASSISTANT_IMAGE_QUALITY,
      },
      route.aiGateway?.gatewayId
        ? { gateway: { id: route.aiGateway.gatewayId } }
        : undefined,
    );
    return normalizeWorkersAiImageResult(result);
  }
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", String(input.width));
  form.append("height", String(input.height));
  const formResponse = new Response(form);
  const body = formResponse.body;
  const contentType = formResponse.headers.get("content-type");
  if (!body || !contentType) {
    throw new Error("Could not prepare Workers AI image request.");
  }
  const result = await route.ai.run(
    route.model,
    { multipart: { body, contentType } },
    route.aiGateway?.gatewayId
      ? { gateway: { id: route.aiGateway.gatewayId } }
      : undefined,
  );
  return normalizeWorkersAiImageResult(result);
}

async function normalizeWorkersAiImageResult(
  result: unknown,
): Promise<AssistantImageGenerationResult> {
  if (result instanceof Response) {
    const bytes = new Uint8Array(await result.arrayBuffer());
    return {
      bytes,
      mimeType: inferImageMimeType(bytes, result.headers.get("content-type")),
      revisedPrompt: null,
      usage: null,
    };
  }

  if (result instanceof ArrayBuffer) {
    const bytes = new Uint8Array(result);
    return {
      bytes,
      mimeType: inferImageMimeType(bytes, null),
      revisedPrompt: null,
      usage: null,
    };
  }

  if (ArrayBuffer.isView(result)) {
    const bytes = new Uint8Array(
      result.buffer.slice(
        result.byteOffset,
        result.byteOffset + result.byteLength,
      ),
    );
    return {
      bytes,
      mimeType: inferImageMimeType(bytes, null),
      revisedPrompt: null,
      usage: null,
    };
  }

  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    const output = record.result && typeof record.result === "object"
      ? record.result as Record<string, unknown>
      : record;
    const imageUrl = normalizedText(output.image);
    if (imageUrl?.startsWith("https://")) {
      const url = new URL(imageUrl);
      if (!url.hostname.endsWith(".r2.dev")) {
        throw new Error("Generated image URL is outside Cloudflare's image storage.");
      }
      const imageResponse = await fetch(url, { redirect: "error" });
      if (!imageResponse.ok) throw new Error(`Generated image download failed (${imageResponse.status}).`);
      const declaredSize = Number(imageResponse.headers.get("content-length"));
      if (declaredSize > 25 * 1024 * 1024) throw new Error("Generated image is too large.");
      const bytes = new Uint8Array(await imageResponse.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > 25 * 1024 * 1024) {
        throw new Error("Generated image size is invalid.");
      }
      return {
        bytes,
        mimeType: inferImageMimeType(bytes, imageResponse.headers.get("content-type")),
        revisedPrompt: normalizedText(output.revised_prompt),
        usage: normalizeOpenAiImageUsage(record.usage as { input_tokens?: unknown; output_tokens?: unknown; total_tokens?: unknown } | undefined),
      };
    }
    const imageBase64 =
      normalizedText(output.image) ||
      normalizedText(output.data) ||
      normalizedText(record.result);
    if (imageBase64) {
      const bytes = decodeBase64Image(imageBase64, "Workers AI");
      return {
        bytes,
        mimeType: inferImageMimeType(
          bytes,
          normalizedText(record.mimeType),
        ),
        revisedPrompt:
          normalizedText(record.revised_prompt) ||
          normalizedText(record.revisedPrompt),
        usage: null,
      };
    }
  }

  throw new Error("Workers AI image response did not include image bytes.");
}

function normalizeOpenAiImageUsage(
  usage:
    | {
        input_tokens?: unknown;
        output_tokens?: unknown;
        total_tokens?: unknown;
      }
    | undefined,
): AssistantImageGenerationUsage | null {
  if (!usage) return null;
  const inputTokens = normalizedNonNegativeInteger(usage.input_tokens);
  const outputTokens = normalizedNonNegativeInteger(usage.output_tokens);
  const totalTokens =
    normalizedNonNegativeInteger(usage.total_tokens) ||
    inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

function normalizedNonNegativeInteger(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function normalizedText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function decodeBase64Image(value: string, provider: string): Uint8Array {
  const normalized = value.includes(",") ? value.split(",").pop() || "" : value;
  const binary = atob(normalized.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytes.byteLength === 0) {
    throw new Error(`${provider} returned an empty image.`);
  }
  return bytes;
}

function inferImageMimeType(
  bytes: Uint8Array,
  fallback: string | null,
): string {
  const normalizedFallback =
    fallback?.split(";")[0]?.trim().toLowerCase() || "";
  if (normalizedFallback.startsWith("image/")) return normalizedFallback;
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return "image/png";
}
