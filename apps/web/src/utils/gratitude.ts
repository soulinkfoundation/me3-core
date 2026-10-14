export type Quote = { id: string; text: string; author: string; source: string | null; sourceUrl: string | null; savedAt: string | null };
export type GratitudeSettings = { quoteInBriefing: boolean; eveningReminder: boolean; inToday?: boolean };
export type GratitudeState = {
  date: string; timezone: string; quote: Quote | null; gratitude: string[]; goodThings: string[];
  days: { date: string; written: boolean }[]; settings: GratitudeSettings;
};
export function gratitudeLines(value: unknown): string[] {
  return Array.from({ length: 3 }, (_, i) => Array.isArray(value) && typeof value[i] === "string" ? value[i] : "");
}
export function writtenGratitude(metadata?: Record<string, unknown>) {
  return { gratitude: gratitudeLines(metadata?.gratitude).filter(line => line.trim()), goodThings: gratitudeLines(metadata?.goodThings).filter(line => line.trim()) };
}
