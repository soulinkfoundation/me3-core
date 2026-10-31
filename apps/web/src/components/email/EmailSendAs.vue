<script setup lang="ts">
import { computed, onMounted, ref, useId } from "vue";
import { api } from "../../api";
import { useAppToast } from "../../composables/useAppToast";
import Button from "../Button.vue";
import CampaignSenderSetup from "../campaigns/CampaignSenderSetup.vue";

/**
 * Send-as addresses (me3-lmax): addresses forwarded into ME3 that the owner can also
 * send from. Adding one emails a code from the address to itself through the chosen
 * provider; the forward brings it back to the inbox and the owner types it here.
 */
type ProviderId = "cloudflare-email" | "smtp" | "postmark" | "mailgun";
type Identity = {
  id: string;
  address: string;
  displayName: string;
  providerId: string;
  status: "pending" | "verified";
  codeSentAt: string | null;
};
type ProviderSettings = { providers: Array<{ id: string; label: string; configured: boolean }> };

const PROVIDERS: Array<{ id: ProviderId; label: string }> = [
  { id: "cloudflare-email", label: "Cloudflare Email" },
  { id: "smtp", label: "SMTP" },
  { id: "postmark", label: "Postmark" },
  { id: "mailgun", label: "Mailgun" },
];

const { toastSuccess, toastFromUnknown } = useAppToast();
const titleId = `send-as-title-${useId()}`;
const identities = ref<Identity[]>([]);
const configured = ref<Set<string>>(new Set());
const address = ref("");
const displayName = ref("");
const providerId = ref<ProviderId>("cloudflare-email");
const codes = ref<Record<string, string>>({});
const busy = ref<string | null>(null);

const addressValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address.value.trim()));
const providerReady = computed(() => configured.value.has(providerId.value));
const providerLabel = (id: string) => PROVIDERS.find((item) => item.id === id)?.label || id;

async function loadProviders() {
  try {
    const settings = await api.get<ProviderSettings>("/email-provider-settings");
    configured.value = new Set(settings.providers.filter((item) => item.configured).map((item) => item.id));
    const ready = PROVIDERS.find((item) => configured.value.has(item.id));
    if (ready && !configured.value.has(providerId.value)) providerId.value = ready.id;
  } catch {
    configured.value = new Set();
  }
}

async function load() {
  try {
    identities.value = (await api.get<{ identities: Identity[] }>("/email-send-identities")).identities;
  } catch {
    identities.value = [];
  }
}

function replace(identity: Identity) {
  const index = identities.value.findIndex((item) => item.id === identity.id);
  if (index === -1) identities.value = [...identities.value, identity];
  else identities.value = identities.value.map((item) => (item.id === identity.id ? identity : item));
}

async function add() {
  if (!addressValid.value || !providerReady.value || busy.value) return;
  busy.value = "add";
  try {
    const { identity } = await api.post<{ identity: Identity }>("/email-send-identities", {
      address: address.value.trim(),
      displayName: displayName.value.trim(),
      providerId: providerId.value,
    });
    replace(identity);
    address.value = "";
    displayName.value = "";
    toastSuccess(`Code sent to ${identity.address}. It arrives in your inbox through your forward.`);
  } catch (error) {
    toastFromUnknown(error, "The code could not be sent.");
  } finally {
    busy.value = null;
  }
}

async function verify(identity: Identity) {
  if (busy.value) return;
  busy.value = identity.id;
  try {
    const result = await api.post<{ identity: Identity }>(`/email-send-identities/${identity.id}/verify`, {
      code: codes.value[identity.id] || "",
    });
    replace(result.identity);
    toastSuccess(`You can now send as ${identity.address}.`);
  } catch (error) {
    toastFromUnknown(error, "That code did not work.");
  } finally {
    busy.value = null;
  }
}

async function resend(identity: Identity) {
  if (busy.value) return;
  busy.value = identity.id;
  try {
    replace((await api.post<{ identity: Identity }>(`/email-send-identities/${identity.id}/code`)).identity);
    toastSuccess(`New code sent to ${identity.address}.`);
  } catch (error) {
    toastFromUnknown(error, "The code could not be sent.");
  } finally {
    busy.value = null;
  }
}

async function remove(identity: Identity) {
  if (busy.value) return;
  busy.value = identity.id;
  try {
    await api.delete(`/email-send-identities/${identity.id}`);
    identities.value = identities.value.filter((item) => item.id !== identity.id);
    toastSuccess(`${identity.address} removed.`);
  } catch (error) {
    toastFromUnknown(error, "The address could not be removed.");
  } finally {
    busy.value = null;
  }
}

onMounted(() => void Promise.all([load(), loadProviders()]));
</script>

