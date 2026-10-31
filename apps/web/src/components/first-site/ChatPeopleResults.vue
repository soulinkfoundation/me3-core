<script setup lang="ts">
import Button from "../Button.vue";
import { initials, type PersonRow } from "../../utils/firstSite";

/** People the assistant found (core_people_search), as compact rows. A free call books through Chat. */
defineProps<{ people: PersonRow[]; busy?: boolean }>();
const emit = defineEmits<{ book: [person: PersonRow] }>();
</script>

<template>
  <ul class="people-rows" aria-label="People found" data-testid="people-results">
    <li v-for="person in people" :key="person.key" class="people-rows__row">
      <img v-if="person.avatarUrl" :src="person.avatarUrl" alt="" class="people-rows__avatar" loading="lazy" />
      <span v-else class="people-rows__avatar people-rows__avatar--initials" aria-hidden="true">{{ initials(person.name) }}</span>
      <span class="people-rows__who">
        <strong>{{ person.name }}<small v-if="person.self"> · You</small></strong>
        <span class="people-rows__line">{{ [person.freeCall?.title, person.location].filter(Boolean).join(" · ") || person.bio }}</span>
      </span>
      <Button v-if="person.self && person.url" color="ghost" shape="pill" size="small" :href="person.url" target="_blank" rel="noopener noreferrer">Your listing</Button>
      <Button v-else-if="person.freeCall" color="primary" shape="pill" size="small" :disabled="busy" @click="emit('book', person)">Book</Button>
      <Button v-else-if="person.url" color="ghost" shape="pill" size="small" :href="person.url" target="_blank" rel="noopener noreferrer">View</Button>
    </li>
  </ul>
</template>

<style scoped>
.people-rows { display: flex; flex-direction: column; box-sizing: border-box; width: min(560px, 100%); margin: 0; padding: 4px 0; list-style: none; border-radius: 20px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
.people-rows__row { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 6px 12px 6px 14px; }
.people-rows__row + .people-rows__row { box-shadow: inset 0 1px 0 var(--ui-border); }
.people-rows__avatar { flex: 0 0 auto; width: 40px; height: 40px; border-radius: 50%; object-fit: cover; }
.people-rows__avatar--initials { display: grid; place-items: center; background: var(--ui-accent-soft); color: var(--ui-accent-strong, var(--ui-accent)); font-size: 14px; font-weight: 700; }
.people-rows__who { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.people-rows__who strong { overflow: hidden; font-size: 15px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.people-rows__who small { color: var(--ui-text-muted); font-size: 13px; font-weight: 500; }
.people-rows__line { overflow: hidden; color: var(--ui-text-muted); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
</style>
