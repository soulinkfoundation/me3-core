<script setup lang="ts">
import { computed, ref, useId } from "vue";
import AppDialog from "../AppDialog.vue";
import Button from "../Button.vue";
import ConfirmationDialog from "../ConfirmationDialog.vue";
import UiIcon from "../UiIcon.vue";
import SocialMarks from "./SocialMarks.vue";
import { useAppToast } from "../../composables/useAppToast";
import { useSocialStore, type SocialAccountRow, type SocialPostDetail } from "../../stores/social";
import {
  SOCIAL_NETWORKS,
  accountName,
  accountState,
  accountsFor,
  pausedPostCount,
  type SocialNetwork,
} from "../../utils/social-posts";

const props = defineProps<{
  open: boolean;
  accounts: SocialAccountRow[];
  posts: SocialPostDetail[];
  siteId: string;
  hostedPlatforms: string[];
  returnPath?: string;
}>();
const emit = defineEmits<{ close: []; changed: [] }>();

const social = useSocialStore();
const { toastError, toastFromUnknown } = useAppToast();
const titleId = `social-accounts-${useId()}`;
const connecting = ref<SocialNetwork | null>(null);
const disconnecting = ref<SocialAccountRow | null>(null);
const busy = ref(false);

const rows = computed(() =>
  SOCIAL_NETWORKS.map((network) => {
    const state = accountState(network.id, props.accounts);
    const connected = accountsFor(network.id, props.accounts).find((account) => account.status === "active") || null;
    const paused = pausedPostCount(network.id, props.posts, props.accounts);
    let detail = network.note;
    if (state === "connected" && connected) detail = accountName(connected);
    if (state === "disconnected") detail = paused ? `Disconnected · ${paused} post${paused === 1 ? "" : "s"} paused` : "Disconnected";
    return { ...network, state, connected, detail };
  }),
);

async function connect(network: SocialNetwork) {
  if (connecting.value) return;
  if (!props.siteId) {
    toastError("ME3 needs your profile page before it can connect accounts.");
    return;
  }
  connecting.value = network;
  try {
    const url = await social.startSocialOAuth(
      network,
      props.siteId,
      props.returnPath || "/social",
      props.hostedPlatforms.includes(network) ? "managed" : undefined,
    );
    window.location.assign(url);
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't start connecting. Try again.");
    connecting.value = null;
  }
}

async function confirmDisconnect() {
  const account = disconnecting.value;
  if (!account || busy.value) return;
  busy.value = true;
  try {
    await social.disconnectSocialAccount(account.id);
    disconnecting.value = null;
    emit("changed");
  } catch (caught) {
    toastFromUnknown(caught, "Couldn't disconnect. Try again.");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AppDialog :open="open" :labelled-by="titleId" close-on-backdrop @close="emit('close')">
    <section class="accounts-sheet">
      <header class="accounts-sheet__header">
        <h2 :id="titleId">Social accounts</h2>
        <Button color="ghost" shape="soft" size="compact" icon-only aria-label="Close" @click="emit('close')">
          <UiIcon name="X" :size="18" />
        </Button>
      </header>
      <ul class="accounts-sheet__list">
        <li v-for="row in rows" :key="row.id" class="account-row">
          <SocialMarks :platforms="[row.id]" size="large" />
          <div class="account-row__text">
            <span class="account-row__name">{{ row.label }}</span>
            <span class="account-row__detail" :class="{ 'account-row__detail--danger': row.state === 'disconnected' }">
              {{ row.detail }}
            </span>
          </div>
          <template v-if="row.state === 'connected' && row.connected">
            <span class="account-row__chip">Connected</span>
            <Button
              class="account-row__quiet"
              color="ghost"
              shape="soft"
              size="small"
              :aria-label="`Disconnect ${row.label}`"
              @click="disconnecting = row.connected"
            >Disconnect</Button>
          </template>
          <Button
            v-else
            :color="row.state === 'disconnected' ? 'primary' : 'outline'"
            shape="pill"
            size="small"
            :disabled="connecting !== null"
            @click="connect(row.id)"
          >{{ connecting === row.id ? "Opening…" : row.state === "disconnected" ? "Reconnect" : "Connect" }}</Button>
        </li>
      </ul>
    </section>
  </AppDialog>

  <ConfirmationDialog
    :open="Boolean(disconnecting)"
    title="Disconnect this account?"
    message="Scheduled posts for it will wait until you connect again. Posted ones stay in Posted."
    confirm-label="Disconnect"
    :busy="busy"
    danger
    @cancel="disconnecting = null"
    @confirm="confirmDisconnect"
  />
</template>

<style scoped>
.accounts-sheet {
  box-sizing: border-box;
  width: min(480px, calc(100vw - 32px));
  padding: 16px 18px 12px;
  border-radius: var(--ui-radius-lg);
  background: var(--ui-surface);
  box-shadow: var(--ui-shadow-md);
}
.accounts-sheet__header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.accounts-sheet__header h2 { margin: 0; font-size: 17px; font-weight: 650; }
.accounts-sheet__list { margin: 8px 0 0; padding: 0; list-style: none; }
.account-row { display: flex; align-items: center; gap: 12px; min-height: 56px; border-top: 1px solid var(--ui-border); }
.account-row:first-child { border-top: 0; }
.account-row__text { display: grid; flex: 1 1 auto; min-width: 0; gap: 1px; }
.account-row__name { font-size: 14px; font-weight: 600; }
.account-row__detail { overflow: hidden; color: var(--ui-text-muted); font-size: 12.5px; text-overflow: ellipsis; }
.account-row__detail--danger { color: var(--ui-danger); }
.account-row__chip {
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--ui-accent-soft);
  color: var(--ui-text);
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.account-row :deep(.account-row__quiet) { min-height: 30px; padding-inline: 6px; color: var(--ui-text-muted); font-weight: 500; }
@media (max-width: 640px) {
  .accounts-sheet { width: 100vw; border-radius: var(--ui-radius-lg) var(--ui-radius-lg) 0 0; padding-bottom: 28px; }
}
</style>
