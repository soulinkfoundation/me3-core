<script setup lang="ts">
import { computed } from "vue";
import { networkLabel, networkMark, socialNetwork, type MarkState } from "../../utils/social-posts";

const props = withDefaults(
  /** `states` maps a platform to its progress: a spinning ring, a tick, or a red dot. */
  defineProps<{ platforms: string[]; size?: "tiny" | "small" | "large"; states?: Record<string, MarkState> }>(),
  { size: "small", states: () => ({}) },
);

// The TikTok logo; a text note at this size reads as a dot.
const TIKTOK_PATH = "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z";

// One mark per network (Instagram and Instagram Business share one).
const marks = computed(() => {
  const seen = new Set<string>();
  return props.platforms
    .map((platform) => socialNetwork(platform))
    .filter((network): network is NonNullable<typeof network> => {
      if (!network || seen.has(network)) return false;
      seen.add(network);
      return true;
    });
});

const stateFor = computed(() => {
  const byNetwork: Record<string, MarkState> = {};
  for (const [platform, state] of Object.entries(props.states)) {
    const network = socialNetwork(platform);
    if (network) byNetwork[network] = state;
  }
  return byNetwork;
});
const label = computed(() =>
  marks.value.map((network) => (stateFor.value[network] === "posting" ? `${networkLabel(network)}, posting` : networkLabel(network))).join(", "),
);
</script>

<template>
  <span class="social-marks" :class="`social-marks--${size}`" :aria-label="label" role="img">
    <span
      v-for="network in marks"
      :key="network"
      class="social-mark"
      :class="[`social-mark--${network}`, stateFor[network] && `is-${stateFor[network]}`]"
      aria-hidden="true"
    >
      <svg v-if="network === 'tiktok'" class="social-mark__logo" viewBox="0 0 24 24" fill="currentColor"><path :d="TIKTOK_PATH" /></svg>
      <template v-else>{{ networkMark(network) }}</template>
      <span v-if="stateFor[network] === 'posting' || stateFor[network] === 'posted'" class="social-mark__ring" />
      <span v-if="stateFor[network] === 'posted'" class="social-mark__tick">
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.2 5 8.5 9.5 3.5" /></svg>
      </span>
      <span v-else-if="stateFor[network] === 'failed'" class="social-mark__dot" />
    </span>
  </span>
</template>

<style scoped>
.social-marks { display: inline-flex; flex: none; }
.social-mark {
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border: 2px solid var(--ui-bg);
  border-radius: 50%;
  color: #fff;
  font: 700 9px/1 var(--font-sans, system-ui);
}
.social-mark + .social-mark { margin-left: -7px; }
.social-marks--tiny .social-mark { width: 18px; height: 18px; border-width: 1.5px; font-size: 7.5px; }
.social-marks--tiny .social-mark + .social-mark { margin-left: -5px; }
.social-marks--tiny .social-mark__logo { width: 9px; height: 9px; }
.social-marks--large .social-mark { width: 32px; height: 32px; border: 0; font-size: 12px; }
/* Brand colours identify each network; X uses the text colour so it reads in light and dark. */
.social-mark--x { background: var(--ui-text); color: var(--ui-bg); }
.social-mark--linkedin { background: #0a66c2; }
.social-mark--instagram { background: #d62976; }
.social-mark--facebook { background: #1877f2; }
.social-mark--youtube { background: #e62117; }
.social-mark--tiktok { background: #111; }
.social-mark__logo { width: 11px; height: 11px; }
.social-marks--large .social-mark__logo { width: 16px; height: 16px; }
/* Progress: the ring spins while posting and settles solid once posted. */
.social-mark__ring {
  position: absolute;
  inset: -4px;
  border: 2px solid var(--ui-accent-soft);
  border-top-color: var(--ui-accent);
  border-radius: 50%;
  animation: social-mark-spin 1.1s linear infinite;
}
.social-mark.is-posted .social-mark__ring { border-color: var(--ui-accent); animation: none; }
.social-mark__tick {
  position: absolute;
  right: -5px;
  bottom: -5px;
  display: grid;
  place-items: center;
  width: 12px;
  height: 12px;
  border: 2px solid var(--ui-bg);
  border-radius: 50%;
  background: var(--ui-success, var(--ui-accent));
  color: #fff;
}
.social-mark__tick svg { width: 8px; height: 8px; }
.social-mark__dot {
  position: absolute;
  top: -3px;
  right: -3px;
  width: 9px;
  height: 9px;
  border: 2px solid var(--ui-bg);
  border-radius: 50%;
  background: var(--ui-danger);
}
.social-mark.is-posting + .social-mark, .social-mark.is-posted + .social-mark { margin-left: -2px; }
@keyframes social-mark-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .social-mark__ring { animation: none; border-color: var(--ui-accent-soft); border-top-color: var(--ui-accent); border-right-color: var(--ui-accent); }
}
</style>
