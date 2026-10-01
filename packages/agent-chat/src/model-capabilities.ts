export type AiAgentModelProviderId = "workers-ai" | "openai" | "anthropic";

export type AiAgentModelCapability =
  | "text"
  | "vision"
  | "image_input"
  | "image_generation"
  | "image_edit"
  | "long-context"
  | "reasoning"
  | "tool-use";

export type AssistantImageCapability = "image_generation" | "image_edit";

type AiModelCapabilityRecord = {
  providerId: AiAgentModelProviderId;
  model: string;
  capabilities: AiAgentModelCapability[];
  image?: {
    generation?: boolean;
    edit?: boolean;
    sizes?: string[];
    formats?: Array<"png" | "jpeg" | "webp">;
    maxInputImages?: number;
  };
};

export const DEFAULT_WORKERS_AI_IMAGE_GENERATION_MODEL =
  "@cf/black-forest-labs/flux-2-klein-4b";
export const DEFAULT_OPENAI_IMAGE_GENERATION_MODEL = "gpt-image-2";

const AI_MODEL_CAPABILITY_RECORDS: readonly AiModelCapabilityRecord[] = [
  {
    providerId: "anthropic",
    model: "claude-sonnet-4-6",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
  },
  {
    providerId: "anthropic",
    model: "claude-sonnet-5",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
  },
  {
    providerId: "anthropic",
    model: "claude-opus-4-8",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
  },
  {
    providerId: "openai",
    model: "gpt-4o",
    capabilities: ["text", "image_input", "tool-use"],
  },
  {
    providerId: "openai",
    model: "gpt-5.4-mini",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
  },
  {
    providerId: "openai",
    model: "gpt-5.4-nano",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
  },
  {
    providerId: "openai",
    model: "gpt-5.5",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
  },
  {
    providerId: "openai",
    model: DEFAULT_OPENAI_IMAGE_GENERATION_MODEL,
    capabilities: ["image_generation"],
    image: {
      generation: true,
      sizes: ["1024x1024"],
      formats: ["png"],
    },
  },
  {
    providerId: "workers-ai",
    model: "moonshotai/kimi-k3",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
  },
  {
    providerId: "workers-ai",
    model: "anthropic/claude-sonnet-4.6",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
  },
  {
    providerId: "workers-ai",
    model: "openai/gpt-5.4-mini",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
  },
  {
    providerId: "workers-ai",
    model: "openai/gpt-5.4-nano",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
  },
  {
    providerId: "workers-ai",
    model: "openai/gpt-5.5",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
  },
  {
    providerId: "workers-ai",
    model: "@cf/zai-org/glm-4.7-flash",
    capabilities: ["text", "long-context", "reasoning", "tool-use"],
  },
  {
    providerId: "workers-ai",
    model: "@cf/zai-org/glm-5.2",
    capabilities: ["text", "long-context", "reasoning", "tool-use"],
  },
  {
    providerId: "workers-ai",
    model: "@cf/qwen/qwen3-30b-a3b-fp8",
    capabilities: ["text", "long-context", "reasoning"],
  },
  {
    providerId: "workers-ai",
    model: "@cf/openai/gpt-oss-120b",
    capabilities: ["text", "long-context", "reasoning", "tool-use"],
  },
  {
    providerId: "workers-ai",
    model: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    capabilities: ["text", "long-context", "reasoning"],
  },
  {
    providerId: "workers-ai",
    model: "@cf/moonshotai/kimi-k2.7-code",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
    image: {
      maxInputImages: 1,
    },
  },
  {
    providerId: "workers-ai",
    model: "@cf/google/gemma-4-26b-a4b-it",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
  },
  {
    providerId: "workers-ai",
    model: DEFAULT_WORKERS_AI_IMAGE_GENERATION_MODEL,
    capabilities: ["image_generation"],
    image: {
      generation: true,
      sizes: ["1024x1024"],
      formats: ["png"],
    },
  },
  {
    providerId: "workers-ai",
    model: "openai/gpt-image-2",
    capabilities: ["image_generation"],
    image: {
      generation: true,
      sizes: ["1024x1024"],
      formats: ["png"],
    },
  },
];

export function modelSupportsCapability(
  providerId: AiAgentModelProviderId,
  model: string,
  capability: AssistantImageCapability,
): boolean {
  const record = findModelCapabilityRecord(providerId, model);
  if (!record) return false;
  return record.capabilities.includes(capability);
}

export function modelSupportsImageInput(
  providerId: AiAgentModelProviderId,
  model: string,
): boolean {
  const record = findModelCapabilityRecord(providerId, model);
  if (!record) return false;
  return (
    record.capabilities.includes("image_input") ||
    record.capabilities.includes("vision")
  );
}

export function modelCapabilitiesFor(
  providerId: AiAgentModelProviderId,
  model: string,
): readonly AiAgentModelCapability[] {
  return findModelCapabilityRecord(providerId, model)?.capabilities ?? [];
}

export function modelSupportsToolUse(
  providerId: AiAgentModelProviderId,
  model: string,
): boolean {
  const record = findModelCapabilityRecord(providerId, model);
  // Custom/self-hosted models historically entered the tool runtime without a
  // catalog record. Preserve that compatibility while using explicit records
  // to keep known chat-only models out of native function calling.
  return record ? record.capabilities.includes("tool-use") : true;
}

function findModelCapabilityRecord(
  providerId: AiAgentModelProviderId,
  model: string,
): AiModelCapabilityRecord | null {
  const normalizedModel = model.trim().toLowerCase();
  return (
    AI_MODEL_CAPABILITY_RECORDS.find(
      (record) =>
        record.providerId === providerId &&
        record.model.trim().toLowerCase() === normalizedModel,
    ) || null
  );
}
