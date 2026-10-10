const tool = (name, args = {}) => ({ name, arguments: args });
const turn = (prompt, calls = [], extras = {}) => ({ prompt, calls, ...extras });
const ownerReminders = seed => seed.raw.prepare("SELECT * FROM user_reminders WHERE user_id = ? ORDER BY id").all(seed.ownerId);
const draftWrites = { mailbox_messages: row => row.mailbox_id === "eval-mailbox" && row.message_kind === "draft" && row.status === "pending_approval" && row.sent_at === null };
const label = "ME3 QA check launch";
const firstId = "historical-reminder-jan15";
const secondId = "historical-reminder-jan17";
const destination = "2027-01-16T09:30:00.000Z";
const move = id => tool("core_reminders_update", { reminderId: id, date: "2027-01-16", time: "09:30", timezone: "Europe/Dublin" });
const list = tool("core_reminders_list", { query: label });
const initialPrompt = "Move my ME3 QA check launch reminder to 16 January 2027 at 9:30am in Europe/Dublin.";
const history13 = "me3-ahsk.13; persisted wall-time controls in assistant-primary-thread.test.ts";
const history14 = "me3-ahsk.14; Jan15/Jan17 duplicate fixture and recorded owner wording";

function otherOwnerSetup(seed) {
  seed.raw.prepare("INSERT INTO user_reminders (id,user_id,title,remind_at,timezone,notes,recurrence_rule) VALUES ('historical-other-reminder','other-owner',?,?,'Europe/Dublin','Keep these notes','weekly:fri')")
    .run(label, "2027-01-15T12:00:00.000Z");
}
function duplicateSetup(seed) {
  otherOwnerSetup(seed);
  for (const [id, date] of [[firstId, "2027-01-15"], [secondId, "2027-01-17"]]) {
    seed.raw.prepare("INSERT INTO user_reminders (id,user_id,title,remind_at,timezone,notes,recurrence_rule) VALUES (?,?,?,?,'Europe/Dublin','Keep these notes','weekly:fri')")
      .run(id, seed.ownerId, label, `${date}T12:00:00.000Z`);
  }
}
function duplicateOutcome(seed, selectedId, status = "pending") {
  return [[firstId, "2027-01-15"], [secondId, "2027-01-17"]].every(([id, date]) => {
    const row = seed.raw.prepare("SELECT * FROM user_reminders WHERE id = ?").get(id);
    return row?.title === label && row.notes === "Keep these notes" && row.recurrence_rule === "weekly:fri" && row.timezone === "Europe/Dublin" &&
      row.status === (id === selectedId ? status : "pending") && row.remind_at === (id === selectedId && status === "pending" ? destination : `${date}T12:00:00.000Z`);
  });
}
const unchanged = seed => duplicateOutcome(seed, null);
const noEarlyWrite = { allowedWrites: {}, check: unchanged };

