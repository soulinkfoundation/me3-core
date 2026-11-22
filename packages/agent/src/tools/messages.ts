import type { AgentTool } from "../types";
import { domainTool, ok, optionalString, requiredString } from "./common";

type ContactRow = { id: string; name: string; source: string | null; source_ref: string | null; social_handles: string | null; metadata: string | null };

/**
 * "Tell Erum I'm running late": ME3 drafts a message to one person and the owner's
 * app shows it as a card with Edit and Send. The phone sends it through Soulink
 * chat; this tool never sends and has no way to read anyone's messages.
 */
export function messageTools(): AgentTool[] {
  return [
    domainTool("core.messages.draft", async (args, context) => {
      const text = requiredString(args.text, "Message text");
      if (text.length > 2000) throw new Error("Keep the message under 2000 characters.");
      const contactId = optionalString(args.contactId)?.trim();
      const name = optionalString(args.to)?.trim();
      if (!contactId && !name) throw new Error("Say who the message is for: their name as the owner said it, or a contactId.");
      context.signal.throwIfAborted();

      const columns = "id, name, source, source_ref, social_handles, metadata";
      const rows = contactId
        ? [await context.db.prepare(`SELECT ${columns} FROM contacts WHERE id = ? AND user_id = ? AND status = 'active'`)
          .bind(contactId, context.ownerId).first<ContactRow>()].filter((row): row is ContactRow => Boolean(row))
        : bestNameMatches((await context.db.prepare(
          `SELECT ${columns} FROM contacts WHERE user_id = ? AND status = 'active' AND name LIKE ? COLLATE NOCASE
           ORDER BY updated_at DESC LIMIT 20`,
        ).bind(context.ownerId, `%${name!.replace(/[%_]/g, "")}%`).all<ContactRow>()).results || [], name!);

      const recipient = { name: name ?? null };
      if (!rows.length) {
        return ok({ drafted: false, reason: "unknown", recipient,
          next: "No one in the owner's People matches. Ask who they mean in one short sentence; nothing was drafted or sent." });
      }
      const reachable = rows.filter(row => nodeId(row));
      if (!reachable.length) {
        return ok({ drafted: false, reason: "not_on_me3", recipient: { name: rows[0].name, contactId: rows[0].id },
          next: `${rows[0].name} can't get ME3 messages yet. Say so in one short sentence and offer to invite them to ME3 from People, or to email them instead.` });
      }
      if (reachable.length > 1) {
        return ok({ drafted: false, reason: "ambiguous", candidates: reachable.slice(0, 5).map(row => ({ contactId: row.id, name: row.name })),
          next: "More than one person matches. Ask which one in one short sentence, naming them; then call this again with their contactId." });
      }
      const person = reachable[0];
      return ok({
        drafted: true,
        draft: { contactId: person.id, recipientName: person.name, soulinkNodeId: nodeId(person), soulinkHandle: handle(person), text },
        next: "The owner's app shows this message as a card with Edit and Send; nothing is sent until they tap Send. Reply in one short sentence and do not repeat the message.",
      });
    }),
  ];
}

/** Exact full name first, then first name, then anything containing the words. */
function bestNameMatches(rows: ContactRow[], query: string): ContactRow[] {
  const wanted = query.toLowerCase().replace(/\s+/g, " ");
  const exact = rows.filter(row => row.name.trim().toLowerCase().replace(/\s+/g, " ") === wanted);
  if (exact.length) return exact;
  const first = rows.filter(row => row.name.trim().toLowerCase().split(/\s+/)[0] === wanted);
  if (first.length) return first;
  return rows;
}

function record(value: string | null): Record<string, unknown> {
  try {
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function nodeId(row: ContactRow): string | null {
  const value = record(row.metadata).soulinkNodeId;
  if (typeof value === "string" && value.trim()) return value.trim();
  return row.source === "soulink" && row.source_ref?.trim() ? row.source_ref.trim() : null;
}

function handle(row: ContactRow): string | null {
  const value = record(row.social_handles).soulink;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
