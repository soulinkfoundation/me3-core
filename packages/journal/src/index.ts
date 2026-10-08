export const JOURNAL_PLUGIN_ID = "me3.journal";

export const JOURNAL_RUNTIME = {
  id: JOURNAL_PLUGIN_ID,
  packageName: "@me3-core/plugin-journal",
  bundled: true,
  runtimeStatus: "journal_workspace",
  defaultRoute: "/journal",
  notes: [
    "Core bundles Journal as an optional first-party private writing workspace.",
    "Journal entries are owner-scoped and plugin-owned.",
    "Assistant actions and operational review stay outside this plugin boundary.",
  ],
} as const;

export {
  normalizeJournalBodyFormat,
  normalizeJournalDateKey,
  type JournalBodyFormat,
} from "./schema";

export {
  getJournalDay, updateJournalDay, JournalInputError, JournalConflictError,
  requireJournalDateKey, serializeJournalEntry, type JournalEntryRow,
} from "./day";
export { saveJournalDayForAgent } from "./agent-write";

export {
  readJournalEntriesForAgent,
  type JournalAgentDb,
  type JournalAgentEntry,
  type JournalAgentReadInput,
  type JournalAgentReadResult,
} from "./agent-read";
