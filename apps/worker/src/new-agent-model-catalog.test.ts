import { describe, expect, it } from "vitest";
import { modelCapabilitiesFor, modelSupportsImageInput } from "@me3-core/plugin-agent-chat/model-capabilities";

describe("independent agent model capabilities", () => {
  it.each(["openai/gpt-6.1-sol", "openai/gpt-6-astra", "anthropic/claude-opus-5.5", "anthropic/claude-sonnet-5.5", "@cf/zai-org/glm-5.3-flash"])("allows tools and image input for %s through the binding", model => {
    expect(modelCapabilitiesFor("workers-ai", model)).toContain("tool-use");
    expect(modelSupportsImageInput("workers-ai", model)).toBe(true);
  });
});
