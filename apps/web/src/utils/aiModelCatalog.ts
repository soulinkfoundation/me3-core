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

export type AiAgentModelOption = {
  id: string;
  label: string;
  providerId: AiAgentModelProviderId;
  model: string;
  description: string;
  runtimeLabel: string;
  costLabel: string;
  capabilities: AiAgentModelCapability[];
  badge?: string;
};

export const AI_AGENT_MODEL_OPTIONS: AiAgentModelOption[] = [
  {
    id: "anthropic-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    providerId: "anthropic",
    model: "claude-sonnet-5.5",
    runtimeLabel: "Anthropic",
    costLabel: "Paid",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
    description: "Paid Claude model for everyday agent work with tools and images.",
  },
  {
    id: "anthropic-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    providerId: "anthropic",
    model: "claude-sonnet-4-6",
    runtimeLabel: "Anthropic",
    costLabel: "Paid",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
    description: "Paid Claude model with a strong speed and intelligence balance.",
  },
  {
    id: "anthropic-opus-4-8",
    label: "Claude Opus 4.8",
    providerId: "anthropic",
    model: "claude-opus-4-8",
    runtimeLabel: "Anthropic",
    costLabel: "Paid",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
    description: "Paid Claude model for the hardest planning and reasoning work.",
  },
  {
    id: "openai-gpt-4o",
    label: "GPT-4o",
    providerId: "openai",
    model: "gpt-4o",
    runtimeLabel: "OpenAI",
    costLabel: "Paid",
    capabilities: ["text", "image_input", "tool-use"],
    description: "Familiar multimodal OpenAI model with broad compatibility.",
  },
  {
    id: "openai-gpt-5-5",
    label: "GPT-5.5",
    providerId: "openai",
    model: "gpt-5.5",
    runtimeLabel: "OpenAI",
    costLabel: "Paid",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
    description: "OpenAI flagship for complex reasoning, coding, and agentic workflows.",
  },
  {
    id: "workers-deepseek-v4-1-flash",
    label: "DeepSeek V4.1 Flash",
    providerId: "workers-ai",
    model: "@cf/deepseek-ai/deepseek-v4.1-flash-1017",
    runtimeLabel: "Cloudflare Workers AI",
    costLabel: "Low cost",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
    badge: "Default",
    description:
      "DeepSeek V4.1 Flash on Workers AI: the recommended no-key model for everyday chat, tool use and images.",
  },
  {
    id: "workers-glm-4-7-flash",
    label: "GLM 4.7 Flash",
    providerId: "workers-ai",
    model: "@cf/zai-org/glm-4.7-flash",
    runtimeLabel: "Cloudflare Workers AI",
    costLabel: "Fast",
    capabilities: ["text", "long-context", "reasoning", "tool-use"],
    description:
      "Small GLM model on Workers AI for dialogue and instruction following; weaker with tools.",
  },
  {
    id: "workers-gemma-4-26b",
    label: "Gemma 4 26B",
    providerId: "workers-ai",
    model: "@cf/google/gemma-4-26b-a4b-it",
    runtimeLabel: "Cloudflare Workers AI",
    costLabel: "Low cost",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
    description:
      "Google Gemma 4 26B A4B on Workers AI for economical text, vision, reasoning, and tool use.",
  },
  {
    id: "workers-glm-5-2",
    label: "GLM 5.2",
    providerId: "workers-ai",
    model: "@cf/zai-org/glm-5.2",
    runtimeLabel: "Cloudflare Workers AI",
    costLabel: "Paid",
    capabilities: ["text", "long-context", "reasoning", "tool-use"],
    description:
      "Z.ai GLM 5.2 on Workers AI for agentic coding, planning, and tool-augmented work.",
  },
  {
    id: "workers-qwen3-30b",
    label: "Qwen3",
    providerId: "workers-ai",
    model: "@cf/qwen/qwen3-30b-a3b-fp8",
    runtimeLabel: "Cloudflare Workers AI",
    costLabel: "Low cost",
    capabilities: ["text", "long-context", "reasoning"],
    description:
      "Qwen3 30B A3B FP8 on Workers AI for everyday chat, writing, and light planning.",
  },
  {
    id: "workers-gpt-oss-120b",
    label: "GPT-OSS 120B",
    providerId: "workers-ai",
    model: "@cf/openai/gpt-oss-120b",
    runtimeLabel: "Cloudflare Workers AI",
    costLabel: "Low cost",
    capabilities: ["text", "long-context", "reasoning", "tool-use"],
    description:
      "OpenAI open-weight model on Workers AI for general-purpose high-reasoning and agentic tasks.",
  },
  {
    id: "workers-kimi-k2-7",
    label: "Kimi K2.7",
    providerId: "workers-ai",
    model: "@cf/moonshotai/kimi-k2.7-code",
    runtimeLabel: "Cloudflare Workers AI",
    costLabel: "Paid",
    capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
    description:
      "Kimi K2.7 Code on Workers AI for large-context agentic work and tool use.",
  },
  {
    id: "workers-deepseek-r1",
    label: "Deepseek R1",
    providerId: "workers-ai",
    model: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    runtimeLabel: "Cloudflare Workers AI",
    costLabel: "Paid",
    capabilities: ["text", "long-context", "reasoning"],
    description:
      "DeepSeek R1 Distill Qwen 32B on Workers AI for slower, more careful reasoning.",
  },
];

export function aiAgentModelOptionIsAvailable(
  option: AiAgentModelOption,
  configuredProviderIds: ReadonlySet<string>,
) {
  return (
    option.providerId === "workers-ai" ||
    configuredProviderIds.has(option.providerId)
  );
}
