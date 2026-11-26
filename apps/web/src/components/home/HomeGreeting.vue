<script lang="ts">
// Greets once per page load: coming back to Home doesn't bring it back.
let greeted = false;
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { firstName } from "../../utils/people";

// "☀️ Good afternoon, Kieran" on one quiet, centred line above the cards. As Home opens, a soft light sweeps
// across the words twice (the same shimmer as ME3's working line), then after a few seconds it fades away and
// the cards slide up into its place. As iOS (HomeGreeting) and Android.
const props = defineProps<{ name?: string | null }>();
const VISIBLE_FOR_MS = 5_000;

const shown = ref(!greeted);
let hideTimer = 0;
onMounted(() => {
  if (!shown.value) return;
  hideTimer = window.setTimeout(() => { greeted = true; shown.value = false; }, VISIBLE_FOR_MS);
});
onBeforeUnmount(() => window.clearTimeout(hideTimer));

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
  <Transition name="home-greeting-out">
    <h1 v-if="shown" class="home-greeting" data-testid="home-greeting">
      <span class="home-greeting__emoji" aria-hidden="true">{{ salutation.emoji }}</span>
      <span class="home-greeting__text">{{ line }}</span>
    </h1>
  </Transition>
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
/* Fade out, then give the space back so the cards below slide up. */
.home-greeting-out-leave-active {
  overflow: hidden;
  transition: opacity 600ms ease-in-out, transform 600ms ease-in-out, max-height 600ms ease-in-out, margin 600ms ease-in-out;
}
.home-greeting-out-leave-from { max-height: 40px; }
.home-greeting-out-leave-to { opacity: 0; transform: translateY(-8px); max-height: 0; margin-top: 0; margin-bottom: 0; }
@media (prefers-reduced-motion: reduce) {
  .home-greeting { animation: none; }
  .home-greeting-out-leave-active { transition-duration: 200ms; }
  .home-greeting-out-leave-to { transform: none; }
  .home-greeting__text { animation: none; background: none; color: var(--ui-text-muted); }
}
</style>
