import { readJournalEntriesForAgent, saveJournalDayForAgent, type JournalAgentEntry, type JournalAgentReadInput } from "@me3-core/plugin-journal";
import { domainTool, ok, requiredString } from "./common";
import { approval, rememberTargets, requireTarget } from "./targets";

export function journalTools() {
  return [
    domainTool("core.journal.read", async (args, context) => {
      const result = await readJournalEntriesForAgent(context.db, context.ownerId, args as JournalAgentReadInput);
      await rememberTargets(context, "journal day", result.entries.map(entry => ({ ...entry, id: entry.date })));
      return ok(result);
    }),
    domainTool("core.journal.save", async (args, context) => {
      const date = requiredString(args.date, "Journal date");
      const mode = args.mode as "create" | "append" | "replace";
      if (!["create", "append", "replace"].includes(mode)) throw new Error("Invalid journal save mode.");
      if (mode !== "create") {
        const expected = await requireTarget<JournalAgentEntry>(context, "journal day", date);
        if (args.expectedRevision !== expected.revision) throw new Error("Journal revision must match the previously read day.");
        if (mode === "replace") {
          const pending = approval(context, "Replace journal entry", `Replace the journal body for ${date}`, { target: expected, targetDomain: "journal day", replacementBody: args.body });
          if (pending) return pending;
        }
      }
      const result = await saveJournalDayForAgent(context.db, context.ownerId, args as Parameters<typeof saveJournalDayForAgent>[2], context.idempotencyKey);
      const { metadata: _metadata, ...entry } = result.entry;
      await rememberTargets(context, "journal day", [{ ...entry, id: entry.date }]);
      return ok({ entry, mode });
    }, { idempotencyArguments: args => { const { expectedRevision: _revision, ...semantic } = args; return semantic; } }),
  ];
}
