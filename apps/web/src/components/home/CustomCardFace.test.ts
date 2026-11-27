import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CustomCardFace from "./CustomCardFace.vue";
import type { HomeCardRecord } from "../../utils/homeCards";

const record: HomeCardRecord = {
  card: { id: "card-week", name: "My week", emoji: "📅", version: 2, createdBy: "agent", createdAt: "", updatedAt: "", history: [], blocks: [
    { type: "habit", key: "run", label: "Run", emoji: "🏃" },
    { type: "counter", key: "water", label: "Water", unit: "glasses", goal: 8 },
    { type: "stat", key: "stat1", source: "money.today" },
    { type: "progress", key: "progress1", source: "goal" },
    { type: "days", key: "days1", source: "bookings.week" },
    { type: "list", key: "list1", source: "tasks" },
    { type: "list", key: "list2", source: "invoices.unpaid" },
    { type: "action", key: "action1", label: "Remind them", prompt: "Remind the late ones" },
  ] },
  state: { date: "2026-11-24", done: 1, total: 2, blocks: {
    run: { type: "habit", today: true, streak: 4, week: [true, true, null, null, null, null, null] },
    water: { type: "counter", today: 0, total: 0, goal: 8, done: false },
    stat1: { type: "stat", value: "–", label: "Part of ME3 Starter and Business" },
    progress1: { type: "progress", pct: 40, label: "Launch · 40%" },
    days1: { type: "days", values: [1, 0, 3, 0, 0, 0, 0], labels: ["M", "T", "W", "T", "F", "S", "S"], today: 1 },
    list1: { type: "list", empty: "", rows: [{ id: "t1", title: "Ship it", check: { on: false, taskId: "t1" } }] },
    list2: { type: "list", rows: [], empty: "Part of ME3 Starter and Business" },
  } },
};
const face = (props = {}) => mount(CustomCardFace, { props: { record, ...props }, global: { stubs: { UiIcon: true } } });

describe("custom card face", () => {
  it("draws every block from the install's state, including the paid-only state as sent", () => {
    const wrapper = face();
    expect(wrapper.text()).toContain("1 of 2 today");
    expect(wrapper.text()).toContain("🔥 4 days");
    expect(wrapper.text()).toContain("0 of 8 glasses");
    expect(wrapper.findAll(".cc__stat strong")[0]!.text()).toBe("–");
    expect(wrapper.text().match(/Part of ME3 Starter and Business/g)).toHaveLength(2);
    expect(wrapper.find('[role="progressbar"]').attributes("aria-valuenow")).toBe("40");
    expect(wrapper.find(".cc__days").attributes("aria-label")).toBe("This week: 4 bookings");
    expect(wrapper.find('[aria-label="Run"]').attributes("aria-pressed")).toBe("true");
  });
  it("sends ticks, counts, task ticks and actions", async () => {
    const wrapper = face();
    await wrapper.find('[aria-label="Run"]').trigger("click");
    expect(wrapper.find('[aria-label="Less Water"]').attributes("disabled")).toBeDefined();
    await wrapper.find('[aria-label="More Water"]').trigger("click");
    await wrapper.find('[aria-label="Ship it"]').trigger("click");
    await wrapper.find(".cc__action").trigger("click");
    expect(wrapper.emitted("act")).toEqual([
      [{ action: "tick", key: "run", on: false }],
      [{ action: "add", key: "water", by: 1 }],
      [{ action: "task.done", key: "list1", on: true, taskId: "t1" }],
    ]);
    expect(wrapper.emitted("ask")).toEqual([["Remind the late ones"]]);
  });
  it("disables a block while it saves, and opens the card from its title", async () => {
    const wrapper = face({ busy: ["run"] });
    expect(wrapper.find('[aria-label="Run"]').attributes("disabled")).toBeDefined();
    await wrapper.find('[aria-label="Open My week"]').trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
  });
});
