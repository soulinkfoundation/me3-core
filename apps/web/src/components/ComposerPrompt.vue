<script setup lang="ts">
defineProps<{ text: string }>();
</script>
<template><span class="composer-prompt" aria-hidden="true">{{ text }}</span></template>
<style scoped>
.composer-prompt { position: absolute; inset: 0; display: flex; align-items: center; pointer-events: none; color: color-mix(in oklab, var(--ui-text-muted) 70%, transparent); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style>
