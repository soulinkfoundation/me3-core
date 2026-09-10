<script setup lang="ts">
import type { LandingPageEvent } from '@me3-core/plugin-landing-pages';
const props = defineProps<{ modelValue?: LandingPageEvent }>();
const emit = defineEmits<{ 'update:modelValue': [value: LandingPageEvent | undefined] }>();
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
function enable(event: Event) {
  emit('update:modelValue', (event.target as HTMLInputElement).checked
    ? { startDate: '', timezone, location: { type: 'place', name: '', address: '' } } : undefined);
}
function localTime(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return '';
  const date = new Date(value);
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function setDate(key: 'startDate' | 'endDate', event: Event) {
  if (!props.modelValue) return;
  const value = (event.target as HTMLInputElement).value;
  emit('update:modelValue', { ...props.modelValue, timezone, [key]: value ? new Date(value).toISOString().replace('.000Z', 'Z') : key === 'startDate' ? '' : undefined });
}
function setLocationType(event: Event) {
  if (!props.modelValue) return;
  emit('update:modelValue', { ...props.modelValue, location: (event.target as HTMLSelectElement).value === 'online' ? { type: 'online', url: '' } : { type: 'place', name: '', address: '' } });
}
function setLocation(key: 'name' | 'address' | 'url', event: Event) {
  if (!props.modelValue) return;
  emit('update:modelValue', { ...props.modelValue, location: { ...props.modelValue.location, [key]: (event.target as HTMLInputElement).value } });
}
</script>

<template>
  <fieldset class="event-fields">
    <legend>Event details</legend>
    <label class="event-toggle"><input type="checkbox" :checked="!!modelValue" @change="enable" /> This page is for a scheduled event</label>
    <template v-if="modelValue">
      <p>These details appear on the page and help search engines understand the event. Times use {{ timezone }}.</p>
      <div class="event-dates">
        <label>Starts<input type="datetime-local" :value="localTime(modelValue.startDate)" required @input="setDate('startDate', $event)" /></label>
        <label>Ends (optional)<input type="datetime-local" :value="localTime(modelValue.endDate)" :min="localTime(modelValue.startDate)" @input="setDate('endDate', $event)" /></label>
      </div>
      <label>Location<select :value="modelValue.location.type" @change="setLocationType"><option value="place">In person</option><option value="online">Online</option></select></label>
      <template v-if="modelValue.location.type === 'place'">
        <label>Venue name<input :value="modelValue.location.name" required @input="setLocation('name', $event)" /></label>
        <label>Venue address<input :value="modelValue.location.address" required @input="setLocation('address', $event)" /></label>
      </template>
      <label v-else>Public event information URL<input type="url" :value="modelValue.location.url" required @input="setLocation('url', $event)" /></label>
    </template>
  </fieldset>
</template>

<style scoped>
.event-fields{display:grid;gap:12px;margin:16px 0;padding:16px;border:1px solid var(--ui-border);border-radius:var(--ui-radius-md);min-width:0;color:var(--ui-text)}
legend{font-weight:600}label{display:grid;gap:6px;font-size:14px}.event-toggle{display:flex;align-items:center;gap:8px}.event-toggle input{width:auto}p{margin:0;color:var(--ui-text-muted);font-size:13px;line-height:1.5}.event-dates{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}input,select{width:100%;min-width:0;box-sizing:border-box;font:inherit;padding:10px;border:1px solid var(--ui-border);border-radius:var(--ui-radius-sm);background:var(--ui-surface);color:var(--ui-text)}input:focus-visible,select:focus-visible{outline:2px solid var(--ui-focus);outline-offset:2px}@media(max-width:600px){.event-dates{grid-template-columns:1fr}}
</style>
