import { afterEach, describe, expect, it, vi } from "vitest";
import { getGratitudeState, updateGratitudeLines, updateGratitudeSettings, dispatchDueGratitudeReminders } from "./gratitude";
import { getBriefingQuote } from "./quotes";
import { notifyCalendarItemDue, notifyDailyBriefingReady } from "./push-notifications";
import { dispatchDueMorningCalendarPushes } from "./morning-calendar-push";
import { getLiveDailyBriefing } from "./daily-briefing";
import { createDomainTools } from "../../../packages/agent/src/tools";
import type { AgentToolContext } from "../../../packages/agent/src/types";
import { saveOwnerQuote } from "./quotes";
import { gratitudeFixture } from "./test-utils/gratitude-fixture";

vi.mock("./push-notifications", () => ({ notifyCalendarItemDue: vi.fn(async () => ({ ok: true, matched: 1, sent: 1 })), notifyDailyBriefingReady: vi.fn(async () => ({ ok: true, matched: 1, sent: 1, retryable: 0 })) }));
// Failure modes: clobbering writing/metadata, empty lines counting, device/owner
// date mismatch, enabling by default, duplicate pushes, completion not skipping,
// stale reminders, DST drift, losing existing reminders in the table rebuild.
const fixtures: ReturnType<typeof gratitudeFixture>[] = [];
function fixture(timezone?: string) { const f = gratitudeFixture(timezone); fixtures.push(f); return f; }
afterEach(() => { fixtures.splice(0).forEach(f => f.raw.close()); vi.clearAllMocks(); });
const morning = new Date("2026-10-13T08:00:00Z");
const evening = new Date("2026-10-13T20:00:00Z");

