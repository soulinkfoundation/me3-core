import type { AgentTool, AgentToolContext } from "../types";
import { domainTool, ok, optionalString, requiredString, services } from "./common";
import { rememberTargets, requireTarget } from "./targets";

function contacts(context: AgentToolContext) {
  const service = services(context).contacts;
  if (!service) throw new Error("People is unavailable.");
  return service;
}

// People: one person in full, and keeping their record. Emails still go through mailbox drafts the owner sends.
export function contactTools(): AgentTool[] {
  return [
    domainTool("core.contact.read", async (args, context) => {
      const result = await contacts(context).read(requiredString(args.contactId, "Contact ID"));
      if (!result) throw new Error("Contact not found. Search with core_contacts_search and use the returned ID.");
      await rememberTargets(context, "contact", [result.contact], contact => contact.name);
      return ok(result);
    }),
    domainTool("core.contact.save", async (args, context) => {
      const contactId = optionalString(args.contactId)?.trim();
      if (contactId) await requireTarget(context, "contact", contactId);
      else if (!optionalString(args.name)?.trim()) throw new Error("Give the person's name, or the contactId of someone already saved.");
      context.signal.throwIfAborted();
      const result = await contacts(context).save(args, context.ownerTimezone);
      await rememberTargets(context, "contact", [result.contact], contact => contact.name);
      return ok(result);
    }),
  ];
}
