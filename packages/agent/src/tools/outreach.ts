import type { AgentTool } from "../types";
import { domainTool, ok, optionalNumber, optionalString, services } from "./common";
import { rememberTargets } from "./targets";

// Outreach: the assistant keeps the owner's prospect list. It never sends:
// emails are drafted with core_mailbox_draft and go out only on the owner's approval.
export function outreachTools(): AgentTool[] {
  return [
    domainTool("core.outreach.list", async (args, context) => {
      const service = services(context).outreach;
      if (!service) throw new Error("Outreach is unavailable.");
      const result = await service.list({ filter: optionalString(args.filter), limit: optionalNumber(args.limit) });
      return ok({ ...result, ...await rememberTargets(context, "contact", result.prospects, prospect => prospect.name) });
    }),
    domainTool("core.outreach.save", async (args, context) => {
      const service = services(context).outreach;
      if (!service) throw new Error("Outreach is unavailable.");
      if (!optionalString(args.contactId)?.trim() && !optionalString(args.name)?.trim()) throw new Error("Give the prospect's name, or the contactId of someone already saved.");
      context.signal.throwIfAborted();
      const result = await service.save([args]);
      await rememberTargets(context, "contact", result.saved, prospect => prospect.name);
      return ok({
        ...result,
        next: "Nothing was sent and no one was marked Sent. To write to a saved prospect, call core_mailbox_draft with their contactId: each email is a draft the owner reads and sends. Tell the owner who was saved, who was skipped and why, and who has no email address yet.",
      });
    }),
  ];
}
