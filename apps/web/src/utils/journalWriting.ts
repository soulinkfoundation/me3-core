export function reorderJournalBlocks<T extends { id: string; text: string }>(blocks: T[], order: string[]): T[] | null {
  const filled = blocks.filter((block) => block.text.trim());
  const byId = new Map(filled.map((block) => [block.id, block]));
  if (order.length !== filled.length || new Set(order).size !== filled.length || order.some((id) => !byId.has(id))) return null;
  let next = 0;
  return blocks.map((block) => block.text.trim() ? byId.get(order[next++])! : block);
}
