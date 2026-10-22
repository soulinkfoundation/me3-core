import type { AgentTargetMetadata, AgentTool } from "../types";
import { calendarTools } from "./calendar";
import { cardTools } from "./cards";
import { codingTools } from "./coding";
import { conversationTools } from "./conversations";
import { journalTools } from "./journal";
import { quoteTools } from "./quotes";
import { imageTools } from "./images";
import { mailboxTools } from "./mailbox";
import { memoryTools } from "./memory";
import { paymentTools } from "./payments";
import { reminderTools } from "./reminders";
import { schedulingTools } from "./scheduling";
import { siteTools } from "./sites";
import { socialTools } from "./social";
import { taskTools } from "./tasks";
import { webTools } from "./web";
import { targetPresentationTool } from "./presentations";
import { toolGroupFor } from "../tool-groups";
import { confirmEvent, confirmPeopleFound, confirmReminder, confirmTask, withOneStepConfirmation } from "../confirmations";

// Only single-ID domain adapters can offer this exact-action selection contract.
const targetContracts: Record<string, AgentTargetMetadata> = {
  core_reminders_update: { domain: "reminder", idParameter: "reminderId", actionLabel: "Move reminder", ownerTimezoneParameter: "timezone" },
  core_reminders_cancel: { domain: "reminder", idParameter: "reminderId", actionLabel: "Cancel reminder" },
  core_calendar_event_reschedule: { domain: "calendar event", idParameter: "eventId", actionLabel: "Move calendar event" },
  core_calendar_event_cancel: { domain: "calendar event", idParameter: "eventId", actionLabel: "Cancel calendar event" },
  core_mission_task_update: { domain: "task", idParameter: "taskId", actionLabel: "Update task", unsupportedArguments: ["projectName"] },
  core_mission_task_archive: { domain: "task", idParameter: "taskId", actionLabel: "Archive task" },
  core_mailbox_draft: { domain: "mailbox message", idParameter: "replyToMessageId", actionLabel: "Draft reply" },
  core_mailbox_send: { domain: "mailbox message", idParameter: "draftId", actionLabel: "Send email draft" },
  core_scheduling_request: { domain: "contact", idParameter: "contactId", actionLabel: "Request meeting" },
  core_scheduling_request_profile: { domain: "public profile", idParameter: "profileId", actionLabel: "Request meeting" },
  core_scheduling_approve: { domain: "scheduling request", idParameter: "requestId", actionLabel: "Approve meeting request" },
  core_scheduling_decline: { domain: "scheduling request", idParameter: "requestId", actionLabel: "Decline meeting request" },
  core_social_posting_plan_confirm: { domain: "posting plan", idParameter: "planId", actionLabel: "Schedule social posts" },
};

const oneStepConfirmations: Record<string, (data: unknown, timezone: string) => string | null> = {
  core_reminders_create: confirmReminder,
  core_calendar_event_create: confirmEvent,
  core_mission_task_create: confirmTask,
  core_people_search: confirmPeopleFound,
};

const ALWAYS_VISIBLE_TOOLS = new Set(["core_sites_starter_draft"]);

export function createDomainTools(): AgentTool[] {
  const tools = [...calendarTools(), ...cardTools(), ...codingTools(), ...conversationTools(), ...journalTools(), ...quoteTools(), ...mailboxTools(), ...memoryTools(), ...paymentTools(), ...reminderTools(), ...schedulingTools(), ...siteTools(), ...socialTools(), ...taskTools(), ...webTools(), ...imageTools()];
  for (const [index, tool] of tools.entries()) {
    const confirm = oneStepConfirmations[tool.name];
    if (confirm) tools[index] = withOneStepConfirmation(tool, confirm);
  }
  for (const tool of tools) {
    tool.target = targetContracts[tool.name];
    // The first-site draft stays visible on every turn: the Build your website entry must reach it in
    // one step. Once deferred-group preloading lands (agent-latency, me3-ahsk.34) it can rejoin "sites".
    tool.group = ALWAYS_VISIBLE_TOOLS.has(tool.name) ? undefined : toolGroupFor(tool.name);
    if (tool.approval === "required") {
      // Share the read-only validation prefix; each consequential executor returns before its effect.
      tool.prepareApproval = (args, context) => tool.execute(args, { ...context, approved: false, approvalData: undefined });
    }
  }
  tools.push(targetPresentationTool(tools));
  return tools;
}
export type { AgentDomainServices, AgentCodingServices, AgentMailboxServices, AgentPaymentServices, NetworkSellerRef, PaymentProposalRecord, AgentSchedulingServices, AgentPeopleServices, AgentImageGenerationServices, AgentImageGenerationResult, AgentGeneratedImageAction, AgentGeneratedImageAsset, MailboxRecord, SchedulingContact, SchedulingRequest } from "./services";
