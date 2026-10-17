import { enableAutoUnmount, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import JournalDayPlan from "./JournalDayPlan.vue";

enableAutoUnmount(afterEach);
afterEach(() => { document.body.innerHTML = ""; });
vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) { this.removeAttribute("open"); });

const goals = [
  { id: "g1", title: "Launch the Soulink public beta with 100 founding members by the end of November", status: "active" as const, progress: 40 },
  { id: "g2", title: "Run a half marathon", status: "active" as const, progress: 65 },
  { id: "old", title: "Finished goal", status: "completed" as const },
];
const today = new Date().toISOString();
const tasks = [
  { id: "open", title: "Write the invite email", status: "in_progress" },
  { id: "done", title: "Book the venue", status: "done", updatedAt: today },
  { id: "later", title: "Someday idea", status: "backlog" },
];
function render() {
  return mount(JournalDayPlan, { props: { tasks, goals }, attachTo: document.body, global: { stubs: { RouterLink: { template: "<a><slot /></a>" }, UiIcon: true } } });
}

// Failure modes: the goal truncated or missing its progress, no way to change the focus,
// tasks from later or other days showing, finished tasks vanishing, an add row coming back.
describe("Journal day plan", () => {
  it("shows the focus goal in full with a thin progress bar", () => {
    const plan = render();
    expect(plan.text()).toContain(goals[0].title);
    expect(plan.text()).not.toContain("40%");
    expect(plan.find(".day-plan__bar i").attributes("style")).toContain("width: 40%");
  });
  it("opens a goal picker and makes the chosen goal the focus", async () => {
    const plan = render();
    await plan.find(".day-plan__goal").trigger("click");
    const options = [...document.body.querySelectorAll<HTMLButtonElement>(".day-plan__option")];
    expect(options.map(option => option.textContent)).toEqual([expect.stringContaining("Launch"), expect.stringContaining("half marathon")]);
    options[1].click();
    expect(plan.emitted("focus")).toEqual([["g2"]]);
  });
  it("lists today's open and finished tasks, links to all tasks, and has no add row", async () => {
    const plan = render();
    const rows = plan.findAll(".day-plan__task");
    expect(rows.map(row => row.text())).toEqual(["Book the venue", "Write the invite email"]);
    expect(rows[0].classes()).toContain("is-done");
    expect(plan.text()).not.toContain("Someday idea");
    expect(plan.find('a[to="/tasks"]').text()).toBe("All tasks");
    expect(plan.find("input").exists()).toBe(false);
    await rows[1].find("button").trigger("click");
    expect(plan.emitted("complete")?.[0]?.[0]).toMatchObject({ id: "open" });
  });
});
