import type { AgentTool, AgentToolContext } from "../types";
import { domainTool, ok, optionalNumber, optionalString, requiredString, services } from "./common";
import { rememberTargets, requireTarget } from "./targets";
import type { AccountsEntryInput, AccountsEntryRecord } from "./services";

const ATTACHMENT_PREFIX = "me3-attachment:";

function accounts(context: AgentToolContext) {
  const service = services(context).accounts;
  if (!service) throw new Error("Accounts is unavailable.");
  return service;
}

/** The owner's attached images this turn, in the order they were sent. */
function receiptAttachmentId(context: AgentToolContext, position: number): string {
  const images = context.messages.filter(message => message.role === "user").flatMap(message => message.images || []);
  const url = images[position - 1]?.url;
  if (!url?.startsWith(ATTACHMENT_PREFIX)) throw new Error(images.length ? `receiptImage must be between 1 and ${images.length}.` : "No photo is attached to this message. Ask the owner to attach the receipt.");
  return decodeURIComponent(url.slice(ATTACHMENT_PREFIX.length));
}

function ownerToday(context: AgentToolContext) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: context.ownerTimezone, dateStyle: "short" }).format(new Date());
}

function entryInput(args: Record<string, unknown>): AccountsEntryInput {
  return {
    entryType: optionalString(args.entryType), amount: optionalNumber(args.amount), currency: optionalString(args.currency)?.trim().toUpperCase() || undefined,
    date: optionalString(args.date), description: optionalString(args.description), category: optionalString(args.category),
    status: optionalString(args.status), notes: optionalString(args.notes),
  };
}

const label = (entry: AccountsEntryRecord) => `${entry.description} ${entry.amount} ${entry.currency} ${entry.date}`;

// Accounts: the assistant reads the books and keeps entries. It never moves money and never deletes.
export function accountsTools(): AgentTool[] {
  return [
    domainTool("core.accounts.summary", async (_args, context) => ok(await accounts(context).summary())),
    domainTool("core.accounts.entries.list", async (args, context) => {
      const result = await accounts(context).listEntries({
        entryType: optionalString(args.entryType), dateFrom: optionalString(args.dateFrom), dateTo: optionalString(args.dateTo),
        category: optionalString(args.category), status: optionalString(args.status), search: optionalString(args.search), limit: optionalNumber(args.limit),
      });
      const selection = await rememberTargets(context, "accounts entry", result.entries, label);
      return ok({ ...result, ...selection, shown: result.entries.length, more: result.total > result.entries.length });
    }),
    domainTool("core.accounts.entry.create", async (args, context) => {
      const receiptImage = optionalNumber(args.receiptImage);
      const input = { ...entryInput(args), date: optionalString(args.date) || ownerToday(context) };
      context.signal.throwIfAborted();
      const result = await accounts(context).createEntry(input, { threadId: context.threadId, ...(receiptImage === undefined ? {} : { receiptAttachmentId: receiptAttachmentId(context, receiptImage) }) });
      await rememberTargets(context, "accounts entry", [result.entry], label);
      const next = result.duplicate
        ? "This photo was already added: this is the entry made the first time. Nothing new was created. Tell the owner."
        : result.receipt?.saved ? "Saved for the owner's review in Accounts, with the photo in Files. Tell the owner the supplier, date and amount you read so they can correct anything."
        : result.receipt ? `The entry was saved for review but the photo was not kept in Files: ${result.receipt.reason}` : undefined;
      return ok({ ...result, ...(next ? { next } : {}) });
    }),
    domainTool("core.accounts.entry.update", async (args, context) => {
      const id = requiredString(args.entryId, "Entry ID");
      await requireTarget<AccountsEntryRecord>(context, "accounts entry", id);
      const { entryType: _entryType, ...patch } = entryInput(args);
      if (!Object.values(patch).some(value => value !== undefined)) throw new Error("Give at least one field to change.");
      context.signal.throwIfAborted();
      const result = await accounts(context).updateEntry(id, patch);
      await rememberTargets(context, "accounts entry", [result.entry], label);
      return ok(result);
    }),
  ];
}
