<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { useRoute, useRouter } from "vue-router";
import { ApiError, api } from "../api";
import GoalsDialog from "../components/tasks/GoalsDialog.vue";
import AppDialog from "../components/AppDialog.vue";
import Button from "../components/Button.vue";
import IconPicker from "../components/IconPicker.vue";
import PageLoading from "../components/PageLoading.vue";
import TiptapEditor from "../components/TiptapEditor.vue";
import ProjectIcon from "../components/tasks/ProjectIcon.vue";
import {
  TASK_MODES,
  displayTaskDate,
  projectIconIsImage,
  sortTasks,
  taskDescriptionForEditor,
  taskDescriptionText,
  taskMode,
  taskModeStatus,
  tasksUrl,
  type TaskModeId,
  type TaskProject,
  type TaskStatus,
  type WorkspaceTask,
} from "../components/tasks/taskWorkspace";
import UiIcon from "../components/UiIcon.vue";
import { useAppToast } from "../composables/useAppToast";

definePage({
  path: "/tasks",
  meta: {
    requiresAuth: true,
    requiresWorkspace: true,
    requiresPlugin: "me3.mission-control",
    title: "Tasks | ME3",
    description: "ME3 tasks and projects workspace.",
    robots: "noindex,follow",
  },
});

type TasksResponse = {
  tasks: WorkspaceTask[];
  nextCursor: string | null;
};

type TaskDraft = {
  title: string;
  description: string;
  projectId: string;
  status: Exclude<TaskStatus, "cancelled">;
  important: boolean;
  scheduledFor: string;
};

const route = useRoute();
const router = useRouter();
const goalsOpen = ref(route.query.goals === "1");
watch(() => route.query.goals, (value) => { goalsOpen.value = value === "1"; });
function closeGoals() {
  goalsOpen.value = false;
  if (route.query.goals) {
    const { goals: _goals, ...query } = route.query;
    void router.replace({ query });
  }
}

const { toastSuccess } = useAppToast();

const projects = ref<TaskProject[]>([]);
const tasks = ref<WorkspaceTask[]>([]);
const selectedProjectId = ref(queryValue(route.query.project));
const mode = ref<TaskModeId>(taskMode(route.query.view));
const loading = ref(true);
const error = ref("");
const taskError = ref("");
const taskSaving = ref(false);
const taskActionId = ref("");
const selectedTask = ref<WorkspaceTask | null>(null);
const taskDialogOpen = ref(false);
const taskTitleInput = ref<HTMLInputElement | null>(null);
const archiveConfirmOpen = ref(false);
const taskDraft = ref<TaskDraft>(emptyTaskDraft());

const projectPicker = ref<HTMLDetailsElement | null>(null);
const projectDialogOpen = ref(false);
const editingProjectId = ref("");
const projectNameDraft = ref("");
const projectPurposeDraft = ref("");
const projectIconDraft = ref("");
const projectLogoDraft = ref("");
const projectLogoName = ref("");
const projectSaving = ref(false);
const projectError = ref("");
const projectDeleteConfirmOpen = ref(false);

const selectedProject = computed(
  () => projects.value.find((project) => project.id === selectedProjectId.value) || null,
);
const scopedTasks = computed(() =>
  selectedProjectId.value
    ? tasks.value.filter((task) => task.projectId === selectedProjectId.value)
    : tasks.value,
);
const visibleTasks = computed(() =>
  sortTasks(
    scopedTasks.value.filter((task) => task.status === taskModeStatus(mode.value)),
  ),
);
const modeCounts = computed(() =>
  Object.fromEntries(
    TASK_MODES.map((item) => [
      item.id,
      scopedTasks.value.filter((task) => task.status === item.status).length,
    ]),
  ) as Record<TaskModeId, number>,
);
const projectNames = computed(
  () => new Map(projects.value.map((project) => [project.id, project.name])),
);
const projectFormIcon = computed(() => projectLogoDraft.value || projectIconDraft.value);
const projectFormTitle = computed(() =>
  editingProjectId.value ? "Edit project" : "Add project",
);
const projectSaveDisabled = computed(
  () => projectSaving.value || !projectNameDraft.value.trim(),
);
const taskSaveDisabled = computed(
  () =>
    taskSaving.value ||
    !taskDraft.value.title.trim() ||
    !taskDraft.value.projectId,
);
const emptyTitle = computed(() => {
  if (mode.value === "now") return "Nothing to do?";
  if (mode.value === "backlog") return "No tasks in backlog";
  return "No completed tasks";
});
const emptyMessage = computed(() => {
  if (mode.value === "now") return "Go outside or choose something from the backlog.";
  if (mode.value === "backlog") return "Add a task or ask ME3 for ideas based on your goals.";
  return "Tasks you finish will appear here.";
});

