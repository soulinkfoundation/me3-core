<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import QRCode from "qrcode";
import { api } from "../api";
import { useAppToast } from "../composables/useAppToast";
import Button from "./Button.vue";
import UiIcon from "./UiIcon.vue";

const SETUP_LINK_TOOLTIP =
  "Generate a fresh setup link and tap Start in Telegram to finish linking.";

type TelegramConnectionRecord = {
  id: string;
  channel: "telegram";
  status: "pending" | "active" | "disconnected";
  botUsername: string | null;
  telegramUserId: string | null;
  telegramChatId: string | null;
  telegramUsername: string | null;
  telegramFirstName: string | null;
  telegramLastName: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type TelegramStatusResponse = {
  available: boolean;
  configured: boolean;
  encryptionConfigured: boolean;
  botUsername: string | null;
  botUsernameSource: "environment" | "stored" | "not_configured";
  tokenConfigured: boolean;
  botTokenSource: "environment" | "stored" | "not_configured";
  botTokenHint: string | null;
  botTokenUpdatedAt: string | null;
  webhookSecretConfigured: boolean;
  webhookSecretSource: "environment" | "stored" | "not_configured";
  webhookSecretHint: string | null;
  webhookSecretUpdatedAt: string | null;
  webhookUrl: string | null;
  startUrl: string | null;
  connection: TelegramConnectionRecord | null;
};

const props = withDefaults(
  defineProps<{
    /** Account page: full status row + primary CTA. Modal: hint + compact refresh + QR. */
    variant?: "default" | "compact";
    /** After first load, call setup when user can connect but is not active yet (e.g. ?section=telegram or dashboard modal). */
    autoPrepareWhenNotConnected?: boolean;
    showStatusRow?: boolean;
    compactConnected?: boolean;
  }>(),
  {
    variant: "default",
    autoPrepareWhenNotConnected: false,
    showStatusRow: true,
    compactConnected: false,
  },
);

const emit = defineEmits<{
  (e: "connection-active"): void;
}>();

const router = useRouter();
const { toastSuccess } = useAppToast();
const qrCanvas = ref<HTMLCanvasElement | null>(null);

const loading = ref(false);
const setupLoading = ref(false);
const disconnectLoading = ref(false);
const settingsSaving = ref(false);
const webhookSyncing = ref(false);
const available = ref(false);
const configured = ref(false);
const encryptionConfigured = ref(false);
const botUsername = ref<string | null>(null);
const botUsernameSource = ref<"environment" | "stored" | "not_configured">(
  "not_configured",
);
const tokenConfigured = ref(false);
const botTokenSource = ref<"environment" | "stored" | "not_configured">(
  "not_configured",
);
const botTokenHint = ref<string | null>(null);
const webhookSecretConfigured = ref(false);
const webhookSecretSource = ref<"environment" | "stored" | "not_configured">(
  "not_configured",
);
const webhookSecretHint = ref<string | null>(null);
const webhookUrl = ref<string | null>(null);
const startUrl = ref<string | null>(null);
const connection = ref<TelegramConnectionRecord | null>(null);
const error = ref<string | null>(null);
const botUsernameInput = ref("");
const botTokenInput = ref("");
const webhookSecretInput = ref("");
const showBotToken = ref(false);

const statusHint = computed(() => {
  if (!available.value) {
    return "Telegram channel access is available on Pro.";
  }

  if (!configured.value) {
    return "Paste the bot name and token from BotFather to connect Telegram.";
  }

  if (!connection.value) {
    return "Open the setup link, then tap Start in Telegram.";
  }

  if (connection.value.status === "active") {
    return `Telegram is connected${
      connection.value.telegramUsername
        ? ` to @${connection.value.telegramUsername}`
        : ""
    }.`;
  }

  if (connection.value.status === "disconnected") {
    return "This Telegram connection was disconnected.";
  }

  if (connection.value.status === "pending") {
    return "Pending setup.";
  }

  return "";
});

const isConnected = computed(() => connection.value?.status === "active");
const showSetupForm = computed(
  () => props.variant === "default" && !isConnected.value,
);
const showConnectionDetails = computed(
  () => !(props.compactConnected && isConnected.value),
);

const refreshButtonTooltip = computed(() => {
  if (!configured.value) {
    return "Telegram deployment setup is incomplete.";
  }
  if (connection.value?.status === "active") {
    return "Refresh Telegram connection status";
  }
  return SETUP_LINK_TOOLTIP;
});

const refreshAriaLabel = computed(() => refreshButtonTooltip.value);

const connectionDetails = computed(() => {
  const current = connection.value;
  if (!current) return [];

  const details: Array<{ label: string; value: string }> = [];
  for (const [label, value] of [
    ["Status", current.status],
    ["Telegram user", formatTelegramUser(current)],
    ["Connected", formatDateTime(current.connectedAt)],
    ["Last inbound", formatDateTime(current.lastInboundAt)],
    ["Last outbound", formatDateTime(current.lastOutboundAt)],
  ] as const) {
    if (value) details.push({ label, value });
  }
  return details;
});

const telegramWebhookSyncDisabled = computed(
  () =>
    webhookSyncing.value ||
    settingsSaving.value ||
    !botUsernameInput.value.trim() ||
    (!tokenConfigured.value && !botTokenInput.value.trim()),
);

const botTokenPlaceholder = computed(() =>
  botTokenHint.value
    ? `Stored token ${botTokenHint.value}; paste a new token to replace`
    : "Paste BotFather token",
);

function formatTelegramUser(current: TelegramConnectionRecord) {
  if (current.telegramUsername) return `@${current.telegramUsername}`;
  const name = [current.telegramFirstName, current.telegramLastName]
    .filter(Boolean)
    .join(" ");
  return name || current.telegramUserId || null;
}

function formatDateTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function syncStatus(response: TelegramStatusResponse) {
  available.value = response.available;
  configured.value = response.configured;
  encryptionConfigured.value = response.encryptionConfigured;
  botUsername.value = response.botUsername;
  botUsernameSource.value = response.botUsernameSource;
  tokenConfigured.value = response.tokenConfigured;
  botTokenSource.value = response.botTokenSource;
  botTokenHint.value = response.botTokenHint;
  webhookSecretConfigured.value = response.webhookSecretConfigured;
  webhookSecretSource.value = response.webhookSecretSource;
  webhookSecretHint.value = response.webhookSecretHint;
  webhookUrl.value = response.webhookUrl;
  startUrl.value = response.startUrl;
  connection.value = response.connection;
  botUsernameInput.value = response.botUsername || botUsernameInput.value;
  botTokenInput.value = "";
  webhookSecretInput.value = "";
  if (response.connection?.status === "active") {
    emit("connection-active");
  }
}

async function loadTelegram() {
  loading.value = true;
  error.value = null;

  try {
    const response = await api.get<TelegramStatusResponse>("/telegram/status");
    syncStatus(response);
  } catch (err: unknown) {
    error.value =
      err instanceof Error ? err.message : "Failed to load Telegram status";
  } finally {
    loading.value = false;
  }
}

async function saveTelegramSettings() {
  if (telegramWebhookSyncDisabled.value) return;
  settingsSaving.value = true;
  error.value = null;

  try {
    const response = await api.put<TelegramStatusResponse & { ok: boolean }>(
      "/telegram/settings",
      {
        botUsername: botUsernameInput.value,
        botToken: botTokenInput.value.trim() || undefined,
        webhookSecret: webhookSecretInput.value.trim() || undefined,
      },
    );
    syncStatus(response);
    toastSuccess("Telegram settings saved.");
  } catch (err: unknown) {
    error.value =
      err instanceof Error ? err.message : "Failed to save Telegram settings";
  } finally {
    settingsSaving.value = false;
  }
}

async function saveAndSyncTelegramWebhook() {
  if (telegramWebhookSyncDisabled.value) return;
  if (!webhookSecretConfigured.value && !webhookSecretInput.value.trim()) {
    generateWebhookSecret();
  }
  await saveTelegramSettings();
  if (error.value) return;

  webhookSyncing.value = true;
  error.value = null;

  try {
    const response = await api.post<
      TelegramStatusResponse & { ok: boolean; webhookUrl: string }
    >("/telegram/webhook/sync", {});
    syncStatus(response);
    if (
      available.value &&
      configured.value &&
      connection.value?.status !== "active"
    ) {
      await setupTelegram();
    }
    if (!error.value) {
      toastSuccess(
        connection.value?.status === "active"
          ? "Telegram webhook set."
          : "Telegram webhook set. Open the setup link to finish.",
      );
    }
  } catch (err: unknown) {
    error.value =
      err instanceof Error ? err.message : "Failed to set Telegram webhook";
  } finally {
    webhookSyncing.value = false;
  }
}

function generateWebhookSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  webhookSecretInput.value = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function setupTelegram() {
  if (setupLoading.value || !available.value) return;

  setupLoading.value = true;
  error.value = null;

  try {
    const response = await api.post<TelegramStatusResponse>(
      "/telegram/setup",
      {},
    );
    syncStatus(response);
  } catch (err: unknown) {
    error.value =
      err instanceof Error ? err.message : "Failed to prepare Telegram setup";
  } finally {
    setupLoading.value = false;
  }
}

async function disconnectTelegram() {
  if (disconnectLoading.value || connection.value?.status !== "active") return;
  const confirmed = window.confirm(
    "Disconnect Telegram from this ME3 account?",
  );
  if (!confirmed) return;

  disconnectLoading.value = true;
  error.value = null;

  try {
    const response = await api.post<TelegramStatusResponse>(
      "/telegram/disconnect",
      {},
    );
    syncStatus(response);
  } catch (err: unknown) {
    error.value =
      err instanceof Error ? err.message : "Failed to disconnect Telegram";
  } finally {
    disconnectLoading.value = false;
  }
}

async function renderQr() {
  await nextTick();
  const canvas = qrCanvas.value;
  const url = startUrl.value;
  if (!canvas || !url) return;
  try {
    await QRCode.toCanvas(canvas, url, {
      width: props.variant === "compact" ? 180 : 200,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    });
  } catch {
    /* QR render failed — link still available as fallback */
  }
}

watch(startUrl, (url) => {
  if (url) renderQr();
});

async function handlePrimaryAction() {
  if (!available.value) {
    router.push("/account");
    return;
  }

  if (!configured.value) {
    return;
  }

  if (connection.value?.status === "active") {
    await loadTelegram();
    return;
  }

  await setupTelegram();
}

onMounted(async () => {
  await loadTelegram();
  if (
    props.autoPrepareWhenNotConnected &&
    available.value &&
    configured.value &&
    connection.value?.status !== "active"
  ) {
    await setupTelegram();
    await renderQr();
  }
});

defineExpose({
  available,
  configured,
  connection,
  error,
  loadTelegram,
  setupTelegram,
});
</script>

<template>
  <div class="telegram-connect-panel">
    <div v-if="loading" class="status-row">Loading Telegram…</div>

    <template v-else-if="available">
      <template v-if="variant === 'default' && showStatusRow">
        <div
          class="status-row"
          :class="{ verified: connection?.status === 'active' }"
        >
          <span class="status-pill">
            {{ botUsername ? `@${botUsername}` : "Telegram" }}
          </span>
          <span v-if="statusHint">{{ statusHint }}</span>
        </div>
      </template>

      <p v-else-if="variant === 'compact'" class="telegram-compact-hint">
        {{ statusHint }}
      </p>

      <form
        v-if="showSetupForm"
        class="telegram-settings-form"
        @submit.prevent="saveAndSyncTelegramWebhook"
      >
        <div class="telegram-field">
          <input
            v-model="botUsernameInput"
            type="text"
            inputmode="text"
            autocomplete="off"
            spellcheck="false"
            aria-label="Bot username"
            placeholder="Bot username"
          />
        </div>
        <div class="telegram-field">
          <div class="password-field telegram-token-field">
            <input
              v-model="botTokenInput"
              class="password-field__input"
              :type="showBotToken ? 'text' : 'password'"
              autocomplete="off"
              spellcheck="false"
              aria-label="Bot token"
              :placeholder="botTokenPlaceholder"
            />
            <button
              type="button"
              class="password-field__toggle"
              :aria-label="showBotToken ? 'Hide bot token' : 'Show bot token'"
              :aria-pressed="showBotToken"
              @click="showBotToken = !showBotToken"
            >
              <UiIcon :name="showBotToken ? 'EyeOff' : 'Eye'" :size="18" />
            </button>
          </div>
        </div>
        <div class="telegram-settings-actions">
          <Button
            color="primary"
            size="small"
            type="submit"
            :disabled="telegramWebhookSyncDisabled"
          >
            {{
              webhookSyncing || settingsSaving
                ? "Connecting..."
                : "Save & connect"
            }}
          </Button>
        </div>
      </form>

      <div
        v-if="configured"
        class="telegram-qr-section"
        :class="{
          'telegram-qr-section--compact-connected':
            compactConnected && isConnected,
        }"
      >
        <dl
          v-if="showConnectionDetails && connectionDetails.length"
          class="telegram-health"
          aria-label="Telegram connection health"
        >
          <div
            v-for="detail in connectionDetails"
            :key="detail.label"
            class="telegram-health__row"
          >
            <dt>{{ detail.label }}</dt>
            <dd>{{ detail.value }}</dd>
          </div>
        </dl>

        <div v-if="startUrl && !isConnected" class="telegram-qr-section__body">
          <template v-if="startUrl">
            <p class="hint">
              Scan this QR code with your phone to connect via Telegram.
            </p>
            <canvas ref="qrCanvas" class="telegram-qr-canvas" />
            <a
              class="telegram-qr-fallback"
              :href="startUrl"
              target="_blank"
              rel="noreferrer"
            >
              Or open this link on your phone
            </a>
          </template>
        </div>
        <div class="telegram-qr-section__footer">
          <Button
            color="secondary"
            size="small"
            class="telegram-refresh-btn"
            type="button"
            :disabled="setupLoading"
            :title="refreshButtonTooltip"
            :aria-label="refreshAriaLabel"
            @click="handlePrimaryAction"
          >
            <template #icon>
              <UiIcon name="RefreshCw" :size="18" aria-hidden="true" />
            </template>
          </Button>
          <Button
            v-if="connection?.status === 'active'"
            color="outline"
            size="small"
            class="telegram-disconnect-btn"
            type="button"
            :disabled="disconnectLoading"
            title="Disconnect Telegram from this account"
            @click="disconnectTelegram"
          >
            <template #icon>
              <UiIcon name="Unplug" :size="18" aria-hidden="true" />
            </template>
            {{ disconnectLoading ? "Disconnecting..." : "Disconnect" }}
          </Button>
        </div>
      </div>
    </template>

    <div v-else class="recommended-card">
      <span class="recommended-pill">Pro</span>
      <h3>Connect Telegram for ME3 messages</h3>
      <p class="hint">
        Pro unlocks the Telegram channel MVP, which records message events and
        prepares the account for Cloudflare agent routing.
      </p>
      <router-link class="button primary link-button-inline" to="/account">
        Review settings
      </router-link>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<style scoped>
