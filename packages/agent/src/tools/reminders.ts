import { normalizeTimeZone } from "@me3-core/plugin-calendar";
import { cancelAgentReminder, createAgentReminder, getPendingAgentReminder, listPendingAgentReminders, parseAgentReminderInput, updateAgentReminder, type AgentReminder, type AgentReminderInput } from "../../../agent-chat/src/reminders";
import { domainTool, idProperty, objectSchema, ok, optionalString, requiredString, resultOrThrow } from "./common";
import { approval, assertUnchanged, rememberTargets, requireTarget } from "./targets";
import type { AgentToolContext } from "../types";

const reminderTimeProperties = {
  date: { type: "string", format: "date", description: "Future local YYYY-MM-DD date." },
  time: { type: "string", pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$", description: "Local 24-hour HH:MM time." },
  timezone: { type: "string", description: "IANA timezone; omit to use the owner's timezone." },
  title: { type: "string", minLength: 1 }, notes: { type: "string" }, recurrence: { type: "string" },
};
function reminderInput(args: Record<string, unknown>, context: AgentToolContext, existing?: AgentReminder): AgentReminderInput {
  const date = requiredString(args.date, "Reminder date");
  const time = requiredString(args.time, "Reminder time");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Reminder date must be a real YYYY-MM-DD date.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Reminder time must use a valid HH:MM time.");
  const timezone = normalizeTimeZone(args.timezone ?? context.ownerTimezone);
  if (!timezone) throw new Error("Reminder timezone must be a valid IANA timezone.");
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
      const reminders = await listPendingAgentReminders({ DB: context.db }, context.ownerId, { query, limit: 50 });
      const selection = await rememberTargets(context, "reminder", reminders);
      return ok({ reminders, ...selection, ambiguous: reminders.length > 1 });
    }, { description: "List upcoming owner reminders with stable IDs. Use query to find matching titles; multiple matches return numbered candidates. Read before changing a reminder.", parameters: objectSchema({ query: { type: "string" } }) }),
    domainTool("core.reminders.create", async (args, context) => {
      const reminder = resultOrThrow(await createAgentReminder({ DB: context.db }, context.ownerId, reminderInput(args, context), { idempotencyKey: context.idempotencyKey }));
      await rememberTargets(context, "reminder", [reminder]);
      return ok({ reminder });
    }, { parameters: objectSchema(reminderTimeProperties, ["title", "date", "time"]) }),
    domainTool("core.reminders.update", async (args, context) => {
      const id = requiredString(args.reminderId, "Reminder ID");
      const expected = await requireTarget<AgentReminder>(context, "reminder", id);
      const existing = await getPendingAgentReminder({ DB: context.db }, context.ownerId, id);
      if (!existing) throw new Error("Reminder not found.");
      assertUnchanged(expected, existing, "Reminder");
      resultOrThrow(await updateAgentReminder({ DB: context.db }, context.ownerId, id, reminderInput(args, context, existing), expected));
      const reminder = await getPendingAgentReminder({ DB: context.db }, context.ownerId, id);
      if (!reminder) throw new Error("Updated reminder could not be read back.");
      await rememberTargets(context, "reminder", [reminder]);
      return ok({ reminder });
    }, { description: "Change one reminder using its stable ID from a prior read. Preserve omitted fields; ambiguous titles must first be resolved with list.", parameters: objectSchema({ reminderId: idProperty("reminder"), ...reminderTimeProperties }, ["reminderId", "date", "time"]) }),
    domainTool("core.reminders.cancel", async (args, context) => {
      const id = requiredString(args.reminderId, "Reminder ID");
      const expected = await requireTarget<AgentReminder>(context, "reminder", id);
      const current = await getPendingAgentReminder({ DB: context.db }, context.ownerId, id);
      if (!current) throw new Error("Reminder not found.");
      assertUnchanged(expected, current, "Reminder");
      const pending = approval(context, "Cancel reminder", `${current.title} at ${current.remindAt}`, { target: current, targetDomain: "reminder" });
      if (pending) return pending;
      resultOrThrow(await cancelAgentReminder({ DB: context.db }, context.ownerId, id, expected));
      return ok({ cancelled: true, reminderId: id });
    }, { description: "Cancel one previously read reminder using its stable ID. Requires durable owner approval.", effect: "destructive", approval: "required", parameters: objectSchema({ reminderId: idProperty("reminder") }, ["reminderId"]) }),
  ];
}