async function loadWorkspace() {
  loading.value = true;
  error.value = "";
  try {
    const [projectResponse, activeTasks] = await Promise.all([
      api.get<{ projects: TaskProject[] }>("/mission-control/projects"),
      fetchAllTasks({ active: true }),
    ]);
    projects.value = projectResponse.projects || [];
    tasks.value = activeTasks;
    if (
      selectedProjectId.value &&
      !projects.value.some((project) => project.id === selectedProjectId.value)
    ) {
      await selectProject("");
    }
    await openTaskFromRoute();
  } catch (caught) {
    error.value = apiMessage(caught, "Tasks could not load");
  } finally {
    loading.value = false;
  }
}

async function fetchAllTasks(options: {
  active?: boolean;
  archived?: boolean;
  status?: TaskStatus;
}): Promise<WorkspaceTask[]> {
  let cursor: string | null = null;
  const seen = new Set<string>();
  const byId = new Map<string, WorkspaceTask>();
  do {
    const response: TasksResponse = await api.get<TasksResponse>(
      tasksUrl({ ...options, cursor }),
    );
    for (const task of response.tasks || []) byId.set(task.id, task);
    cursor = response.nextCursor || null;
    if (cursor && !seen.add(cursor)) break;
  } while (cursor && seen.size < 100);
  return [...byId.values()];
}

async function selectProject(projectId: string) {
  selectedProjectId.value = projectId;
  if (projectPicker.value) projectPicker.value.open = false;
  const { project: _project, ...query } = route.query;
  await router.replace({ query: projectId ? { ...query, project: projectId } : query });
}

async function selectMode(nextMode: TaskModeId) {
  mode.value = nextMode;
  const { view: _view, ...query } = route.query;
  await router.replace({
    query: nextMode === "now" ? query : { ...query, view: nextMode },
  });
}

function openNewTask() {
  selectedTask.value = null;
  archiveConfirmOpen.value = false;
  taskError.value = "";
  taskDraft.value = emptyTaskDraft();
  taskDialogOpen.value = true;
  focusTaskTitle();
}

async function openTask(task: WorkspaceTask, updateRoute = true) {
  selectedTask.value = task;
  archiveConfirmOpen.value = false;
  taskError.value = "";
  taskDraft.value = {
    title: task.title,
    description: taskDescriptionForEditor(task),
    projectId: task.projectId || defaultProjectId(),
    status: task.status === "cancelled" ? "backlog" : task.status,
    important: task.priority === 1,
    scheduledFor: task.scheduledFor || task.dueAt || "",
  };
  taskDialogOpen.value = true;
  if (updateRoute) {
    await router.replace({ query: { ...route.query, task: task.id } });
  }
  focusTaskTitle();
}

async function openTaskFromRoute() {
  const taskId = queryValue(route.query.task);
  if (!taskId || selectedTask.value?.id === taskId) return;
  const local = tasks.value.find((task) => task.id === taskId);
  if (local) {
    await openTask(local, false);
    return;
  }
  try {
    const response = await api.get<{ task: WorkspaceTask }>(
      `/mission-control/tasks/${encodeURIComponent(taskId)}`,
    );
    await openTask(response.task, false);
  } catch {
    const { task: _task, ...query } = route.query;
    await router.replace({ query });
  }
}

async function closeTaskDialog() {
  if (taskSaving.value) return;
  taskDialogOpen.value = false;
  selectedTask.value = null;
  archiveConfirmOpen.value = false;
  const { task: _task, ...query } = route.query;
  await router.replace({ query });
}

async function saveTask() {
  if (taskSaveDisabled.value) return;
  taskSaving.value = true;
  taskError.value = "";
  const payload = {
    title: taskDraft.value.title.trim(),
    description: taskDraft.value.description.trim() || null,
    projectId: taskDraft.value.projectId,
    status: taskDraft.value.status,
    priority: taskDraft.value.important ? 1 : 3,
    scheduledFor: taskDraft.value.scheduledFor || null,
  };
  try {
    const response = selectedTask.value
      ? await api.patch<{ task: WorkspaceTask }>(
          `/mission-control/tasks/${encodeURIComponent(selectedTask.value.id)}`,
          payload,
        )
      : await api.post<{ task: WorkspaceTask }>("/mission-control/tasks", payload);
    mergeTask(response.task);
    toastSuccess(selectedTask.value ? "Task saved" : "Task added");
    taskSaving.value = false;
    await closeTaskDialog();
  } catch (caught) {
    taskError.value = apiMessage(caught, "Task could not be saved");
  } finally {
    taskSaving.value = false;
  }
}

