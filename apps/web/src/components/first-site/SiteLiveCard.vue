<script setup lang="ts">
import { computed, useId } from "vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import { useAppToast } from "../../composables/useAppToast";

/** After the first publish: the link, and the next steps one at a time (iOS live card). */
const props = defineProps<{ name: string; publicUrl: string; busy?: boolean }>();
const emit = defineEmits<{ showMe: []; findSomeone: [] }>();
const { toastSuccess, toastError } = useAppToast();
const titleId = useId();
const host = computed(() => props.publicUrl.replace(/^https?:\/\//, "").replace(/\/$/, ""));

async function copyLink() {
  try { await navigator.clipboard.writeText(props.publicUrl); toastSuccess("Link copied"); }
  catch { toastError("Couldn't copy the link"); }
}
</script>

<template>
  <section class="site-live" :aria-labelledby="titleId" data-testid="site-live-card">
    <div class="site-live__head">
      <span class="site-live__mark" aria-hidden="true"><UiIcon name="Check" :size="18" /></span>
      <span class="site-live__stack">
        <h3 :id="titleId" class="site-live__title">You're live</h3>
        <a :href="publicUrl" target="_blank" rel="noopener noreferrer" class="site-live__link">{{ host }}</a>
      </span>
      <Button color="ghost" shape="soft" icon-only aria-label="Copy link" @click="copyLink"><UiIcon name="Copy" :size="18" /></Button>
    </div>
    <p class="site-live__text">People and their assistants can find you now and book your free call. See what they see, or find someone you know.</p>
    <div class="site-live__btns">
      <Button color="ghost" shape="soft" :disabled="busy" @click="emit('findSomeone')"><UiIcon name="UserPlus" :size="18" />Find someone</Button>
      <Button class="site-live__primary" color="primary" shape="soft" :disabled="busy" @click="emit('showMe')"><UiIcon name="Search" :size="18" />See what they see</Button>
    </div>
  </section>
</template>

<style scoped>
.site-live { display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; width: min(560px, 100%); padding: 16px; border-radius: 20px; background: var(--ui-surface); color: var(--ui-text); box-shadow: var(--ui-shadow-sm); }
.site-live__head { display: flex; align-items: center; gap: 12px; }
.site-live__mark { display: grid; place-items: center; flex: 0 0 auto; width: 36px; height: 36px; border-radius: 50%; background: var(--ui-accent-soft); color: var(--ui-accent); }
.site-live__stack { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
.site-live__title { margin: 0; font-size: 16px; font-weight: 600; }
.site-live__link { color: var(--ui-accent-strong, var(--ui-accent)); font-size: 14px; font-weight: 600; overflow-wrap: anywhere; }
.site-live__text { margin: 0; font-size: 14px; line-height: 1.45; }
.site-live__btns { display: flex; flex-wrap: wrap; gap: 8px; }
.site-live__btns :deep(.me3-btn) { min-height: 44px; }
.site-live__btns :deep(svg) { margin-right: 6px; }
.site-live__primary { flex: 1; min-width: 160px; }
</style>
