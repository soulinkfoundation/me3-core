<script setup lang="ts">
defineProps<{ title?: string; titleId?: string }>();
</script>

<template>
  <!-- The page's header lives in the app top bar: its one action on the left (`leading`), the title centred,
       and the bar's X on the right. `actions` sit beside the title and are for a single ⋯ menu at most. -->
  <Teleport v-if="$slots.leading" to="#app-page-leading" defer>
    <div class="app-page-bar__leading"><slot name="leading" /></div>
  </Teleport>
  <Teleport to="#app-page-controls" defer>
    <div class="app-page-bar">
      <h1 :id="titleId" class="app-page-bar__title"><slot name="title">{{ title }}</slot></h1>
      <div v-if="$slots.actions" class="app-page-bar__actions"><slot name="actions" /></div>
    </div>
  </Teleport>
</template>

<style scoped>
.app-page-bar { display: flex; align-items: center; justify-content: center; gap: 4px; min-width: 0; min-height: 44px; }
.app-page-bar__title { display: flex; align-items: baseline; justify-content: center; gap: 6px; min-width: 0; margin: 0; overflow: hidden; color: var(--ui-text); font-size: 16px; font-weight: 700; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
.app-page-bar__actions { display: flex; flex: none; align-items: center; gap: 2px; }
.app-page-bar__leading { display: flex; align-items: center; }
/* Left actions are icon buttons with a 44px target. */
.app-page-bar__leading :deep(button), .app-page-bar__leading :deep(a) { min-width: 44px; min-height: 44px; }
</style>