async function changeTaskStatus(
  task: WorkspaceTask,
  status: Extract<TaskStatus, "in_progress" | "done">,
  successMessage: string,
  failureMessage: string,
) {
  if (taskActionId.value) return;
  taskActionId.value = task.id;
  try {
    const response = await api.patch<{ task: WorkspaceTask }>(
      `/mission-control/tasks/${encodeURIComponent(task.id)}`,
      { status },
    );
    mergeTask(response.task);
    toastSuccess(successMessage);
  } catch (caught) {
    error.value = apiMessage(caught, failureMessage);
  } finally {
    taskActionId.value = "";
  }
}

async function markDone(task: WorkspaceTask) {
  await changeTaskStatus(
    task,
    "done",
    "Task completed",
    "Task could not be completed",
  );
}

async function moveToNow(task: WorkspaceTask) {
  await changeTaskStatus(
    task,
    "in_progress",
    "Moved to Now",
    "Task could not move to Now",
  );
}

async function archiveSelectedTask() {
  const task = selectedTask.value;
  if (!task || taskSaving.value) return;
  taskSaving.value = true;
  taskError.value = "";
  try {
    await api.delete(`/mission-control/tasks/${encodeURIComponent(task.id)}`);
    tasks.value = tasks.value.filter((item) => item.id !== task.id);
    toastSuccess("Task archived");
    taskSaving.value = false;
    await closeTaskDialog();
  } catch (caught) {
    taskError.value = apiMessage(caught, "Task could not be archived");
  } finally {
    taskSaving.value = false;
  }
}

function mergeTask(task: WorkspaceTask) {
  tasks.value = tasks.value.filter((item) => item.id !== task.id);
  if (!task.archivedAt && task.status !== "cancelled") {
    tasks.value.push(task);
  }
}

function openNewProject() {
  editingProjectId.value = "";
  resetProjectDraft();
  if (projectPicker.value) projectPicker.value.open = false;
  projectDialogOpen.value = true;
}

function openEditProject() {
  const project = selectedProject.value;
  if (!project) return;
  editingProjectId.value = project.id;
  projectNameDraft.value = project.name;
  projectPurposeDraft.value = project.description || "";
  projectLogoDraft.value = projectIconIsImage(project.icon) ? project.icon || "" : "";
  projectIconDraft.value = projectIconIsImage(project.icon) ? "" : project.icon || "";
  projectLogoName.value = projectLogoDraft.value ? "Uploaded logo" : "";
  projectError.value = "";
  projectDeleteConfirmOpen.value = false;
  if (projectPicker.value) projectPicker.value.open = false;
  projectDialogOpen.value = true;
}

function closeProjectDialog() {
  if (projectSaving.value) return;
  projectDialogOpen.value = false;
  projectDeleteConfirmOpen.value = false;
}

async function saveProject() {
  if (projectSaveDisabled.value) return;
  projectSaving.value = true;
  projectError.value = "";
  const payload = {
    name: projectNameDraft.value.trim(),
    description: projectPurposeDraft.value.trim() || null,
    icon: projectFormIcon.value || null,
  };
  try {
    const response = editingProjectId.value
      ? await api.patch<{ project: TaskProject }>(
          `/mission-control/projects/${encodeURIComponent(editingProjectId.value)}`,
          payload,
        )
      : await api.post<{ project: TaskProject }>("/mission-control/projects", payload);
    projects.value = [
      ...projects.value.filter((project) => project.id !== response.project.id),
      response.project,
    ].sort(projectOrder);
    await selectProject(response.project.id);
    toastSuccess(editingProjectId.value ? "Project saved" : "Project added");
    projectDialogOpen.value = false;
  } catch (caught) {
    projectError.value = apiMessage(caught, "Project could not be saved");
  } finally {
    projectSaving.value = false;
  }
}

async function deleteProject() {
  const project = selectedProject.value;
  if (!project || project.slug === "personal" || projectSaving.value) return;
  projectSaving.value = true;
  projectError.value = "";
  try {
    await api.delete(`/mission-control/projects/${encodeURIComponent(project.id)}`);
    projects.value = projects.value.filter((item) => item.id !== project.id);
    tasks.value = tasks.value.filter((task) => task.projectId !== project.id);
    await selectProject("");
    toastSuccess("Project deleted");
    projectDialogOpen.value = false;
  } catch (caught) {
    projectError.value = apiMessage(caught, "Project could not be deleted");
  } finally {
    projectSaving.value = false;
  }
}

function chooseProjectLogo(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  projectError.value = "";
  if (!file.type.startsWith("image/")) {
    projectError.value = "Choose an image file for the project logo";
    input.value = "";
    return;
  }
  if (file.size > 180_000) {
    projectError.value = "Choose a logo under 180 KB";
    input.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    projectLogoDraft.value = typeof reader.result === "string" ? reader.result : "";
    projectLogoName.value = file.name;
    projectIconDraft.value = "";
  };
  reader.onerror = () => {
    projectError.value = "Could not read that image";
  };
  reader.readAsDataURL(file);
}