describe("Gratitude persistence and reminders", () => {
  it("adds the same day's quote to the briefing and additive push summary only when enabled", async () => {
    vi.useFakeTimers(); vi.setSystemTime(morning);
    try {
      const f = fixture(); const quote = await getBriefingQuote(f.env, "owner", morning);
      expect((await getLiveDailyBriefing(f.env, "owner")).message).toContain(quote!.text);
      await dispatchDueMorningCalendarPushes(f.env, morning);
      expect(notifyDailyBriefingReady).toHaveBeenCalledWith(f.env, "daily:2026-10-13", expect.objectContaining({ quote: { text: quote!.text, author: quote!.author }, counts: { birthdays: 0, events: 0, bookings: 0, reminders: 0 } }));
      await updateGratitudeSettings(f.env, "owner", { quoteInBriefing: false }, morning);
      expect((await getLiveDailyBriefing(f.env, "owner")).message).not.toContain(quote!.text);
      await dispatchDueMorningCalendarPushes(f.env, new Date("2026-10-14T08:00:00Z"));
      expect(vi.mocked(notifyDailyBriefingReady).mock.calls.at(-1)![2]).not.toHaveProperty("quote");
    } finally { vi.useRealTimers(); }
  });

  it("refuses direct agent saves without canonical independent authorization", async () => {
    const f = fixture(); const tool = createDomainTools().find(t => t.name === "core_quotes_save")!;
    const context = { db: f.env.DB, ownerId: "owner", messageText: 'Save this quote: "A small thing, in my own words."', signal: new AbortController().signal, enabledPluginIds: new Set(), services: { quotes: { save: (input: unknown) => saveOwnerQuote(f.env, "owner", input, "agent") } } } as unknown as AgentToolContext;
    expect((await tool.execute({ text: "A small thing, in my own words." }, context)).status).toBe("error");
    expect((await tool.execute({ text: "An invented line." }, context)).status).toBe("error");
    expect(f.raw.prepare("SELECT COUNT(*) count FROM quotes WHERE origin='agent'").get()).toMatchObject({ count: 0 });
  });
  it("preserves owner writing and metadata, counts either list, and uses the owner date", async () => {
    const f = fixture("Pacific/Auckland");
    f.raw.exec(`INSERT INTO journal_entries(id,user_id,entry_date,title,body,metadata_json) VALUES('day','owner','2026-10-14','My day','My own writing','{"other":42}')`);
    await updateGratitudeLines(f.env, "owner", { date: "2026-10-14", gratitude: [" Tea ", "", ""] }, evening);
    await updateGratitudeLines(f.env, "owner", { date: "2026-10-14", goodThings: ["A walk", "", ""] }, evening);
    const row = f.raw.prepare("SELECT * FROM journal_entries WHERE id='day'").get()!;
    expect(row.body).toBe("My own writing"); expect(row.title).toBe("My day");
    expect(JSON.parse(String(row.metadata_json))).toEqual({ other: 42, gratitude: ["Tea", "", ""], goodThings: ["A walk", "", ""] });
    const state = await getGratitudeState(f.env, "owner", evening);
    expect(state.date).toBe("2026-10-14"); expect(state.days).toHaveLength(7);
    expect(state.days.at(-1)).toEqual({ date: "2026-10-14", written: true });
    await expect(updateGratitudeLines(f.env, "owner", { date: "2026-10-13", gratitude: ["old"] }, evening)).rejects.toThrow();
  });

  it("defaults briefing quotes on and the evening reminder off, and honours both switches", async () => {
    const f = fixture();
    expect((await getGratitudeState(f.env, "owner", morning)).settings).toEqual({ quoteInBriefing: true, eveningReminder: false });
    expect(await getBriefingQuote(f.env, "owner", morning)).toBeTruthy();
    await updateGratitudeSettings(f.env, "owner", { quoteInBriefing: false, eveningReminder: true }, morning);
    expect(await getBriefingQuote(f.env, "owner", morning)).toBeNull();
    expect(f.raw.prepare("SELECT context_type,context_id,recurrence_rule,remind_at FROM user_reminders").get()).toMatchObject({ context_type: "card", context_id: "gratitude", recurrence_rule: "FREQ=DAILY", remind_at: evening.toISOString() });
    await updateGratitudeSettings(f.env, "owner", { eveningReminder: false }, morning);
    await dispatchDueGratitudeReminders(f.env, evening);
    expect(notifyCalendarItemDue).not.toHaveBeenCalled();
  });

  it("sends once at 21:00, advances locally, and skips if any good thing is already written", async () => {
    const f = fixture();
    await updateGratitudeSettings(f.env, "owner", { eveningReminder: true }, morning);
    await dispatchDueGratitudeReminders(f.env, new Date(evening.getTime() - 1));
    expect(notifyCalendarItemDue).not.toHaveBeenCalled();
    await Promise.all([dispatchDueGratitudeReminders(f.env, evening), dispatchDueGratitudeReminders(f.env, evening)]);
    expect(notifyCalendarItemDue).toHaveBeenCalledTimes(1);
    expect(notifyCalendarItemDue).toHaveBeenCalledWith(f.env, expect.objectContaining({ category: "reminders", contextType: "card", contextId: "gratitude" }));
    const tomorrow = new Date("2026-10-14T20:00:00Z");
    await updateGratitudeLines(f.env, "owner", { date: "2026-10-14", goodThings: ["Done"] }, tomorrow);
    await dispatchDueGratitudeReminders(f.env, tomorrow);
    expect(notifyCalendarItemDue).toHaveBeenCalledTimes(1);
    expect(f.raw.prepare("SELECT remind_at FROM user_reminders").get()!.remind_at).toBe("2026-10-15T20:00:00.000Z");
  });

  it("doesn't let gratitude lines suppress the evening reminder and handles DST", async () => {
    const f = fixture(); const now = new Date("2026-10-24T08:00:00Z");
    await updateGratitudeSettings(f.env, "owner", { eveningReminder: true }, now);
    await updateGratitudeLines(f.env, "owner", { date: "2026-10-24", gratitude: ["Thankful"] }, now);
    await dispatchDueGratitudeReminders(f.env, new Date("2026-10-24T20:00:00Z"));
    expect(notifyCalendarItemDue).toHaveBeenCalledTimes(1);
    expect(f.raw.prepare("SELECT remind_at FROM user_reminders").get()!.remind_at).toBe("2026-10-25T21:00:00.000Z");
  });
});
