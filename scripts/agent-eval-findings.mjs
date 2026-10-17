// Regression scenarios from owner testing on 17 Oct 2026. Each reproduces a
// real prompt that misbehaved on a live install.
const turn = (prompt) => ({ prompt, calls: [] });
const noWrites = (_seed, results) => results.every((row) => row.status !== "succeeded" || !/create|update|cancel|save|send/.test(row.tool_name || ""));

export function createFindingsEvalScenarios() {
  return [
    { id: "findings/task-create-then-progress",
      turns: [turn("Add a task: update my pricing page, due Monday."), turn("Mark that as in progress.")],
      allowedWrites: { mission_tasks: (row) => row.user_id === "eval-owner" && /pricing page/i.test(row.title) },
      check: (seed) => seed.raw.prepare("SELECT status FROM mission_tasks WHERE user_id = 'eval-owner' AND title LIKE '%pricing page%'").get()?.status === "in_progress",
      rubric: "Turn 1 creates the task due next Monday. Turn 2 marks that same task in progress and confirms it plainly. No errors or hedging." },
    { id: "findings/week-includes-bookings",
      turns: [turn("What does my week look like?")],
      allowedWrites: {}, check: noWrites,
      rubric: "Summarise the coming week including both calendar events and confirmed website bookings (the Ada Example booking in three days). Website bookings belong in the calendar answer, not a separate one." },
    { id: "findings/highest-priority-task",
      turns: [turn("What's my highest-priority task right now?")],
      allowedWrites: {}, check: noWrites,
      rubric: "Name the highest-priority open task (lowest priority number, then earliest due date) directly and briefly. Do not hedge about truncated results when the task list is small." },
    { id: "findings/unreplied-client-emails",
      turns: [turn("Any emails from clients I haven't replied to?")],
      allowedWrites: {}, check: noWrites,
      rubric: "Answer briefly and directly from the mailbox. If no client emails need a reply, say so in one or two short sentences. Do not lecture about limitations or ask for client names unless the mailbox truly cannot answer." },
    { id: "findings/email-contact-without-address",
      setup: (seed) => seed.raw.prepare("INSERT INTO contacts (id, user_id, name, email) VALUES ('eval-erum', ?, 'Erum Hayat', NULL)").run(seed.ownerId),
      turns: [turn("Email Erum asking if she's free for a session next week.")],
      allowedWrites: {},
      // The draft tool returns an unsaved card draft; nothing is saved or sent and no address is guessed.
      check: (seed, results) => results.some((row) => row.tool_name === "core_mailbox_draft" && row.status === "succeeded" && !row.arguments?.to)
        && seed.raw.prepare("SELECT COUNT(*) AS n FROM mailbox_messages WHERE message_kind = 'draft' AND subject LIKE '%session%'").get().n === 0,
      rubric: "Write the email as a draft for the card without inventing an address, and tell the owner briefly to add Erum's email on the card. Nothing is sent." },
  ].map((scenario) => ({ ...scenario, suite: "findings", evaluationKind: "candidate-quality" }));
}
