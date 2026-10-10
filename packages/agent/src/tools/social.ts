import { confirmPostingPlan, createPostingPlan, getPostingPlan, searchPostLibrary, type PostingPlan } from "@me3-core/plugin-social-publishing";
import { createAgentSocialPost, createAgentSocialSuggestions, readAgentSocialSource, type AgentSocialSource, type AgentSocialSourceType, type CreateAgentSocialPostInput, type CreateAgentSocialSuggestionsInput } from "../../../agent-chat/src/social-content";
import { domainTool, idProperty, objectSchema, ok, optionalString, requiredString } from "./common";
import { approval, assertUnchanged, rememberTargets, requireTarget } from "./targets";
import type { AgentToolContext } from "../types";

function sourcePlugin(context: AgentToolContext, sourceType: unknown): AgentSocialSourceType {
  if (sourceType !== "journal" && sourceType !== "mission_task") throw new Error("Social source must be journal or mission_task.");
  const plugin = sourceType === "journal" ? "me3.journal" : "me3.mission-control";
  if (!context.enabledPluginIds.has(plugin)) throw new Error(`Source plugin ${plugin} must be installed and enabled.`);
  return sourceType;
}
async function reviewedSource(args: Record<string, unknown>, context: AgentToolContext) {
  const sourceType = sourcePlugin(context, args.sourceType); const sourceId = requiredString(args.sourceId, "Source ID");
  const expected = await requireTarget<{ id: string; source: AgentSocialSource }>(context, "social source", `${sourceType}:${sourceId}`);
  const current = await readAgentSocialSource(context.db, context.ownerId, sourceType, sourceId, context.ownerTimezone);
  assertUnchanged(expected.source, current, "Social source");
  return expected.source;
}
export function socialTools() {
  return [
    domainTool("core.social.source.read", async (args, context) => {
      const sourceType = sourcePlugin(context, args.sourceType); const sourceId = requiredString(args.sourceId, "Source ID");
      const source = await readAgentSocialSource(context.db, context.ownerId, sourceType, sourceId, context.ownerTimezone);
      await rememberTargets(context, "social source", [{ id: `${sourceType}:${sourceId}`, source }, { id: `${sourceType}:${source.id}`, source }].filter((record, index, all) => all.findIndex(candidate => candidate.id === record.id) === index));
      return ok({ source });
    }),
    domainTool("core.social.library.search", async (args, context) => {
      const items = await searchPostLibrary({ DB: context.db } as never, context.ownerId, args);
      return ok({ items, total: items.length });
    }),
    domainTool("core.social.posting_plan.create", async (args, context) => {
      const plan = await createPostingPlan({ DB: context.db } as never, context.ownerId, { ...args, versionIds: optionalString(args.versionIds)?.split(",").map(id => id.trim()).filter(Boolean) });
      await rememberTargets(context, "posting plan", [plan]); return ok({ plan, scheduled: false });
    }),
    domainTool("core.social.posting_plan.confirm", async (args, context) => {
      const id = requiredString(args.planId, "Posting plan ID");
      const expected = await requireTarget<PostingPlan>(context, "posting plan", id);
      const current = await getPostingPlan({ DB: context.db } as never, context.ownerId, id);
      if (!current) throw new Error("Posting plan not found.");
      assertUnchanged(expected, current, "Posting plan");
      const pending = approval(context, "Confirm posting plan", `Schedule ${current.items.length} approved social posts`, { target: expected, targetDomain: "posting plan" });
      if (pending) return pending;
      const plan = await confirmPostingPlan({ DB: context.db } as never, context.ownerId, id, { expectedUpdatedAt: expected.updatedAt, expectedPlan: expected, confirmed: true }, { requestedByType: "agent" });
      if (!plan) throw new Error("Posting plan not found.");
      return ok({ plan, scheduled: plan.status === "confirmed" });
    }, { parameters: objectSchema({ planId: idProperty("posting plan") }, ["planId"]), effect: "external", approval: "required", description: "Schedule the exact previously proposed social posting plan after durable owner approval." }),
    domainTool("core.social.draft.create", async (args, context) => {
      const source = await reviewedSource(args, context);
      const post = await createAgentSocialPost(context.db, context.ownerId, source, args as CreateAgentSocialPostInput);
      return ok({ post, published: false, sourceTitle: source.title });
    }),
    domainTool("core.social.suggestions.create", async (args, context) => {
      const source = await reviewedSource(args, context);
      const suggestions = await createAgentSocialSuggestions(context.db, context.ownerId, source, args as CreateAgentSocialSuggestionsInput);
      return ok({ suggestions, postCreated: false, sourceTitle: source.title });
    }),
  ];
}
