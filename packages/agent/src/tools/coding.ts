import { domainTool, ok, optionalString, requiredString, services } from "./common";
import { approval } from "./targets";
import type { AgentToolContext } from "../types";

function coding(context: AgentToolContext) {
  const service = services(context).coding;
  if (!service) throw new Error("Claude isn't connected. The owner can connect GitHub in Settings > Coding agents.");
  return service;
}

export function codingTools() {
  return [
    domainTool("core.coding.status", async (args, context) => ok(await coding(context).status({ repository: optionalString(args.repository) }))),
    domainTool("core.coding.send", async (args, context) => {
      const service = coding(context);
      const repository = await service.resolveRepository(requiredString(args.repository, "Repository"));
      const title = requiredString(args.title, "Title");
      if (title.length > 100) throw new Error("Keep the title under 100 characters.");
      const brief = requiredString(args.brief, "Brief");
      const pending = approval(context, "Send to Claude", `${repository}: ${title}`, { repository, issueTitle: title, brief });
      if (pending) return pending;
      context.signal.throwIfAborted();
      return ok(await service.send({ repository, title, brief }));
    }),
  ];
}
