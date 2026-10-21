import { describe, expect, it } from "vitest";
import {
  AI_AGENT_MODEL_OPTIONS,
  aiAgentModelOptionIsAvailable,
} from "./aiModelCatalog";

function visibleLabels(configuredProviderIds: string[]) {
  const configured = new Set(configuredProviderIds);
  return AI_AGENT_MODEL_OPTIONS.filter((option) =>
    aiAgentModelOptionIsAvailable(option, configured),
  ).map((option) => option.label);
}

describe("AI model catalog", () => {
  it("keeps Workers AI visible and hides API-key providers until configured", () => {
    expect(visibleLabels([])).toEqual([
      "DeepSeek V4.1 Flash",
      "GLM 4.7 Flash",
      "Gemma 4 26B",
      "GLM 5.2",
      "Qwen3",
      "GPT-OSS 120B",
      "Kimi K2.7",
      "Deepseek R1",
    ]);

    expect(visibleLabels(["openai"])).toContain("GPT-4o");
    expect(visibleLabels(["openai"])).not.toContain("Claude Sonnet 4.6");
  });

  it("describes Gemma 4 with the canonical Workers AI capabilities", () => {
    expect(
      AI_AGENT_MODEL_OPTIONS.find((option) => option.id === "workers-gemma-4-26b"),
    ).toMatchObject({
      providerId: "workers-ai",
      model: "@cf/google/gemma-4-26b-a4b-it",
      capabilities: ["text", "image_input", "long-context", "reasoning", "tool-use"],
    });
  });
});