function setProjectIcon(value: string) {
  projectIconDraft.value = value;
  if (value) {
    projectLogoDraft.value = "";
    projectLogoName.value = "";
  }
}

function resetProjectDraft() {
  projectNameDraft.value = "";
  projectPurposeDraft.value = "";
  projectIconDraft.value = "";
  projectLogoDraft.value = "";
  projectLogoName.value = "";
  projectError.value = "";
  projectDeleteConfirmOpen.value = false;
}

function emptyTaskDraft(): TaskDraft {
  return {
    title: "",
    description: "",
    projectId: selectedProjectId.value || defaultProjectId(),
    status: taskModeStatus(mode.value),
    important: false,
    scheduledFor: "",
  };
}

function defaultProjectId(): string {
  return (
    selectedProjectId.value ||
    projects.value.find((project) => project.slug === "personal")?.id ||
    projects.value[0]?.id ||
    ""
  );
}

function projectOrder(left: TaskProject, right: TaskProject): number {
  if (left.slug === "personal") return -1;
  if (right.slug === "personal") return 1;
  return left.name.localeCompare(right.name);
}

function queryValue(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw : "";
}

function apiMessage(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}

function focusTaskTitle() {
  void nextTick(() => taskTitleInput.value?.focus());
}

function handleWindowClick(event: MouseEvent) {
  const picker = projectPicker.value;
  if (picker?.open && event.target instanceof Node && !picker.contains(event.target)) {
    picker.open = false;
  }
}

watch(
  () => route.query.project,
  (value) => {
    selectedProjectId.value = queryValue(value);
  },
);

watch(
  () => route.query.view,
  (value) => {
    mode.value = taskMode(value);
  },
);

watch(
  () => route.query.task,
  () => void openTaskFromRoute(),
);

onMounted(() => {
  window.addEventListener("click", handleWindowClick);
  void loadWorkspace();
});

onBeforeUnmount(() => {
  window.removeEventListener("click", handleWindowClick);
});
</script>

