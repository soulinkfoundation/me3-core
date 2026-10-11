<script setup lang="ts">
import { ref, watch } from "vue";
import { api } from "../../api";
import { useAppToast } from "../../composables/useAppToast";

const props = defineProps<{ siteId: string }>();
const { toastFromUnknown } = useAppToast();
const enabled = ref<boolean | null>(null);
const loading = ref(false);
const saving = ref(false);
let requestVersion = 0;

async function load() {
  const version = ++requestVersion;
  enabled.value = null;
  loading.value = true;
  try {
    const result = await api.get<{ enabled: boolean }>(`/sites/${encodeURIComponent(props.siteId)}/booking-reminders`);
    if (version === requestVersion) enabled.value = result.enabled;
  } catch (error) {
    if (version === requestVersion) toastFromUnknown(error, "Booking reminders could not load");
  } finally {
    if (version === requestVersion) loading.value = false;
  }
}

async function toggle(event: Event) {
  const input = event.target as HTMLInputElement;
  const next = input.checked;
  input.checked = enabled.value === true;
  const version = requestVersion;
  saving.value = true;
  try {
    const result = await api.patch<{ enabled: boolean }>(`/sites/${encodeURIComponent(props.siteId)}/booking-reminders`, { enabled: next });
    if (version === requestVersion) enabled.value = result.enabled;
  } catch (error) {
    if (version === requestVersion) toastFromUnknown(error, "Booking reminders could not be saved");
  } finally {
    saving.value = false;
  }
}

watch(() => props.siteId, load, { immediate: true });
</script>

<template>
  <div class="booking-reminders">
    <label class="booking-reminders__label">
      <input type="checkbox" :checked="enabled === true" :disabled="enabled === null || saving" @change="toggle" />
      <span>Booking reminders</span>
    </label>
    <p>Send reminders to you and your guest 24 hours and 2 hours before confirmed bookings. This setting takes effect immediately for this site.</p>
    <button v-if="enabled === null && !loading" type="button" @click="load">Retry loading reminders</button>
  </div>
</template>

<style scoped>
.booking-reminders { display: grid; gap: 4px; margin-top: 16px; color: var(--ui-text); }
.booking-reminders__label { display: flex; align-items: center; gap: 8px; min-height: 44px; font-weight: 600; cursor: pointer; }
.booking-reminders input { accent-color: var(--ui-primary); }
.booking-reminders p { margin: 0; color: var(--ui-text-muted); font-size: 13px; line-height: 1.5; }
.booking-reminders button { justify-self: start; min-height: 44px; background: none; border: 0; color: var(--ui-primary); cursor: pointer; }
</style>
