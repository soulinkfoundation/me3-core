<script setup lang="ts">
import { ref, watch } from "vue";
import AppDialog from "./AppDialog.vue";
import Button from "./Button.vue";
import SoulinkConnectPanel from "./SoulinkConnectPanel.vue";
import UiIcon from "./UiIcon.vue";

const props = withDefaults(
  defineProps<{
    open: boolean;
    bannerVisible?: boolean;
    soulinkUrl?: string;
  }>(),
  {
    bannerVisible: false,
    soulinkUrl: "https://soulinkfoundation.org",
  },
);

const emit = defineEmits<{
  close: [];
  dismissBanner: [];
  connectionActive: [];
  open: [];
}>();

const continuedToSoulink = ref(false);

watch(
  () => props.open,
  (open) => {
    if (open) continuedToSoulink.value = false;
  },
);

function openDialog() {
  emit("open");
}

function continueToSoulink() {
  continuedToSoulink.value = true;
  emit("dismissBanner");
}
</script>

<template>
  <aside
    v-if="bannerVisible"
    class="soulink-banner"
    aria-label="Soulink network"
  >
    <p>
      Meditate, call and chat with conscious communities on Soulink.
      <button type="button" class="soulink-banner__link" aria-label="Join Soulink" @click="openDialog">
        Join
      </button>
    </p>
    <button
      type="button"
      class="soulink-banner__close"
      aria-label="Dismiss Soulink invitation"
      @click="emit('dismissBanner')"
    >
      <UiIcon name="X" :size="16" aria-hidden="true" />
    </button>
  </aside>

  <AppDialog
    :open="open"
    labelled-by="soulink-join-title"
    described-by="soulink-join-description"
    close-on-backdrop
    @close="emit('close')"
  >
    <section class="soulink-dialog">
      <header class="soulink-dialog__header">
        <img
          class="soulink-dialog__logo"
          src="/images/soulink-logo.png"
          alt=""
          aria-hidden="true"
        />
        <div>
          <h2 id="soulink-join-title">Join Soulink</h2>
          <p id="soulink-join-description">
            A conscious social network for meditation, video calls and chat.
          </p>
        </div>
        <Button
          class="soulink-dialog__close"
          color="ghost"
          shape="soft"
          size="compact"
          icon-only
          aria-label="Close Soulink invitation"
          @click="emit('close')"
        >
          <UiIcon name="X" :size="18" aria-hidden="true" />
        </Button>
      </header>

      <template v-if="!continuedToSoulink">
        <ul class="soulink-dialog__benefits">
          <li>Meet people who share your values and purpose.</li>
          <li>Join communities, conversations and calls.</li>
          <li>Bring your ME3 assistant into the network.</li>
        </ul>

        <footer class="soulink-dialog__actions">
          <a
            class="soulink-dialog__primary-action"
            :href="soulinkUrl"
            target="_blank"
            rel="noreferrer"
            @click="continueToSoulink"
          >
            Continue to Soulink
            <UiIcon name="ArrowRight" :size="17" aria-hidden="true" />
          </a>
          <p>Soulink will open your chats or show your current access status.</p>
        </footer>
      </template>

      <section v-else class="soulink-dialog__connect" aria-labelledby="soulink-connect-title">
        <div class="soulink-dialog__connect-copy">
          <h3 id="soulink-connect-title">Connect your ME3 assistant</h3>
          <p>
            If Soulink confirmed your access, connect this assistant so it can
            join your private Soulink chat.
          </p>
        </div>
        <SoulinkConnectPanel
          variant="compact"
          @connection-active="emit('connectionActive')"
        />
      </section>
    </section>
  </AppDialog>
</template>

<style scoped>
.soulink-banner {
  position: fixed;
  /* Sits just above the chat composer when a page has one (see useComposerClearance). */
  bottom: calc(
    var(--app-composer-clearance, max(12px, env(safe-area-inset-bottom))) + 10px
  );
  left: 50%;
  z-index: 45;
  display: flex;
  align-items: center;
  gap: 8px;
  width: max-content;
  max-width: min(620px, calc(100vw - 28px));
  min-height: 42px;
  padding: 4px 4px 4px 14px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-md);
  background: var(--ui-surface, var(--color-bg));
  box-shadow: var(--ui-shadow-sm, var(--shadow-soft));
  color: var(--ui-text, var(--color-text));
  transform: translateX(-50%);
}

