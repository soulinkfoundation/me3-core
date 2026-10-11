<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import type { RouteLocationRaw } from "vue-router";

export type ButtonColor =
  | "primary"
  | "secondary"
  | "accent"
  | "neutral"
  | "outline"
  | "ghost"
  | "danger"
  | "warning";
export type ButtonTone = "green" | "black" | "red" | "orange" | "outline";
export type ButtonVariant = "primary" | "secondary" | "outline";
export type ButtonSize = "small" | "compact" | "medium" | "large";
export type ButtonShape = "pill" | "soft";

const legacyToneColor: Record<ButtonTone, ButtonColor> = {
  green: "primary",
  black: "neutral",
  red: "danger",
  orange: "warning",
  outline: "outline",
};

const legacyVariantColor: Record<ButtonVariant, ButtonColor> = {
  primary: "primary",
  secondary: "secondary",
  outline: "outline",
};

const props = withDefaults(
  defineProps<{
    /** Semantic color. Prefer this over legacy `tone`/`variant`. */
    color?: ButtonColor;
    /** Legacy color tone. Takes precedence over `variant` when `color` is omitted. */
    tone?: ButtonTone;
    /** Legacy variant API; maps to a tone when `tone` is omitted. */
    variant?: ButtonVariant;
    size?: ButtonSize;
    shape?: ButtonShape;
    iconOnly?: boolean;
    active?: boolean;
    ariaLabel?: string;
    title?: string;
    /** When set, renders as `RouterLink`. */
    to?: RouteLocationRaw;
    /** When set (and `to` is not), renders as `<a>`. */
    href?: string;
    type?: "button" | "submit" | "reset";
    disabled?: boolean;
  }>(),
  {
    variant: "outline",
    size: "medium",
    shape: "pill",
    iconOnly: false,
    active: false,
    type: "button",
  },
);

const resolvedColor = computed<ButtonColor>(() => {
  if (props.color !== undefined) return props.color;
  if (props.tone !== undefined) return legacyToneColor[props.tone];
  return legacyVariantColor[props.variant];
});

const root = computed(() => {
  if (props.to !== undefined) return RouterLink;
  if (props.href !== undefined) return "a";
  return "button";
});

const rootAttrs = computed(() => {
  const sharedAttrs = {
    title: props.title,
    "aria-label": props.ariaLabel,
  };
  if (props.to !== undefined) return { ...sharedAttrs, to: props.to };
  if (props.href !== undefined) return { ...sharedAttrs, href: props.href };
  return {
    ...sharedAttrs,
    type: props.type,
    disabled: props.disabled,
  };
});

const rootClass = computed(() => [
  "me3-btn",
  `me3-btn--${resolvedColor.value}`,
  `me3-btn--${props.size}`,
  `me3-btn--${props.shape}`,
  {
    "me3-btn--icon-only": props.iconOnly,
    "me3-btn--active": props.active,
  },
]);
</script>

<template>
  <component :is="root" :class="rootClass" v-bind="rootAttrs">
    <span v-if="$slots.icon || iconOnly" class="me3-btn__icon">
      <slot name="icon">
        <slot />
      </slot>
    </span>
    <span v-if="!iconOnly && $slots.default" class="me3-btn__label">
      <slot />
    </span>
  </component>
</template>

<style scoped>
.me3-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  font-family: inherit;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
  border-style: solid;
  border-width: 1px;
  border-color: transparent;
  white-space: nowrap;
}

button.me3-btn {
  appearance: none;
}

.me3-btn:focus-visible {
  outline: 2px solid var(--ui-primary, var(--ui-accent, var(--color-text)));
  outline-offset: 2px;
}

.me3-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.me3-btn__icon {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  line-height: 0;
}

.me3-btn__emoji {
  font-size: 1.125em;
  line-height: 1;
  font-family:
    "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
}

:slotted(.me3-btn__emoji) {
  font-size: 1.125em;
  line-height: 1;
  font-family:
    "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
}

.me3-btn__label {
  line-height: 1.15;
}

/* --- colors --- */

