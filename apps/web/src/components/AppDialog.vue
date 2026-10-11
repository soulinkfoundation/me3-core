<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    open: boolean;
    labelledBy?: string;
    describedBy?: string;
    ariaLabel?: string;
    closeOnBackdrop?: boolean;
  }>(),
  {
    closeOnBackdrop: false,
  },
);

const emit = defineEmits<{
  close: [];
}>();

const dialog = ref<HTMLDialogElement | null>(null);
let returnFocusTo: HTMLElement | null = null;

function restoreFocus() {
  const target = returnFocusTo;
  returnFocusTo = null;
  void nextTick(() => {
    if (!target?.isConnected || target.closest("dialog:not([open])")) return;
    target.focus();
  });
}

watch(
  () => props.open,
  async (open) => {
    await nextTick();
    if (open !== props.open) return;
    const element = dialog.value;
    if (!element) return;

    if (open && !element.open) {
      returnFocusTo =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      element.showModal();
      return;
    }

    if (!open && element.open) {
      element.close();
      restoreFocus();
    }
  },
  { immediate: true },
);

function requestClose() {
  emit("close");
}

function handleCancel(event: Event) {
  event.preventDefault();
  requestClose();
}

function handleBackdropClick(event: MouseEvent) {
  if (props.closeOnBackdrop && event.target === dialog.value) requestClose();
}

onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close();
  restoreFocus();
});
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      v-bind="$attrs"
      class="app-dialog"
      :aria-label="ariaLabel"
      :aria-labelledby="labelledBy"
      :aria-describedby="describedBy"
      @cancel="handleCancel"
      @click="handleBackdropClick"
    >
      <slot />
    </dialog>
  </Teleport>
</template>

<style scoped>
.app-dialog {
  box-sizing: border-box;
  width: 100%;
  max-width: none;
  height: 100%;
  max-height: none;
  margin: 0;
  padding: 24px;
  overflow: auto;
  color: var(--ui-text, inherit);
  background: transparent;
  border: 0;
}

.app-dialog[open] {
  display: grid;
  place-items: center;
}

.app-dialog::backdrop {
  background: color-mix(in oklab, #000, transparent 64%);
}

@media (max-width: 640px) {
  .app-dialog[open] {
    align-items: end;
    padding: 0;
  }
}
</style>
