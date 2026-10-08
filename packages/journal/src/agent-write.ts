import { getJournalDay, updateJournalDay, JournalConflictError, requireJournalDateKey } from "./day";
import type { JournalBodyFormat } from "./schema";

export async function saveJournalDayForAgent(
  db: Parameters<typeof getJournalDay>[0]["DB"],
  userId: string,
  input: {
    date: string;
    mode: "create" | "append" | "replace";
    body: string;
    title?: string;
    bodyFormat?: "plain_text" | "markdown";
    expectedRevision: number | null;
  },
  writeId: string,
) {
  const date = requireJournalDateKey(input.date);
  if (new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error("Journal date must be a real YYYY-MM-DD date.");
  }
  if (!input.body.trim()) throw new Error("Journal body must not be empty.");
  if (input.title !== undefined && input.title.length > 180) throw new Error("Journal title must be at most 180 characters.");
  if (!["create", "append", "replace"].includes(input.mode)) throw new Error("Invalid Journal save mode.");
  if (input.expectedRevision !== null && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)) {
    throw new Error("Journal expectedRevision must be a saved positive revision or null for create.");
  }
  if (input.bodyFormat && !["plain_text", "markdown"].includes(input.bodyFormat)) throw new Error("Journal save bodyFormat must be plain_text or markdown.");
  const { entry } = await getJournalDay({ DB: db }, userId, date);
  // Save the marker with the writing so a retry before the tool receipt cannot re-append.
  if (entry?.metadata.agentJournalWriteId === writeId) return { entry };
  if (input.mode === "create" ? input.expectedRevision !== null || entry !== null : !entry || entry.revision !== input.expectedRevision) {
    throw new JournalConflictError();
  }
  let bodyFormat: JournalBodyFormat = input.bodyFormat || "plain_text";
  let body = input.body;
  if (input.mode === "append" && entry) {
    bodyFormat = entry.bodyFormat;
    const addition = bodyFormat === "html" ? `<p>${escapeHtml(body).replace(/\n/g, "<br>")}</p>` : body;
    body = entry.body + (entry.body ? bodyFormat === "html" ? "\n" : "\n\n" : "") + addition;
  }
  return updateJournalDay({ DB: db }, userId, date, {
    title: input.title ?? entry?.title ?? null, body, bodyFormat,
  }, input.expectedRevision, { restoreArchived: false, writeId });
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
