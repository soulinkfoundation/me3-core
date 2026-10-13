import { domainTool, ok, requiredString, services } from "./common";

export function quoteTools() {
  return [domainTool("core.quotes.save", async (args, context) => {
    const text = requiredString(args.text, "Quote");
    const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
    if (!normalize(context.messageText).includes(normalize(text))) throw new Error("Save only the quote supplied in the owner's message.");
    const quotes = services(context).quotes;
    if (!quotes) throw new Error("Quote saving is unavailable.");
    return ok({ quote: await quotes.save(args) });
  })];
}
