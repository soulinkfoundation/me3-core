import type { AgentTool } from "../types";
import { calendarTools } from "./calendar";
import { journalTools } from "./journal";
import { mailboxTools } from "./mailbox";
import { reminderTools } from "./reminders";
import { schedulingTools } from "./scheduling";
import { siteTools } from "./sites";
import { socialTools } from "./social";
import { taskTools } from "./tasks";
import { webTools } from "./web";

export function createDomainTools(): AgentTool[] {
  const tools = [...calendarTools(), ...journalTools(), ...mailboxTools(), ...reminderTools(), ...schedulingTools(), ...siteTools(), ...socialTools(), ...taskTools(), ...webTools()];
  for (const tool of tools) {
    if (tool.approval === "required") {
      // Share the read-only validation prefix; each consequential executor returns before its effect.
      tool.prepareApproval = (args, context) => tool.execute(args, { ...context, approved: false, approvalData: undefined });
    }
  }
  return tools;
}
export type { AgentDomainServices, AgentMailboxServices, AgentSchedulingServices, AgentPeopleServices, MailboxRecord, SchedulingContact, SchedulingRequest } from "./services";
