<script setup lang="ts">
import Button from "../Button.vue";
import SoupBowl from "../soup/SoupBowl.vue";
import SoupHeadlines from "../soup/SoupHeadlines.vue";
import type { SoupServing, SoupServingAction } from "../../utils/soup";

// The Soup card body on Home (me3-ydf4.4). Before taste is set up it is the cauldron intro that
// hands the owner to ME3; afterwards it is only drawn while a serving is open.
defineProps<{ serving: SoupServing | null; setUp: boolean; busy?: boolean }>();
const emit = defineEmits<{ setup: []; act: [serving: SoupServing, action: SoupServingAction, itemId: string] }>();
</script>

<template>
  <section v-if="!setUp" class="soup-intro" aria-label="The Human Soup">
    <img src="/soup-cauldron.webp" alt="Little robots diving into a cauldron of soup" width="160" height="160" />
    <h3>The Human Soup</h3>
    <p>Wholesome content from around the web, seasoned to your taste by ME3.</p>
    <Button color="neutral" shape="pill" :disabled="busy" @click="emit('setup')">Set it up with ME3</Button>
    <span class="soup-intro__note">Takes a minute. Your taste stays on your ME3.</span>
  </section>
  <template v-else-if="serving">
    <SoupHeadlines v-if="serving.kind === 'headlines'" :serving="serving" @act="(action, itemId) => emit('act', serving!, action, itemId)" />
    <SoupBowl v-else :serving="serving" :busy="busy" @act="(action, itemId) => emit('act', serving!, action, itemId)" />
  </template>
</template>

<style scoped>
.soup-intro { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 4px 0 6px; text-align: center; }
.soup-intro img { width: 160px; height: auto; margin: -6px 0 2px; filter: drop-shadow(0 10px 18px rgba(0, 0, 0, .18)); }
.soup-intro h3 { margin: 0; font-family: var(--font-serif, ui-serif, 'New York', Georgia, serif); font-size: 20px; font-weight: 600; letter-spacing: -.01em; }
.soup-intro p { margin: 0; max-width: 290px; font-size: 14.5px; line-height: 1.45; color: var(--ui-text-muted); }
.soup-intro :deep(.me3-btn) { align-self: stretch; margin-top: 6px; }
.soup-intro__note { font-size: 12.5px; color: var(--ui-text-muted); }
</style>