<template>
  <main class="tasks-page">
    <header class="tasks-topbar">
      <div aria-hidden="true" />

      <details ref="projectPicker" class="project-picker">
        <summary aria-label="Choose project">
          <ProjectIcon
            v-if="selectedProject"
            :icon="selectedProject.icon"
            :name="selectedProject.name"
            size="small"
          />
          <span>{{ selectedProject?.name || "All projects" }}</span>
          <UiIcon name="ChevronDown" :size="14" />
        </summary>
        <div class="project-picker__menu">
          <button
            type="button"
            :class="{ 'is-selected': !selectedProjectId }"
            @click="selectProject('')"
          >
            <span class="project-picker__all"><UiIcon name="ListTodo" :size="16" /></span>
            <span>All projects</span>
            <UiIcon v-if="!selectedProjectId" name="Check" :size="15" />
          </button>
          <button
            v-for="project in projects"
            :key="project.id"
            type="button"
            :class="{ 'is-selected': selectedProjectId === project.id }"
            @click="selectProject(project.id)"
          >
            <ProjectIcon :icon="project.icon" :name="project.name" size="small" />
            <span>{{ project.name }}</span>
            <UiIcon v-if="selectedProjectId === project.id" name="Check" :size="15" />
          </button>
          <div class="project-picker__divider" />
          <button type="button" @click="openNewProject">
            <span class="project-picker__all"><UiIcon name="Plus" :size="16" /></span>
            <span>Add project</span>
          </button>
          <button v-if="selectedProject" type="button" @click="openEditProject">
            <span class="project-picker__all"><UiIcon name="Pencil" :size="15" /></span>
            <span>Edit {{ selectedProject.name }}</span>
          </button>
        </div>
      </details>

      <div class="tasks-topbar-actions">
        <Button color="ghost" shape="soft" size="compact" icon-only aria-label="Goals" title="Goals" aria-haspopup="dialog" @click="goalsOpen = true">
          <UiIcon name="Goal" :size="19" />
        </Button>
        <Button
          color="ghost"
          shape="soft"
          size="compact"
          icon-only
          aria-label="Add task"
          title="Add task"
          :disabled="loading || projects.length === 0"
          @click="openNewTask"
        >
          <UiIcon name="Plus" :size="19" />
        </Button>
      </div>
    </header>

    <GoalsDialog v-if="goalsOpen" @close="closeGoals" />

    <section class="tasks-workspace" aria-labelledby="tasks-view-title">
      <h1 id="tasks-view-title" class="visually-hidden">Tasks</h1>

      <div class="task-modes" aria-label="Task view">
        <button
          v-for="item in TASK_MODES"
          :key="item.id"
          type="button"
          :class="{ 'is-selected': mode === item.id }"
          :aria-pressed="mode === item.id"
          @click="selectMode(item.id)"
        >
          <span>{{ item.label }}</span>
          <strong>{{ modeCounts[item.id] }}</strong>
        </button>
      </div>

      <p v-if="selectedProject?.description" class="project-purpose">
        {{ selectedProject.description }}
      </p>

      <p v-if="error" class="tasks-error" role="alert">{{ error }}</p>

      <PageLoading v-if="loading" compact label="Loading tasks..." />

      <div v-else-if="visibleTasks.length === 0" class="tasks-empty">
        <strong>{{ emptyTitle }}</strong>
        <p>{{ emptyMessage }}</p>
      </div>

      <div v-else class="task-list">
        <article
          v-for="task in visibleTasks"
          :key="task.id"
          class="task-row"
          :class="{
            'is-busy': taskActionId === task.id,
            'has-now-action': task.status === 'backlog',
          }"
        >
          <button
            v-if="task.status !== 'done'"
            type="button"
            class="task-row__complete"
            :disabled="Boolean(taskActionId)"
            :aria-label="`Mark ${task.title} done`"
            @click="markDone(task)"
          >
            <UiIcon name="Circle" :size="20" />
          </button>
          <span v-else class="task-row__completed" aria-hidden="true">
            <UiIcon name="CircleCheck" :size="20" />
          </span>

          <button type="button" class="task-row__body" @click="openTask(task)">
            <span class="task-row__title">
              {{ task.title }}
              <UiIcon
                v-if="task.priority === 1"
                name="Star"
                :size="13"
                class="task-row__important"
              />
            </span>
            <span v-if="taskDescriptionText(task)" class="task-row__description">
              {{ taskDescriptionText(task) }}
            </span>
            <span class="task-row__meta">
              <template v-if="!selectedProjectId">
                {{ projectNames.get(task.projectId || '') || "Personal" }}
              </template>
              <template v-if="displayTaskDate(task.scheduledFor || task.dueAt)">
                <span v-if="!selectedProjectId" aria-hidden="true">·</span>
                {{ displayTaskDate(task.scheduledFor || task.dueAt) }}
              </template>
            </span>
          </button>
          <button
            v-if="task.status === 'backlog'"
            type="button"
            class="task-row__now"
            :disabled="Boolean(taskActionId)"
            :aria-label="`Move ${task.title} to Now`"
            title="Move to Now"
            @click="moveToNow(task)"
          >
            <UiIcon name="CirclePlus" :size="20" aria-hidden="true" />
          </button>
        </article>
      </div>
    </section>

    <AppDialog
      :open="taskDialogOpen"
      labelled-by="task-dialog-title"
      close-on-backdrop
      @close="closeTaskDialog"
    >
      <form class="tasks-dialog" @submit.prevent="saveTask">
        <header class="tasks-dialog__header">
          <Button
            color="ghost"
            shape="soft"
            size="compact"
            type="button"
            @click="closeTaskDialog"
          >
            Cancel
          </Button>
          <h2 id="task-dialog-title">{{ selectedTask ? "Task" : "New task" }}</h2>
          <Button
            color="primary"
            shape="soft"
            size="compact"
            type="submit"
            :disabled="taskSaveDisabled"
          >
            {{ taskSaving ? "Saving..." : "Save" }}
          </Button>
        </header>

        <div class="tasks-dialog__content">
          <label class="field">
            <span>Task</span>
            <input
              ref="taskTitleInput"
              v-model="taskDraft.title"
              type="text"
              autocomplete="off"
            />
          </label>
          <div
            class="field task-description-field"
            role="group"
            aria-labelledby="task-description-label"
          >
            <span id="task-description-label">Description</span>
            <TiptapEditor
              v-model="taskDraft.description"
              variant="section"
              aria-label="Task description"
              placeholder="Add details..."
            />
          </div>
          <div class="tasks-dialog__grid">
            <label class="field">
              <span>Project</span>
              <select v-model="taskDraft.projectId">
                <option v-for="project in projects" :key="project.id" :value="project.id">
                  {{ project.name }}
                </option>
              </select>
            </label>
            <label class="field">
              <span>Status</span>
              <select v-model="taskDraft.status">
                <option value="in_progress">Now</option>
                <option value="backlog">Backlog</option>
                <option value="done">Done</option>
              </select>
            </label>
          </div>
          <div class="tasks-dialog__grid">
            <label class="field">
              <span>Date</span>
              <input v-model="taskDraft.scheduledFor" type="date" />
            </label>
            <label class="task-important">
              <input v-model="taskDraft.important" type="checkbox" />
              <span><UiIcon name="Star" :size="16" /> Important</span>
            </label>
          </div>

          <p v-if="taskError" class="dialog-error" role="alert">{{ taskError }}</p>

          <div v-if="selectedTask" class="danger-zone">
            <button
              v-if="!archiveConfirmOpen"
              type="button"
              class="danger-zone__trigger"
              @click="archiveConfirmOpen = true"
            >
              Archive task
            </button>
            <div v-else class="danger-zone__confirm">
              <span>Archive this task?</span>
              <Button
                color="danger"
                shape="soft"
                size="compact"
                type="button"
                :disabled="taskSaving"
                @click="archiveSelectedTask"
              >
                Archive
              </Button>
              <Button
                color="ghost"
                shape="soft"
                size="compact"
                type="button"
                @click="archiveConfirmOpen = false"
              >
                Keep
              </Button>
            </div>
          </div>
        </div>
      </form>
    </AppDialog>

    <AppDialog
      :open="projectDialogOpen"
      labelled-by="project-dialog-title"
      close-on-backdrop
      @close="closeProjectDialog"
    >
      <form class="tasks-dialog tasks-dialog--project" @submit.prevent="saveProject">
        <header class="tasks-dialog__header">
          <Button
            color="ghost"
            shape="soft"
            size="compact"
            type="button"
            @click="closeProjectDialog"
          >
            Cancel
          </Button>
          <h2 id="project-dialog-title">{{ projectFormTitle }}</h2>
          <Button
            color="primary"
            shape="soft"
            size="compact"
            type="submit"
            :disabled="projectSaveDisabled"
          >
            {{ projectSaving ? "Saving..." : editingProjectId ? "Save" : "Add" }}
          </Button>
        </header>

        <div class="tasks-dialog__content">
          <div class="project-form-heading">
            <ProjectIcon
              :icon="projectFormIcon"
              :name="projectNameDraft || 'Project'"
              size="large"
            />
            <div>
              <strong>{{ projectNameDraft || "New project" }}</strong>
              <span>Give each project a recognisable mark.</span>
            </div>
          </div>
          <label class="field">
            <span>Name</span>
            <input v-model="projectNameDraft" type="text" autocomplete="off" autofocus />
          </label>
          <label class="field">
            <span>Purpose</span>
            <textarea v-model="projectPurposeDraft" rows="4" />
          </label>
          <label class="field">
            <span>Icon</span>
            <IconPicker
              :model-value="projectIconDraft"
              aria-label="Project icon"
              @update:model-value="setProjectIcon"
            />
          </label>
          <label class="field">
            <span>Logo upload</span>
            <input type="file" accept="image/*" @change="chooseProjectLogo" />
          </label>
          <div v-if="projectLogoDraft" class="project-logo-preview">
            <ProjectIcon :icon="projectLogoDraft" :name="projectNameDraft || 'Project'" />
            <span>{{ projectLogoName }}</span>
            <Button
              color="ghost"
              shape="soft"
              size="compact"
              type="button"
              @click="projectLogoDraft = ''; projectLogoName = ''"
            >
              Remove
            </Button>
          </div>

          <p v-if="projectError" class="dialog-error" role="alert">{{ projectError }}</p>

          <div
            v-if="editingProjectId && selectedProject?.slug !== 'personal'"
            class="danger-zone"
          >
            <button
              v-if="!projectDeleteConfirmOpen"
              type="button"
              class="danger-zone__trigger"
              @click="projectDeleteConfirmOpen = true"
            >
              Delete project
            </button>
            <div v-else class="danger-zone__confirm">
              <span>Delete this project and archive its tasks?</span>
              <Button
                color="danger"
                shape="soft"
                size="compact"
                type="button"
                :disabled="projectSaving"
                @click="deleteProject"
              >
                Delete
              </Button>
              <Button
                color="ghost"
                shape="soft"
                size="compact"
                type="button"
                @click="projectDeleteConfirmOpen = false"
              >
                Keep
              </Button>
            </div>
          </div>
        </div>
      </form>
    </AppDialog>
  </main>
