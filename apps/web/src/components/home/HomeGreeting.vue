<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { firstName } from "../../utils/people";

// "Good afternoon, Kieran", centred above the cards. The day's details live in the cards themselves.
const props = defineProps<{ name?: string | null }>();

const now = ref(new Date());
const timer = window.setInterval(() => { now.value = new Date(); }, 60_000);
onBeforeUnmount(() => window.clearInterval(timer));

const salutation = computed(() => {
  const hour = now.value.getHours();
  return hour < 12 ? { text: "Good morning", emoji: "🌅" } : hour < 18 ? { text: "Good afternoon", emoji: "☀️" } : { text: "Good evening", emoji: "🌙" };
});
const first = computed(() => (props.name ? firstName(props.name) : "") || "");
</script>

<template>
  <h1 class="home-greeting" data-testid="home-greeting">
    <span class="home-greeting__emoji" aria-hidden="true">{{ salutation.emoji }}</span>
    <span class="home-greeting__text">{{ salutation.text }}<template v-if="first">, <span class="home-greeting__name">{{ first }}</span></template></span>
  </h1>
</template>

<style scoped>
.home-greeting {
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  width: min(620px, 100%); margin: 6px auto 22px; text-align: center;
  font-size: clamp(26px, 6vw, 32px); font-weight: 500; line-height: 1.15; letter-spacing: -0.02em;
  color: var(--ui-text);
}
.home-greeting__emoji {
  font-size: 34px; line-height: 1;
  font-family: 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
  animation: home-greeting-emoji 900ms cubic-bezier(.2, .9, .25, 1.25) both;
}
.home-greeting__text { animation: home-greeting-rise 700ms cubic-bezier(.2, .8, .2, 1) 120ms both; }
.home-greeting__name { color: var(--ui-accent-strong); }
@keyframes home-greeting-emoji {
  0% { opacity: 0; transform: translateY(10px) scale(.6) rotate(-12deg); }
  60% { opacity: 1; transform: translateY(-2px) scale(1.08) rotate(4deg); }
  100% { opacity: 1; transform: none; }
}
@keyframes home-greeting-rise {
  from { opacity: 0; transform: translateY(8px); filter: blur(4px); }
  to { opacity: 1; transform: none; filter: none; }
}
@media (prefers-reduced-motion: reduce) {
  .home-greeting__emoji, .home-greeting__text { animation: none; }
}
</style>
