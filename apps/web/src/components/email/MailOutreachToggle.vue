<script setup lang="ts">
// Compose footer: "Track as outreach". Sending with it on makes the people the
// email is To prospects in People, with what was offered and a follow-up date.
export type ComposeOutreach = { on: boolean; followUpDays: number; offer: string };

const model = defineModel<ComposeOutreach>({ required: true });

const FOLLOW_UP_OPTIONS = [3, 7, 14, 30];

function patch(change: Partial<ComposeOutreach>) {
  model.value = { ...model.value, ...change };
}
</script>

<template>
  <div class="compose-outreach" :class="{ 'compose-outreach--on': model.on }">
    <button
      type="button"
      class="compose-outreach__switch"
      role="switch"
      :aria-checked="model.on"
      aria-label="Track as outreach"
      @click="patch({ on: !model.on })"
    >
      <span class="compose-outreach__knob" aria-hidden="true" />
    </button>
    <span v-if="!model.on" class="compose-outreach__label" @click="patch({ on: true })">Track as outreach</span>
    <template v-else>
      <span class="compose-outreach__label">Outreach · follow up in</span>
      <select
        class="compose-outreach__pill"
        aria-label="Follow up in"
        :value="model.followUpDays"
        @change="patch({ followUpDays: Number(($event.target as HTMLSelectElement).value) })"
      >
        <option v-for="days in FOLLOW_UP_OPTIONS" :key="days" :value="days">{{ days }} days</option>
      </select>
      <span class="compose-outreach__label">· offered</span>
      <input
        class="compose-outreach__pill compose-outreach__offer"
        type="text"
        aria-label="What you offered"
        placeholder="e.g. member discount"
        maxlength="200"
        :value="model.offer"
        @input="patch({ offer: ($event.target as HTMLInputElement).value })"
      />
    </template>
  </div>
</template>

<style scoped>
.compose-outreach {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  color: var(--ui-text-muted);
  font-size: 13px;
}

.compose-outreach__switch {
  position: relative;
  flex: none;
  width: 32px;
  height: 18px;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: var(--ui-border-strong);
  cursor: pointer;
}

.compose-outreach--on .compose-outreach__switch {
  background: var(--ui-accent);
}

.compose-outreach__knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s ease;
}

.compose-outreach--on .compose-outreach__knob {
  transform: translateX(14px);
}

.compose-outreach__label {
  cursor: default;
}

.compose-outreach__pill {
  min-height: 28px;
  padding: 2px 8px;
  border: 1px solid var(--ui-border);
  border-radius: 999px;
  background: var(--ui-surface);
  color: var(--ui-text);
  font: inherit;
  font-size: 13px;
}

.compose-outreach__offer {
  flex: 1 1 140px;
  min-width: 0;
  max-width: 260px;
}

.compose-outreach__switch:focus-visible,
.compose-outreach__pill:focus-visible {
  outline: 2px solid var(--ui-accent);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .compose-outreach__knob {
    transition: none;
  }
}
</style>
