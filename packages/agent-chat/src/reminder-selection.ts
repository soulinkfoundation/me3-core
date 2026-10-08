import { normalizeTimeZone } from "@me3-core/plugin-calendar";
import type { AgentReminder, ReminderDb } from "./reminders";

type Choice = Pick<AgentReminder, "id" | "title" | "remindAt" | "timezone" | "status">;
type Selection = { operation: "update" | "cancel"; signature: string; choices: Choice[] };

export async function loadAgentReminderTitleChoices(db: ReminderDb, userId: string, title: string): Promise<Choice[]> {
  const rows = await db.prepare(
    `SELECT id, title, remind_at, timezone, status FROM user_reminders
     WHERE user_id = ? AND lower(trim(title)) = lower(trim(?)) AND status IN ('pending', 'failed')
     ORDER BY remind_at, id LIMIT 51`,
  ).bind(userId, title).all<{
    id: string; title: string; remind_at: string; timezone: string | null; status: AgentReminder["status"];
  }>();
  return (rows.results || []).map(row => ({
    id: row.id, title: row.title, remindAt: row.remind_at, timezone: row.timezone, status: row.status,
  }));
}

export async function loadAgentReminderSelection(input: {
  db: ReminderDb; userId: string; requestId: string; assistantText: string;
}): Promise<Selection | null> {
  if (!input.assistantText.startsWith("Which reminder do you mean? I haven't changed any reminders.")) return null;
  const previous = await input.db.prepare(
    `SELECT result_json FROM agent_tool_executions
     WHERE user_id = ? AND tool_name IN ('core_reminders_update', 'core_reminders_cancel')
       AND request_id != ? AND status = 'succeeded'
       AND json_valid(result_json) AND json_extract(result_json, '$.result.status') = 'needs_selection'
       AND json_extract(result_json, '$.fallbackReply') = ?
       AND datetime(updated_at) > datetime('now', '-30 minutes')
     ORDER BY updated_at DESC, rowid DESC LIMIT 1`,
  ).bind(input.userId, input.requestId, input.assistantText).first<{ result_json: string }>();
  return previous ? JSON.parse(previous.result_json).result.selection as Selection : null;
}

export function selectedAgentReminderChoice(selection: Selection | null, ownerText: string, ownerTimezone: string | null | undefined): Choice | undefined {
  if (!selection) return undefined;
  const text = normalizeChoiceText(ownerText);
  const number = numberedChoice(text);
  const candidates = number === null
    ? selection.choices.filter(choice => dateAliases(choice, ownerTimezone).includes(text))
    : selection.choices.slice(number - 1, number);
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function selectedAgentReminderSourceDate(choices: Choice[], ownerText: string, ownerTimezone: string | null | undefined): Choice | undefined {
  const text = normalizeChoiceText(ownerText);
  if (choices.length > 50 || /\b(?:not|except|neither)\b/.test(text) || /\breminder\s+id\s+/i.test(ownerText)) return undefined;
  const dated = choices.filter(choice => dateAliases(choice, ownerTimezone).some(date =>
    (` ${text} `).includes(` due on ${date} `),
  ));
  return dated.length === 1 ? dated[0] : undefined;
}

export async function requireAgentReminderSelection(input: {
  db: ReminderDb;
  userId: string;
  reminder: AgentReminder;
  operation: Selection["operation"];
  signature: string;
  ownerText: string;
  assistantText: string;
  previousOwnerText: string;
  ownerTimezone: string | null | undefined;
  priorSelection: Selection | null;
  forceSelection?: boolean;
}): Promise<{ selection: Selection; reply: string; selectedReminderId?: string } | null> {
  const choices = await loadAgentReminderTitleChoices(input.db, input.userId, input.reminder.title);
  const ownerText = normalizeChoiceText(input.ownerText);
  const excluded = /\b(?:not|except|neither)\b/.test(ownerText);
  const tokens: string[] = input.ownerText.match(/[\w-]+/g) || [];
  const explicitOwnerId = input.ownerText.match(/\breminder\s+id\s+([\w-]+)/i)?.[1];
  const explicitIds = choices.filter(choice => explicitOwnerId ? choice.id === explicitOwnerId : tokens.includes(choice.id));
  const hasSourceContext = ownerText.includes(normalizeChoiceText(input.reminder.title)) ||
    normalizeChoiceText(input.assistantText).includes(normalizeChoiceText(input.reminder.title)) ||
    normalizeChoiceText(input.previousOwnerText).includes(normalizeChoiceText(input.reminder.title));
  const hasSourceDate = hasSourceContext && /\bdue on\b/.test(ownerText);
  const replyingToChoice = input.assistantText.startsWith("Which reminder do you mean? I haven't changed any reminders.");
  if (choices.length < 2 && !replyingToChoice && !hasSourceDate && !explicitOwnerId && !explicitIds.length && !input.forceSelection) return null;
  let selected = explicitIds.length === 1 && !excluded ? explicitIds[0] : undefined;

  // An explicit source date identifies the existing record, never the proposed destination date.
  if (!selected && !explicitIds.length && !explicitOwnerId && choices.length <= 50 && hasSourceDate) {
    selected = selectedAgentReminderSourceDate(choices, input.ownerText, input.ownerTimezone);
  }

  const prior = input.priorSelection;
  if (!selected && prior?.operation === input.operation && prior.signature === input.signature) {
    const old = selectedAgentReminderChoice(prior, input.ownerText, input.ownerTimezone);
    if (old) {
      selected = choices.find(choice => choice.id === old.id && choice.title === old.title &&
        choice.remindAt === old.remindAt && choice.timezone === old.timezone && choice.status === old.status);
    }
  }
  if (selected?.id === input.reminder.id && !input.forceSelection) return null;

  const selection: Selection = { operation: input.operation, signature: input.signature, choices: choices.slice(0, 8) };
  const reply = [
    "Which reminder do you mean? I haven't changed any reminders.",
    ...selection.choices.map((choice, i) => `${i + 1}. ${choice.title} — ${formatChoice(choice, input.ownerTimezone)}`),
    ...(choices.length > 8 ? ["These are the first eight matches. Open Calendar to find another reminder's ID."] : []),
    "Reply with its number or specify the date it is currently due on.",
  ].join("\n");
  return { selection, reply, ...(selected ? { selectedReminderId: selected.id } : {}) };
}

function normalizeChoiceText(value: string): string {
  return value.toLocaleLowerCase().replace(/[,.!?]/g, " ").replace(/\s+/g, " ").trim();
}

function dateAliases(choice: Choice, ownerTimezone: string | null | undefined): string[] {
  const timeZone = normalizeTimeZone(choice.timezone) || normalizeTimeZone(ownerTimezone) || "UTC";
  const date = new Date(choice.remindAt);
  const format = (month: "long" | "short") => new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month, year: "numeric", timeZone,
  }).format(date);
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(date);
  return [format("long"), format("short"), parts].map(normalizeChoiceText);
}

function formatChoice(choice: Choice, ownerTimezone: string | null | undefined): string {
  const timeZone = normalizeTimeZone(choice.timezone) || normalizeTimeZone(ownerTimezone) || "UTC";
  return `${new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone }).format(new Date(choice.remindAt))} (${timeZone})`;
}

function numberedChoice(text: string): number | null {
  const words = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
  for (let i = 0; i < words.length; i++) {
    if ([`${i + 1}`, words[i], `the ${words[i]} one`].includes(text)) return i + 1;
  }
  return null;
}
