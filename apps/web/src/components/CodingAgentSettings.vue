<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api } from "../api";
import Button from "./Button.vue";
import PageLoading from "./PageLoading.vue";
import StatusBadge from "./StatusBadge.vue";

/** Settings > Coding agents: connect GitHub so ME3 can hand coding tasks to Claude Code. */
type Connection = { connected: boolean; login?: string; repositories?: string[]; error?: string };
type Task = { repository: string; number: number; title: string; label: string; link: string; status: string };

const connection = ref<Connection | null>(null);
const tasks = ref<Task[]>([]);
const token = ref("");
const loading = ref(true);
const busy = ref(false);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  try {
    connection.value = await api.get<Connection>("/coding-agent");
    tasks.value = connection.value.connected && !connection.value.error
      ? (await api.get<{ tasks: Task[] }>("/coding-agent/tasks")).tasks
      : [];
  } catch (e: any) {
    error.value = e.message || "Could not load the GitHub connection.";
  } finally {
    loading.value = false;
  }
}

async function connect() {
  busy.value = true;
  error.value = "";
  try {
    connection.value = await api.put<Connection>("/coding-agent", { token: token.value });
    token.value = "";
    await load();
  } catch (e: any) {
    error.value = e.message || "GitHub didn't accept that token.";
  } finally {
    busy.value = false;
  }
}

async function disconnect() {
  busy.value = true;
  try {
    connection.value = await api.delete<Connection>("/coding-agent");
    tasks.value = [];
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="coding-agent">
    <PageLoading v-if="loading" compact label="Loading GitHub connection..." />
    <template v-else-if="connection?.connected">
      <div class="coding-agent__status">
        <p>
          Ask ME3 to send work to Claude, for example
          <em>"send this to Claude for me3-ios: …"</em>. Claude opens a pull request for you to
          review and merge.
        </p>
        <StatusBadge :tone="connection.error ? 'pending_setup' : 'active'">
          {{ connection.error ? "Check token" : `GitHub · ${connection.login}` }}
        </StatusBadge>
      </div>
      <p v-if="connection.error" class="coding-agent__error">{{ connection.error }}</p>
      <p v-else class="coding-agent__hint">
        {{ connection.repositories?.length || 0 }} repositories reachable. Each one needs the Claude
        workflow and the CLAUDE_CODE_OAUTH_TOKEN secret before Claude picks up work there.
      </p>
      <ul v-if="tasks.length" class="coding-agent__tasks">
        <li v-for="task in tasks" :key="`${task.repository}#${task.number}`">
          <a :href="task.link" target="_blank" rel="noopener">{{ task.title }}</a>
          <span>{{ task.repository.split("/")[1] }} · {{ task.label }}</span>
        </li>
      </ul>
      <Button color="secondary" shape="soft" size="compact" type="button" :disabled="busy" @click="disconnect">
        Disconnect GitHub
      </Button>
    </template>
    <form v-else class="coding-agent__connect" @submit.prevent="connect">
      <p class="coding-agent__hint">
        Connect a GitHub token so ME3 can hand coding tasks to Claude Code. Create a
        <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">fine-grained token</a>
        for the repositories you want, with Issues: Read and write. The token stays on this installation.
      </p>
      <label>
        <span>GitHub token</span>
        <input v-model="token" class="coding-agent__input" type="password" autocomplete="off" spellcheck="false" />
      </label>
      <Button color="primary" shape="soft" size="compact" type="submit" :disabled="busy || !token.trim()">
        {{ busy ? "Connecting…" : "Connect GitHub" }}
      </Button>
    </form>
    <p v-if="error" class="coding-agent__error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.coding-agent { display: grid; gap: 12px; }
.coding-agent__status { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.coding-agent__status p, .coding-agent__hint { margin: 0; color: var(--ui-text-muted, var(--color-text-muted)); line-height: 1.5; }
.coding-agent__error { margin: 0; color: var(--ui-danger, #c62828); }
.coding-agent__connect { display: grid; gap: 12px; justify-items: start; }
.coding-agent__connect label { display: grid; gap: 6px; width: 100%; font-size: 14px; }
.coding-agent__input { box-sizing: border-box; width: 100%; min-height: 44px; padding: 0 12px; border: 1px solid var(--ui-border, var(--color-border)); border-radius: var(--ui-radius-sm, 8px); background: var(--ui-surface, var(--color-bg)); color: var(--ui-text, var(--color-text)); font: inherit; }
.coding-agent__tasks { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.coding-agent__tasks li { display: grid; gap: 2px; padding: 10px 0; border-top: 1px solid var(--ui-border, var(--color-border)); }
.coding-agent__tasks span { font-size: 13px; color: var(--ui-text-muted, var(--color-text-muted)); }
@media (max-width: 640px) { .coding-agent__status { flex-direction: column; } }
</style>