.telegram-connect-panel .hint {
  margin-top: 0;
}

.status-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  margin-top: 12px;
}

.status-row.verified {
  color: var(--color-text);
}

.status-pill {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  border: 1px solid var(--color-border);
  background: var(--color-surface-muted, rgba(0, 0, 0, 0.04));
}

.telegram-refresh-btn.me3-btn {
  min-width: 40px;
  padding: 8px;
}

.telegram-refresh-btn :deep(.me3-btn__icon) {
  margin: 0;
}

.telegram-disconnect-btn {
  color: var(--color-error, #c62828);
}

.telegram-compact-hint {
  margin: 0 0 12px;
  font-size: 14px;
  line-height: 1.45;
  color: var(--color-text-muted);
}

.telegram-settings-form {
  display: grid;
  grid-template-columns: minmax(150px, 0.9fr) minmax(220px, 1.3fr) auto;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
}

.telegram-field {
  min-width: 0;
}

.telegram-field input,
.password-field__input {
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  min-height: 36px;
  padding: 8px 12px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-surface);
  color: var(--color-text);
  font: inherit;
  font-weight: 500;
}

.telegram-field input:focus,
.password-field__input:focus {
  outline: 2px solid var(--ui-accent-soft, rgba(20, 184, 166, 0.28));
  outline-offset: 1px;
  border-color: var(--ui-accent, var(--color-border));
}

