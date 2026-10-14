<script setup lang="ts">
// One plain, left-aligned title style for every section of the Today card and daily page.
defineProps<{ title: string; to?: string; label?: string }>();
</script>

<template>
  <section class="today-section" :aria-label="title">
    <RouterLink v-if="to" :to="to" class="today-section__title" :aria-label="label">{{ title }}</RouterLink>
    <h3 v-else class="today-section__title">{{ title }}</h3>
    <slot />
  </section>
</template>

<style scoped>
.today-section { display: flex; flex-direction: column; margin-top: 10px; }
.today-section__title { display: block; margin: 0 0 2px; padding: 0; color: var(--ui-text-muted); font-size: 13px; font-weight: 600; line-height: 1.4; text-decoration: none; text-align: left; }
a.today-section__title { align-self: flex-start; min-height: 24px; }
a.today-section__title:hover { color: var(--ui-text); }
</style>
