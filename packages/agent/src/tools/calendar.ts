import { cancelCalendarEventForAgent, createCalendarEventForAgent, getCancellableCalendarEventForAgent, readCalendarEventsForAgent, rescheduleCalendarEventForAgent, type CalendarAgentCreateInput, type CalendarAgentEvent, type CalendarAgentReadInput, type CalendarAgentRescheduleInput } from "@me3-core/plugin-calendar";
import { readUpcomingBookingsForAgent } from "../../../agent-chat/src/bookings";
import { domainTool, ok, requiredString, services } from "./common";
import { approval, rememberTargets, requireTarget } from "./targets";

export function calendarTools() {
  return [
    domainTool("core.calendar.events.list", async (args, context) => {
      const result = await readCalendarEventsForAgent(context.db, context.ownerId, context.ownerTimezone, args as CalendarAgentReadInput);
      return ok({ ...result, ...await rememberTargets(context, "calendar event", result.events, event => event.title) });
    }),
    domainTool("core.calendar.availability", async (args, context) => {
      const service = services(context).scheduling?.availability;
      if (!service) throw new Error("Calendar availability is unavailable.");
      return ok(await service(args as Parameters<typeof service>[0]));
    }),
    domainTool("core.calendar.event.create", async (args, context) => {
      context.signal.throwIfAborted();
      const event = await createCalendarEventForAgent(context.db, context.ownerId, context.ownerTimezone, args as CalendarAgentCreateInput, { idempotencyKey: context.idempotencyKey });
      await rememberTargets(context, "calendar event", [event], value => value.title);
      return ok({ event });
    }),
    domainTool("core.calendar.event.reschedule", async (args, context) => {
      const id = requiredString(args.eventId, "Event ID");
      const expected = await requireTarget<CalendarAgentEvent>(context, "calendar event", id);
      const current = await getCancellableCalendarEventForAgent(context.db, context.ownerId, id);
      if (current.title !== expected.title || current.notes !== expected.notes || current.location !== expected.location || current.starts_at !== expected.startsAt || current.ends_at !== expected.endsAt || current.timezone !== expected.timezone) throw new Error("Calendar event changed since it was read. List it again before moving it.");
      context.signal.throwIfAborted();
      const event = await rescheduleCalendarEventForAgent(context.db, context.ownerId, args as CalendarAgentRescheduleInput, expected);
      await rememberTargets(context, "calendar event", [{ ...expected, ...event }], value => value.title);
      return ok({ event });
    }),
    domainTool("core.calendar.event.cancel", async (args, context) => {
      const id = requiredString(args.eventId, "Event ID");
      const expected = await requireTarget<CalendarAgentEvent>(context, "calendar event", id);
      const current = await getCancellableCalendarEventForAgent(context.db, context.ownerId, id);
      if (current.title !== expected.title || current.notes !== expected.notes || current.location !== expected.location || current.starts_at !== expected.startsAt || current.ends_at !== expected.endsAt || current.timezone !== expected.timezone) throw new Error("Calendar event changed since it was read. List it again before cancelling it.");
      const pending = approval(context, "Cancel calendar event", `${expected.title}, ${expected.startsAt}`, { target: expected, targetDomain: "calendar event" });
      if (pending) return pending;
      context.signal.throwIfAborted();
      return ok({ cancelled: true, event: await cancelCalendarEventForAgent(context.db, context.ownerId, { eventId: id, startsAt: expected.startsAt, endsAt: expected.endsAt }, expected) });
    }, { effect: "destructive", approval: "required", description: "Cancel one previously read timed personal calendar event by stable ID after durable owner approval. Imported, recurring, and booking-linked events cannot be cancelled." }),
    domainTool("core.bookings.lookup", async (args, context) => ok(await readUpcomingBookingsForAgent(context.db, context.ownerId, args as { limit?: number }))),
  ];
}