.password-field {
  position: relative;
}

.password-field__input {
  padding-right: 44px;
}

.password-field__toggle {
  position: absolute;
  top: 50%;
  right: 7px;
  display: inline-flex;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--ui-radius-sm, 8px);
  background: transparent;
  color: var(--ui-text-muted, var(--color-text-muted));
  cursor: pointer;
  transform: translateY(-50%);
}

.password-field__toggle:hover,
.password-field__toggle:focus-visible {
  color: var(--ui-text, var(--color-text));
}

.password-field__toggle:focus-visible {
  outline: 2px solid var(--ui-text, var(--color-text));
  outline-offset: 2px;
}

.telegram-settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
}

.telegram-qr-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(100%, 480px);
  box-sizing: border-box;
  margin: 16px auto 0;
  padding: 20px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
}

.telegram-qr-section--compact-connected {
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
}

.telegram-health {
  display: grid;
  gap: 8px;
  width: 100%;
  margin: 0 0 16px;
  padding: 0;
}

.telegram-health__row {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  font-size: 13px;
}

.telegram-health dt {
  color: var(--color-text-muted);
}

.telegram-health dd {
  margin: 0;
  text-align: right;
  font-weight: 600;
}

.telegram-qr-section__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  min-height: 0;
}

.telegram-qr-section__footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin-top: 12px;
  padding-top: 4px;
}

