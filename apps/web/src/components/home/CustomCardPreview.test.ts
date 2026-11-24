import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import CustomCardPreview from "./CustomCardPreview.vue";
import type { HomeCardRecord } from "../../utils/homeCards";

vi.mock("../../api", () => ({ api: { post: vi.fn() } }));
const record = (today: boolean): HomeCardRecord => ({
  card: { id: "card-habits", name: "Habits", emoji: "✅", version: 2, blocks: [{ type: "habit", key: "run", label: "Run" }], createdBy: "agent", createdAt: "", updatedAt: "", history: [] },
  state: { date: "2026-11-24", done: today ? 1 : 0, total: 1, blocks: { run: { type: "habit", today } } },
});
const preview = (props: { isUpdate?: boolean; pinned?: boolean } = {}) => mount(CustomCardPreview, { props: { record: record(false), isUpdate: false, pinned: false, ...props }, global: { stubs: { UiIcon: true } } });

describe("custom card preview in chat", () => {
  it("lets the owner try the card, then add it to Home or change it", async () => {
    vi.mocked(api.post).mockResolvedValue(record(true));
    const wrapper = preview();
    expect(wrapper.text()).toContain("Preview");
    await wrapper.find('[aria-label="Run"]').trigger("click"); await flushPromises();
    expect(api.post).toHaveBeenCalledWith("/home/cards/card-habits/act", { action: "tick", key: "run", on: true });
    expect(wrapper.find('[aria-label="Run"]').attributes("aria-pressed")).toBe("true");
    expect(wrapper.emitted("changed")).toHaveLength(1);
    const buttons = wrapper.findAll("button").filter(button => ["Change it", "Add to Home"].includes(button.text()));
    await buttons[0]!.trigger("click"); await buttons[1]!.trigger("click");
    expect(wrapper.emitted("change")).toHaveLength(1);
    expect(wrapper.emitted("addToHome")).toHaveLength(1);
  });
  it("says when the card is already on Home, or was updated there", () => {
    expect(preview({ pinned: true }).text()).toContain("On your Home");
    const updated = preview({ isUpdate: true });
    expect(updated.text()).toContain("v2");
    expect(updated.text()).toContain("Updated on your Home");
    expect(updated.text()).not.toContain("Add to Home");
  });
  it("puts a tick back and says so when it can't save", async () => {
    vi.mocked(api.post).mockRejectedValue(new Error("offline"));
    const wrapper = preview();
    await wrapper.find('[aria-label="Run"]').trigger("click"); await flushPromises();
    expect(wrapper.find('[aria-label="Run"]').attributes("aria-pressed")).toBe("false");
    expect(wrapper.text()).toContain("Couldn't update Habits. Try again.");
  });
});