<template>
  <section class="send-as" :aria-labelledby="titleId">
    <h3 :id="titleId">Send from other addresses</h3>
    <p>
      Send as addresses you forward to ME3, like a work address. Replies go out from the
      address the mail was sent to.
    </p>

    <ul v-if="identities.length" class="send-as__list">
      <li v-for="identity in identities" :key="identity.id" class="send-as__item">
        <div class="send-as__identity">
          <strong>{{ identity.displayName || identity.address }}</strong>
          <span v-if="identity.displayName">{{ identity.address }}</span>
          <span class="send-as__meta">
            {{ identity.status === "verified" ? "Ready" : "Waiting for code" }} · {{ providerLabel(identity.providerId) }}
          </span>
        </div>
        <form
          v-if="identity.status === 'pending'"
          class="send-as__code"
          @submit.prevent="verify(identity)"
        >
          <input
            v-model="codes[identity.id]"
            :aria-label="`Code for ${identity.address}`"
            inputmode="numeric"
            autocomplete="one-time-code"
            maxlength="6"
            placeholder="6-digit code"
          />
          <Button color="primary" shape="soft" size="compact" type="submit" :disabled="busy !== null">Confirm</Button>
          <Button color="ghost" shape="soft" size="compact" type="button" :disabled="busy !== null" @click="resend(identity)">
            New code
          </Button>
        </form>
        <Button
          color="ghost"
          shape="soft"
          size="compact"
          type="button"
          :disabled="busy !== null"
          :aria-label="`Remove ${identity.address}`"
          @click="remove(identity)"
        >Remove</Button>
      </li>
    </ul>

    <form class="send-as__fields" @submit.prevent="add">
      <label class="send-as__field">
        <span>Address</span>
        <input v-model="address" type="email" autocomplete="off" placeholder="you@yourdomain.com" />
      </label>
      <label class="send-as__field">
        <span>Name (optional)</span>
        <input v-model="displayName" autocomplete="off" placeholder="How recipients see you" />
      </label>
      <label class="send-as__field">
        <span>Send through</span>
        <select v-model="providerId">
          <option v-for="item in PROVIDERS" :key="item.id" :value="item.id">
            {{ item.label }}{{ configured.has(item.id) ? "" : " (not connected)" }}
          </option>
        </select>
      </label>
      <p class="send-as__hint">
        The provider must be allowed to send for this address's domain. With Cloudflare Email,
        add the domain under Email Sending in the Cloudflare account that holds it.
      </p>
      <div v-if="providerReady" class="send-as__actions">
        <Button color="primary" shape="soft" size="compact" type="submit" :disabled="!addressValid || busy !== null">
          {{ busy === "add" ? "Sending code…" : "Send code" }}
        </Button>
      </div>
    </form>

    <CampaignSenderSetup
      v-if="!providerReady"
      :key="providerId"
      class="send-as__connect"
      :activate="false"
      :provider="providerId"
      :preset-from="address.trim().toLowerCase()"
      :title="`Connect ${providerLabel(providerId)}`"
      description="Connect it once. Your main ME3 sender stays the same."
      @connected="loadProviders"
    />
  </section>
</template>

<style scoped>
.send-as { display: grid; gap: 8px; margin-top: 20px; }
.send-as h3 { margin: 0; font-size: 15px; font-weight: 700; }
.send-as > p { margin: 0; color: var(--ui-text-muted); font-size: 13px; line-height: 1.45; }
.send-as__list { display: grid; gap: 10px; margin: 4px 0 0; padding: 0; list-style: none; }
.send-as__item { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; padding: 10px 12px; border-radius: 12px; background: var(--ui-surface); box-shadow: var(--ui-shadow-sm); }
.send-as__identity { display: grid; flex: 1 1 200px; min-width: 0; gap: 2px; font-size: 14px; }
.send-as__identity strong,
.send-as__identity span { overflow-wrap: anywhere; }
.send-as__meta { color: var(--ui-text-muted); font-size: 12px; }
.send-as__code { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.send-as__code input { width: 9ch; min-height: 36px; padding: 4px 0; border: 0; border-bottom: 1px solid var(--ui-border); background: transparent; color: var(--ui-text); font: inherit; font-size: 15px; letter-spacing: 0.08em; }
.send-as__fields { display: grid; gap: 12px; margin-top: 4px; }
.send-as__field { display: grid; gap: 4px; min-width: 0; }
.send-as__field > span { color: var(--ui-text-muted); font-size: 12px; font-weight: 600; }
.send-as__field input,
.send-as__field select { box-sizing: border-box; width: 100%; min-height: 40px; padding: 6px 0; border: 0; border-bottom: 1px solid var(--ui-border); border-radius: 0; background: transparent; color: var(--ui-text); font: inherit; font-size: 15px; }
.send-as__field input:focus,
.send-as__field select:focus,
.send-as__code input:focus { outline: none; border-bottom-color: var(--ui-accent); box-shadow: 0 1px 0 var(--ui-accent); }
.send-as__hint { margin: -4px 0 0; color: var(--ui-text-muted); font-size: 12px; line-height: 1.45; }
.send-as__actions { display: flex; justify-content: flex-end; }
.send-as__connect { margin-top: 8px; }
</style>
