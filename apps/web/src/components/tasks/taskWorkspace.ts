import { resolveUiIconName, type UiIconName } from "../../utils/icons";

export type TaskModeId = "now" | "backlog" | "done";
export type TaskStatus = "backlog" | "in_progress" | "done" | "cancelled";

export type TaskProject = {
  id: string;
  name: string;
  slug: string;
  status: "active" | "paused" | "archived";
  description: string | null;
  icon: string | null;
};

export type WorkspaceTask = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  projectId: string | null;
  dueAt: string | null;
  scheduledFor: string | null;
  priority: number;
  position: number;
  pinnedAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export const TASK_MODES: ReadonlyArray<{
  id: TaskModeId;
  label: string;
  status: Extract<TaskStatus, "backlog" | "in_progress" | "done">;
}> = [
  { id: "backlog", label: "Backlog", status: "backlog" },
  { id: "now", label: "Now", status: "in_progress" },
  { id: "done", label: "Done", status: "done" },
];

export const TASK_PAGE_SIZE = 50;

export function taskMode(value: unknown): TaskModeId {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "backlog" || raw === "done" ? raw : "now";
}

export function taskModeStatus(mode: TaskModeId) {
  return TASK_MODES.find((item) => item.id === mode)?.status || "in_progress";
}

export function tasksUrl(options: {
  active?: boolean;
  archived?: boolean;
  status?: TaskStatus;
  cursor?: string | null;
}): string {
  const params = new URLSearchParams({ limit: String(TASK_PAGE_SIZE) });
  if (options.active) params.set("active", "1");
  if (options.archived) params.set("archived", "1");
  if (options.status) params.set("status", options.status);
  if (options.cursor) params.set("cursor", options.cursor);
  return `/mission-control/tasks?${params.toString()}`;
}

export function sortTasks(tasks: WorkspaceTask[]): WorkspaceTask[] {
  return [...tasks].sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    if (left.position !== right.position) return left.position - right.position;
    const leftDate = left.scheduledFor || left.dueAt || left.createdAt;
    const rightDate = right.scheduledFor || right.dueAt || right.createdAt;
    const dateOrder = leftDate.localeCompare(rightDate);
    return dateOrder || left.id.localeCompare(right.id);
  });
}

export function taskDescriptionForEditor(
  task: WorkspaceTask | null | undefined,
): string {
  return task?.description || "";
}

export function taskDescriptionText(task: WorkspaceTask | null | undefined): string {
  const description = task?.description?.trim();
  if (!description) return "";
  if (!/[<&]/.test(description)) return description.replace(/\s+/g, " ").trim();

  const document = new DOMParser().parseFromString(
    description.replace(/<\/(p|div|li|h[1-6])>/gi, " "),
    "text/html",
  );
  return (document.body.textContent || "").replace(/\s+/g, " ").trim();
}

export function projectIconIsImage(icon: string | null | undefined): boolean {
  const value = icon?.trim() || "";
  return (
    value.startsWith("data:image/") ||
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("/") ||
    value.startsWith("blob:")
  );
}

export function projectUiIcon(icon: string | null | undefined): UiIconName | null {
  if (projectIconIsImage(icon)) return null;
  return resolveUiIconName(icon?.trim() || "") as UiIconName | null;
}

export function projectEmoji(icon: string | null | undefined): string {
  const value = icon?.trim() || "";
  if (!value || projectIconIsImage(value) || projectUiIcon(value)) return "";
  return /\p{Extended_Pictographic}/u.test(value) ? value : "";
}

export function displayTaskDate(value: string | null | undefined): string {
  if (!value) return "";
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: parsed.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(parsed);
}
