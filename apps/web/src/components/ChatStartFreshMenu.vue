<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import UiIcon from "./UiIcon.vue";

// The Chat header's new-chat button: Start fresh, or open archived chats (kept in Your agent).
defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ startFresh: [] }>();
const open = ref(false);
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);

function close(restoreFocus = false) { open.value = false; if (restoreFocus) void nextTick(() => trigger.value?.focus()); }
async function toggle() {
  if (open.value) { close(true); return; }
  open.value = true;
  await nextTick();
  menu.value?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
}
function keys(event: KeyboardEvent) {
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); return; }
  if (event.key === "Tab") { close(); return; }
  if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
  event.preventDefault();
  const items = [...menu.value!.querySelectorAll<HTMLElement>("[role=menuitem]")];
  const current = items.indexOf(document.activeElement as HTMLElement);
  items[(current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
}
function outside(event: PointerEvent) {
  if (!menu.value?.contains(event.target as Node) && !trigger.value?.contains(event.target as Node)) close();
}
function startFresh() { close(); emit("startFresh"); }
onMounted(() => document.addEventListener("pointerdown", outside));
onBeforeUnmount(() => document.removeEventListener("pointerdown", outside));
</script>

<template>
  <div class="fresh-menu">
    <button ref="trigger" type="button" class="fresh-menu__trigger" aria-label="New chat options" title="New chat options" aria-haspopup="menu" :aria-expanded="open" :disabled="disabled" @click="toggle" @keydown.down.prevent="!open && toggle()">
      <UiIcon name="SquarePen" :size="20" />
    </button>
    <div v-if="open" ref="menu" class="fresh-menu__list" role="menu" aria-label="New chat options" @keydown="keys">
      <button type="button" class="fresh-menu__row" role="menuitem" tabindex="-1" @click="startFresh"><UiIcon name="SquarePen" :size="18" /><span>Start fresh<small>Archives this chat</small></span></button>
      <RouterLink :to="{ path: '/agent', query: { archived: '1' } }" class="fresh-menu__row" role="menuitem" tabindex="-1" @click="close()"><UiIcon name="History" :size="18" /><span>Archived chats</span></RouterLink>
    </div>
  </div>
</template>

<style scoped>
.fresh-menu { position: relative; }
.fresh-menu__trigger { display: grid; place-items: center; width: 44px; height: 44px; border: 0; border-radius: 50%; background: transparent; color: var(--ui-text); cursor: pointer; }
.fresh-menu__trigger:hover, .fresh-menu__trigger[aria-expanded="true"] { background: var(--ui-surface-muted); }
.fresh-menu__trigger:disabled { opacity: .45; cursor: default; background: transparent; }
.fresh-menu__trigger:focus-visible { outline: 2px solid var(--ui-accent); outline-offset: 2px; }
.fresh-menu__list { position: absolute; top: calc(100% + 6px); left: 0; z-index: 100; width: 240px; padding: 6px; box-sizing: border-box; border-radius: 18px; background: var(--ui-surface); color: var(--ui-text); box-shadow: var(--ui-shadow-md); }
.fresh-menu__row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; padding: 8px 12px; box-sizing: border-box; border: 0; border-radius: 12px; color: var(--ui-text); background: transparent; font: 500 15px var(--font-sans); text-decoration: none; text-align: left; cursor: pointer; }
.fresh-menu__row:hover, .fresh-menu__row:focus-visible { background: var(--ui-surface-muted); outline: none; }
.fresh-menu__row > svg, .fresh-menu__row > :first-child { color: var(--ui-text-muted); flex: none; }
.fresh-menu__row span { display: grid; }
.fresh-menu__row small { color: var(--ui-text-muted); font-size: 12px; font-weight: 400; }
</style>
