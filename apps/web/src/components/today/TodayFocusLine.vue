<script setup lang="ts">
import UiIcon from "../UiIcon.vue";
// The one goal for now. The goal icon stands in for the word "Focus"; Mission is where it's chosen.
defineProps<{ goal: { title: string } | null; hasGoals?: boolean }>();
</script>

<template>
  <RouterLink to="/mission" class="today-focus" :aria-label="goal ? `Focus goal: ${goal.title}. Open Mission` : 'Choose a focus goal'">
    <UiIcon name="Goal" :size="18" class="today-focus__icon" />
    <span v-if="goal" class="today-focus__goal">{{ goal.title }}</span>
    <span v-else class="today-focus__goal today-focus__goal--empty">{{ hasGoals ? 'Pick one goal to focus on' : 'Add a goal to focus on' }}</span>
  </RouterLink>
</template>

<style scoped>
.today-focus { display: flex; align-items: center; gap: 10px; min-height: 44px; padding: 8px 12px; border-radius: 14px; background: color-mix(in oklab, var(--ui-accent) 16%, transparent); color: var(--ui-text); text-decoration: none; }
.today-focus:hover { filter: brightness(1.04); }
.today-focus__icon { flex-shrink: 0; color: var(--ui-accent-strong, var(--ui-accent)); }
.today-focus__goal { flex: 1; min-width: 0; overflow: hidden; font-size: 15px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.today-focus__goal--empty { color: var(--ui-text-muted); font-weight: 500; }
</style>
