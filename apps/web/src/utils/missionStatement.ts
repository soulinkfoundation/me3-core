// The dashboard API falls back to a fill-in-the-blanks template
// ("I am here to help [who/what]…") when the owner has not written a mission.
// Treat that template as no mission so pages prompt for one instead of showing it.
export function ownMissionStatement(statement: string | null | undefined): string {
  const text = statement?.trim() || "";
  return /\[[^\]]+\]/.test(text) ? "" : text;
}