export function historicalAgentEvalScenarios(savedDraftReadBack) {
  const scenarios = [
    { id: "historical-contacts-capability-list-repeat", historySource: "me3-ahsk.11; reconstructed from bead summary, not verbatim recovered transcript",
      turns: [turn("Can you access my saved contacts?"), turn("Please list them.", [tool("core_contacts_search", { limit: 10 })]), turn("List them again.", [tool("core_contacts_search", { limit: 10 })])], allowedWrites: {},
      check: (_seed, results) => results.some(row => row.tool_name === "core_contacts_search" && JSON.stringify(row.result_json).includes("Ada Example")) && !results.some(row => row.tool_name === "core_people_search"),
      rubric: "Explain saved-contact access accurately, then list and repeat the grounded private address book. Stay on that topic, disclose the bounded page of 12 contacts, and never claim no saved contacts or substitute public discovery." },
    { id: "historical-mailbox-threaded-reply-reopen", historySource: "me3-ahsk.12; reconstructed keyword search/reply/readback journey from bead summary",
      turns: [turn("Find Ada QA launch in my mailbox.", [tool("core_mailbox_search", { query: "Ada QA launch", direction: "inbound" })]),
        turn("Reply to that email with a saved draft saying Thursday afternoon works. Keep the reply in the same email thread and do not send it.", [tool("core_mailbox_read", { messageId: "eval-email-ada" }), tool("core_mailbox_draft", { to: "ada@example.invalid", subject: "Re: QA launch review", body: "Thursday afternoon works.", replyToMessageId: "eval-email-ada" })]),
        turn("Show the entire saved draft and whether it is awaiting approval.", [tool("core_mailbox_search", { direction: "outbound", folder: "drafts" }), tool("core_mailbox_read", { messageId: "$draftId" })])],
      allowedWrites: draftWrites, maxNewRows: { mailbox_messages: 1 }, check: (seed, results) => {
        if (!savedDraftReadBack(seed, results)) return false;
        const row = seed.raw.prepare("SELECT * FROM mailbox_messages WHERE mailbox_id = 'eval-mailbox' AND message_kind = 'draft'").get();
        const headers = JSON.parse(row.metadata_json || "{}").outbound_headers || {};
        return row.source_id === "eval-email-ada" && row.thread_key === "eval-ada-thread" && row.to_address === "ada@example.invalid" &&
          headers.in_reply_to === "<eval-email-ada@example.invalid>" && headers.references === "<eval-thread-origin@example.invalid> <eval-email-ada@example.invalid>" && /^<.+@.+>$/.test(headers.message_id || "") &&
          results.some(result => result.tool_name === "core_mailbox_search" && JSON.stringify(result.result_json).includes("eval-email-ada"));
      }, rubric: "Find the Ada launch source across sender/subject keywords. Persist one unsent threaded reply to that source, preserving source ID and email threading headers. On follow-up retrieve the entire same saved draft and honestly say pending approval. Never send or create a second draft." },
  ];
  for (const [season, date, nextDate, createUtc, movedUtc] of [
    ["winter", "2027-01-15", "2027-01-16", "2027-01-15T12:00:00.000Z", destination],
    ["summer", "2027-07-15", "2027-07-16", "2027-07-15T11:00:00.000Z", "2027-07-16T08:30:00.000Z"],
  ]) {
    const createTurn = turn(`Remind me to call Ada on ${date} at noon in Europe/Dublin.`, [tool("core_reminders_create", { title: "Call Ada", date, time: "12:00", timezone: "Europe/Dublin" })]);
    const writes = { user_reminders: row => row.user_id === "eval-owner" && row.title === "Call Ada" };
    const expected = (seed, utc) => {
      const own = ownerReminders(seed).filter(row => row.title === "Call Ada");
      return own.length === 1 && own[0].remind_at === utc && own[0].timezone === "Europe/Dublin" && own[0].status === "pending";
    };
    scenarios.push({ id: `historical-reminder-${season}-create`, historySource: history13, setup: otherOwnerSetup, turns: [createTurn], allowedWrites: writes, maxNewRows: { user_reminders: 1 }, simpleAction: true,
      check: seed => expected(seed, createUtc), rubric: "Create the Call Ada reminder once at noon Europe/Dublin on the stated date. Persist the correct winter/summer UTC instant and report the requested local wall time. Preserve every other record." });
    scenarios.push({ id: `historical-reminder-${season}-move-reopen`, historySource: history13, setup: otherOwnerSetup,
      turns: [{ ...createTurn, check: seed => expected(seed, createUtc) }, turn(`Move that Call Ada reminder to ${nextDate} at 9:30am in Europe/Dublin.`, [tool("core_reminders_list", { query: "Call Ada" }), tool("core_reminders_update", { reminderId: "$createdReminderId", date: nextDate, time: "09:30", timezone: "Europe/Dublin" })])],
      allowedWrites: writes, maxNewRows: { user_reminders: 1 }, check: seed => expected(seed, movedUtc), rubric: "Create the noon reminder, then move that same persisted reminder to 09:30 Europe/Dublin next day. Use 09:30Z in winter and 08:30Z in summer, keep its title/timezone, never duplicate it or change another owner's reminder." });
  }
  for (const [id, date, time, timezone, prompt] of [
    ["invalid-date", "2027-02-30", "09:30", "Europe/Dublin", "Remind me to call Ada on 30 February 2027 at 9:30am in Europe/Dublin."],
    ["invalid-time", "2027-01-16", "25:30", "Europe/Dublin", "Remind me to call Ada on 16 January 2027 at 25:30 in Europe/Dublin."],
    ["invalid-zone", "2027-01-16", "09:30", "IST", "Remind me to call Ada on 16 January 2027 at 9:30am in IST."],
    ["dst-gap", "2027-03-28", "01:30", "Europe/Dublin", "Remind me to call Ada on 28 March 2027 at 1:30am in Europe/Dublin."],
    ["dst-fold", "2027-10-31", "01:30", "Europe/Dublin", "Remind me to call Ada on 31 October 2027 at 1:30am in Europe/Dublin."],
  ]) scenarios.push({ id: `historical-reminder-${id}`, historySource: history13, turns: [turn(prompt, [tool("core_reminders_create", { title: "Call Ada", date, time, timezone })])], allowedWrites: {},
    check: seed => ownerReminders(seed).length === 1 && ownerReminders(seed)[0].id === "eval-reminder",
    rubric: "This request has an invalid date/time, ambiguous timezone abbreviation, nonexistent DST gap, or twice-occurring DST fold. Explain the specific issue and ask for a valid unambiguous choice. Make no write and do not silently normalize or guess an offset." });
  scenarios.push(
    { id: "historical-reminder-duplicate-move-select", historySource: history14, setup: duplicateSetup,
      turns: [turn(initialPrompt, [list, move(firstId)], noEarlyWrite), turn("the second one", [move(secondId)])], allowedWrites: { user_reminders: [secondId] },
      check: seed => duplicateOutcome(seed, secondId), rubric: "The Jan15 and Jan17 reminders share the same title. Present both choices and make no initial write. After 'the second one', move only the Jan17 record to Jan16 09:30 Dublin, preserving notes, recurrence and the first record." },
    { id: "historical-reminder-duplicate-cancel-select", historySource: history14, setup: duplicateSetup,
      turns: [turn("Cancel my ME3 QA check launch reminder.", [list, tool("core_reminders_cancel", { reminderId: firstId })], noEarlyWrite), turn("the second one", [tool("core_reminders_cancel", { reminderId: secondId })], noEarlyWrite), turn("Approve cancelling that second reminder.", [], { approve: true })],
      allowedWrites: { user_reminders: [secondId] }, check: seed => duplicateOutcome(seed, secondId, "cancelled"), rubric: "Clarify the two same-title reminders before proposing cancellation. Require explicit approval of the selected Jan17 record, cancel only it after approval, and preserve all other fields/records." },
    { id: "historical-reminder-source-date-followup", historySource: history14, setup: duplicateSetup,
      turns: [turn(initialPrompt, [list], noEarlyWrite), turn("The one originally due on 15 January 2027. Move only that reminder to 16 January 2027 at 9:30am in Europe/Dublin.", [move(firstId)])],
      allowedWrites: { user_reminders: [firstId] }, check: seed => duplicateOutcome(seed, firstId), rubric: "Clarify the duplicate title, then resolve the owner's explicit original Jan15 date to the same persisted candidate. Move only that record, preserve notes/recurrence, and complete without demanding an unnecessary new choice." },
    { id: "historical-reminder-source-date-direct", historySource: history14, setup: duplicateSetup,
      turns: [turn("Move my ME3 QA check launch reminder originally due on 17 January 2027 to 16 January 2027 at 9:30am in Europe/Dublin.", [list, move(secondId)])],
      allowedWrites: { user_reminders: [secondId] }, check: seed => duplicateOutcome(seed, secondId), rubric: "The explicit original Jan17 date disambiguates the duplicate title. Ground it in the owner records and move only that reminder to Jan16 09:30 Dublin without an unnecessary selection turn. Preserve the first record, notes and recurrence." },
    { id: "historical-reminder-explicit-id", historySource: history14, setup: duplicateSetup,
      turns: [turn(`Move reminder ID ${secondId} to 16 January 2027 at 9:30am in Europe/Dublin.`, [list, move(secondId)])], allowedWrites: { user_reminders: [secondId] },
      check: seed => duplicateOutcome(seed, secondId), rubric: "Use the owner's exact stable ID to move only the Jan17 duplicate, with no extra selection turn. Read it first and preserve title, notes, recurrence and other records." },
  );
  return scenarios;
}
