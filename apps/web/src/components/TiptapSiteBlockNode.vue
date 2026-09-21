<script setup lang="ts">
import { computed } from "vue";
import { NodeViewWrapper } from "@tiptap/vue-3";
import UiIcon from "./UiIcon.vue";

const props = defineProps<{
  node: any;
  deleteNode: () => void;
}>();

const blockType = computed<"newsletter" | "testimonials" | "booking">(() => {
  const value = props.node?.attrs?.blockType;
  return value === "testimonials" || value === "booking"
    ? value
    : "newsletter";
});

const title = computed(() =>
  blockType.value === "newsletter"
    ? "Newsletter signup"
    : blockType.value === "testimonials"
      ? "Testimonials"
      : "Booking widget",
);

const description = computed(() =>
  blockType.value === "newsletter"
    ? "Uses the newsletter title, description, and subscriber form from your site settings."
    : blockType.value === "testimonials"
      ? "Uses the testimonial collection and title from your site settings."
      : "Uses your booking offers, schedule, and booking form from site settings.",
);
</script>

<template>
  <NodeViewWrapper class="site-block-node" contenteditable="false">
    <span class="site-block-icon" aria-hidden="true">
      <UiIcon
        :name="blockType === 'newsletter' ? 'Mail' : blockType === 'testimonials' ? 'MessageSquare' : 'Calendar'"
        :size="18"
      />
    </span>
    <span class="site-block-copy">
      <strong>{{ title }}</strong>
      <span>{{ description }}</span>
    </span>
    <button
      class="site-block-remove"
      type="button"
      :aria-label="`Remove ${title.toLowerCase()} block`"
      :title="`Remove ${title.toLowerCase()} block`"
      @click="deleteNode"
    >
      <UiIcon name="Trash2" :size="15" aria-hidden="true" />
    </button>
  </NodeViewWrapper>
</template>

<style scoped>
.site-block-node {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-md, 12px);
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  color: var(--ui-text, var(--color-text));
}

.site-block-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-accent-soft, var(--color-bg-muted));
  color: var(--ui-accent-strong, var(--color-primary));
}

.site-block-copy {
  display: grid;
  gap: 2px;
  min-width: 0;
}

.site-block-copy strong {
  font-size: 14px;
}

.site-block-copy span {
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
  line-height: 1.4;
}

.site-block-remove {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: var(--ui-radius-sm, 8px);
  background: transparent;
  color: var(--ui-text-muted, var(--color-text-muted));
  cursor: pointer;
}

.site-block-remove:hover,
.site-block-remove:focus-visible {
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
}

.site-block-remove:focus-visible {
  outline: 2px solid var(--ui-accent, var(--color-primary));
  outline-offset: 2px;
}
</style>
