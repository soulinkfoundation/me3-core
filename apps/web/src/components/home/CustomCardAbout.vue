<script setup lang="ts">
import { computed, ref, watch } from "vue";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import UiIcon from "../UiIcon.vue";
import type { UiIconName } from "../../utils/icons";
import { agentAbilities, dataLine, madeLine, shortDate, type HomeCardRecord } from "../../utils/homeCards";

// About this card: you own it. Where it lives, its data, what it can see and change, what ME3 can do with it,
// its versions (Go back adds a version) and its spec. Change with ME3 and Remove card live here, as on iOS.
const props = defineProps<{ record: HomeCardRecord | null; working?: boolean }>();
const emit = defineEmits<{ close: []; rollback: [version: number]; remove: []; change: [] }>();
const showSpec = ref(false);
const confirmRemove = ref(false);
watch(() => props.record?.card.id, () => { showSpec.value = false; confirmRemove.value = false; });
const rows = computed((): { icon: UiIconName; label: string; value: string }[] => {
  const record = props.record;
  if (!record) return [];
  const sees = record.card.access?.sees ?? [];
  const changes = (record.card.access?.changes ?? []).filter(change => change !== "Its own entries");
  type Row = { icon: UiIconName; label: string; value: string };
  const access: Row[] = sees.length
    ? [{ icon: "Eye", label: "Can see", value: sees.join(", ") }, { icon: "Lock", label: "Can change", value: changes.join(", ") || "Nothing" }]
    : [{ icon: "Lock", label: "Can reach", value: "Nothing else" }];
  return [
    { icon: "House", label: "Lives in", value: "your ME3" },
    { icon: "Folder", label: "Its data", value: dataLine(record) },
    ...access,
    { icon: "Sparkles", label: "ME3 can", value: agentAbilities(record.card) },
  ];
});
const spec = computed(() => {
  const record = props.record;
  if (!record) return "";
  return JSON.stringify(record.surface ?? { name: record.card.name, emoji: record.card.emoji, version: record.card.version, blocks: record.card.blocks }, null, 2);
});
</script>

<template>
  <AppDialog :open="record !== null" aria-label="About this card" close-on-backdrop @close="emit('close')">
    <section v-if="record" class="cc-about">
      <header class="cc-about__bar"><h2>About this card</h2><button type="button" class="cc-about__close" aria-label="Close" @click="emit('close')"><UiIcon name="X" :size="20" /></button></header>
      <div class="cc-about__who"><span class="cc-about__emoji" aria-hidden="true">{{ record.card.emoji }}</span><div><h3>{{ record.card.name }}</h3><p>{{ madeLine(record.card) }}</p></div></div>
      <dl class="cc-about__panel">
        <div v-for="row in rows" :key="row.label" class="cc-about__row"><dt><UiIcon :name="row.icon" :size="18" />{{ row.label }}</dt><dd>{{ row.value }}</dd></div>
      </dl>
      <pre v-if="showSpec" class="cc-about__spec" aria-label="Card spec">{{ spec }}</pre>
      <ol class="cc-about__panel" aria-label="Versions">
        <li v-for="version in record.card.history" :key="version.version" class="cc-about__row">
          <UiIcon :name="version.version === record.card.version ? 'History' : 'Clock'" :size="18" class="cc-about__muted" />
          <span class="cc-about__version"><span>v{{ version.version }} · {{ version.summary }}</span><small>{{ shortDate(version.createdAt) }}</small></span>
          <span v-if="version.version === record.card.version" class="cc-about__muted">Current</span>
          <Button v-else size="small" color="neutral" :disabled="working" :aria-label="`Go back to version ${version.version}`" @click="emit('rollback', version.version)">Go back</Button>
        </li>
      </ol>
      <div class="cc-about__actions">
        <Button color="secondary" @click="showSpec = !showSpec">{{ showSpec ? 'Hide spec' : 'View spec' }}</Button>
        <Button color="primary" @click="emit('change')"><UiIcon name="Sparkles" :size="16" />Change with ME3</Button>
      </div>
      <div v-if="confirmRemove" class="cc-about__confirm" role="alert">
        <p><strong>Remove this card and its data from your ME3?</strong> Ticks and notes go with it. ME3 can make it again later.</p>
        <div class="cc-about__actions"><Button color="secondary" @click="confirmRemove = false">Keep it</Button><Button color="danger" :disabled="working" @click="emit('remove')">Remove card</Button></div>
      </div>
      <button v-else type="button" class="cc-about__remove" :disabled="working" @click="confirmRemove = true">Remove card</button>
    </section>
  </AppDialog>
</template>

<style scoped>
.cc-about { display: grid; gap: 16px; width: min(520px, 100%); max-height: 88dvh; overflow: auto; padding: 20px; border-radius: 28px; background: var(--ui-surface); box-sizing: border-box; box-shadow: var(--ui-shadow-md); }
.cc-about__bar { display: flex; align-items: center; justify-content: space-between; }
.cc-about__bar h2 { margin: 0; font-size: 17px; font-weight: 600; }
.cc-about__close { display: grid; place-items: center; width: 44px; height: 44px; margin-right: -8px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--ui-text); cursor: pointer; }
.cc-about__close:hover { background: var(--ui-surface-muted); }
.cc-about__who { display: flex; align-items: center; gap: 12px; }
.cc-about__who h3 { margin: 0; font-size: 22px; font-weight: 700; }
.cc-about__who p { margin: 2px 0 0; color: var(--ui-text-muted); font-size: 14px; }
.cc-about__emoji { font-size: 36px; line-height: 1; }
.cc-about__panel { display: grid; margin: 0; padding: 4px 12px; border-radius: 18px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); list-style: none; }
.cc-about__row { display: flex; align-items: center; gap: 12px; min-height: 48px; }
.cc-about__row + .cc-about__row { border-top: 1px solid var(--ui-border); }
.cc-about__row dt { display: flex; align-items: center; gap: 12px; font-size: 14.5px; }
.cc-about__row dt :deep(svg) { color: var(--ui-text-muted); }
.cc-about__row dd { margin: 0 0 0 auto; color: var(--ui-text-muted); font-size: 14.5px; text-align: right; }
.cc-about__version { display: grid; flex: 1; gap: 2px; min-width: 0; font-size: 14.5px; }
.cc-about__version small, .cc-about__muted { color: var(--ui-text-muted); font-size: 12.5px; }
.cc-about__spec { margin: 0; padding: 14px; border-radius: 16px; background: var(--ui-surface-muted); font-size: 12.5px; white-space: pre-wrap; overflow-wrap: anywhere; }
.cc-about__actions { display: flex; flex-wrap: wrap; gap: 10px; }
.cc-about__actions > * { flex: 1; }
.cc-about__confirm { display: grid; gap: 10px; padding: 14px; border-radius: 16px; background: var(--ui-surface-muted); }
.cc-about__confirm p { margin: 0; font-size: 14px; }
.cc-about__remove { min-height: 44px; border: 0; border-radius: 12px; background: transparent; color: var(--ui-danger, #dc2626); font: inherit; font-weight: 600; cursor: pointer; }
.cc-about__remove:hover { background: var(--ui-surface-muted); }
button:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 3px; }
@media (max-width: 640px) { .cc-about { width: 100%; border-radius: 28px 28px 0 0; padding: 16px; } }
</style>
