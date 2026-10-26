<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { mailInitials } from "./brief";
import { proxiedAvatarUrl } from "../../utils/avatarUrl";

/** Contact photo or brand logo served by the Worker, otherwise initials from the display name. */
const props = withDefaults(defineProps<{ name: string; avatarUrl?: string | null; size?: number }>(), {
  avatarUrl: null,
  size: 40,
});
const failed = ref(false);
watch(() => props.avatarUrl, () => { failed.value = false; });
const initials = computed(() => mailInitials(props.name));
const src = computed(() => proxiedAvatarUrl(props.avatarUrl));
const showImage = computed(() => Boolean(src.value) && !failed.value);
</script>

<template>
  <span
    class="mail-avatar"
    :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.36)}px` }"
    aria-hidden="true"
  >
    <img v-if="showImage" :src="src || undefined" alt="" loading="lazy" referrerpolicy="no-referrer" @error="failed = true" />
    <template v-else>{{ initials }}</template>
  </span>
</template>

<style scoped>
.mail-avatar {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: var(--ui-accent-soft, #dcefe9);
  color: var(--ui-accent-strong, var(--ui-accent, #1c7d60));
  font-weight: 650;
  overflow: hidden;
}

.mail-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
