import { domainTool, objectSchema, ok, requiredString, services } from "./common";
import type { AgentToolContext } from "../types";

/**
 * Custom Home cards (catalog me3/cards/v1). ME3 writes a small declarative spec;
 * the install stores it, keeps habit and counter entries by day, fills data
 * blocks from live install data, and every client draws the card natively.
 * These tools never place a card on Home: the owner does that from the preview.
 */
const SOURCES = ["bookings.week", "money.today", "money.month", "invoices.unpaid", "invoices.overdue", "enquiries.new", "tasks", "reminders", "goal"];
const BLOCK = {
  type: "object",
  description: "One row of the card.",
  properties: {
    type: { type: "string", enum: ["habit", "counter", "stat", "progress", "days", "list", "action"], description: "You-fill-in blocks: habit (a daily tick with streak and week dots), counter (a number per day or a running total, optional goal). Live-data blocks read a source and update by themselves: stat (one big number), progress (a bar toward a goal), days (one bar per weekday, bookings only), list (up to 5 rows; tasks rows get tick boxes that tick the real task). action: a button that sends prompt to ME3 in chat, for anything with side effects (reminding late payers, replying); ME3 still asks before sending." },
    key: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,31}$", description: "Stable id for habit and counter blocks; unique within the card. Optional for other blocks." },
    source: { type: "string", enum: SOURCES, description: "Data blocks only. stat: any source except reminders. progress: money.month (needs goal) or goal. days: bookings.week. list: bookings.week, invoices.unpaid, invoices.overdue, enquiries.new, tasks, reminders. Business sources (bookings, money, invoices, enquiries) only make sense if the owner takes bookings or payments." },
    goalId: { type: "string", description: "goal and tasks sources only: the goal id from the goals tools. Without it, goal uses the first active goal and tasks lists all open tasks." },
    limit: { type: "integer", minimum: 1, maximum: 5, description: "List only: rows to show. Default 3." },
    empty: { type: "string", maxLength: 80, description: "List only: what to show when there is nothing, e.g. Everyone has paid." },
    prompt: { type: "string", maxLength: 300, description: "Action only: what the button asks ME3, in the owner's words, e.g. Remind everyone with an overdue invoice." },
    label: { type: "string", maxLength: 60, description: "habit and counter: short label, e.g. Meditate, Water. action: the button text, e.g. Remind late payers. stat and progress: optional replacement for the default caption." },
    emoji: { type: "string", maxLength: 8, description: "One emoji for this row." },
    perWeek: { type: "integer", minimum: 1, maximum: 7, description: "Habit only: a target of this many days a week instead of every day." },
    unit: { type: "string", maxLength: 12, description: "Counter only: unit label, e.g. glasses, pages, km." },
    step: { type: "number", minimum: 0.01, maximum: 1000, description: "Counter only: how much one tap adds. Default 1." },
    goal: { type: "number", minimum: 0.01, maximum: 100000000, description: "Counter: the value that counts the row as done. money.month progress: the monthly money goal in the owner's currency (major units, e.g. 3000)." },
    period: { type: "string", enum: ["day", "total"], description: "Counter only: day resets each day (default); total keeps a running sum." },
  },
  required: ["type"],
  additionalProperties: false,
};
const CARD_PROPERTIES = {
  name: { type: "string", minLength: 1, maxLength: 40, description: "Card title, one to three words, e.g. Habits, Owed to you, Launch my course." },
  emoji: { type: "string", minLength: 1, maxLength: 8, description: "One emoji for the card header." },
  blocks: { type: "array", minItems: 1, maxItems: 12, items: BLOCK, description: "The rows, top to bottom. Keep cards short: up to 12 rows." },
};
const cardId = { type: "string", minLength: 1, description: "Card id from core_cards_list, core_cards_read or a create result, e.g. card-habits." };

function cards(context: AgentToolContext) {
  const service = services(context).cards;
  if (!service) throw new Error("Custom cards are unavailable on this installation.");
  return service;
}

export function cardTools() {
  return [
    domainTool("core.cards.list", async (_args, context) => ok(await cards(context).list()), {
      description: "List the owner's custom Home cards with today's state (ticks, streaks, counters and live data). Read before changing or using a card.",
      parameters: objectSchema({}),
    }),
    domainTool("core.cards.read", async (args, context) => ok(await cards(context).read(requiredString(args.cardId, "Card ID"))), {
      description: "Read one custom Home card: its spec, version history and today's state, including each habit's streak, longest run, this week's ticks and dates.",
      parameters: objectSchema({ cardId }, ["cardId"]),
    }),
    domainTool("core.cards.create", async (args, context) => {
      context.signal.throwIfAborted();
      return ok(await cards(context).create(args));
    }, {
      description: "Build a new custom Home card when the owner wants to track or see something at a glance: habits or counts they fill in, or live views of their own ME3 data (bookings this week, money in today or against a monthly goal, unpaid or overdue invoices, new enquiries, a goal with its tasks and reminders). Keep cards short, about 2 to 4 blocks. Pick an emoji for the card. The owner sees a live preview with Add to Home; do not add it yourself. Reply in one short line and invite them to try it.",
      parameters: objectSchema(CARD_PROPERTIES, ["name", "emoji", "blocks"]),
    }),
    domainTool("core.cards.update", async (args, context) => {
      const id = requiredString(args.cardId, "Card ID");
      const { cardId: _cardId, summary, ...changes } = args;
      context.signal.throwIfAborted();
      return ok(await cards(context).update(id, changes, summary));
    }, {
      description: "Change an existing custom card: new name, emoji or blocks (send the full block list to add, remove or reorder rows). Data for kept keys survives. Saves a new version the owner can roll back; summary is the one-line change note shown in its history.",
      parameters: objectSchema({ cardId, summary: { type: "string", minLength: 1, maxLength: 120, description: "One line saying what changed, e.g. Added cold shower." }, ...Object.fromEntries(Object.entries(CARD_PROPERTIES).map(([key, value]) => [key, { ...value, description: `Optional. ${value.description}` }])) }, ["cardId", "summary"]),
    }),
    domainTool("core.cards.act", async (args, context) => {
      const id = requiredString(args.cardId, "Card ID");
      const { cardId: _cardId, ...action } = args;
      context.signal.throwIfAborted();
      return ok(await cards(context).act(id, action));
    }, {
      description: "Use a custom card for the owner: tick a habit (on false unticks), add to a counter, or set a counter for a day. Today unless a past date is given; never a future day. Use when the owner says they did a habit or logged a number. To tick a task, use the task tools.",
      parameters: objectSchema({
        cardId,
        action: { type: "string", enum: ["tick", "add", "set"], description: "tick a habit, add to a counter, or set a counter number." },
        key: { type: "string", description: "The block key on the card." },
        on: { type: "boolean", description: "tick only: false removes the tick. Default true." },
        by: { type: "number", description: "add only: amount to add (negative to undo). Default the block's step." },
        value: { type: ["number", "string"], description: "set only: the counter number." },
        date: { type: "string", format: "date", description: "Local YYYY-MM-DD; default today." },
      }, ["cardId", "action", "key"]),
    }),
  ];
}
