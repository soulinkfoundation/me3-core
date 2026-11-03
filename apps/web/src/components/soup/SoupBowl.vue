<script setup lang="ts">
import { computed, ref } from "vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import { soupActionIcon, soupActionLabel, soupHadIt, soupPick, type SoupServing, type SoupServingAction } from "../../utils/soup";

// One pick from The Human Soup: the picture, the title and who made it, ME3's for-you line,
// and Soup's own summary and quote behind "More". Listen/Watch/Read opens the original.
const props = defineProps<{ serving: SoupServing; busy?: boolean; compact?: boolean }>();
const emit = defineEmits<{ act: [action: SoupServingAction, itemId: string] }>();
const open = ref(false);
const main = computed(() => soupPick(props.serving).pick);
const alternates = computed(() => soupPick(props.serving).also);
const had = computed(() => main.value ? soupHadIt(main.value) : false);
const rated = computed(() => main.value ? ["liked", "disliked"].includes(main.value.state) : false);
</script>

<template>
  <div v-if="main" class="soup-bowl" :class="{ 'soup-bowl--compact': compact }">
    <a class="soup-bowl__pic" :href="main.url" target="_blank" rel="noopener noreferrer" :aria-label="`${soupActionLabel(main.medium)} ${main.title}`" @click="emit('act', 'open', main.id)">
      <img v-if="main.thumbnailUrl" :src="main.thumbnailUrl" alt="" loading="lazy" />
      <span v-else class="soup-bowl__pic-empty" aria-hidden="true"><UiIcon :name="soupActionIcon(main.medium)" :size="28" /></span>
      <span v-if="main.minutes" class="soup-bowl__len"><UiIcon :name="soupActionIcon(main.medium)" :size="12" />{{ main.minutes }} min</span>
    </a>
    <div class="soup-bowl__text">
      <span class="soup-bowl__title">{{ main.title }}</span>
      <span class="soup-bowl__by">{{ main.creator }}<template v-if="main.soupTitle"> · {{ main.soupTitle }}</template></span>
    </div>
    <p v-if="main.forYou" class="soup-foryou">{{ main.forYou }}</p>
    <template v-if="open">
      <p v-if="main.summary" class="soup-bowl__sum">{{ main.summary }}</p>
      <p v-if="main.quote" class="soup-bowl__quote">“{{ main.quote.text }}”<template v-if="main.quote.by"> {{ main.quote.by }}</template></p>
    </template>
    <div class="soup-bowl__acts">
      <template v-if="had">
        <span class="soup-bowl__after">{{ rated ? 'Noted.' : 'Enjoyed it?' }}</span>
        <template v-if="!rated">
          <Button color="secondary" size="small" shape="pill" :disabled="busy" aria-label="More like this" @click="emit('act', 'like', main.id)">👍</Button>
          <Button color="secondary" size="small" shape="pill" :disabled="busy" aria-label="Less like this" @click="emit('act', 'dislike', main.id)">👎</Button>
        </template>
      </template>
      <template v-else>
        <Button color="neutral" shape="pill" size="compact" :href="main.url" target="_blank" rel="noopener noreferrer" @click="emit('act', 'open', main.id)"><template #icon><UiIcon :name="soupActionIcon(main.medium)" :size="16" /></template>{{ soupActionLabel(main.medium) }}</Button>
        <Button v-if="main.state === 'opened'" color="secondary" shape="pill" size="compact" :disabled="busy" @click="emit('act', 'finish', main.id)">Done</Button>
        <Button v-else color="secondary" shape="pill" size="compact" :disabled="busy || main.state === 'later'" @click="emit('act', 'later', main.id)">{{ main.state === 'later' ? 'Kept for tomorrow' : 'Later' }}</Button>
      </template>
      <button type="button" class="soup-link" :aria-expanded="open" @click="open = !open">{{ open ? 'Less' : 'More' }}</button>
    </div>
    <div v-if="alternates.length && !compact" class="soup-also" aria-label="Also good">
      <a v-for="item in alternates" :key="item.id" :href="item.url" target="_blank" rel="noopener noreferrer" class="soup-also__row" @click="emit('act', 'open', item.id)">
        <img v-if="item.thumbnailUrl" :src="item.thumbnailUrl" alt="" loading="lazy" />
        <span v-else class="soup-also__pic-empty" aria-hidden="true"><UiIcon :name="soupActionIcon(item.medium)" :size="16" /></span>
        <span class="soup-also__text"><span class="soup-also__title">{{ item.title }}</span><span class="soup-also__sub">{{ [item.minutes ? `${item.minutes} min` : '', item.creator].filter(Boolean).join(' · ') }}</span></span>
      </a>
    </div>
  </div>
</template>

<style scoped>
.soup-bowl { display: flex; flex-direction: column; gap: 10px; text-align: left; color: var(--ui-text); }
.soup-bowl__pic { position: relative; display: block; overflow: hidden; aspect-ratio: 16 / 9; border-radius: 18px; background: var(--ui-surface-muted); }
.soup-bowl__pic img { display: block; width: 100%; height: 100%; object-fit: cover; }
.soup-bowl__pic-empty { display: grid; place-items: center; width: 100%; height: 100%; color: var(--ui-text-muted); }
.soup-bowl__len { position: absolute; right: 8px; bottom: 8px; display: flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 999px; background: rgba(0, 0, 0, .66); color: #fff; font-size: 12px; font-weight: 600; }
.soup-bowl__text { display: flex; flex-direction: column; gap: 2px; }
.soup-bowl__title { font-size: 17px; font-weight: 650; line-height: 1.3; letter-spacing: -.01em; }
.soup-bowl__by { font-size: 13px; color: var(--ui-text-muted); }
/* ME3's own line: why this is for *you*. Subtle, never coloured. */
.soup-foryou { margin: 0; font-size: 13.5px; line-height: 1.4; color: var(--ui-text-muted); }
.soup-bowl__sum { margin: 0; font-size: 14.5px; line-height: 1.45; color: var(--ui-text-muted); }
.soup-bowl__quote { margin: 0; padding-left: 10px; box-shadow: inset 2px 0 0 var(--ui-border); font-family: var(--font-serif, ui-serif, 'New York', Georgia, serif); font-size: 14px; line-height: 1.4; color: var(--ui-text-muted); }
.soup-bowl__acts { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.soup-bowl__after { font-size: 13px; color: var(--ui-text-muted); }
.soup-link { margin-left: auto; min-height: 36px; padding: 0 4px; border: 0; background: transparent; color: var(--ui-text-muted); font: inherit; font-size: 14px; cursor: pointer; }
.soup-link:hover { color: var(--ui-text); }
.soup-link:focus-visible { outline: 2px solid var(--ui-focus); outline-offset: 2px; border-radius: 6px; }
.soup-also { display: flex; flex-direction: column; margin-top: 2px; }
.soup-also__row { display: flex; align-items: center; gap: 10px; padding: 8px 0; color: inherit; text-decoration: none; box-shadow: inset 0 -1px 0 var(--ui-border); }
.soup-also__row:last-child { box-shadow: none; }
.soup-also__row img, .soup-also__pic-empty { flex: none; width: 84px; height: 48px; border-radius: 10px; object-fit: cover; background: var(--ui-surface-muted); }
.soup-also__pic-empty { display: grid; place-items: center; color: var(--ui-text-muted); }
.soup-also__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.soup-also__title { font-size: 14px; font-weight: 600; line-height: 1.3; }
.soup-also__sub { font-size: 13px; color: var(--ui-text-muted); }
.soup-bowl--compact .soup-bowl__title { font-size: 16px; }
</style>