.soulink-banner p {
  margin: 0;
  font-size: 13px;
  line-height: 1.4;
}

.soulink-banner__link {
  padding: 4px 2px;
  border: 0;
  background: transparent;
  color: var(--ui-accent-strong, var(--color-accent));
  font: inherit;
  font-weight: 750;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.soulink-banner__link:focus-visible,
.soulink-banner__close:focus-visible {
  outline: 2px solid var(--ui-focus, var(--color-accent));
  outline-offset: 2px;
}

.soulink-banner__close {
  display: grid;
  flex: 0 0 auto;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: var(--ui-radius-sm);
  background: transparent;
  color: var(--ui-text-muted, var(--color-text-muted));
  cursor: pointer;
}

.soulink-banner__close:hover {
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  color: var(--ui-text, var(--color-text));
}

.soulink-dialog {
  position: relative;
  width: min(100%, 520px);
  padding: 24px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface, var(--color-bg));
  box-shadow: var(--ui-shadow-md, var(--shadow-soft));
  color: var(--ui-text, var(--color-text));
}

.soulink-dialog__header {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 44px;
  align-items: start;
  gap: 14px;
}

.soulink-dialog__logo {
  display: block;
  width: 24px;
  height: 40px;
  object-fit: contain;
}

.soulink-dialog__header h2,
.soulink-dialog__connect h3 {
  margin: 0;
  color: var(--ui-text, var(--color-text));
}

.soulink-dialog__header h2 {
  font-size: 24px;
  line-height: 1.1;
}

.soulink-dialog__header p,
.soulink-dialog__connect-copy p,
.soulink-dialog__actions p {
  margin: 6px 0 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  line-height: 1.5;
}

.soulink-dialog__header p,
.soulink-dialog__connect-copy p {
  font-size: 14px;
}

.soulink-dialog__close {
  justify-self: end;
  min-width: 44px;
  min-height: 44px;
}

.soulink-dialog__benefits {
  display: grid;
  gap: 10px;
  margin: 24px 0;
  padding: 0 0 0 20px;
  color: var(--ui-text, var(--color-text));
  font-size: 14px;
  line-height: 1.5;
}

.soulink-dialog__benefits li::marker {
  color: var(--ui-accent, var(--color-accent));
}

.soulink-dialog__actions {
  display: grid;
  gap: 8px;
}

.soulink-dialog__primary-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 44px;
  padding: 0 18px;
  border: 1px solid var(--ui-accent, var(--color-accent));
  border-radius: var(--ui-radius-md);
  background: var(--ui-accent, var(--color-accent));
  color: var(--ui-accent-contrast, #fff);
  font-size: 14px;
  font-weight: 750;
  text-decoration: none;
}

.soulink-dialog__primary-action:hover {
  border-color: var(--ui-accent-strong, var(--color-accent));
  background: var(--ui-accent-strong, var(--color-accent));
}

.soulink-dialog__primary-action:focus-visible {
  outline: 2px solid var(--ui-focus, var(--color-accent));
  outline-offset: 2px;
}

.soulink-dialog__actions p {
  font-size: 12px;
  text-align: center;
}

.soulink-dialog__connect {
  display: grid;
  gap: 20px;
  margin-top: 22px;
  padding-top: 22px;
  border-top: 1px solid var(--ui-border, var(--color-border));
}

.soulink-dialog__connect h3 {
  font-size: 18px;
  line-height: 1.25;
}

@media (max-width: 640px) {
  .soulink-banner {
    right: 12px;
    left: 12px;
    width: auto;
    max-width: none;
    transform: none;
  }

  .soulink-dialog {
    width: 100%;
    padding: 22px 18px max(22px, env(safe-area-inset-bottom));
    border-right: 0;
    border-bottom: 0;
    border-left: 0;
    border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0;
  }
}
</style>
