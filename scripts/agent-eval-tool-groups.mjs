// Deferred tool groups (packages/agent/src/tool-groups.ts): site and social
// tools reach the model only after core_tools_load, and ordinary turns skip it.
const turn = (prompt) => ({ prompt, calls: [] });
const succeeded = (results, name) => results.some((row) => row.tool_name === name && row.status === "succeeded");
const loaded = (results) => results.some((row) => row.tool_name === "core_tools_load");

export function createToolGroupEvalScenarios() {
  return [
    { id: "toolgroups/landing-page-create",
      turns: [turn("Make me a waitlist landing page for my breathwork course that starts in March. Don't publish it.")],
      allowedWrites: { sites: (row) => row.user_id === "eval-owner" },
      check: (_seed, results) => loaded(results) && succeeded(results, "core_sites_landing_page_create"),
      rubric: "Create an unpublished waitlist landing page draft for the breathwork course and say it is a draft ready to review. No claim that it was published." },
    { id: "toolgroups/social-post-from-message",
      turns: [turn("Save this as a post for X and LinkedIn: We're opening the studio on Saturday, 10 till 4. Come and say hello.")],
      allowedWrites: {},
      check: (_seed, results) => loaded(results) && succeeded(results, "core_social_draft_from_message"),
      rubric: "Save the owner's own sentence as an X and LinkedIn draft without adding words. Nothing is published or scheduled." },
    { id: "toolgroups/tasks-without-loading",
      turns: [turn("What tasks are due this week?")],
      allowedWrites: {},
      check: (_seed, results) => !loaded(results) && results.every((row) => row.status !== "succeeded" || !/create|update|cancel|save|send/.test(row.tool_name || "")),
      rubric: "List the open tasks due this week briefly from the task list. No writes." },
  ].map((scenario) => ({ ...scenario, suite: "toolgroups", evaluationKind: "candidate-quality" }));
}
