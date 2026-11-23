import { resolveAgentCalendarStart } from "@me3-core/plugin-calendar";
import { cancelAgentReminder, createAgentReminder, getPendingAgentReminder, listPendingAgentReminders, parseAgentReminderInput, updateAgentReminder, type AgentReminder, type AgentReminderInput } from "../../../agent-chat/src/reminders";
import { domainTool, idProperty, objectSchema, ok, optionalString, requiredString, resultOrThrow } from "./common";
import { approval, ownerDateTime, assertUnchanged, rememberTargets, requireTarget } from "./targets";
import type { AgentToolContext } from "../types";

const reminderTimeProperties = {
  date: { type: "string", format: "date", description: "Future local YYYY-MM-DD date." },
  time: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$", description: "Local 24-hour HH:MM time." },
  timezone: { type: "string", description: "IANA timezone; omit to use the owner's timezone." },
  title: { type: "string", minLength: 1 }, notes: { type: "string" }, recurrence: { type: "string" },
};
const pad = (value: number) => String(value).padStart(2, "0");
function localNow(timezone: string, now: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/**
 * Owners often don't know when they want reminding, so a reminder never waits on a question: a missing
 * day or time gets a sensible one (09:00, tomorrow when today's has passed) and the owner can move it.
 */
export function defaultReminderWhen(args: { date?: unknown; time?: unknown }, timezone: string, now = new Date()): { date: string; time: string; guessed: boolean } {
  const date = optionalString(args.date)?.trim(), time = optionalString(args.time)?.trim();
  if (date && time) return { date, time, guessed: false };
  const local = localNow(timezone, now);
  const tomorrow = addDays(local.date, 1);
  if (time) {
    const [hour, minute] = time.split(":").map(Number);
    return { date: hour * 60 + minute > local.minutes ? local.date : tomorrow, time, guessed: true };
  }
  if (!date || date > local.date) return { date: date || tomorrow, time: "09:00", guessed: true };
  if (local.minutes < 9 * 60) return { date, time: "09:00", guessed: true };
  // Later today: the next whole hour at least an hour away, or tomorrow morning after 21:00.
  const hour = Math.floor(local.minutes / 60) + 2;
  return hour <= 22 ? { date, time: `${pad(hour)}:00`, guessed: true } : { date: tomorrow, time: "09:00", guessed: true };
}

function reminderInput(args: Record<string, unknown>, context: AgentToolContext, existing?: AgentReminder): AgentReminderInput {
  const { startDate: date, startTime: time, startTimezone: timezone } = resolveAgentCalendarStart({
    startDate: requiredString(args.date, "Reminder date"),
    startTime: requiredString(args.time, "Reminder time"),
    startTimezone: requiredString(args.timezone ?? context.ownerTimezone, "Reminder timezone"),
  }, "Reminder");
  const input = { date, time, timezone, title: args.title ?? existing?.title, notes: args.notes ?? existing?.notes, recurrence: args.recurrence ?? existing?.recurrenceRule };
  const parsed = parseAgentReminderInput(input);
  if ("error" in parsed) throw new Error(parsed.error);
  if (Date.parse(parsed.remindAt) <= Date.now()) throw new Error("Reminder time must be in the future.");
  return input;
}

export function reminderTools() {
  return [
    domainTool("core.reminders.list", async (args, context) => {
      const query = optionalString(args.query)?.trim().toLocaleLowerCase();
      const reminders = await listPendingAgentReminders({ DB: context.db }, context.ownerId, { query, limit: 50, includeOverdue: Boolean(query) });
      const selection = await rememberTargets(context, "reminder", reminders, reminder => reminder.title);
      return ok({ reminders, ...selection, ambiguous: reminders.length > 1 });
    }, { description: "List upcoming owner reminders with stable IDs. A nonempty query searches matching pending or failed reminders, including overdue records. Multiple matches return numbered candidates. Read before changing a reminder.", parameters: objectSchema({ query: { type: "string" } }) }),
    domainTool("core.reminders.create", async (args, context) => {
      context.signal.throwIfAborted();
      const defaulted = defaultReminderWhen(args, requiredString(args.timezone ?? context.ownerTimezone, "Reminder timezone"));
      const when = { ...defaulted, guessed: defaulted.guessed || args.guessedTime === true };
      const reminder = resultOrThrow(await createAgentReminder({ DB: context.db }, context.ownerId, reminderInput({ ...args, date: when.date, time: when.time }, context), { idempotencyKey: context.idempotencyKey }));
      await rememberTargets(context, "reminder", [reminder], value => value.title);
      return ok({ reminder, ...(when.guessed ? { timeChosenByMe3: true, next: "ME3 picked the time. Say when it is set for and that the owner can change it." } : {}) });
    }, { createCheck: true, parameters: objectSchema({
      ...reminderTimeProperties,
      date: { ...reminderTimeProperties.date, description: "Future local YYYY-MM-DD. Omit when the owner named no day (tomorrow is used)." },
      time: { ...reminderTimeProperties.time, description: "Local 24-hour HH:MM. Omit when the owner named no time (09:00 is used)." },
      guessedTime: { type: "boolean", description: "True when you chose the day or time from something vague like \"this weekend\"." },
    }, ["title"]) }),
    domainTool("core.reminders.update", async (args, context) => {
      const id = requiredString(args.reminderId, "Reminder ID");
      const expected = await requireTarget<AgentReminder>(context, "reminder", id);
      const existing = await getPendingAgentReminder({ DB: context.db }, context.ownerId, id);
      if (!existing) throw new Error("Reminder not found.");
      assertUnchanged(expected, existing, "Reminder");
      context.signal.throwIfAborted();
      resultOrThrow(await updateAgentReminder({ DB: context.db }, context.ownerId, id, reminderInput(args, context, existing), expected));
      const reminder = await getPendingAgentReminder({ DB: context.db }, context.ownerId, id);
      if (!reminder) throw new Error("Updated reminder could not be read back.");
      await rememberTargets(context, "reminder", [reminder], value => value.title);
      return ok({ reminder });
    }, { description: "Change one reminder using its stable ID from a prior read. Preserve omitted fields; ambiguous titles must first be resolved with list.", parameters: objectSchema({ reminderId: idProperty("reminder"), ...reminderTimeProperties }, ["reminderId", "date", "time"]) }),
    domainTool("core.reminders.cancel", async (args, context) => {
      const id = requiredString(args.reminderId, "Reminder ID");
      const expected = await requireTarget<AgentReminder>(context, "reminder", id);
      const current = await getPendingAgentReminder({ DB: context.db }, context.ownerId, id);
      if (!current) throw new Error("Reminder not found.");
      assertUnchanged(expected, current, "Reminder");
      const pending = approval(context, "Cancel reminder", `${current.title}, ${ownerDateTime(context, current.remindAt)}`, { target: current, targetDomain: "reminder" });
      if (pending) return pending;
      context.signal.throwIfAborted();
      resultOrThrow(await cancelAgentReminder({ DB: context.db }, context.ownerId, id, expected));
      return ok({ cancelled: true, reminderId: id });
    }, { description: "Cancel one previously read reminder using its stable ID. Requires durable owner approval.", effect: "destructive", approval: "required", parameters: objectSchema({ reminderId: idProperty("reminder") }, ["reminderId"]) }),
  ];
}
