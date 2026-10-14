import { describe, expect, it } from "vitest";
import { CORE_CHAT_CAPABILITIES, parseAgentReminderInput, validateCoreChatCapabilityContracts } from "@me3-core/plugin-agent-chat";
import { createDomainTools } from "../../../packages/agent/src/tools/index";

describe("retained capability catalogue and reminder inputs", () => {
  it("retains valid capability contracts behind the new domain tools", () => {
    expect(validateCoreChatCapabilityContracts()).toEqual([]);
    expect(CORE_CHAT_CAPABILITIES.some(value => value.id === "core.journal.read")).toBe(true);
    expect(createDomainTools().filter(tool => tool.name.startsWith("core_reminders_")).map(tool => tool.name)).toEqual([
      "core_reminders_list", "core_reminders_create", "core_reminders_update", "core_reminders_cancel",
    ]);
  });
  it("accepts offset-aware reminder timestamps and refuses unzoned wall times", () => {
    expect(parseAgentReminderInput({ title: "Call Sam", remindAt: "2026-07-10T09:00:00+01:00", timezone: "Europe/Dublin" }))
      .toMatchObject({ title: "Call Sam", remindAt: "2026-07-10T08:00:00.000Z", timezone: "Europe/Dublin" });
    expect(parseAgentReminderInput({ title: "Call Sam", remindAt: "2026-07-10T09:00:00" }))
      .toEqual({ error: "Reminder timestamp must include a timezone offset" });
  });
});
