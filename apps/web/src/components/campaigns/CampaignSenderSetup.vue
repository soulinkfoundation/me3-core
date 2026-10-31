<script setup lang="ts">
import { computed, onMounted, ref, useId } from "vue";
import { api } from "../../api";
import Button from "../Button.vue";

/**
 * Self-hosted "Connect a sender" step (me3-bli3.2.11): campaigns go out through the owner's own
 * provider, saved with the same email sender settings Account uses. Saving sends nothing.
 */
type ProviderId = "postmark" | "cloudflare-email" | "mailgun" | "smtp";
type ProviderRecord = {
  id: string;
  label: string;
  configured: boolean;
  config: {
    fromAddress: string;
    sendingDomain: string;
    accountId: string;
    messageStream: string;
    smtpHost: string;
    smtpPort: number;
    smtpSecurity: string;
    smtpUsername: string;
    mailgunRegion: string;
  };
};
type ProviderSettings = { activeProviderId: string; providers: ProviderRecord[] };

const props = withDefaults(defineProps<{
  /** False connects the provider without making it the main sender (send-as addresses). */
  activate?: boolean;
  /** Fixes the provider and hides the choice. */
  provider?: ProviderId;
  presetFrom?: string;
  title?: string;
  description?: string;
}>(), {
  activate: true,
  provider: undefined,
  presetFrom: "",
  title: "Connect a sender",
  description: "Campaigns go out through your own email provider. Your other ME3 email uses it too.",
});

const emit = defineEmits<{ connected: [] }>();

const PROVIDERS: Array<{ id: ProviderId; label: string; secret: string }> = [
  { id: "postmark", label: "Postmark", secret: "Server API token" },
  { id: "cloudflare-email", label: "Cloudflare Email", secret: "API token" },
  { id: "mailgun", label: "Mailgun", secret: "API key" },
  { id: "smtp", label: "SMTP", secret: "Password" },
];

const titleId = `campaign-sender-title-${useId()}`;
const loaded = ref<ProviderSettings | null>(null);
const providerId = ref<ProviderId>(props.provider || "postmark");
const fromAddress = ref(props.presetFrom);
const secret = ref("");
const accountId = ref("");
const sendingDomain = ref("");
const mailgunRegion = ref("us");
const smtpHost = ref("");
const smtpPort = ref("587");
const smtpUsername = ref("");
const saving = ref(false);
const error = ref("");

const choice = computed(() => PROVIDERS.find((item) => item.id === providerId.value)!);
const existing = computed(() => loaded.value?.providers.find((item) => item.id === providerId.value));
const canConnect = computed(() => {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress.value.trim())) return false;
  // A saved token is kept when the field is left empty.
  const hasSecret = Boolean(secret.value.trim() || existing.value?.configured);
  if (providerId.value === "cloudflare-email") return true;
  if (providerId.value === "mailgun") return hasSecret && Boolean(sendingDomain.value.trim());
  if (providerId.value === "smtp") return hasSecret && Boolean(smtpHost.value.trim() && smtpUsername.value.trim());
  return hasSecret;
});

function fill(id: ProviderId) {
  const config = loaded.value?.providers.find((item) => item.id === id)?.config;
  fromAddress.value = config?.fromAddress || fromAddress.value;
  accountId.value = config?.accountId || "";
  sendingDomain.value = config?.sendingDomain || "";
  mailgunRegion.value = config?.mailgunRegion || "us";
  smtpHost.value = config?.smtpHost || "";
  smtpPort.value = String(config?.smtpPort || 587);
  smtpUsername.value = config?.smtpUsername || "";
  secret.value = "";
}

function chooseProvider(event: Event) {
  providerId.value = (event.target as HTMLSelectElement).value as ProviderId;
  fill(providerId.value);
}

async function load() {
  try {
    loaded.value = await api.get<ProviderSettings>("/email-provider-settings");
    const active = PROVIDERS.find((item) => item.id === loaded.value?.activeProviderId);
    if (!props.provider && active && loaded.value.providers.some((item) => item.id === active.id && item.config.fromAddress)) {
      providerId.value = active.id;
    }
    fill(providerId.value);
  } catch {
    // The form still works without the saved settings.
  }
}

