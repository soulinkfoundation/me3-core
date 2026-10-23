<script setup lang="ts">
import { computed } from "vue";
import { networkLabel, networkMark, socialNetwork } from "../../utils/social-posts";

const props = withDefaults(
  defineProps<{ platforms: string[]; size?: "small" | "large" }>(),
  { size: "small" },
);

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
</script>

<template>
  <span class="social-marks" :class="`social-marks--${size}`" :aria-label="marks.map(networkLabel).join(', ')" role="img">
    <span v-for="network in marks" :key="network" class="social-mark" :class="`social-mark--${network}`" aria-hidden="true">
      {{ networkMark(network) }}
    </span>
  </span>
</template>

<style scoped>
.social-marks { display: inline-flex; flex: none; }
.social-mark {
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
.social-marks--large .social-mark { width: 32px; height: 32px; border: 0; font-size: 12px; }
/* Brand colours identify each network; X uses the text colour so it reads in light and dark. */
.social-mark--x { background: var(--ui-text); color: var(--ui-bg); }
.social-mark--linkedin { background: #0a66c2; }
.social-mark--instagram { background: #d62976; }
.social-mark--facebook { background: #1877f2; }
.social-mark--youtube { background: #e62117; }
</style>
