<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { Contact } from "../../stores/contacts";
import { avatarUrl, initials, isSoulinkPerson } from "../../utils/people";

const props = withDefaults(defineProps<{ contact: Contact; size?: number }>(), { size: 36 });

const failed = ref(false);
const photo = computed(() => (failed.value ? null : avatarUrl(props.contact)));
const badgeSize = computed(() => Math.max(13, Math.round(props.size * 0.34)));
watch(() => avatarUrl(props.contact), () => { failed.value = false; });
</script>

<template>
  <span class="person-avatar" :style="{ width: `${size}px`, height: `${size}px` }">
    <img
      v-if="photo"
      class="person-avatar__photo"
      :src="photo"
      alt=""
      :width="size"
      :height="size"
      @error="failed = true"
    />
    <span
      v-else
      class="person-avatar__initials"
      :style="{ fontSize: `${Math.round(size * 0.36)}px` }"
      aria-hidden="true"
    >{{ initials(contact.name) }}</span>
    <img
      v-if="isSoulinkPerson(contact)"
      class="person-avatar__badge"
      src="/images/soulink-icon.png"
      alt="On Soulink"
      :width="badgeSize"
      :height="badgeSize"
    />
  </span>
</template>

<style scoped>
.person-avatar {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}

.person-avatar__photo,
.person-avatar__initials {
  width: 100%;
  height: 100%;
  border-radius: 50%;
}

.person-avatar__photo {
  object-fit: cover;
}

.person-avatar__initials {
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-muted);
  color: var(--ui-text-muted);
  font-weight: 600;
  letter-spacing: 0.01em;
}

.person-avatar__badge {
  position: absolute;
  right: -2px;
  bottom: -2px;
  border-radius: 30%;
  box-shadow: 0 0 0 2px var(--ui-bg, var(--color-bg));
}
</style>
