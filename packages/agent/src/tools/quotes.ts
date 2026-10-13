import { domainTool, ok, requiredString, services } from "./common";
import { requireOwnerCreateIntent } from "../owner-create-intent";

export function quoteTools() {
  const tool = domainTool("core.quotes.save", async (args, context) => {
    requiredString(args.text, "Quote");
    const quotes = services(context).quotes;
    if (!quotes) throw new Error("Quote saving is unavailable.");
    const authorization = await requireOwnerCreateIntent(context, tool, args);
    context.signal.throwIfAborted();
    return ok({ quote: await quotes.save(args, { signal: context.signal, authorization }) });
  });
  return [tool];
}
