<script setup lang="ts">
import { ASSISTANT_AVATAR_SRC } from "../utils/assistantBranding";
withDefaults(defineProps<{ state?: "idle" | "listening" | "working"; size?: number }>(), { state: "idle", size: 48 });
</script>

<template>
  <span class="agent-dog" :data-state="state" :style="{ '--dog-size': `${size}px` }" aria-hidden="true">
    <span v-if="state === 'listening'" class="agent-dog__rings"><span /><span /><span /></span>
    <img :src="ASSISTANT_AVATAR_SRC" alt="" />
  </span>
</template>

<style scoped>
.agent-dog { position: relative; display: inline-grid; place-items: center; flex: 0 0 auto; width: var(--dog-size); height: var(--dog-size); }
.agent-dog img { position: relative; display: block; width: 100%; height: 100%; object-fit: contain; animation: dog-bob 3s ease-in-out infinite; }
.agent-dog[data-state="working"] img { animation-duration: 1.4s; }
.agent-dog[data-state="listening"] img { animation: dog-listen 1.8s ease-in-out infinite; }
.agent-dog__rings { position: absolute; inset: -22%; }
.agent-dog__rings span { position: absolute; inset: 0; border: 2px solid var(--ui-accent); border-radius: 50%; opacity: 0; animation: dog-ring 2.4s ease-out infinite; }
.agent-dog__rings span:nth-child(2) { animation-delay: .8s; }
.agent-dog__rings span:nth-child(3) { animation-delay: 1.6s; }
@keyframes dog-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes dog-listen { 0%, 100% { transform: rotate(-3deg); } 50% { transform: rotate(3deg); } }
@keyframes dog-ring { from { transform: scale(.75); opacity: .25; } to { transform: scale(1.25); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .agent-dog[data-state] img, .agent-dog__rings span { animation: none; transform: none; }
  .agent-dog__rings span:first-child { opacity: .18; }
}
</style>
