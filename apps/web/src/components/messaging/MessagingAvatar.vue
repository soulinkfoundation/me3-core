<script setup lang="ts">
import { computed } from "vue";
import type { MessagingPerson } from "../../utils/messagingCards";

const props = withDefaults(defineProps<{ person: Pick<MessagingPerson, "name" | "imageUrl">; size?: number }>(), { size: 36 });
const initials = computed(() =>
  props.person.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "?",
);
</script>

<template>
  <span class="messaging-avatar" :style="{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px` }" aria-hidden="true">
    <img v-if="person.imageUrl" :src="person.imageUrl" alt="" loading="lazy" />
    <span v-else>{{ initials }}</span>
  </span>
</template>

<style scoped>
.messaging-avatar {
  display: inline-grid;
  flex: none;
  place-items: center;
  overflow: hidden;
  border-radius: 999px;
  background: var(--ui-accent-soft);
  color: var(--ui-accent-strong);
  font-weight: 600;
}

.messaging-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