.telegram-qr-section--compact-connected .telegram-qr-section__footer {
  margin: 0;
  padding: 0;
  justify-content: flex-end;
}

.telegram-qr-section .hint {
  margin-top: 0;
  text-align: center;
}

.telegram-qr-canvas {
  border-radius: 8px;
  image-rendering: pixelated;
}

.telegram-qr-fallback {
  font-size: 13px;
  color: var(--color-text-muted);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.telegram-qr-fallback:hover {
  color: var(--color-text);
}

.recommended-card {
  margin-top: 12px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: var(--color-surface-muted, rgba(0, 0, 0, 0.03));
}

.recommended-pill {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin-bottom: 8px;
}

.recommended-card h3 {
  margin: 0 0 8px;
  font-size: 16px;
}

.error {
  margin-top: 12px;
  color: var(--color-error, #c62828);
  font-size: 14px;
}

.success {
  margin-top: 12px;
  color: var(--ui-accent-strong, #047857);
  font-size: 14px;
}

@media (max-width: 520px) {
  .telegram-settings-form {
    grid-template-columns: 1fr;
  }

  .telegram-settings-actions {
    grid-template-columns: 1fr;
  }

  .telegram-settings-actions .me3-btn {
    width: 100%;
    justify-content: center;
  }
}

@media (prefers-color-scheme: dark) {
  .recommended-card {
    background: rgba(46, 125, 50, 0.14);
    border-color: rgba(129, 199, 132, 0.32);
  }

  .recommended-pill {
    color: #c8e6c9;
  }
}
</style>
