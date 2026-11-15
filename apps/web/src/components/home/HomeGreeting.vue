<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { firstName } from "../../utils/people";

// "☀️ Good afternoon, Kieran" on one quiet, centred line above the cards. As Home opens, a soft light sweeps
// across the words twice (the same shimmer as ME3's working line), then it rests.
const props = defineProps<{ name?: string | null }>();

const now = ref(new Date());
const timer = window.setInterval(() => { now.value = new Date(); }, 60_000);
onBeforeUnmount(() => window.clearInterval(timer));

const salutation = computed(() => {
  const hour = now.value.getHours();
  return hour < 12 ? { text: "Good morning", emoji: "🌅" } : hour < 18 ? { text: "Good afternoon", emoji: "☀️" } : { text: "Good evening", emoji: "🌙" };
});
const line = computed(() => {
  const first = props.name ? firstName(props.name) : "";
  return first ? `${salutation.value.text}, ${first}` : salutation.value.text;
});
</script>

<template>
  <h1 class="home-greeting" data-testid="home-greeting">
    <span class="home-greeting__emoji" aria-hidden="true">{{ salutation.emoji }}</span>
    <span class="home-greeting__text">{{ line }}</span>
  </h1>
</template>

<style scoped>
.home-greeting {
  display: flex; align-items: center; justify-content: center; gap: 8px;
  width: min(620px, 100%); margin: 2px auto 14px; text-align: center;
  font-size: 19px; font-weight: 400; line-height: 1.3; letter-spacing: -0.01em;
  color: var(--ui-text-muted);
  animation: home-greeting-rise 600ms cubic-bezier(.2, .8, .2, 1) both;
}
.home-greeting__emoji {
  flex: none; font-size: 20px; line-height: 1;
  font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
}
.home-greeting__text {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  background: linear-gradient(90deg, var(--ui-text-muted) 0%, var(--ui-text-muted) 35%, var(--ui-text) 50%, var(--ui-text-muted) 65%, var(--ui-text-muted) 100%);
  background-size: 300% 100%; background-position: 100% 0;
  -webkit-background-clip: text; background-clip: text; color: transparent;
  animation: home-greeting-sweep 1.6s ease-in-out 250ms 2 both;
}
@keyframes home-greeting-rise {
  from { opacity: 0; transform: translateY(6px); filter: blur(3px); }
  to { opacity: 1; transform: none; filter: none; }
}
@keyframes home-greeting-sweep {
  from { background-position: 100% 0; }
  to { background-position: 0% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .home-greeting { animation: none; }
  .home-greeting__text { animation: none; background: none; color: var(--ui-text-muted); }
}
</style>
