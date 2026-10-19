<script setup lang="ts">
defineProps<{ modelValue: boolean; label: string; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
</script>

<template>
  <!-- One on/off control, shaped like the iOS switch, for settings rows. -->
  <button
    type="button"
    class="app-switch"
    role="switch"
    :aria-label="label"
    :aria-checked="modelValue"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  >
    <i />
  </button>
</template>

<style scoped>
.app-switch { position: relative; flex-shrink: 0; width: 50px; height: 44px; padding: 7px 0; border: 0; background: transparent; cursor: pointer; }
.app-switch::before { content: ""; position: absolute; inset: 7px 0; border-radius: 18px; background: var(--ui-border-strong); transition: background .15s; }
.app-switch i { position: relative; display: block; width: 26px; height: 26px; margin-left: 2px; border-radius: 50%; background: var(--ui-surface); box-shadow: 0 1px 3px rgb(0 0 0 / 20%); transition: margin-left .15s; }
.app-switch[aria-checked="true"]::before { background: var(--ui-primary); }
.app-switch[aria-checked="true"] i { margin-left: 22px; background: var(--ui-primary-contrast); }
.app-switch:disabled { opacity: .5; cursor: default; }
.app-switch:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; border-radius: 18px; }
</style>
