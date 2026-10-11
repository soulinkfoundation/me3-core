import { nextTargetIntentAction, verifyTargetIntent } from "../target-intent";
import { prepareTargetPresentation, targetPresentationCard } from "../presentations";
import type { AgentTool } from "../types";
import { objectSchema, requiredString } from "./common";

export function targetPresentationTool(tools: readonly AgentTool[]): AgentTool {
  return {
    name: "core_targets_present", effect: "read", approval: "none", endsTurn: true,
    description: "Check owner intent, or present immutable records and the exact proposed action for the owner to choose. Use a read selectionId and supported target tool; supply all action arguments except its target ID. An ok result applies no change: invoke its exact authorizedCall to perform the next action. Only a needs_selection card ends the current turn. Selecting does not approve destructive or external actions.",
    parameters: objectSchema({ selectionId: { type: "string", minLength: 1 }, toolName: { type: "string", minLength: 1 }, arguments: { type: "object", additionalProperties: true } }, ["selectionId", "toolName", "arguments"]),
    async execute(args, context) {
      try {
        if (context.verifyTargetIntent && !context.targetSelection && !context.approved) {
          const verified = await verifyTargetIntent(context, { selectionId: requiredString(args.selectionId, "Selection ID") });
          if (verified.verdict.decision === "allow") {
            const next=await nextTargetIntentAction(context,verified);
            return { status: "ok", data: { actionApplied:false, ...(next?{authorizedCall:next.authorizedCall}:{}), verificationReceiptId:verified.receiptId,
              instruction:next?"No action was performed by this read tool. Invoke the exact authorizedCall next; do not report it completed before its successful native result.":"All independently authorized actions already have successful saved native receipts; this read tool performed no action." } };
          }
          if (verified.verdict.decision === "deny") return { status: "error", error: verified.verdict.reason };
        }
        const presentation = await prepareTargetPresentation(context, { selectionId: requiredString(args.selectionId, "Selection ID"), toolName: requiredString(args.toolName, "Action"), arguments: args.arguments as Record<string, unknown> }, tools);
        return { status: "needs_selection", data: { targetPresentation: targetPresentationCard(presentation) } };
      } catch (error) { return { status: "error", error: error instanceof Error ? error.message : String(error) }; }
    },
  };
}
