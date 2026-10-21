import { afterEach, describe, expect, it, vi } from "vitest";
import { backfillGratitudeText, getGratitudeState, updateGratitudeLines, updateGratitudeSettings, dispatchDueGratitudeReminders, withGratitudeText } from "./gratitude";
import { getBriefingQuote } from "./quotes";
import { notifyCalendarItemDue, notifyDailyBriefingReady } from "./push-notifications";
import { dispatchDueMorningCalendarPushes } from "./morning-calendar-push";
import { getLiveDailyBriefing } from "./daily-briefing";
import { createDomainTools } from "../../../packages/agent/src/tools";
import type { AgentToolContext } from "../../../packages/agent/src/types";
import { saveOwnerQuote } from "./quotes";
import { gratitudeFixture } from "./test-utils/gratitude-fixture";
import { deleteJournalDay } from "./journal";
import { cancelAgentReminder, getPendingAgentReminder, listPendingAgentReminders, updateAgentReminder } from "../../../packages/agent-chat/src/reminders";

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
    expect(row.body).toBe("My own writing\n\n### Grateful for\n\n1. Tea\n\n### Three good things\n\n1. A walk"); expect(row.title).toBe("My day");
    expect(JSON.parse(String(row.metadata_json))).toEqual({ other: 42, gratitude: ["Tea", "", ""], goodThings: ["A walk", "", ""], gratitudeInBody: true });
    const state = await getGratitudeState(f.env, "owner", evening);
    expect(state.date).toBe("2026-10-14"); expect(state.days).toHaveLength(7);
    expect(state.days.at(-1)).toEqual({ date: "2026-10-14", written: true });
    await expect(updateGratitudeLines(f.env, "owner", { date: "2026-10-13", gratitude: ["old"] }, evening)).rejects.toThrow();
  });

  it("keeps the lines as one section of the day's writing, replacing it on each save and leaving the rest alone", () => {
    const html = withGratitudeText("<p>Before</p>", "html", "gratitude", ["Tea & <cake>", "", "Rain"]);
    expect(html).toBe("<p>Before</p><h3>Grateful for</h3><ol><li><p>Tea &amp; &lt;cake&gt;</p></li><li><p>Rain</p></li></ol>");
    expect(withGratitudeText(`${html}<p>After</p>`, "html", "gratitude", ["Sun $&"])).toBe("<p>Before</p><h3>Grateful for</h3><ol><li><p>Sun $&amp;</p></li></ol><p>After</p>");
    expect(withGratitudeText(`${html}<p>After</p>`, "html", "gratitude", ["", "", ""])).toBe("<p>Before</p><p>After</p>");
    expect(withGratitudeText("<p></p>", "html", "goodThings", ["Gym"])).toBe("<h3>Three good things</h3><ol><li><p>Gym</p></li></ol>");
    const markdown = "Morning\n\n### Three good things\n\n1. Gym\n2. Coffee\n\nEvening";
    expect(withGratitudeText(markdown, "markdown", "goodThings", ["Walk"])).toBe("Morning\n\n### Three good things\n\n1. Walk\n\nEvening");
    expect(withGratitudeText(markdown, "markdown", "goodThings", [])).toBe("Morning\n\nEvening");
  });

  it("moves an older day's lines into its writing once, and not again after the owner deletes them", async () => {
    const f = fixture();
    f.raw.exec(`INSERT INTO journal_entries(id,user_id,entry_date,body,body_format,metadata_json) VALUES('old','owner','2026-10-01','<p>Hi</p>','html','{"gratitude":["Tea","",""],"goodThings":["","",""]}')`);
    const entry = () => { const row = f.raw.prepare("SELECT body, metadata_json FROM journal_entries WHERE id='old'").get()!; return { date: "2026-10-01", body: String(row.body), metadata: JSON.parse(String(row.metadata_json)) }; };
    expect(await backfillGratitudeText(f.env, "owner", entry())).toBe(true);
    expect(entry().body).toBe("<p>Hi</p><h3>Grateful for</h3><ol><li><p>Tea</p></li></ol>");
    f.raw.exec("UPDATE journal_entries SET body='<p>Hi</p>' WHERE id='old'");
    expect(await backfillGratitudeText(f.env, "owner", entry())).toBe(false);
    expect(entry().body).toBe("<p>Hi</p>");
  });

  it("defaults briefing quotes on and the evening reminder off, and honours both switches", async () => {
    const f = fixture();
    expect((await getGratitudeState(f.env, "owner", morning)).settings).toEqual({ quoteInBriefing: true, eveningReminder: false, inToday: false });
    expect(await getBriefingQuote(f.env, "owner", morning)).toBeTruthy();
    await updateGratitudeSettings(f.env, "owner", { quoteInBriefing: false, eveningReminder: true }, morning);
    expect(await getBriefingQuote(f.env, "owner", morning)).toBeNull();
    expect(f.raw.prepare("SELECT context_type,context_id,recurrence_rule,remind_at FROM user_reminders").get()).toMatchObject({ context_type: "card", context_id: "gratitude", recurrence_rule: "FREQ=DAILY", remind_at: evening.toISOString() });
    await updateGratitudeSettings(f.env, "owner", { eveningReminder: false }, morning);
    await dispatchDueGratitudeReminders(f.env, evening);
    expect(notifyCalendarItemDue).not.toHaveBeenCalled();
  });

  it("keeps Gratitude off the Today card until switched on, without touching the other switches", async () => {
    const f = fixture();
    expect((await updateGratitudeSettings(f.env, "owner", { inToday: true }, morning)).settings).toEqual({ quoteInBriefing: true, eveningReminder: false, inToday: true });
    expect((await getGratitudeState(f.env, "owner", morning)).settings.inToday).toBe(true);
    expect((await updateGratitudeSettings(f.env, "owner", { inToday: false }, morning)).settings.inToday).toBe(false);
    await expect(updateGratitudeSettings(f.env, "owner", { inToday: "yes" }, morning)).rejects.toThrow();
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

  it("starts a deleted journal page over instead of restoring its writing", async () => {
    const f = fixture();
    f.raw.exec(`INSERT INTO journal_entries(id, user_id, entry_date, title, body, body_format, metadata_json, revision)
      VALUES ('j1', 'owner', '2026-10-13', 'Private', '<p>secret diary</p>', 'html', '{"goodThings":["old","",""]}', 1)`);
    await deleteJournalDay(f.env, "owner", "2026-10-13");
    await updateGratitudeLines(f.env, "owner", { date: "2026-10-13", gratitude: ["coffee"] }, morning);

    const row = f.raw.prepare("SELECT title, body, archived_at, metadata_json FROM journal_entries").get()!;
    expect(row).toMatchObject({ title: null, body: "<h3>Grateful for</h3><ol><li><p>coffee</p></li></ol>", archived_at: null });
    expect(JSON.parse(String(row.metadata_json))).toEqual({ gratitude: ["coffee", "", ""], gratitudeInBody: true });

    // A live page keeps its writing.
    f.raw.exec("UPDATE journal_entries SET title = 'Kept', body = '<p>today</p>'");
    await updateGratitudeLines(f.env, "owner", { date: "2026-10-13", goodThings: ["sun"] }, morning);
    expect(f.raw.prepare("SELECT title, body, metadata_json FROM journal_entries").get()).toMatchObject({
      title: "Kept", body: "<p>today</p><h3>Three good things</h3><ol><li><p>sun</p></li></ol>", metadata_json: JSON.stringify({ gratitude: ["coffee", "", ""], gratitudeInBody: true, goodThings: ["sun", "", ""] }),
    });
  });

  it("keeps the evening reminder out of the briefing and the agent's reminder tools", async () => {
    vi.useFakeTimers(); vi.setSystemTime(morning);
    try {
      const f = fixture();
      await updateGratitudeSettings(f.env, "owner", { eveningReminder: true }, morning);
      f.raw.exec(`INSERT INTO user_reminders(id, user_id, title, remind_at, timezone, status)
        VALUES ('r-call', 'owner', 'Call Mam', '2026-10-13T17:00:00.000Z', 'Europe/Dublin', 'pending')`);
      const card = f.raw.prepare("SELECT id FROM user_reminders WHERE context_type = 'card'").get()!.id as string;

      const message = (await getLiveDailyBriefing(f.env, "owner")).message;
      expect(message).toContain("Call Mam");
      expect(message).not.toContain("Three good things");

      const env = { DB: f.env.DB } as never;
      expect((await listPendingAgentReminders(env, "owner", { includeOverdue: true })).map(r => r.title)).toEqual(["Call Mam"]);
      expect(await getPendingAgentReminder(env, "owner", card)).toBeNull();
      expect(await listPendingAgentReminders(env, "owner", { query: "Three good things", includeOverdue: true })).toEqual([]);
      expect(await updateAgentReminder(env, "owner", card, { title: "Three good things", remindAt: "2026-10-13T18:00:00.000Z" })).toMatchObject({ status: 404 });
      expect(f.raw.prepare("SELECT remind_at FROM user_reminders WHERE id = ?").get(card)!.remind_at).toBe("2026-10-13T20:00:00.000Z");

      // The calendar's Reminders row can still turn it off, which the card settings reflect.
      expect(await cancelAgentReminder(env, "owner", card)).toEqual({ ok: true });
      expect((await getGratitudeState(f.env, "owner", morning)).settings.eveningReminder).toBe(false);
    } finally { vi.useRealTimers(); }
  });
});
