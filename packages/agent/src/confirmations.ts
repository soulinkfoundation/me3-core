import type { AgentTool } from "./types";

// Everyday creates should feel instant. When the model marks a create as the
// last thing the owner's request needs and it is the step's only call, the
// loop replies with a confirmation built from the saved record instead of
// spending a second model call writing one.
export const FINAL_STEP_ARGUMENT = "finalStep";
const FINAL_STEP_PROPERTY = { type: "boolean", description: "Set true only when nothing else remains for the owner's request after this call; ME3 then confirms it directly. Leave it out when more steps follow, such as booking someone you are searching for." };

type Confirm = (data: unknown, timezone: string) => string | null;

function record(value: unknown, key: string): Record<string, unknown> | null {
  const outer = value && typeof value === "object" ? (value as Record<string, unknown>)[key] : null;
  return outer && typeof outer === "object" && !Array.isArray(outer) ? outer as Record<string, unknown> : null;
}
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }

export function ownerLocal(iso: unknown, timezone: string, parts: "date" | "time" | "both" = "both"): string | null {
  const date = typeof iso === "string" ? new Date(iso) : null;
  if (!date || !Number.isFinite(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, ...(parts !== "time" ? { weekday: "short", day: "numeric", month: "short" } : {}), ...(parts !== "date" ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(date);
  } catch { return null; }
}

export const confirmReminder: Confirm = (data, timezone) => {
  const reminder = record(data, "reminder");
  const title = text(reminder?.title), at = ownerLocal(reminder?.remindAt, text(reminder?.timezone) ?? timezone);
  if (!title || !at) return null;
  return `Reminder set: ${title}, ${at}${text(reminder?.recurrenceRule) ? ", repeating" : ""}.`;
};

export const confirmEvent: Confirm = (data, timezone) => {
  const event = record(data, "event");
  const title = text(event?.title), zone = text(event?.timezone) ?? timezone;
  const start = ownerLocal(event?.startsAt, zone), end = ownerLocal(event?.endsAt, zone, "time");
  if (!title || !start) return null;
  return `Added to your calendar: ${title}, ${start}${end ? `–${end}` : ""}.`;
};

export const confirmTask: Confirm = (data, timezone) => {
  const task = record(data, "task");
  const title = text(task?.title);
  if (!title) return null;
  const project = text(task?.projectName), due = ownerLocal(task?.dueAt, timezone, "date");
  return `Task added: ${title}${project ? ` in ${project}` : ""}${due ? `, due ${due}` : ""}.`;
};

/** A search the owner only wanted to see: the app shows each person as a row, so one line under them is enough. */
export const confirmPeopleFound: Confirm = (data) => {
  const results = data && typeof data === "object" ? (data as { results?: unknown }).results : null;
  if (!Array.isArray(results) || !results.length) return null;
  const people = results.filter((result): result is Record<string, unknown> => !!result && typeof result === "object");
  if (people.some(person => person.self === true)) return null;
  const only = people.length === 1 ? text(people[0].name) : null;
  return only ? `Here’s ${only} on ME3.` : `I found ${people.length} people on ME3.`;
};

/** Adds the optional finalStep flag; it never reaches the domain service or the effect identity. */
export function withOneStepConfirmation(tool: AgentTool, confirm: Confirm): AgentTool {
  const strip = (args: Record<string, unknown>) => { const { [FINAL_STEP_ARGUMENT]: _flag, ...rest } = args; return rest; };
  const execute = tool.execute;
  const idempotencyArguments = tool.idempotencyArguments;
  return {
    ...tool,
    parameters: { ...tool.parameters, properties: { ...(tool.parameters.properties as Record<string, unknown>), [FINAL_STEP_ARGUMENT]: FINAL_STEP_PROPERTY } },
    execute: (args, context) => execute(strip(args), context),
    idempotencyArguments: args => idempotencyArguments ? idempotencyArguments(strip(args)) : strip(args),
    confirm,
  };
}
