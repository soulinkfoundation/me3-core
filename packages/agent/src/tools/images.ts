import { validateArguments } from "../schema";
import type { AgentTool } from "../types";
import { objectSchema, requiredString, services } from "./common";
import type { AgentImageEditRegion } from "./services";

export function imageTools(): AgentTool[] {
  const tool: AgentTool = {
    name: "core_images_generate",
    description: "Generate one new private image requested by the owner and save it to this conversation using the installation's configured image model. This does not publish, overwrite or send an image; to change an existing image use core_images_edit. Use only the server-returned asset result; an unknown operation must be reconciled before retrying.",
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
  const fraction = (description: string) => ({ type: "number", minimum: 0, maximum: 1, description });
  const edit: AgentTool = {
    name: "core_images_edit",
    description: "Edit an image already in this conversation, such as a photo the owner attached or an image generated earlier, and save the result as a new private image. The original is never changed. To change one part of a photo and keep the rest untouched, pass region around that part: only that area is redrawn and pasted back, so faces and everything outside it keep their original pixels. Without region the whole image is redrawn and details such as faces can shift; say so to the owner. Use only the server-returned asset result; an unknown operation must be reconciled before retrying.",
    parameters: objectSchema({
      prompt: { type: "string", minLength: 1, maxLength: 4_000, description: "The change the owner asked for, described as it applies to the image or region." },
      attachmentId: { type: "string", minLength: 1, maxLength: 200, description: "ID of the image to edit, copied exactly from the attached image IDs or an earlier image result. Omit to edit the newest image in the conversation." },
      region: objectSchema({
        x: fraction("Left edge of the part to change, as a fraction of the image width from the left."),
        y: fraction("Top edge of the part to change, as a fraction of the image height from the top."),
        width: fraction("Width of the part to change, as a fraction of the image width."),
        height: fraction("Height of the part to change, as a fraction of the image height."),
      }, ["x", "y", "width", "height"]),
    }, ["prompt"]),
    effect: "write",
    approval: "none",
    pluginId: null,
    idempotencyArguments: args => ({ ...args, prompt: typeof args.prompt === "string" ? args.prompt.trim() : args.prompt }),
    async execute(args, context) {
      try {
        const invalid = validateArguments(edit.parameters, args);
        if (invalid) throw new Error(invalid);
        const prompt = requiredString(args.prompt, "Image edit instruction");
        const region = args.region as AgentImageEditRegion | undefined;
        if (region && (region.width <= 0 || region.height <= 0 || region.x + region.width > 1 || region.y + region.height > 1)) throw new Error("The region must lie inside the image.");
        const imageService = services(context).images;
        if (!imageService?.edit) throw new Error("Image editing is unavailable.");
        context.signal.throwIfAborted();
        const result = await imageService.edit(prompt, {
          idempotencyKey: context.idempotencyKey, threadId: context.threadId,
          turnId: context.turnId, requestId: context.requestId, signal: context.signal,
          ...(typeof args.attachmentId === "string" ? { attachmentId: args.attachmentId } : {}), ...(region ? { region } : {}),
        });
        if (result.status === "complete") return { status: "ok", data: { operationId: result.operationId, imageAction: result.action, redrawn: region ? "region" : "whole image" } };
        return { status: "error", error: result.error, ...(result.operationId ? { operationId: result.operationId } : {}), ...(result.status === "unknown" ? { reconciliationRequired: true } : {}) };
      } catch (error) {
        return { status: "error", error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
  return [tool, edit];
}
