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
  { avatarUrl: null, name: null, selected: true, size: 32 },
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
      <svg v-else-if="network === 'linkedin'" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452z" /></svg>
      <svg v-else-if="network === 'instagram'" viewBox="0 0 24 24"><path d="M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077" /></svg>
      <svg v-else-if="network === 'facebook'" viewBox="0 0 24 24"><path d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z" /></svg>
      <svg v-else viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></svg>
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
  right: -4px;
  bottom: -4px;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: max(16px, calc(var(--avatar-size) * .5));
  height: max(16px, calc(var(--avatar-size) * .5));
  border: 1.5px solid var(--ui-surface);
  border-radius: 50%;
  color: #fff;
  transition: filter .15s ease, opacity .15s ease;
}
.social-avatar__logo svg { width: 58%; height: 58%; fill: currentColor; }
.is-off .social-avatar__logo { filter: grayscale(1); opacity: .6; }
/* Brand colours; X follows the text colour so it reads in light and dark. */
.social-avatar__logo--x { background: var(--ui-text); color: var(--ui-surface); }
.social-avatar__logo--linkedin { background: #0a66c2; }
.social-avatar__logo--linkedin svg { width: 54%; height: 54%; }
.social-avatar__logo--instagram { background: radial-gradient(circle at 30% 107%, #fdf497 0%, #fd5949 45%, #d6249f 60%, #285aeb 90%); }
.social-avatar__logo--instagram svg { width: 62%; height: 62%; }
/* Facebook and YouTube marks carry their own shape: brand colour on white. */
.social-avatar__logo--facebook { background: #fff; color: #0866ff; }
.social-avatar__logo--facebook svg { width: 100%; height: 100%; }
.social-avatar__logo--youtube { background: #fff; color: #f00; }
.social-avatar__logo--youtube svg { width: 78%; height: 78%; }
@media (prefers-reduced-motion: reduce) {
  .social-avatar__face, .social-avatar__logo { transition: none; }
}
</style>
