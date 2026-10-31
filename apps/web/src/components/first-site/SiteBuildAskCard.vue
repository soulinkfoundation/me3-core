<script setup lang="ts">
import { computed, onMounted, ref, useId } from "vue";
import Button from "../Button.vue";
import { siteBuildMessage } from "../../utils/firstSite";

/** "Build your website": the owner describes their work and ME3 drafts the site from it (iOS AssistantSiteCards). */
defineProps<{ busy?: boolean }>();
const emit = defineEmits<{ submit: [message: string]; close: [] }>();
const titleId = useId();
const work = ref("");
const links = ref("");
const workField = ref<HTMLTextAreaElement | null>(null);
const ready = computed(() => work.value.trim().length > 0);

function submit() {
  if (!ready.value) return;
  emit("submit", siteBuildMessage(work.value, links.value));
}
onMounted(() => workField.value?.focus());
</script>

<template>
  <section class="site-ask" :aria-labelledby="titleId" data-testid="site-build-ask">
    <h3 :id="titleId" class="site-ask__title">Let's build your website</h3>
    <p class="site-ask__intro">Tell me a bit about your work: what you do, who it's for, and where and how it happens. I'll draft your site and you can change anything before it goes live.</p>
    <form class="site-ask__form" @submit.prevent="submit">
      <label class="site-ask__field">
        <span>About your work</span>
        <textarea ref="workField" v-model="work" rows="4" placeholder="I'm a yoga teacher in Bristol. Small group classes and 1:1 sessions for beginners and people coming back from injury." @keydown.enter.meta.prevent="submit" @keydown.enter.ctrl.prevent="submit" />
      </label>
      <label class="site-ask__field">
        <span>Your website or social links (optional)</span>
        <input v-model="links" type="text" inputmode="url" autocomplete="url" placeholder="yoursite.com" />
      </label>
      <div class="site-ask__actions">
        <Button color="ghost" shape="soft" type="button" :disabled="busy" @click="emit('close')">Not now</Button>
        <Button class="site-ask__primary" color="primary" shape="soft" type="submit" :disabled="!ready || busy">Draft my site</Button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.site-ask { display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; width: min(560px, 100%); padding: 16px; border-radius: 20px; background: var(--ui-surface); color: var(--ui-text); box-shadow: var(--ui-shadow-sm); }
.site-ask__title { margin: 0; font-size: 17px; font-weight: 600; }
.site-ask__intro { margin: 0; color: var(--ui-text-muted); font-size: 14px; line-height: 1.45; }
.site-ask__form { display: flex; width: 100%; flex-direction: column; gap: 12px; }
.site-ask__field { display: flex; width: 100%; flex-direction: column; gap: 6px; font-size: 13px; color: var(--ui-text-muted); }
.site-ask__field textarea, .site-ask__field input { box-sizing: border-box; width: 100%; padding: 10px 12px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-md); background: var(--ui-bg); color: var(--ui-text); font: inherit; font-size: 15px; line-height: 1.45; resize: vertical; }
.site-ask__field textarea:focus, .site-ask__field input:focus { outline: 2px solid var(--ui-accent); outline-offset: 1px; }
.site-ask__actions { display: flex; gap: 8px; }
.site-ask__actions :deep(.me3-btn) { min-height: 44px; }
.site-ask__primary { flex: 1; }
</style>
