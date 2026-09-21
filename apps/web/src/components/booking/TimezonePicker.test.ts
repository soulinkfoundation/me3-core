import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import TimezonePicker from "./TimezonePicker.vue";
import { getTimeZoneDisplayLabel, listSupportedTimeZones } from "../../utils/timezone";

const options = listSupportedTimeZones().map((value) => ({
  value,
  label: getTimeZoneDisplayLabel(value),
}));

describe("TimezonePicker", () => {
  it.each(["Barcelona", "Valencia", "Spain"])(
    "finds the appropriate Spanish timezone when searching %s",
    async (search) => {
      const wrapper = mount(TimezonePicker, {
        props: {
          id: "booking-timezone",
          label: "Timezone",
          modelValue: "Europe/Dublin",
          options,
        },
      });

      await wrapper.get("input").setValue(search);

      const matches = wrapper.findAll('[role="option"]');
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some((option) => option.text().includes("Europe/Madrid"))).toBe(true);

      await matches.find((option) => option.text().includes("Europe/Madrid"))!.trigger("click");
      expect(wrapper.emitted("update:modelValue")).toEqual([["Europe/Madrid"]]);
    },
  );

  it("supports keyboard selection and Escape dismissal", async () => {
    const wrapper = mount(TimezonePicker, {
      props: {
        id: "booking-timezone",
        label: "Timezone",
        modelValue: "Europe/Dublin",
        options,
      },
    });
    const input = wrapper.get("input");

    await input.setValue("Barcelona");
    await input.trigger("keydown", { key: "Enter" });
    expect(wrapper.emitted("update:modelValue")).toEqual([["Europe/Madrid"]]);
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);

    await input.trigger("focus");
    await input.trigger("keydown", { key: "Escape" });
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false);
  });
});
