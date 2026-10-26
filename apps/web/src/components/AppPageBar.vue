<script setup lang="ts">
defineProps<{ title?: string; titleId?: string }>();
</script>

<template>
  <!-- Puts the page title and its actions on the app top bar row beside Back,
       so no page spends a whole row on the Back arrow alone. -->
  <Teleport to="#app-page-controls" defer>
    <div class="app-page-bar">
      <h1 :id="titleId" class="app-page-bar__title"><slot name="title">{{ title }}</slot></h1>
      <div v-if="$slots.actions" class="app-page-bar__actions"><slot name="actions" /></div>
    </div>
  </Teleport>
</template>

<style scoped>
.app-page-bar { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; min-height: 44px; }
.app-page-bar__title { display: flex; flex: 1; align-items: baseline; justify-content: center; gap: 6px; min-width: 0; margin: 0; overflow: hidden; color: var(--ui-text); font-size: 15px; font-weight: 700; line-height: 1.2; white-space: nowrap; }
.app-page-bar__actions { display: flex; flex: none; align-items: center; gap: 2px; margin-left: auto; }
/* Centre the title on the page, not between Back and the actions, so it lines up with centred content. */
@media (min-width: 641px) {
  .app-page-bar__title { position: absolute; left: 50%; max-width: 50%; transform: translateX(-50%); }
}
</style>
