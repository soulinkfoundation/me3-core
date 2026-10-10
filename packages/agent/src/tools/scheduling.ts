import type { AgentTool, AgentToolContext } from "../types";
import { domainTool, idProperty, objectSchema, ok, optionalNumber, optionalString, requiredString, services } from "./common";
import { approval, assertUnchanged, rememberTargets, requireTarget } from "./targets";
import type { PeopleRecord, SchedulingContact, SchedulingRequest } from "./services";

const schedulingFields = { durationMinutes: { type: "integer", minimum: 15, maximum: 180 }, dateFrom: { type: "string", format: "date" }, dateTo: { type: "string", format: "date" }, reason: { type: "string" } };
const requestInput = (args: Record<string, unknown>) => ({ durationMinutes: optionalNumber(args.durationMinutes), dateFrom: optionalString(args.dateFrom), dateTo: optionalString(args.dateTo), reason: optionalString(args.reason) });
async function currentRequest(context: AgentToolContext, id: string) {
  const expected = await requireTarget<SchedulingRequest>(context, "scheduling request", id);
  const read = services(context).scheduling?.getRequest;
  if (!read) throw new Error("Stable scheduling request reads are unavailable.");
  const current = await read(id);
  if (!current) throw new Error("Scheduling request not found.");
  assertUnchanged(expected, current, "Scheduling request");
  return expected;
}
export function schedulingTools(): AgentTool[] {
  const tools = [
    domainTool("core.contacts.search", async (args, context) => {
      const service = services(context).scheduling?.searchContacts;
      if (!service) throw new Error("Contact search is unavailable.");
      const result = await service(args);
      if (result.contacts.some(contact => !contact.id)) throw new Error("Contact service must return stable owner-scoped IDs.");
      return ok({ ...result, ...await rememberTargets(context, "contact", result.contacts, contact => contact.name) });
    }),
    domainTool("core.people.search", async (args, context) => {
      const service = services(context).people?.search;
      if (!service) throw new Error("People search is unavailable.");
      const result = await service(args as Parameters<typeof service>[0]);
      const profiles = result.results.flatMap(person => person.profileId ? [{ ...person, id: person.profileId }] : []);
      return ok({ ...result, ...await rememberTargets(context, "public profile", profiles, profile => profile.name) });
    }),
    domainTool("core.scheduling.request", async (args, context) => {
      const service = services(context).scheduling?.request;
      if (!service) throw new Error("Stable contact scheduling is unavailable.");
      const id = requiredString(args.contactId, "Contact ID");
      const contact = await requireTarget<SchedulingContact>(context, "contact", id);
      const matches = await services(context).scheduling!.searchContacts({ query: contact.name, limit: 10 });
      const current = matches.contacts.find(candidate => candidate.id === id);
      if (!current) throw new Error("Contact not found.");
      assertUnchanged(contact, current, "Contact");
      const pending = approval(context, "Request a meeting", `Ask ${contact.name} for mutual availability`, { target: contact, targetDomain: "contact", request: requestInput(args) });
      if (pending) return pending;
      context.signal.throwIfAborted();
      const request = await service({ contactId: id, expectedContact: contact, ...requestInput(args) }, context.idempotencyKey);
      await rememberTargets(context, "scheduling request", [request]); return ok(request);
    }, { parameters: objectSchema({ contactId: idProperty("contact"), ...schedulingFields }, ["contactId"]), effect: "external", approval: "required" }),
    domainTool("core.scheduling.request_profile", async (args, context) => {
      const service = services(context).scheduling?.requestNetwork;
      if (!service) throw new Error("Public profile scheduling is unavailable.");
      const profileId = requiredString(args.profileId, "Profile ID");
      const person = await requireTarget<PeopleRecord>(context, "public profile", profileId);
      const pending = approval(context, "Request a meeting", `Send ${person.name} a meeting request`, { target: person, targetDomain: "public profile", request: requestInput(args) });
      if (pending) return pending;
      context.signal.throwIfAborted();
      const request = await service({ target: { kind: "public_profile", profileId }, request: { kind: "meeting", participantMode: "one_to_one", paymentMode: "free" }, ...requestInput(args) }, context.idempotencyKey);
      await rememberTargets(context, "scheduling request", [request]); return ok(request);
    }, { parameters: objectSchema({ profileId: idProperty("public profile"), ...schedulingFields }, ["profileId"]), effect: "external", approval: "required" }),
    domainTool("core.scheduling.approve", async (args, context) => {
      const service = services(context).scheduling?.approve;
      if (!service) throw new Error("Stable scheduling approval is unavailable.");
      const id = requiredString(args.requestId, "Scheduling request ID"); const expected = await currentRequest(context, id);
      const option = optionalNumber(args.option);
      if (option !== undefined && !expected.options?.some(candidate => candidate.option === option)) throw new Error("Scheduling option is not one of the reviewed candidates.");
      const pending = approval(context, "Approve scheduling", `Approve ${expected.contactName || id}${option ? `, option ${option}` : ""}`, { target: expected, targetDomain: "scheduling request", option });
      if (pending) return pending;
      context.signal.throwIfAborted();
      const request = await service({ requestId: id, option, confirmed: true, expected }, context.idempotencyKey);
      await rememberTargets(context, "scheduling request", [request]); return ok(request);
    }, { parameters: objectSchema({ requestId: idProperty("scheduling request"), option: { type: "integer", minimum: 1 } }, ["requestId"]), effect: "external", approval: "required" }),
    domainTool("core.scheduling.decline", async (args, context) => {
      const service = services(context).scheduling?.decline;
      if (!service) throw new Error("Stable scheduling decline is unavailable.");
      const id = requiredString(args.requestId, "Scheduling request ID"); const expected = await currentRequest(context, id);
      const pending = approval(context, "Decline scheduling request", expected.contactName || id, { target: expected, targetDomain: "scheduling request", reason: args.reason });
      if (pending) return pending;
      context.signal.throwIfAborted();
      return ok(await service({ requestId: id, reason: optionalString(args.reason), expected }, context.idempotencyKey));
    }, { parameters: objectSchema({ requestId: idProperty("scheduling request"), reason: { type: "string" } }, ["requestId"]), effect: "external", approval: "required" }),
  ];
  tools.push({ name: "core_scheduling_request_read", description: "Read one owner-scoped scheduling request by stable ID, including its exact available options, before approving or declining.", parameters: objectSchema({ requestId: idProperty("scheduling request") }, ["requestId"]), effect: "read", approval: "none", async execute(args, context) {
    try {
      const service = services(context).scheduling?.getRequest;
      if (!service) throw new Error("Scheduling request reads are unavailable.");
      const request = await service(requiredString(args.requestId, "Request ID"));
      if (!request) throw new Error("Scheduling request not found.");
      await rememberTargets(context, "scheduling request", [request]); return ok(request);
    } catch (error) { return { status: "error", error: error instanceof Error ? error.message : String(error) }; }
  } });
  return tools;
}
