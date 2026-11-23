import type { AgentTool } from "../types";
import { domainTool, ok, optionalString, requiredString, services } from "./common";

type ContactRow = { id: string; name: string; source: string | null; source_ref: string | null; social_handles: string | null; metadata: string | null };
const COLUMNS = "id, name, source, source_ref, social_handles, metadata";

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

      const contacts = services(context).contacts;
      const lookup = async () => contactId
        ? [await context.db.prepare(`SELECT ${COLUMNS} FROM contacts WHERE id = ? AND user_id = ? AND status = 'active'`)
          .bind(contactId, context.ownerId).first<ContactRow>()].filter((row): row is ContactRow => Boolean(row))
        : bestNameMatches((await context.db.prepare(
          `SELECT ${COLUMNS} FROM contacts WHERE user_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 2000`,
        ).bind(context.ownerId).all<ContactRow>()).results || [], name!);
      await contacts?.refresh?.();
      let rows = await lookup();
      // Someone linked on Soulink since the last sync: pull them in now rather than tell the owner they don't exist.
      if (!rows.length && contacts?.refresh) {
        await contacts.refresh({ force: true });
        rows = await lookup();
      }
      const recipient = { name: name ?? null };
      if (!rows.length) {
        return ok({ drafted: false, reason: "unknown", recipient,
          next: "No one in the owner's People matches, even after checking Soulink for new links. Ask who they mean in one short sentence; nothing was drafted or sent." });
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

const normal = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

/** Edit distance where swapping two neighbouring letters ("Keiran") counts as one edit. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = [Array.from({ length: b.length + 1 }, (_, index) => index)];
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(rows[i - 1][j] + 1, row[j - 1] + 1, rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) row[j] = Math.min(row[j], rows[i - 2][j - 2] + 1);
    }
    rows.push(row);
  }
  return rows[a.length][b.length];
}

/**
 * Who the owner means, most certain first: the exact full name or Soulink handle, then a first name,
 * then names containing what they said, then a small misspelling (dictation turns "Soulink" into
 * "Solink"). Each tier wins outright, so a near miss never outvotes a real match.
 */
export function bestNameMatches(rows: ContactRow[], query: string): ContactRow[] {
  const wanted = normal(query);
  if (!wanted) return [];
  const names = (row: ContactRow) => {
    const full = normal(row.name);
    const tag = handle(row);
    return { full, first: full.split(" ")[0], tag: tag ? normal(tag) : null, words: full.split(" ") };
  };
  const tiers: ((row: ContactRow) => boolean)[] = [
    row => { const n = names(row); return n.full === wanted || n.tag === wanted; },
    row => names(row).first === wanted,
    row => { const n = names(row); return n.full.includes(wanted) || Boolean(n.tag?.includes(wanted)); },
    row => {
      const n = names(row);
      const allowed = wanted.length >= 8 ? 2 : wanted.length >= 4 ? 1 : 0;
      if (!allowed) return false;
      return [n.full, n.tag, ...n.words].some(candidate => candidate && distance(candidate, wanted, allowed) <= allowed);
    },
  ];
  for (const tier of tiers) {
    const found = rows.filter(tier);
    if (found.length) return found;
  }
  return [];
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
