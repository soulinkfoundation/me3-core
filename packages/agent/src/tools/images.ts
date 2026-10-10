import { validateArguments } from "../schema";
import type { AgentTool } from "../types";
import { objectSchema, requiredString, services } from "./common";

export function imageTools(): AgentTool[] {
  const tool: AgentTool = {
    name: "core_images_generate",
    description: "Generate one new private image requested by the owner and save it to this conversation using the installation's configured image model. This does not edit, publish, overwrite or send an image. Use only the server-returned asset result; an unknown operation must be reconciled before retrying.",
    parameters: objectSchema({ prompt: { type: "string", minLength: 1, maxLength: 4_000, description: "Visual description of the new image requested by the owner." } }, ["prompt"]),
    effect: "write",
    approval: "none",
    pluginId: null,
    idempotencyArguments: args => ({ ...args, prompt: typeof args.prompt === "string" ? args.prompt.trim() : args.prompt }),
    async execute(args, context) {
      try {
        const invalid = validateArguments(tool.parameters, args);
        if (invalid) throw new Error(invalid);
        const prompt = requiredString(args.prompt, "Image prompt");
        const imageService = services(context).images;
        if (!imageService) throw new Error("Image generation is unavailable.");
        context.signal.throwIfAborted();
        const result = await imageService.generate(prompt, {
          idempotencyKey: context.idempotencyKey, threadId: context.threadId,
          turnId: context.turnId, requestId: context.requestId, signal: context.signal,
        });
        if (result.status === "complete") return { status: "ok", data: { operationId: result.operationId, imageAction: result.action } };
        return { status: "error", error: result.error, ...(result.operationId ? { operationId: result.operationId } : {}), ...(result.status === "unknown" ? { reconciliationRequired: true } : {}) };
      } catch (error) {
        return { status: "error", error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
  return [tool];
}
