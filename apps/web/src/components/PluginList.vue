<script setup lang="ts">
import { computed } from "vue";
import {
  isFixedCorePlugin,
  isPluginComingSoon,
  isPluginEnabled,
  isPluginHiddenFromList,
  pluginInfoText,
  pluginNavEmoji,
  sortPluginsForDisplay,
  type PluginRecord,
} from "../utils/plugins";

const props = withDefaults(
  defineProps<{
    plugins: PluginRecord[];
    busyPluginIds?: readonly string[];
    selectedPluginIds?: readonly string[];
    showComingSoon?: boolean;
  }>(),
  {
    busyPluginIds: () => [],
    selectedPluginIds: undefined,
    showComingSoon: false,
  },
);

const emit = defineEmits<{
  toggle: [plugin: PluginRecord, enabled: boolean];
}>();

const visiblePlugins = computed(() =>
  sortPluginsForDisplay(
    props.plugins.filter(
      (plugin) =>
        (props.showComingSoon || !isPluginComingSoon(plugin)) &&
        !isPluginHiddenFromList(plugin),
    ),
  ),
);

const busyPluginIdSet = computed(() => new Set(props.busyPluginIds));
const selectedPluginIdSet = computed(() =>
  props.selectedPluginIds ? new Set(props.selectedPluginIds) : null,
);

function isPluginBusy(plugin: PluginRecord) {
  return busyPluginIdSet.value.has(plugin.id);
}

function isPluginOn(plugin: PluginRecord) {
  if (isFixedCorePlugin(plugin)) return true;
  if (isPluginComingSoon(plugin)) return false;
  const selected = selectedPluginIdSet.value;
  return selected ? selected.has(plugin.id) : isPluginEnabled(plugin);
}

function isPluginToggleDisabled(plugin: PluginRecord) {
  return (
    isPluginBusy(plugin) ||
    isFixedCorePlugin(plugin) ||
    isPluginComingSoon(plugin)
  );
}
</script>

<template>
  <div class="plugin-list">
    <article
      v-for="plugin in visiblePlugins"
      :key="plugin.id"
      class="plugin-row"
    >
      <div class="plugin-row__main">
        <span class="plugin-row__emoji" aria-hidden="true">
          {{ pluginNavEmoji(plugin) }}
        </span>
        <div class="plugin-row__copy">
          <div class="plugin-row__title-line">
            <h3>{{ plugin.name }}</h3>
            <span
              v-if="isPluginComingSoon(plugin)"
              class="plugin-row__badge plugin-row__badge--muted"
            >
              Coming soon
            </span>
            <span
              v-else-if="isFixedCorePlugin(plugin)"
              class="plugin-row__badge"
            >
              Built in
            </span>
          </div>
          <p>{{ pluginInfoText(plugin) }}</p>
        </div>
        <div class="plugin-row__actions">
          <label
            class="plugin-toggle"
            :class="{
              'is-busy': isPluginBusy(plugin),
              'is-locked':
                isFixedCorePlugin(plugin) || isPluginComingSoon(plugin),
            }"
          >
            <input
              type="checkbox"
              class="plugin-toggle__input"
              :checked="isPluginOn(plugin)"
              :disabled="isPluginToggleDisabled(plugin)"
              :aria-label="
                isPluginComingSoon(plugin)
                  ? `${plugin.name} is coming soon`
                  : isFixedCorePlugin(plugin)
                  ? `${plugin.name} is included in ME3`
                  : isPluginOn(plugin)
                  ? `Disable ${plugin.name}`
                  : `Enable ${plugin.name}`
              "
              @change="
                emit(
                  'toggle',
                  plugin,
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
            <span class="plugin-toggle__track" aria-hidden="true" />
          </label>
        </div>
      </div>
    </article>
  </div>
</template>

<style scoped>
.plugin-list {
  display: grid;
  gap: 8px;
}

.plugin-row {
  display: grid;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-md, 10px);
  background: var(--ui-surface, var(--color-bg));
}

.plugin-row__main {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.plugin-row__emoji {
  flex-shrink: 0;
  font-size: 21px;
  line-height: 1;
  font-family:
    "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
}

.plugin-row__copy {
  flex: 1;
  min-width: 0;
}

.plugin-row__title-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.plugin-row__actions {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 10px;
}

.plugin-row h3 {
  margin: 0;
  color: var(--ui-text, var(--color-text));
  font-size: 14px;
  font-weight: 650;
  line-height: 1.3;
}

.plugin-row p {
  margin: 2px 0 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

.plugin-row__badge {
  flex-shrink: 0;
  padding: 3px 7px;
  border-radius: 999px;
  background: var(--ui-accent-soft, rgba(20, 184, 166, 0.14));
  color: var(--ui-accent-strong, #0f766e);
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
}

.plugin-row__badge--muted {
  background: var(--ui-surface-muted, var(--color-bg-soft));
  color: var(--ui-text-muted, var(--color-text-muted));
}

.plugin-toggle {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  cursor: pointer;
}

.plugin-toggle.is-busy {
  cursor: wait;
  opacity: 0.72;
}

.plugin-toggle.is-locked {
  cursor: default;
}

.plugin-toggle__input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.plugin-toggle__track {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 999px;
  background: var(--ui-border, var(--color-border));
  transition: background 0.2s ease;
}

.plugin-toggle__track::after {
  content: "";
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: var(--ui-bg, var(--color-bg));
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  transition: transform 0.2s ease;
}

.plugin-toggle__input:checked + .plugin-toggle__track {
  background: var(--ui-accent, var(--color-accent));
}

.plugin-toggle__input:checked + .plugin-toggle__track::after {
  transform: translateX(18px);
}

.plugin-toggle__input:focus-visible + .plugin-toggle__track {
  outline: 2px solid var(--ui-accent, var(--color-accent));
  outline-offset: 2px;
}

.plugin-toggle__input:disabled + .plugin-toggle__track {
  opacity: 0.55;
}

@media (max-width: 720px) {
  .plugin-row__main {
    align-items: flex-start;
  }

  .plugin-row__actions {
    justify-content: flex-end;
  }
}

@media (max-width: 560px) {
  .plugin-row__main {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
  }

  .plugin-row__actions {
    grid-column: 2;
    width: 100%;
  }
}
</style>
