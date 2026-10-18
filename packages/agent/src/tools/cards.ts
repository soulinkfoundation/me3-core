import { domainTool, objectSchema, ok, requiredString, services } from "./common";
import type { AgentToolContext } from "../types";

/**
 * Custom Home cards. ME3 writes a small declarative spec; the install stores it,
 * keeps the data by day, and every client draws the card natively. These tools
 * never place a card on Home: the owner does that from the preview.
 */
const BLOCK = {
  type: "object",
  description: "One row of the card.",
  properties: {
    type: { type: "string", enum: ["habit", "counter", "note", "text"], description: "habit: a daily tick with streak and week dots. counter: a number per day (or a running total) with an optional goal. note: one short line per day. text: a fixed line of text." },
    key: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,31}$", description: "Stable id for habit, counter and note blocks; unique within the card. Omit for text." },
    label: { type: "string", maxLength: 60, description: "Short label for habit, counter and note blocks, e.g. Meditate, Water, Today's win." },
    emoji: { type: "string", maxLength: 8, description: "One emoji for this row." },
    perWeek: { type: "integer", minimum: 1, maximum: 7, description: "Habit only: a target of this many days a week instead of every day." },
    unit: { type: "string", maxLength: 12, description: "Counter only: unit label, e.g. glasses, pages, km." },
    step: { type: "number", minimum: 0.01, maximum: 1000, description: "Counter only: how much one tap adds. Default 1." },
    goal: { type: "number", minimum: 0.01, maximum: 1000000, description: "Counter only: the value that counts the row as done." },
    period: { type: "string", enum: ["day", "total"], description: "Counter only: day resets each day (default); total keeps a running sum." },
    placeholder: { type: "string", maxLength: 60, description: "Note only: hint shown when the day's line is empty." },
    text: { type: "string", maxLength: 200, description: "Text only: the line to show." },
  },
  required: ["type"],
  additionalProperties: false,
};
const CARD_PROPERTIES = {
  name: { type: "string", minLength: 1, maxLength: 40, description: "Card title, one or two words, e.g. Habits, Reading, Water." },
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
      description: "List the owner's custom Home cards with today's state (ticks, streaks, counters, notes). Read before changing or using a card.",
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
      description: "Build a new custom Home card from blocks when the owner wants to track, count or note something (habits, water, reading, mood, savings, a daily win). Choose an emoji per row and for the card. The owner sees a live preview with Add to Home; do not add it yourself. Reply in one short line and invite them to try it.",
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
      description: "Use a custom card for the owner: tick a habit (on false unticks), add to a counter, or set a counter or note for a day. Today unless a past date is given; never a future day. Use when the owner says they did a habit or logged a number.",
      parameters: objectSchema({
        cardId,
        action: { type: "string", enum: ["tick", "add", "set"], description: "tick a habit, add to a counter, or set a counter number or note text." },
        key: { type: "string", description: "The block key on the card." },
        on: { type: "boolean", description: "tick only: false removes the tick. Default true." },
        by: { type: "number", description: "add only: amount to add (negative to undo). Default the block's step." },
        value: { type: ["number", "string"], description: "set only: the counter number or note text." },
        date: { type: "string", format: "date", description: "Local YYYY-MM-DD; default today." },
      }, ["cardId", "action", "key"]),
    }),
  ];
}
