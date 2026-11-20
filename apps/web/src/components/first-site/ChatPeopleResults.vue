<script setup lang="ts">
import Button from "../Button.vue";
import { initials, type PersonRow } from "../../utils/firstSite";

/**
 * People the assistant found (core_people_search), one compact card each: photo or initials, name, town, the
 * free call and starting price, and one action. A free call books through Chat; everyone else opens their site.
 * No banner, so a long list stays light.
 */
defineProps<{ people: PersonRow[]; busy?: boolean }>();
const emit = defineEmits<{ book: [person: PersonRow] }>();
</script>

<template>
  <ul class="people-cards" aria-label="People found" data-testid="people-results">
    <li v-for="person in people" :key="person.key" class="people-cards__card">
      <img v-if="person.avatarUrl" :src="person.avatarUrl" alt="" class="people-cards__avatar" loading="lazy" />
      <span v-else class="people-cards__avatar people-cards__avatar--initials" aria-hidden="true">{{ initials(person.name) }}</span>
      <span class="people-cards__who">
        <strong><span class="people-cards__name">{{ person.name }}</span><small v-if="person.self">You</small></strong>
        <span v-if="person.place" class="people-cards__place">{{ person.place }}</span>
        <span v-if="person.offer" class="people-cards__offer">{{ person.offer }}</span>
        <span v-if="!person.place && !person.offer" class="people-cards__place">On ME3</span>
      </span>
      <Button v-if="person.freeCall && !person.self" color="primary" shape="pill" size="small" :disabled="busy" @click="emit('book', person)">Book</Button>
      <Button v-else-if="person.url" color="primary" shape="pill" size="small" :href="person.url" target="_blank" rel="noopener noreferrer">Open</Button>
    </li>
  </ul>
</template>

<style scoped>
.people-cards { display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; width: min(560px, 100%); margin: 0; padding: 0; list-style: none; }
.people-cards__card { display: flex; align-items: center; gap: 12px; padding: 12px 12px 12px 14px; border-radius: 18px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm), 0 0 0 1px var(--ui-border); }
.people-cards__avatar { flex: 0 0 auto; width: 48px; height: 48px; border-radius: 50%; object-fit: cover; }
.people-cards__avatar--initials { display: grid; place-items: center; background: var(--ui-accent-soft); color: var(--ui-accent-strong, var(--ui-accent)); font-size: 16px; font-weight: 600; }
.people-cards__who { display: flex; flex: 1; flex-direction: column; gap: 1px; min-width: 0; }
.people-cards__who strong { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 16px; font-weight: 700; }
.people-cards__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.people-cards__who small { flex: none; padding: 1px 6px; border-radius: 6px; background: var(--ui-accent-soft); color: var(--ui-accent-strong, var(--ui-accent)); font-size: 12px; font-weight: 600; }
.people-cards__place, .people-cards__offer { overflow: hidden; font-size: 13.5px; text-overflow: ellipsis; white-space: nowrap; }
.people-cards__place { color: var(--ui-text-muted); }
.people-cards__offer { margin-top: 3px; color: var(--ui-text); font-weight: 500; }
</style>
