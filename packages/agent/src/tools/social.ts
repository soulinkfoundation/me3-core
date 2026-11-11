import { searchPostLibrary } from "@me3-core/plugin-social-publishing";
import { createAgentSocialPostFromOwnerText, readAgentSocialQueue, setAgentSocialNudges, type AgentSocialPlatform } from "../../../agent-chat/src/social-content";
import { domainTool, ok, optionalString, requiredString, services } from "./common";
import type { AgentToolContext } from "../types";

/** Everything the owner wrote in this chat: the only words a message-based draft may use. */
function ownerWords(context: AgentToolContext): string {
  return [...context.messages.filter(message => message.role === "user").map(message => message.content), context.messageText].join("\n");
}

/**
 * ME3 never writes the owner's social posts (owner decision 2026-11-11). It can read the queue
 * and history, save posts in the owner's own words, and start sharing an existing site post.
 */
export function socialTools() {
  return [
    domainTool("core.social.queue.read", async (args, context) => {
      context.signal.throwIfAborted();
      return ok(await readAgentSocialQueue(context.db, context.ownerId, { recordNudge: args.recordNudge === true }));
    }),
    domainTool("core.social.draft.from_message", async (args, context) => {
      const platforms = Array.isArray(args.platforms) ? args.platforms.filter((value): value is AgentSocialPlatform => typeof value === "string") : [];
      context.signal.throwIfAborted();
      const post = await createAgentSocialPostFromOwnerText(context.db, context.ownerId, ownerWords(context), {
        text: requiredString(args.text, "Text"),
        platforms,
        title: optionalString(args.title),
      });
      return ok({ post, published: false, scheduled: false, reviewPath: `/social/${post.post.id}` });
    }),
    domainTool("core.social.site_post.share", async (args, context) => {
      const share = services(context).socialShare;
      if (!share) throw new Error("Sharing site posts is unavailable on this installation.");
      context.signal.throwIfAborted();
      const result = await share.shareSitePost({ slug: requiredString(args.slug, "Post slug") });
      return ok({ ...result, published: false, scheduled: false, reviewPath: `/social/${result.postId}` });
    }),
    domainTool("core.social.nudges.set", async (args, context) => {
      if (typeof args.on !== "boolean") throw new Error("on must be true or false.");
      return ok(await setAgentSocialNudges(context.db, args.on));
    }),
    domainTool("core.social.library.search", async (args, context) => {
      const items = await searchPostLibrary({ DB: context.db } as never, context.ownerId, args);
      return ok({ items, total: items.length });
    }),
  ];
}
