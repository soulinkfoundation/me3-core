import type { AgentReminder } from "./reminders";
import { normalizeTimeZone } from "@me3-core/plugin-calendar";
import type { AgentMissionTask } from "@me3-core/plugin-mission-control";
import { type AgentChatActionCard } from "./contracts";

export function buildReminderActionCard(
  reminder: AgentReminder,
  action: "created" | "updated" | "cancelled",
): AgentChatActionCard {
  const title = action === "created"
    ? "Reminder created"
    : action === "updated"
      ? "Reminder updated"
      : "Reminder cancelled";
  return {
    id: action === "created"
      ? `reminder:${reminder.id}`
      : `reminder:${reminder.id}:${action}`,
    kind: `reminder.${action}`,
    capabilityId: `core.reminders.${action === "created" ? "create" : action === "updated" ? "update" : "cancel"}`,
    title,
    summary: reminder.title,
    status: "complete",
    statusLabel: "Complete",
    changed: [
      { label: "Reminder", value: reminder.title },
      { label: "When", value: formatAgentDateTime(reminder.remindAt, reminder.timezone) },
      {
        label: "Status",
        value: action === "cancelled" ? "Cancelled" : "Pending reminder",
      },
    ],
    records: [{ kind: "reminder", id: reminder.id }],
    primaryAction: { label: "Open calendar", href: "/calendar" },
    secondaryActions: [],
  };
}

export function buildMissionTaskActionCard(
  task: AgentMissionTask,
  action: "created" | "updated" | "archived",
): AgentChatActionCard {
  const capabilityId = action === "created"
    ? "core.mission.task.create"
    : action === "updated"
      ? "core.mission.task.update"
      : "core.mission.task.archive";
  return {
    id: `mission-task:${task.id}`,
    kind: action === "created"
      ? "mission.task_created"
      : action === "updated"
        ? "mission.task_updated"
        : "mission.task_archived",
    capabilityId,
    title: `Task ${action}`,
    summary: task.title,
    status: "complete",
    statusLabel: "Complete",
    changed: [
      { label: "Task", value: task.title },
      { label: "Project", value: task.projectName },
      ...(task.dueAt ? [{ label: "Due", value: task.dueAt }] : []),
      { label: "Priority", value: String(task.priority) },
      { label: "Status", value: action === "archived" ? "archived" : task.status },
    ],
    records: [{ kind: "mission_task", id: task.id }],
    primaryAction: { label: "Open Tasks", href: "/tasks" },
    secondaryActions: [],
  };
}

export function formatAgentDateTime(
  iso: string,
  timezone: string | null | undefined,
): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: normalizeTimeZone(timezone) || "UTC",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