async function connect() {
  if (!canConnect.value || saving.value) return;
  saving.value = true;
  error.value = "";
  const id = providerId.value;
  const from = fromAddress.value.trim().toLowerCase();
  try {
    await api.put("/email-provider-settings", {
      ...(props.activate ? { activeProviderId: id } : {}),
      providers: [{
        id,
        transport: id === "smtp" ? "smtp" : id === "cloudflare-email" && !accountId.value.trim() ? "binding" : "rest",
        fromAddress: from,
        sendingDomain: id === "mailgun" ? sendingDomain.value.trim() : from.split("@")[1] || "",
        accountId: id === "cloudflare-email" ? accountId.value.trim() : "",
        messageStream: id === "postmark" ? existing.value?.config.messageStream || "outbound" : "",
        smtpHost: smtpHost.value.trim(),
        smtpPort: smtpPort.value,
        smtpUsername: smtpUsername.value.trim(),
        mailgunRegion: mailgunRegion.value,
        apiToken: secret.value.trim() || undefined,
      }],
    });
    secret.value = "";
    emit("connected");
  } catch (caught) {
    error.value = caught instanceof Error && caught.message ? caught.message : "Couldn't connect this sender.";
  } finally {
    saving.value = false;
  }
}

onMounted(() => void load());
</script>

<template>
  <section class="sender-setup" :aria-labelledby="titleId">
    <h2 :id="titleId">{{ title }}</h2>
    <p>{{ description }}</p>
    <form class="sender-setup__fields" @submit.prevent="connect">
      <label v-if="!provider" class="sender-setup__field">
        <span>Provider</span>
        <select data-test="sender-provider" :value="providerId" @change="chooseProvider">
          <option v-for="item in PROVIDERS" :key="item.id" :value="item.id">{{ item.label }}</option>
        </select>
      </label>
      <label class="sender-setup__field">
        <span>Send from</span>
        <input v-model="fromAddress" data-test="sender-from" type="email" autocomplete="email" placeholder="news@yourdomain.com" />
      </label>
      <template v-if="providerId === 'mailgun'">
        <label class="sender-setup__field">
          <span>Sending domain</span>
          <input v-model="sendingDomain" placeholder="mg.yourdomain.com" />
        </label>
        <label class="sender-setup__field">
          <span>Region</span>
          <select v-model="mailgunRegion"><option value="us">US</option><option value="eu">EU</option></select>
        </label>
      </template>
      <template v-if="providerId === 'smtp'">
        <label class="sender-setup__field">
          <span>Host</span>
          <input v-model="smtpHost" placeholder="smtp.yourprovider.com" />
        </label>
        <label class="sender-setup__field">
          <span>Port</span>
          <input v-model="smtpPort" inputmode="numeric" />
        </label>
        <label class="sender-setup__field">
          <span>Username</span>
          <input v-model="smtpUsername" autocomplete="off" />
        </label>
      </template>
      <label v-if="providerId === 'cloudflare-email'" class="sender-setup__field">
        <span>Account ID</span>
        <input v-model="accountId" autocomplete="off" placeholder="Leave empty with an EMAIL binding" />
      </label>
      <label class="sender-setup__field">
        <span>{{ choice.secret }}</span>
        <input
          v-model="secret"
          data-test="sender-secret"
          type="password"
          autocomplete="off"
          :placeholder="existing?.configured ? 'Saved. Leave empty to keep it.' : ''"
        />
      </label>
      <p v-if="providerId === 'postmark'" class="sender-setup__hint">Campaigns use the server's broadcast stream.</p>
      <p v-if="error" class="sender-setup__error" role="alert">{{ error }}</p>
      <div class="sender-setup__actions">
        <Button
          data-test="sender-connect"
          color="primary"
          shape="soft"
          size="compact"
          type="submit"
          :disabled="!canConnect || saving"
        >{{ saving ? "Connecting…" : "Connect sender" }}</Button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.sender-setup { display: grid; gap: 6px; }
.sender-setup h2 { margin: 0; font-size: 15px; font-weight: 700; }
.sender-setup > p { margin: 0; color: var(--ui-text-muted); font-size: 13px; line-height: 1.45; }
.sender-setup__fields { display: grid; gap: 12px; margin-top: 8px; }
.sender-setup__field { display: grid; gap: 4px; min-width: 0; }
.sender-setup__field > span { color: var(--ui-text-muted); font-size: 12px; font-weight: 600; }
.sender-setup__field input,
.sender-setup__field select { box-sizing: border-box; width: 100%; min-height: 40px; padding: 6px 0; border: 0; border-bottom: 1px solid var(--ui-border); border-radius: 0; background: transparent; color: var(--ui-text); font: inherit; font-size: 15px; }
.sender-setup__field input:focus,
.sender-setup__field select:focus { outline: none; border-bottom-color: var(--ui-accent); box-shadow: 0 1px 0 var(--ui-accent); }
.sender-setup__hint { margin: -4px 0 0; color: var(--ui-text-muted); font-size: 12px; }
.sender-setup__error { margin: 0; color: var(--ui-danger, color-mix(in oklab, #c62828 75%, var(--ui-text))); font-size: 13px; }
.sender-setup__actions { display: flex; justify-content: flex-end; }
</style>
