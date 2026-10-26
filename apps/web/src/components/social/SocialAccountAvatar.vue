<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { SocialNetwork } from "../../utils/social-posts";

/**
 * The owner's profile picture on a network with that network's logo in the
 * corner. Grey and faded when `selected` is false.
 */
const props = withDefaults(
  defineProps<{
    network: SocialNetwork;
    avatarUrl?: string | null;
    name?: string | null;
    selected?: boolean;
    size?: number;
  }>(),
  { avatarUrl: null, name: null, selected: true, size: 44 },
);

const failed = ref(false);
watch(() => props.avatarUrl, () => (failed.value = false));

const initial = computed(() => (props.name || "").replace(/^@/, "").trim().charAt(0).toUpperCase());
const showImage = computed(() => Boolean(props.avatarUrl) && !failed.value);
</script>

<template>
  <span class="social-avatar" :class="{ 'is-off': !selected }" :style="{ '--avatar-size': `${size}px` }" aria-hidden="true">
    <span class="social-avatar__face">
      <img v-if="showImage" :src="avatarUrl!" alt="" referrerpolicy="no-referrer" @error="failed = true">
      <span v-else>{{ initial }}</span>
    </span>
    <span class="social-avatar__logo" :class="`social-avatar__logo--${network}`">
      <!-- Brand marks (Simple Icons, CC0). -->
      <svg v-if="network === 'x'" viewBox="0 0 24 24"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" /></svg>
      <svg v-else-if="network === 'linkedin'" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286ZM5.337 7.433a2.062 2.062 0 1 1 0-4.125 2.062 2.062 0 0 1 0 4.125Zm1.782 13.019H3.555V9h3.564v11.452Z" /></svg>
      <svg v-else-if="network === 'instagram'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="3" y="3" width="18" height="18" rx="5.5" /><circle cx="12" cy="12" r="4.2" /><circle cx="17.4" cy="6.6" r=".6" fill="currentColor" /></svg>
      <svg v-else-if="network === 'facebook'" viewBox="0 0 24 24"><path d="M15.12 5.32H17V2.14A26.1 26.1 0 0 0 14.26 2c-2.72 0-4.58 1.66-4.58 4.7v2.62H6.61v3.56h3.07V22h3.68v-9.12h3.06l.46-3.56h-3.52V7.05c0-1.03.28-1.73 1.76-1.73Z" /></svg>
      <svg v-else viewBox="0 0 24 24"><path d="M9.545 15.568V8.432L15.818 12l-6.273 3.568Z" /></svg>
    </span>
  </span>
</template>

<style scoped>
.social-avatar { position: relative; display: inline-block; flex: none; width: var(--avatar-size); height: var(--avatar-size); }
.social-avatar__face {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 50%;
  background: var(--ui-surface-muted);
  color: var(--ui-text-muted);
  font: 650 calc(var(--avatar-size) * .4) / 1 var(--font-sans);
  transition: filter .15s ease, opacity .15s ease;
}
.social-avatar__face img { width: 100%; height: 100%; object-fit: cover; }
.is-off .social-avatar__face { filter: grayscale(1); opacity: .5; }
.social-avatar__logo {
  position: absolute;
  right: -3px;
  bottom: -3px;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: calc(var(--avatar-size) * .42);
  height: calc(var(--avatar-size) * .42);
  border: 2px solid var(--ui-surface);
  border-radius: 50%;
  color: #fff;
  transition: filter .15s ease, opacity .15s ease;
}
.social-avatar__logo svg { width: 58%; height: 58%; fill: currentColor; }
.is-off .social-avatar__logo { filter: grayscale(1); opacity: .6; }
/* Brand colours; X follows the text colour so it reads in light and dark. */
.social-avatar__logo--x { background: var(--ui-text); color: var(--ui-surface); }
.social-avatar__logo--linkedin { background: #0a66c2; }
.social-avatar__logo--instagram { background: radial-gradient(circle at 30% 107%, #fdf497 0%, #fd5949 45%, #d6249f 60%, #285aeb 90%); }
.social-avatar__logo--facebook { background: #1877f2; }
.social-avatar__logo--youtube { background: #ff0000; }
.social-avatar__logo--youtube svg { width: 70%; height: 70%; }
@media (prefers-reduced-motion: reduce) {
  .social-avatar__face, .social-avatar__logo { transition: none; }
}
</style>
