<script setup lang="ts">
import Button from "../Button.vue";
import SoupBowl from "../soup/SoupBowl.vue";
import SoupHeadlines from "../soup/SoupHeadlines.vue";
import type { SoupServing, SoupServingAction } from "../../utils/soup";

// The News card body on Home (me3-6ptk). Before News is set up it is the intro that hands the
// owner to ME3; afterwards it shows what is ready.
defineProps<{ serving: SoupServing | null; setUp: boolean; busy?: boolean }>();
const emit = defineEmits<{ setup: []; act: [serving: SoupServing, action: SoupServingAction, itemId: string] }>();
</script>

<template>
  <section v-if="!setUp" class="soup-intro" aria-label="News">
    <span class="soup-intro__big" aria-hidden="true">🗞️</span>
    <h3>Your news, ready when you wake up</h3>
    <p>ME3 picks the news that matters for your work and the topics you love, and has it ready every morning.</p>
    <Button color="neutral" shape="pill" :disabled="busy" @click="emit('setup')">Set it up with ME3</Button>
  </section>
  <template v-else-if="serving">
    <SoupHeadlines v-if="serving.kind === 'headlines'" :serving="serving" @act="(action, itemId) => emit('act', serving!, action, itemId)" />
    <SoupBowl v-else :serving="serving" :busy="busy" @act="(action, itemId) => emit('act', serving!, action, itemId)" />
  </template>
</template>

<style scoped>
.soup-intro { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 4px 0 6px; text-align: center; }
.soup-intro__big { font-size: 64px; line-height: 1; margin: 4px 0; }
.soup-intro h3 { margin: 0; font-size: 20px; font-weight: 650; }
.soup-intro p { margin: 0; max-width: 290px; font-size: 14.5px; line-height: 1.45; color: var(--ui-text-muted); }
.soup-intro :deep(.me3-btn) { align-self: stretch; margin-top: 6px; }
</style>