</template>

<style scoped>
.tasks-page {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  background: var(--ui-bg);
  color: var(--ui-text);
}

.tasks-topbar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: grid;
  grid-template-columns: 80px minmax(0, 1fr) 80px;
  align-items: center;
  min-height: var(--workspace-topbar-height);
  padding: var(--workspace-topbar-padding-block) 24px;
  background: color-mix(in oklab, var(--ui-bg), transparent 4%);
  backdrop-filter: blur(16px);
}

.tasks-topbar-actions {
  display: flex;
  gap: 4px;
  justify-self: end;
}

.project-picker {
  position: relative;
  min-width: 0;
  justify-self: center;
}

.project-picker summary {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 38px;
  padding: 0 8px;
  border-radius: var(--ui-radius-sm);
  color: var(--ui-text);
  font-size: 15px;
  font-weight: 750;
  cursor: pointer;
  list-style: none;
}

.project-picker summary::-webkit-details-marker {
  display: none;
}

.project-picker summary:hover,
.project-picker summary:focus-visible {
  background: var(--ui-surface-muted);
  outline: none;
}

.project-picker summary:focus-visible {
  box-shadow: 0 0 0 2px var(--ui-focus);
}

.project-picker__menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  z-index: 40;
  display: grid;
  width: min(320px, calc(100vw - 32px));
  max-height: min(420px, calc(100vh - 110px));
  gap: 2px;
  overflow-y: auto;
  padding: 6px;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-md);
  transform: translateX(-50%);
}