.me3-btn--primary {
  background: var(--ui-primary, var(--ui-accent, var(--color-accent)));
  border-color: var(--ui-primary, var(--ui-accent, var(--color-accent)));
  color: var(--ui-primary-contrast, var(--ui-accent-contrast, #fff));
}

.me3-btn--primary:hover:not(:disabled),
.me3-btn--primary.me3-btn--active {
  background: var(
    --ui-primary-strong,
    var(--ui-accent-strong, var(--color-accent))
  );
  border-color: var(
    --ui-primary-strong,
    var(--ui-accent-strong, var(--color-accent))
  );
  color: var(--ui-primary-contrast, var(--ui-accent-contrast, #fff));
}

.me3-btn--primary .me3-btn__icon,
.me3-btn--accent .me3-btn__icon {
  color: inherit;
}

.me3-btn--secondary {
  background: var(--ui-secondary, var(--ui-surface-muted, var(--color-border)));
  border-color: transparent;
  color: var(--ui-secondary-contrast, var(--ui-text, var(--color-text)));
}

.me3-btn--secondary:hover:not(:disabled),
.me3-btn--secondary.me3-btn--active {
  background: var(
    --ui-secondary-strong,
    var(--ui-border, var(--color-text-muted))
  );
  color: var(--ui-secondary-contrast, var(--ui-text, var(--color-text)));
}

.me3-btn--accent {
  background: var(--ui-accent-soft, var(--color-bg-subtle));
  border-color: transparent;
  color: var(--ui-accent, var(--color-accent));
}

.me3-btn--accent:hover:not(:disabled),
.me3-btn--accent.me3-btn--active {
  background: var(--ui-accent, var(--color-accent));
  border-color: var(--ui-accent, var(--color-accent));
  color: var(--ui-accent-contrast, #fff);
}

.me3-btn--neutral {
  background: var(--ui-text, var(--color-text));
  border-color: var(--ui-text, var(--color-text));
  color: var(--ui-bg, var(--color-bg));
}

.me3-btn--neutral:hover:not(:disabled),
.me3-btn--neutral.me3-btn--active {
  opacity: 0.9;
}

.me3-btn--danger {
  background: #dc2626;
  border-color: #dc2626;
  color: #fff;
}

.me3-btn--danger:hover:not(:disabled),
.me3-btn--danger.me3-btn--active {
  background: #b91c1c;
  border-color: #b91c1c;
}

.me3-btn--warning {
  background: #ea580c;
  border-color: #ea580c;
  color: #fff;
}

.me3-btn--warning:hover:not(:disabled),
.me3-btn--warning.me3-btn--active {
  background: #c2410c;
  border-color: #c2410c;
}

.me3-btn--outline {
  background: transparent;
  border-color: var(--ui-border, var(--color-border));
  color: var(--ui-text, var(--color-text));
}

.me3-btn--outline:not(.me3-btn--icon-only) {
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text-muted, var(--color-text-muted));
}

.me3-btn--outline:hover:not(:disabled) {
  border-color: color-mix(
    in oklab,
    var(--ui-accent, var(--color-accent)) 40%,
    var(--ui-border, var(--color-border))
  );
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  color: var(--ui-text, var(--color-text));
}

.me3-btn--ghost {
  background: transparent;
  border-color: transparent;
  color: var(--ui-text-muted, var(--color-text-muted));
}

.me3-btn--ghost:hover:not(:disabled),
.me3-btn--ghost.me3-btn--active {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  color: var(--ui-text, var(--color-text));
}

/* --- shapes --- */

.me3-btn--pill {
  border-radius: 999px;
}

.me3-btn--soft {
  border-radius: var(--ui-radius-md, 8px);
}

/* --- sizes --- */

.me3-btn--small {
  gap: 6px;
  min-height: 30px;
  padding: 0 9px;
  font-size: 12px;
}

.me3-btn--compact {
  gap: 7px;
  min-height: 34px;
  padding: 0 10px;
  font-size: 13px;
}

.me3-btn--medium {
  gap: 7px;
  min-height: 36px;
  padding: 0 12px;
  font-size: 13px;
}

.me3-btn--large {
  gap: 8px;
  min-height: 38px;
  padding: 0 14px;
  font-size: 14px;
}

/* --- icon only --- */

.me3-btn--icon-only.me3-btn--small {
  width: 32px;
  min-width: 32px;
  min-height: 32px;
  padding: 0;
}

.me3-btn--icon-only.me3-btn--compact {
  width: 36px;
  min-width: 36px;
  min-height: 36px;
  padding: 0;
}

.me3-btn--icon-only.me3-btn--medium {
  width: 40px;
  min-width: 40px;
  min-height: 40px;
  padding: 0;
}

.me3-btn--icon-only.me3-btn--large {
  width: 44px;
  min-width: 44px;
  min-height: 44px;
  padding: 0;
}

.me3-btn--icon-only.me3-btn--soft {
  border-radius: var(--ui-radius-sm, 6px);
}
</style>
