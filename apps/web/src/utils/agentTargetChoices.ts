export type AgentTargetChoice = { presentationId: string; candidateId: string };
export type AgentTargetField = { label: string; value: string };
export type AgentTargetPresentation = {
  id: string;
  actionLabel: string;
  changes: AgentTargetField[];
  candidates: Array<{ id: string; option: number; label: string; fields: AgentTargetField[] }>;
  expiresAt: string;
  status: "pending" | "selected" | "unavailable";
};

export function normalizeAgentTargetPresentation(value: unknown): AgentTargetPresentation | null {
  if (!value || typeof value !== "object") return null;
  const card = value as AgentTargetPresentation;
  const text = (entry: unknown): entry is string => typeof entry === "string" && entry.length > 0 && entry.length <= 10_000;
  const fields = (entries: unknown): entries is AgentTargetField[] => Array.isArray(entries) && entries.length <= 50
    && entries.every(entry => entry && text(entry.label) && typeof entry.value === "string" && entry.value.length <= 10_000);
  if (!text(card.id) || !text(card.actionLabel) || !fields(card.changes)
    || !["pending", "selected", "unavailable"].includes(card.status) || !Number.isFinite(Date.parse(card.expiresAt))
    || !Array.isArray(card.candidates) || card.candidates.length === 0 || card.candidates.length > 100
    || card.candidates.some((candidate, index) => !candidate || !text(candidate.id) || !text(candidate.label)
      || candidate.option !== index + 1 || !fields(candidate.fields))
    || new Set(card.candidates.map(candidate => candidate.id)).size !== card.candidates.length) return null;
  return card;
}

export function targetChoiceRequest(value: unknown, candidateId: string): AgentTargetChoice | null {
  const card = normalizeAgentTargetPresentation(value);
  if (!card || card.status !== "pending" || Date.parse(card.expiresAt) <= Date.now()
    || !card.candidates.some(candidate => candidate.id === candidateId)) return null;
  return { presentationId: card.id, candidateId };
}
