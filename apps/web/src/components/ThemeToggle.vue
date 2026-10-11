<script setup lang="ts">
import { computed } from "vue";
import { useTheme } from "../composables/useTheme";

const { isDark, toggleTheme } = useTheme();

const label = computed(() =>
  isDark.value ? "Switch to light mode" : "Switch to dark mode",
);
const emoji = computed(() => (isDark.value ? "🌞" : "🌗"));
</script>

<template>
  <button
    type="button"
    class="theme-toggle"
    :aria-label="label"
    :title="label"
    @click="toggleTheme"
  >
    <span class="theme-toggle__emoji" aria-hidden="true">{{ emoji }}</span>
  </button>
</template>

<style scoped>
.theme-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: var(--color-bg);
  color: var(--color-text);
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    background 0.2s ease,
    color 0.2s ease,
    transform 0.2s ease;
  border: none;
}
.theme-toggle:hover {
  transform: translateY(-1px);
}

.theme-toggle:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
}

.theme-toggle__emoji {
  display: block;
  font-family:
    "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  font-size: 20px;
  line-height: 1;
}
</style>
