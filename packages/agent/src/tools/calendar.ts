import { cancelCalendarEventForAgent, createCalendarEventForAgent, getCancellableCalendarEventForAgent, readCalendarEventsForAgent, rescheduleCalendarEventForAgent, type CalendarAgentCreateInput, type CalendarAgentEvent, type CalendarAgentReadInput, type CalendarAgentRescheduleInput } from "@me3-core/plugin-calendar";
import { readBookingsInRangeForAgent, readUpcomingBookingsForAgent } from "../../../agent-chat/src/bookings";
import { domainTool, ok, requiredString, services } from "./common";
import { approval, ownerDateTime, rememberTargets, requireTarget } from "./targets";

// States in the read result what the move/cancel tools refuse, so a model can
// tell the owner without inferring it, and graders can check it.
export function withChangeLimit(event: CalendarAgentEvent): CalendarAgentEvent & { changeableHere?: false; changeLimit?: string } {
  const limit = event.sourceKind === "imported" ? `Imported from ${event.sourceName}; ME3 cannot move or cancel it.`
    : event.recurrenceRule ? "Recurring; ME3 cannot move or cancel it here."
    : event.allDay ? "All-day; ME3 cannot move or cancel it here." : null;
  return limit ? { ...event, changeableHere: false, changeLimit: limit } : event;
}

type AvailabilitySlot = { startsAt: string; endsAt: string; localDate: string; localStartTime: string; localEndTime: string };
// Overlapping step-sized slots are hard to summarise reliably; contiguous ones
// merge into windows that state each free range once.
export function availabilityWindows(slots: readonly AvailabilitySlot[] | undefined) {
  const windows: Array<{ localDate: string; from: string; until: string; slots: number }> = [];
  let lastEnd = "";
  for (const slot of slots ?? []) {
    const current = windows.at(-1);
    if (current && current.localDate === slot.localDate && Date.parse(slot.startsAt) <= Date.parse(lastEnd)) {
      if (Date.parse(slot.endsAt) > Date.parse(lastEnd)) { current.until = slot.localEndTime; lastEnd = slot.endsAt; }
      current.slots++;
    } else {
      windows.push({ localDate: slot.localDate, from: slot.localStartTime, until: slot.localEndTime, slots: 1 });
      lastEnd = slot.endsAt;
    }
  }
  return windows;
}

export function calendarTools() {
  return [
    domainTool("core.calendar.events.list", async (args, context) => {
      const result = await readCalendarEventsForAgent(context.db, context.ownerId, context.ownerTimezone, args as CalendarAgentReadInput);
      // Website bookings are part of the owner's calendar, so every calendar read includes them.
      // Best effort: a bookings failure must never break the calendar answer.
      const bookings = await readBookingsInRangeForAgent(context.db, context.ownerId, { dateFrom: result.dateFrom, dateTo: result.dateTo, timezone: result.timezone }).catch(() => null);
      return ok({ ...result, events: result.events.map(withChangeLimit), ...(bookings ? { bookings } : { bookingsUnavailable: true }), ...await rememberTargets(context, "calendar event", result.events, event => event.title) });
    }, { fastPath: { mode: "arguments", candidates: "calendar" } }),
    domainTool("core.calendar.availability", async (args, context) => {
      const service = services(context).scheduling?.availability;
      if (!service) throw new Error("Calendar availability is unavailable.");
      const result = await service(args as Parameters<typeof service>[0]) as Record<string, unknown> & { slots?: AvailabilitySlot[] };
      return ok({ ...result, windows: availabilityWindows(result.slots) });
    }, { description: "Find bounded free-slot suggestions using booking time types, events and buffers. Slots can overlap; windows merges them into owner-local ranges in which a slot fits. A gap between windows can come from events, bookings, buffers or working hours, so do not call it busy without a calendar read. If limitReached is true, later slots may be omitted; disclose that bound. This read neither lists existing bookings nor creates a booking." }),
    domainTool("core.calendar.event.create", async (args, context) => {
      context.signal.throwIfAborted();
      const event = await createCalendarEventForAgent(context.db, context.ownerId, context.ownerTimezone, args as CalendarAgentCreateInput, { idempotencyKey: context.idempotencyKey });
      await rememberTargets(context, "calendar event", [event], value => value.title);
      return ok({ event });
    }, { fastPath: { mode: "tool_only" } }),
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
      const pending = approval(context, "Cancel calendar event", `${expected.title}, ${ownerDateTime(context, expected.startsAt)}`, { target: expected, targetDomain: "calendar event" });
      if (pending) return pending;
      context.signal.throwIfAborted();
      return ok({ cancelled: true, event: await cancelCalendarEventForAgent(context.db, context.ownerId, { eventId: id, startsAt: expected.startsAt, endsAt: expected.endsAt }, expected) });
    }, { effect: "destructive", approval: "required", description: "Cancel one previously read timed personal calendar event by stable ID after durable owner approval. Imported, recurring, and booking-linked events cannot be cancelled." }),
    domainTool("core.bookings.lookup", async (args, context) => ok(await readUpcomingBookingsForAgent(context.db, context.ownerId, args as { limit?: number }))),
  ];
}
