<script setup lang="ts">
import type { SoupServing, SoupServingAction } from "../../utils/soup";

// A headlines serving: each headline is the title followed by where it came from, with ME3's
// for-you line under it. Opening one goes to the original and marks it opened.
defineProps<{ serving: SoupServing }>();
const emit = defineEmits<{ act: [action: SoupServingAction, itemId: string] }>();
</script>

<template>
  <div class="soup-headlines">
    <a v-for="item in serving.items" :key="item.id" :href="item.url" target="_blank" rel="noopener noreferrer" class="soup-hl" :class="{ 'is-opened': item.state !== 'served' }" @click="emit('act', 'open', item.id)">
      <span class="soup-hl__title">{{ item.title }} <span class="soup-hl__src">· {{ item.creator || item.soupTitle }}</span></span>
      <span v-if="item.forYou" class="soup-foryou">{{ item.forYou }}</span>
    </a>
    <p v-if="serving.fallback" class="soup-headlines__note">Not much new today, so these are older picks.</p>
  </div>
</template>

<style scoped>
.soup-headlines { display: flex; flex-direction: column; }
.soup-hl { display: flex; flex-direction: column; gap: 3px; width: 100%; padding: 10px 0; color: var(--ui-text); text-decoration: none; text-align: left; box-shadow: inset 0 -1px 0 var(--ui-border); }
.soup-hl:last-of-type { box-shadow: none; }
.soup-hl:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 2px; border-radius: 8px; }
.soup-hl__title { font-size: 15px; font-weight: 600; line-height: 1.35; }
.soup-hl__src { font-weight: 400; color: var(--ui-text-muted); white-space: nowrap; }
.soup-hl.is-opened .soup-hl__title { font-weight: 500; }
.soup-foryou { font-size: 13.5px; line-height: 1.4; color: var(--ui-text-muted); }
.soup-headlines__note { margin: 6px 0 0; font-size: 13px; color: var(--ui-text-muted); }
</style>
