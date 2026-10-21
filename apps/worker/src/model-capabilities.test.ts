import { describe, expect, it } from "vitest";
import { modelCapabilitiesFor, modelSupportsImageInput, modelSupportsToolUse } from "@me3-core/plugin-agent-chat/model-capabilities";

describe("shared model capabilities", () => {
  it("registers GPT-5.4 mini as a fast explicit evaluation candidate", () => {
    expect(modelSupportsImageInput("openai", "gpt-5.4-mini")).toBe(true);
    expect(modelSupportsImageInput("workers-ai", "openai/gpt-5.4-mini")).toBe(true);
    expect(modelSupportsImageInput("workers-ai", "openai/gpt-5.4-nano")).toBe(true);
    expect(
      modelCapabilitiesFor("workers-ai", "@cf/zai-org/glm-4.7-flash"),
    ).toContain("tool-use");
    expect(modelSupportsToolUse("workers-ai", "@cf/deepseek-ai/deepseek-v4.1-flash-1017")).toBe(true);
    expect(modelSupportsImageInput("workers-ai", "@cf/deepseek-ai/deepseek-v4.1-flash-1017")).toBe(true);
  });

  it("registers the managed Kimi K3 model with vision-input capabilities", () => {
    expect(modelCapabilitiesFor("workers-ai", "moonshotai/kimi-k3")).toEqual([
      "text",
      "image_input",
      "long-context",
      "reasoning",
      "tool-use",
    ]);
    expect(modelSupportsImageInput("workers-ai", "moonshotai/kimi-k3")).toBe(true);
  });

  it("distinguishes tool-capable and chat-only selectable Workers AI models", () => {
    expect(modelSupportsToolUse("workers-ai", "@cf/zai-org/glm-5.2")).toBe(true);
    expect(modelSupportsToolUse("workers-ai", "@cf/openai/gpt-oss-120b")).toBe(true);
    expect(
      modelSupportsToolUse("workers-ai", "@cf/qwen/qwen3-30b-a3b-fp8"),
    ).toBe(false);
    expect(
      modelSupportsToolUse(
        "workers-ai",
        "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
      ),
    ).toBe(false);
  });

  it("registers Gemma 4 with its canonical runtime capabilities", () => {
    expect(
      modelCapabilitiesFor("workers-ai", "@cf/google/gemma-4-26b-a4b-it"),
    ).toEqual(["text", "image_input", "long-context", "reasoning", "tool-use"]);
    expect(
      modelSupportsImageInput("workers-ai", "@cf/google/gemma-4-26b-a4b-it"),
    ).toBe(true);
  });

});