.project-picker__menu button {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) 18px;
  align-items: center;
  gap: 9px;
  min-height: 38px;
  padding: 6px 8px;
  border: 0;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  text-align: left;
  cursor: pointer;
}

.project-picker__menu button:hover,
.project-picker__menu button:focus-visible,
.project-picker__menu button.is-selected {
  background: var(--ui-surface-muted);
  outline: none;
}

.project-picker__menu button > :last-child:not(:nth-child(2)) {
  justify-self: end;
  color: var(--ui-accent);
}

.project-picker__all {
  display: inline-grid;
  place-items: center;
  color: var(--ui-text-muted);
}

.project-picker__divider {
  height: 1px;
  margin: 4px 6px;
  background: var(--ui-border);
}

.tasks-workspace {
  display: grid;
  width: min(700px, calc(100% - 32px));
  margin: 0 auto;
  padding: 18px 0 112px;
}

.task-modes {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  padding: 3px;
  border-radius: 999px;
  background: var(--ui-surface-muted);
}

.task-modes button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  min-height: 38px;
  padding: 0 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--ui-text-muted);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.task-modes button strong {
  font-weight: 750;
}

.task-modes button:hover,
.task-modes button:focus-visible {
  color: var(--ui-text);
  outline: none;
}

.task-modes button:focus-visible {
  box-shadow: inset 0 0 0 2px var(--ui-focus);
}

.task-modes button.is-selected {
  background: var(--ui-surface);
  color: var(--ui-text);
  font-weight: 750;
  box-shadow: var(--ui-shadow-sm);
}

.project-purpose {
  margin: 14px 4px 2px;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.5;
}

.tasks-error {
  margin: 14px 0 0;
  padding: 10px 12px;
  border-radius: var(--ui-radius-sm);
  background: var(--ui-danger-soft);
  color: var(--ui-danger);
  font-size: 13px;
}

.tasks-empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 118px 24px 48px;
  color: var(--ui-text-muted);
  text-align: center;
}

.tasks-empty strong {
  font-size: 18px;
  line-height: 1.2;
}

.tasks-empty p {
  max-width: 360px;
  margin: 0;
  font-size: 15px;
  line-height: 1.45;
}

.task-list {
  display: grid;
  margin-top: 14px;
  border-top: 1px solid var(--ui-border);
}

.task-row {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 12px 2px;
  border-bottom: 1px solid var(--ui-border);
  transition: opacity 120ms ease;
}

.task-row.has-now-action {
  grid-template-columns: 32px minmax(0, 1fr) 40px;
}

.task-row.is-busy {
  opacity: 0.55;
}

.task-row__complete {
  display: inline-grid;
  width: 32px;
  height: 40px;
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--ui-border-strong);
  cursor: pointer;
}

.task-row__complete:hover,
.task-row__complete:focus-visible {
  color: var(--ui-accent);
  outline: none;
}

.task-row__complete:focus-visible {
  border-radius: var(--ui-radius-sm);
  box-shadow: inset 0 0 0 2px var(--ui-focus);
}

.task-row__completed {
  display: inline-grid;
  width: 32px;
  place-items: center;
  color: var(--ui-accent);
}

.task-row__body {
  display: grid;
  min-width: 0;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.task-row__body:focus-visible {
  border-radius: var(--ui-radius-sm);
  outline: 2px solid var(--ui-focus);
  outline-offset: 4px;
}

.task-row__title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 15px;
  font-weight: 720;
  line-height: 1.35;
}

.task-row__important {
  flex: 0 0 auto;
  color: var(--ui-accent);
}

.task-row__description {
  display: -webkit-box;
  overflow: hidden;
  color: var(--ui-text-muted);
  font-size: 13px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.task-row__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  color: var(--ui-text-muted);
  font-size: 11px;
  font-weight: 680;
}

.task-row__now {
  display: inline-grid;
  width: 40px;
  height: 40px;
  place-items: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-text-muted);
  cursor: pointer;
}

.task-row__now:hover,
.task-row__now:focus-visible {
  color: var(--ui-accent);
  outline: none;
}

.task-row__now:focus-visible {
  border-radius: var(--ui-radius-sm);
  box-shadow: inset 0 0 0 2px var(--ui-focus);
}

