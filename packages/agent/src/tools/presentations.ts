import { prepareTargetPresentation, targetPresentationCard } from "../presentations";
import type { AgentTool } from "../types";
import { objectSchema, requiredString } from "./common";

export function targetPresentationTool(tools: readonly AgentTool[]): AgentTool {
  return {
    name: "core_targets_present", effect: "read", approval: "none", endsTurn: true,
    description: "Present immutable records and the exact proposed action for the owner to choose. Use a selectionId returned by a read and a supported target tool name. Supply all action arguments except its target ID. This ends the current turn; selecting does not approve destructive or external actions.",
    parameters: objectSchema({ selectionId: { type: "string", minLength: 1 }, toolName: { type: "string", minLength: 1 }, arguments: { type: "object", additionalProperties: true } }, ["selectionId", "toolName", "arguments"]),
    async execute(args, context) {
      try {
        const presentation = await prepareTargetPresentation(context, { selectionId: requiredString(args.selectionId, "Selection ID"), toolName: requiredString(args.toolName, "Action"), arguments: args.arguments as Record<string, unknown> }, tools);
        return { status: "needs_selection", data: { targetPresentation: targetPresentationCard(presentation) } };
      } catch (error) { return { status: "error", error: error instanceof Error ? error.message : String(error) }; }
    },
  };
}
