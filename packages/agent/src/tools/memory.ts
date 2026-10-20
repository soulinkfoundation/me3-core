import { domainTool, ok, optionalString, requiredString } from "./common";
import { assertUnchanged, rememberTargets, requireTarget } from "./targets";

// What ME3 remembers about the owner. Memories are archived, never deleted, so a
// forgotten memory is also never proposed again by automatic memory.
type OwnerMemory = { id: string; body: string; kind: string; status: string; source: string };

const MEMORY_SELECT = `SELECT id, body, memory_kind AS kind, review_status AS status, source_kind AS source
  FROM mission_private_memory`;

export function memoryTools() {
  return [
    domainTool("core.memory.search", async (args, context) => {
      const words = (optionalString(args.query) || "").toLowerCase().split(/\s+/).filter(word => word.length > 1).slice(0, 6);
      const filters = words.map(() => "AND lower(body) LIKE ? ESCAPE '\\'").join(" ");
      const patterns = words.map(word => `%${word.replace(/[\\%_]/g, character => `\\${character}`)}%`);
      const rows = (await context.db.prepare(`${MEMORY_SELECT}
        WHERE user_id = ? AND review_status IN ('active', 'needs_review') ${filters}
        ORDER BY importance DESC, updated_at DESC LIMIT 20`)
        .bind(context.ownerId, ...patterns).all<OwnerMemory>()).results || [];
      await rememberTargets(context, "memory", rows, memory => memory.body);
      return ok({ memories: rows });
    }),
    domainTool("core.memory.forget", async (args, context) => {
      const id = requiredString(args.memoryId, "Memory ID");
      const expected = await requireTarget<OwnerMemory>(context, "memory", id);
      const current = await context.db.prepare(`${MEMORY_SELECT} WHERE id = ? AND user_id = ? AND review_status IN ('active', 'needs_review')`)
        .bind(id, context.ownerId).first<OwnerMemory>();
      if (!current) throw new Error("Memory not found.");
      assertUnchanged(expected, current, "Memory");
      context.signal.throwIfAborted();
      await context.db.prepare("UPDATE mission_private_memory SET review_status = 'archived', forgotten_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
        .bind(new Date().toISOString(), new Date().toISOString(), id, context.ownerId).run();
      return ok({ forgotten: true, memoryId: id, body: current.body });
    }),
  ];
}
