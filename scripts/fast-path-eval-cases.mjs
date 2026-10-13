// Authored before the calibration rerun; holdout labels never select thresholds.
const read = (name, args) => ({ name, arguments: args });
const calendar = (dateFrom, dateTo = dateFrom) => read("core_calendar_events_list", dateFrom === null ? null : { dateFrom, dateTo });
const reminders = (args = {}) => read("core_reminders_list", args);
const tasks = (args = {}) => read("core_mission_task_list", args);
const create = name => ({ name, arguments: null });
const row = (id, messageText, expected, recentMessages = []) => ({ id, messageText, expected, recentMessages, images: [], argumentsScorable: true });
const history = date => [{ role: "user", content: "List reminders about Harbor and tasks in the Harbor project for tomorrow." },
  { role: "assistant", content: `The Harbor reminders and project tasks are above. Tomorrow means ${date}.` }];
function dates(baseDate) {
  return offset => { const date = new Date(`${baseDate}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); };
}
export function calibrationExtras(baseDate) {
  const day = dates(baseDate);
  const recent = history(day(1));
  return [
    row("cal-relative-range", "List my calendar for the next 3 days.", calendar(day(0), day(2))),
    row("cal-relative-day", "Show calendar events the day after tomorrow.", calendar(day(2))),
    row("cal-task-create", "Add a task called Check launch copy to my ME3 Launch project.", create("core_mission_task_create")),
    row("cal-task-create-short", "Create a task: finish the draft.", create("core_mission_task_create")),
    row("cal-open-range", "List all upcoming calendar events, without an end date.", calendar(null)),
    row("cal-unsupported-range", "Show calendar events for the next 32 days.", calendar(null)),
    row("cal-history-reminders-dependent", "Show those reminders again.", null, recent),
    row("cal-history-tasks-dependent", "List tasks for that project.", null, recent),
    row("cal-history-calendar-dependent", "Show my calendar for that day.", null, recent),
    row("cal-history-reminders-independent", "List my reminders.", reminders(), recent),
    row("cal-history-calendar-independent", "Show my calendar tomorrow.", calendar(day(1)), recent),
    row("cal-history-create-independent", "Remind me to call Rowan tomorrow at 10am.", create("core_reminders_create"), recent),
  ];
}
export function heldOutFastPathCases(baseDate) {
  const day = dates(baseDate);
  const recent = history(day(1));
  return [
    row("hold-calendar-day", "Could you pull up my calendar two days from now?", calendar(day(2))),
    row("hold-calendar-range", "Let me see the events on my calendar for the next 12 days.", calendar(day(0), day(11))),
    row("hold-calendar-limit", "Show the first 2 calendar events on tomorrow's date.", { name: "core_calendar_events_list", arguments: { dateFrom: day(1), dateTo: day(1), limit: 2 } }),
    row("hold-reminders-all", "Can I see my reminder list?", reminders()),
    row("hold-reminders-query", 'List reminders about "Passport".', reminders({ query: "Passport" })),
    row("hold-reminders-short", "My reminders, please.", reminders()),
    row("hold-tasks-project", 'List tasks in "Harbor".', tasks({ projectName: "Harbor" })),
    row("hold-tasks-status", 'Show done tasks in "Harbor".', tasks({ projectName: "Harbor", status: "done" })),
    row("hold-tasks-all", "List all my tasks.", tasks()),
    row("hold-calendar-create", "Schedule a 20-minute catch-up with Rowan tomorrow at 11am.", create("core_calendar_event_create")),
    row("hold-calendar-create-short", "Put a dentist visit on my calendar on 20 October at 3pm.", create("core_calendar_event_create")),
    row("hold-calendar-create-topic", "Add an event titled Journal club tomorrow at 6pm.", create("core_calendar_event_create")),
    row("hold-reminder-create", "Please remind me to renew my passport on 22 October at noon.", create("core_reminders_create")),
    row("hold-reminder-calendar-word", "Remind me tomorrow at 8am to check my calendar.", create("core_reminders_create")),
    row("hold-reminder-invalid", "Remind me to phone Rowan on 31 November at 10am.", create("core_reminders_create")),
    row("hold-task-create", 'Add a task named "Book train tickets" to "Harbor".', create("core_mission_task_create")),
    row("hold-task-create-short", "Create a task to update the checklist.", create("core_mission_task_create")),
    row("hold-task-create-topic", 'Make a task titled "Review calendar" in "Harbor".', create("core_mission_task_create")),
    row("hold-move-reminder", "Move my passport renewal reminder to Friday at 10am.", null),
    row("hold-cancel-event", "Remove the dentist visit from my calendar.", null),
    row("hold-bookings", "List the appointments clients have booked with me.", null),
    row("hold-availability", "Find a free 20-minute slot on my calendar tomorrow.", null),
    row("hold-journal", "Read yesterday's journal entry about my calendar.", null),
    row("hold-prose", "Explain how I should organise tasks and reminders.", null),
    row("hold-negation", "Don't set a reminder to renew my passport.", null),
    row("hold-compound", "Show my reminders and add a task to renew my passport.", null),
    row("hold-open-range", "Show every future calendar event, however far away it is.", calendar(null)),
    row("hold-long-range", "Show events for the next 45 days.", calendar(null)),
    row("hold-history-reminders", "Show the same reminders again.", null, recent),
    row("hold-history-tasks", "What tasks are left in that project?", null, recent),
    row("hold-history-calendar", "What's on my calendar on the date you mentioned?", null, recent),
    row("hold-history-create", "Set a reminder for that at the same time tomorrow.", null, recent),
    row("hold-history-independent-reminders", 'List reminders called "Passport".', reminders({ query: "Passport" }), recent),
    row("hold-history-independent-calendar", "List my calendar for the next 4 days.", calendar(day(0), day(3)), recent),
    row("hold-history-independent-tasks", 'List backlog tasks in "Harbor".', tasks({ projectName: "Harbor", status: "backlog" }), recent),
    row("hold-history-independent-create", "Add a reminder to buy coffee tomorrow at 9am.", create("core_reminders_create"), recent),
  ];
}