.task-row__now:disabled {
  cursor: default;
}

.tasks-dialog {
  display: grid;
  width: min(620px, calc(100vw - 32px));
  max-height: min(820px, calc(100vh - 48px));
  overflow: hidden;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-md);
}

.tasks-dialog--project {
  width: min(520px, calc(100vw - 32px));
}

.tasks-dialog__header {
  display: grid;
  grid-template-columns: minmax(72px, 1fr) auto minmax(72px, 1fr);
  align-items: center;
  gap: 10px;
  min-height: 58px;
  padding: 0 14px;
  border-bottom: 1px solid var(--ui-border);
}

.tasks-dialog__header > :first-child {
  justify-self: start;
}

.tasks-dialog__header > :last-child {
  justify-self: end;
}

.tasks-dialog__header h2 {
  margin: 0;
  font-size: 15px;
  line-height: 1.2;
}

.tasks-dialog__content {
  display: grid;
  gap: 18px;
  overflow-y: auto;
  padding: 20px;
}

.tasks-dialog__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: end;
  gap: 14px;
}

.field {
  display: grid;
  gap: 7px;
  color: var(--ui-text);
  font-size: 13px;
  font-weight: 680;
}

.field input,
.field select,
.field textarea {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  border: 1px solid var(--ui-border);
  border-radius: var(--ui-radius-sm);
  background: var(--ui-bg);
  color: var(--ui-text);
  font: inherit;
}

.field input,
.field select {
  min-height: 42px;
  padding: 0 11px;
}

.field input[type="file"] {
  height: auto;
  padding: 8px;
  color: var(--ui-text-muted);
  font-weight: 500;
}

.field textarea {
  resize: vertical;
  padding: 11px;
  line-height: 1.5;
}

.task-description-field :deep(.tiptap-editor) {
  gap: 0;
  font-weight: 500;
}

.task-description-field :deep(.editor-toolbar) {
  position: static;
  z-index: auto;
  margin: 0;
  border: 1px solid var(--ui-border);
  border-bottom: 0;
  border-radius: var(--ui-radius-sm) var(--ui-radius-sm) 0 0;
  background: var(--ui-bg);
}

.task-description-field :deep(.editor-content-wrapper) {
  min-height: 150px;
  border-color: var(--ui-border);
  border-radius: 0 0 var(--ui-radius-sm) var(--ui-radius-sm);
  background: var(--ui-bg);
}

.task-description-field :deep(.editor-content-wrapper:focus-within) {
  border-color: var(--ui-focus);
  outline: 2px solid color-mix(in oklab, var(--ui-focus), transparent 65%);
  outline-offset: 1px;
}

.task-description-field :deep(.editor-content-wrapper .ProseMirror) {
  min-height: 150px;
}

.field input:focus,
.field select:focus,
.field textarea:focus {
  border-color: var(--ui-focus);
  outline: 2px solid color-mix(in oklab, var(--ui-focus), transparent 65%);
  outline-offset: 1px;
}

.task-important {
  display: flex;
  min-height: 42px;
  align-items: center;
  gap: 9px;
  color: var(--ui-text);
  font-size: 13px;
  font-weight: 680;
  cursor: pointer;
}

.task-important input {
  width: 18px;
  height: 18px;
  accent-color: var(--ui-accent);
}

.task-important span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.project-form-heading,
.project-logo-preview {
  display: flex;
  align-items: center;
  gap: 12px;
}

.project-form-heading > div {
  display: grid;
  gap: 3px;
}

.project-form-heading span,
.project-logo-preview > span {
  color: var(--ui-text-muted);
  font-size: 12px;
}

.project-logo-preview > span {
  min-width: 0;
  overflow: hidden;
  flex: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dialog-error {
  margin: 0;
  color: var(--ui-danger);
  font-size: 13px;
}

.danger-zone {
  padding-top: 14px;
  border-top: 1px solid var(--ui-border);
}

.danger-zone__trigger {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-danger);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.danger-zone__confirm {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: var(--ui-text);
  font-size: 13px;
}

.danger-zone__confirm span {
  margin-right: auto;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 959px) {
  .tasks-topbar {
    padding-right: 14px;
    padding-left: var(--app-shell-mobile-nav-leading-padding);
  }

}

@media (max-width: 640px) {
  .tasks-workspace {
    width: calc(100% - 28px);
    padding-top: 12px;
  }

  .task-modes button {
    gap: 4px;
    padding: 0 7px;
    font-size: 13px;
  }

  .tasks-empty {
    padding-top: 96px;
  }

  .tasks-dialog {
    width: 100vw;
    max-height: min(92vh, 92dvh);
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0;
  }

  .tasks-dialog__content {
    padding: 18px 16px 28px;
  }

  .tasks-dialog__grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .task-row {
    transition: none;
  }
}
</style>
