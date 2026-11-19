<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useSitesStore, type DomainStatus } from "../stores/sites";
import ConfirmationDialog from "./ConfirmationDialog.vue";
import { permanentPublicSiteUrl } from "../utils/publicSiteUrl";

const props = defineProps<{
  siteId?: string;
  username: string;
  sitePublished?: boolean;
  siteRole?: "profile" | "organization";
  fallbackUrl?: string;
  /** @deprecated Use sitePublished. */
  profilePublished?: boolean;
  initialDomain?: string;
  embedded?: boolean;
  managed?: boolean;
  /** Connect `initialDomain` straight away (the site editor's "Publish and connect"). */
  autoConnect?: boolean;
}>();

const emit = defineEmits<{
  domainStatusChanged: [];
}>();

const sites = useSitesStore();

const domainStatus = ref<DomainStatus | null>(null);
const newDomain = ref("");
const showDomainInput = ref(false);
const showDisconnectConfirm = ref(false);
const domainLoading = ref(false);
const domainError = ref("");
const copySuccess = ref<string | null>(null);
const appliedInitialDomain = ref(false);

const isConnected = computed(
  () => domainStatus.value?.connected && domainStatus.value?.domain,
);
const isDomainActive = computed(() => domainStatus.value?.status === "active");
const isSitePublished = computed(
  () => props.sitePublished === true || props.profilePublished === true,
);
const workerFallbackUrl = computed(
  () =>
    props.fallbackUrl ||
    permanentPublicSiteUrl(props.username, props.siteRole || "profile"),
);
onMounted(async () => {
  await loadDomainStatus();
  applyInitialDomain();
  if (props.autoConnect && newDomain.value && !isConnected.value) await connectDomain();
});

async function loadDomainStatus(emitChange = false) {
  domainStatus.value = await sites.getDomainStatus(props.username);
  if (emitChange) emit("domainStatusChanged");
  applyInitialDomain();
  if (props.embedded && !isConnected.value) {
    showDomainInput.value = true;
  }
}

function applyInitialDomain() {
  const suggestion = normalizeDomainInput(props.initialDomain || "");
  if (
    appliedInitialDomain.value ||
    isConnected.value ||
    !suggestion ||
    newDomain.value
  ) {
    return;
  }

  newDomain.value = suggestion;
  showDomainInput.value = true;
  appliedInitialDomain.value = true;
}

async function connectDomain() {
  const domainToConnect = domainInputForConnect.value;
  if (!domainToConnect) return;

  if (!isSitePublished.value) {
    domainError.value = "Publish this site before connecting a custom domain.";
    return;
  }

  if (!isValidDomain.value) {
    domainError.value = props.managed
      ? "Enter a domain you control, for example kieranbutler.com."
      : "Enter the root domain you control, for example kieranbutler.com.";
    return;
  }

  domainLoading.value = true;
  domainError.value = "";

  const result = await sites.connectDomain(props.username, domainToConnect);

  if (result?.ok) {
    await loadDomainStatus(true);
    newDomain.value = "";
    showDomainInput.value = false;
  } else {
    domainError.value =
      result?.error || sites.error || "Failed to connect domain";
  }

  domainLoading.value = false;
}

async function disconnectDomain() {
  domainLoading.value = true;

  const success = await sites.disconnectDomain(props.username);

  if (success) {
    await loadDomainStatus(true);
    showDisconnectConfirm.value = false;
  }

  domainLoading.value = false;
}

async function refreshStatus() {
  domainLoading.value = true;
  await sites.refreshDomainStatus(props.username);
  await loadDomainStatus(true);
  domainLoading.value = false;
}

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text);
  copySuccess.value = label;
  setTimeout(() => (copySuccess.value = null), 2000);
}

/**
 * Strip the domain from a DNS record name for display.
 * Most registrars auto-append the domain, so we show just the subdomain part.
 * e.g., "_acme-challenge.www.kieran.earth" -> "_acme-challenge.www.kieran.earth"
 * e.g., "kieran.earth" -> "@" (root domain)
 * e.g., "www.kieran.earth" -> "www"
 */
function getRecordNameForDisplay(
  fullName: string,
  domain: string | undefined,
  type?: string,
): string {
  if (!domain) return fullName;

  const domainLower = domain.toLowerCase();
  const nameLower = fullName.toLowerCase();

  // For ACME TXT validation, many providers require the full record name.
  if (type === "txt" && nameLower.startsWith("_acme-challenge.")) {
    return fullName;
  }

  // If it's exactly the domain, it's the root - show @
  if (nameLower === domainLower) {
    if (domainLower.startsWith("www.")) {
      return "www";
    }
    return "@";
  }

  // If it ends with .domain, strip the domain part
  const suffix = `.${domainLower}`;
  if (nameLower.endsWith(suffix)) {
    return fullName.slice(0, -suffix.length);
  }

  return fullName;
}

function normalizeDomainInput(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "";
  const withoutProtocol = trimmed.replace(/^https?:\/\//, "");
  return withoutProtocol
    .split("/")[0]
    .replace(/\.$/, "")
    .replace(/^www\./, "");
}

const normalizedDomainInput = computed(() =>
  normalizeDomainInput(newDomain.value),
);

const domainInputForConnect = computed(() => {
  if (!normalizedDomainInput.value || !props.managed) {
    return normalizedDomainInput.value;
  }
  return `www.${normalizedDomainInput.value}`;
});

const isValidDomain = computed(() =>
  /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
    domainInputForConnect.value,
  ),
);

const domainPreview = computed(() => {
  return isValidDomain.value ? domainInputForConnect.value : "";
});

const rootDomain = computed(() => {
  const domain = domainStatus.value?.domain || domainInputForConnect.value;
  if (!domain) return "";
  return domain.startsWith("www.") ? domain.slice(4) : domain;
});

const adminHost = computed(() => {
  if (props.managed) return "";
  if (domainStatus.value?.admin_host) return domainStatus.value.admin_host;
  return rootDomain.value ? `me3.${rootDomain.value}` : "";
});

const setupDomain = computed(() => domainStatus.value?.domain || domainPreview.value);

const setupHostnames = computed(() =>
  [setupDomain.value, adminHost.value].filter(
    (hostname, index, all) => hostname && all.indexOf(hostname) === index,
  ),
);

watch(
  () => props.initialDomain,
  () => {
    applyInitialDomain();
  },
);
</script>

<template>
  <section class="custom-domain-section">
    <div class="domain-management">
      <!-- Connected domain -->
      <div v-if="isConnected" class="connected-domain">
        <p class="default-me3-url">
          Default ME3 url:
          <a :href="workerFallbackUrl" target="_blank" rel="noopener">
            {{ workerFallbackUrl }}
          </a>
        </p>

        <div class="domain-info">
          <div class="domain-header">
            <span class="domain-name">{{ domainStatus?.domain }}</span>
            <span class="status-badge" :class="domainStatus?.status">
              {{
                domainStatus?.status === "active"
                  ? "Active"
                  : domainStatus?.status === "pending"
                    ? "Pending"
                    : "Failed"
              }}
            </span>
          </div>

          <a
            v-if="isDomainActive"
            :href="domainStatus?.url"
            target="_blank"
            class="domain-link"
          >
            {{ domainStatus?.url }} ↗
          </a>
        </div>

        <!-- DNS Instructions for pending status -->
        <div v-if="domainStatus?.status === 'pending'" class="dns-instructions">
          <h4>{{ managed ? "Connect your www address" : "Complete domain setup" }}</h4>
          <p class="dns-hint">
            {{
              managed
                ? "Add this CNAME record, then click Check status."
                : "Complete the Cloudflare setup for this ME3 install, then check the connection."
            }}
          </p>

          <div v-if="!managed && setupHostnames.length" class="setup-card">
            <strong>Attach custom domains to this Worker</strong>
            <ul class="hostname-list">
              <li v-for="hostname in setupHostnames" :key="hostname">
                <code>{{ hostname }}</code>
                <span>same ME3 Worker</span>
              </li>
            </ul>
          </div>

          <ol
            v-if="domainStatus?.instructions?.length"
            class="domain-instructions"
          >
            <li
              v-for="instruction in domainStatus.instructions"
              :key="instruction"
            >
              {{ instruction }}
            </li>
          </ol>

          <div
            v-for="record in domainStatus?.verification_records || []"
            :key="record.name"
            class="dns-record"
          >
            <div class="record-type">{{ record.type.toUpperCase() }}</div>
            <div class="record-details">
              <div class="record-row">
                <span class="record-label">Name:</span>
                <code class="record-name-display">{{
                  getRecordNameForDisplay(
                    record.name,
                    domainStatus?.domain,
                    record.type,
                  )
                }}</code>
                <button
                  class="copy-btn"
                  @click="
                    copyToClipboard(
                      getRecordNameForDisplay(
                        record.name,
                        domainStatus?.domain,
                        record.type,
                      ),
                      record.name,
                    )
                  "
                >
                  {{ copySuccess === record.name ? "✓" : "Copy" }}
                </button>
              </div>
              <div class="record-row">
                <span class="record-label">Value:</span>
                <code>{{ record.value }}</code>
                <button
                  class="copy-btn"
                  @click="copyToClipboard(record.value, record.value)"
                >
                  {{ copySuccess === record.value ? "✓" : "Copy" }}
                </button>
              </div>
            </div>
          </div>

          <p v-if="managed" class="dns-warning">
            This connects www only; redirect the root domain separately.
          </p>

          <div class="registrar-guides">
            <span class="guides-label">Setup guides:</span>
            <a
              v-for="guide in domainStatus?.registrar_guides"
              :key="guide.name"
              :href="guide.url"
              target="_blank"
              class="guide-link"
            >
              {{ guide.name }}
            </a>
          </div>

          <button
            class="button secondary"
            :disabled="domainLoading"
            @click="refreshStatus"
          >
            {{ domainLoading ? "Checking..." : "Check status" }}
          </button>
        </div>

        <div class="domain-actions-row">
          <button
            class="button danger-outline"
            @click="showDisconnectConfirm = true"
          >
            Disconnect Domain
          </button>
        </div>
      </div>

      <!-- No domain connected -->
      <div v-else class="no-domain">
        <!-- Connect existing domain -->
        <div v-if="!showDomainInput && !embedded" class="domain-actions">
          <p v-if="!isSitePublished" class="domain-requirement">
            Publish this site before connecting a custom domain.
          </p>
          <button
            class="button primary"
            :disabled="!isSitePublished"
            @click="showDomainInput = true"
          >
            {{ managed ? "Connect domain" : "Connect root domain" }}
          </button>
          <router-link
            v-if="!isSitePublished"
            class="button secondary"
            :to="{
              path: '/create',
              query: {
                ...(siteId ? { siteId } : {}),
                site: username,
                step: 'publish',
                return: '/settings?section=domain',
              },
            }"
          >
            Publish site
          </router-link>
        </div>

        <!-- Domain input -->
        <p v-if="embedded && !isSitePublished" class="domain-requirement">
          Publish this site before connecting a custom domain.
        </p>
        <form
          v-if="showDomainInput"
          class="domain-input-wrapper"
          :class="{ 'domain-input-wrapper--embedded': embedded }"
          @submit.prevent="connectDomain"
        >
          <div class="input-row">
            <input
              v-model="newDomain"
              type="text"
              aria-label="Custom domain"
              placeholder="yourdomain.com"
              class="domain-input"
            />
            <button
              class="button primary"
              type="submit"
              :disabled="
                domainLoading ||
                !isSitePublished ||
                !normalizedDomainInput ||
                !isValidDomain
              "
            >
              {{
                domainLoading
                  ? "Connecting..."
                  : embedded
                    ? "Save"
                    : "Connect"
              }}
            </button>
            <button
              v-if="!embedded"
              class="button text"
              type="button"
              @click="showDomainInput = false"
            >
              Cancel
            </button>
          </div>
          <div class="domain-options">
            <span v-if="domainPreview" class="domain-preview">
              Public site: <strong>{{ domainPreview }}</strong>
              <template v-if="adminHost">
                · ME3 login: <strong>{{ adminHost }}</strong>
              </template>
              · Default ME3 url:
              <a :href="workerFallbackUrl" target="_blank" rel="noopener">
                <strong>{{ workerFallbackUrl }}</strong>
              </a>
            </span>
            <span v-else-if="normalizedDomainInput" class="domain-note">
              {{
                managed
                  ? "ME3 will connect the www address and keep your permanent me3.app address available."
                  : "Use the root domain you control."
              }}
              <strong v-if="!managed">kieranbutler.com</strong>
            </span>
          </div>
          <p v-if="domainError" class="error">{{ domainError }}</p>
        </form>
      </div>
    </div>

    <ConfirmationDialog
      :open="showDisconnectConfirm"
      title="Disconnect domain?"
      :message="`Disconnect ${domainStatus?.domain || 'this domain'}? Your site will remain available at ${workerFallbackUrl}.`"
      confirm-label="Disconnect"
      :busy="domainLoading"
      danger
      @cancel="showDisconnectConfirm = false"
      @confirm="disconnectDomain"
    />
  </section>
</template>

<style scoped>
.custom-domain-section {
  margin-bottom: 24px;
}

.link-btn {
  background: none;
  border: none;
  color: var(--color-text);
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
  font-size: inherit;
}

.domain-actions {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.domain-actions .button {
  width: 100%;
}

.domain-requirement {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.45;
}

.default-me3-url {
  margin: 0 0 16px;
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.45;
}

.default-me3-url a {
  color: var(--color-text);
  font-weight: 600;
  text-decoration: none;
  overflow-wrap: anywhere;
}

.default-me3-url a:hover {
  text-decoration: underline;
}

.connected-domain {
  padding: 20px;
  margin-bottom: 20px;
  background: var(--color-border);
  border-radius: 12px;
}

.domain-info {
  margin-bottom: 16px;
}

.domain-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.domain-name {
  font-size: 18px;
  font-weight: 600;
}

.status-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 20px;
}

.status-badge.active {
  background: #e8f5e9;
  color: #2e7d32;
}

.status-badge.pending {
  background: #fff3e0;
  color: #e65100;
}

.status-badge.failed {
  background: #ffebee;
  color: #c62828;
}

.domain-link {
  color: var(--color-text-muted);
  font-size: 14px;
  text-decoration: none;
}

.domain-link:hover {
  text-decoration: underline;
}

.domain-actions-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: nowrap;
}

.verify-account-btn {
  padding: 0 !important;
}

.dns-instructions {
  margin: 20px 0;
  padding: 16px;
  background: var(--color-bg);
  border-radius: 8px;
}

.dns-instructions h4 {
  margin-bottom: 8px;
  font-size: 14px;
}

.dns-hint {
  font-size: 13px;
  color: var(--color-text-muted);
  margin-bottom: 16px;
}

.domain-instructions {
  display: grid;
  gap: 8px;
  margin: 0 0 16px 18px;
  padding: 0;
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.45;
}

.setup-card {
  display: grid;
  gap: 10px;
  padding: 14px;
  margin-bottom: 14px;
  background: var(--color-border);
  border-radius: 8px;
}

.setup-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.setup-card strong {
  font-size: 13px;
}

.setup-card pre {
  margin: 0;
  padding: 12px;
  overflow-x: auto;
  background: var(--color-bg);
  border-radius: 6px;
}

.setup-card code {
  font-size: 12px;
}

.setup-card p {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.45;
}

.hostname-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.hostname-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--color-text-muted);
  font-size: 13px;
}

.hostname-list code {
  padding: 4px 8px;
  background: var(--color-bg);
  border-radius: 4px;
  color: var(--color-text);
  overflow-wrap: anywhere;
}

.dns-tip {
  display: block;
  font-size: 12px;
  opacity: 0.8;
  margin-top: 4px;
}

.dns-warning {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: -6px 0 16px;
}

.dns-warning strong {
  color: var(--color-text);
}

.record-name-display {
  font-weight: 600;
}

.dns-record {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
  padding: 12px;
  background: var(--color-border);
  border-radius: 6px;
}

.record-type {
  font-weight: 700;
  font-size: 12px;
  color: var(--color-text-muted);
  min-width: 50px;
}

.record-details {
  flex: 1;
}

.record-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.record-row:last-child {
  margin-bottom: 0;
}

.record-label {
  font-size: 12px;
  color: var(--color-text-muted);
  min-width: 45px;
}

.record-details code {
  font-size: 12px;
  background: var(--color-bg);
  padding: 4px 8px;
  border-radius: 4px;
  word-break: break-all;
  flex: 1;
}

.copy-btn {
  font-size: 11px;
  padding: 4px 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
}

.registrar-guides {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin: 16px 0;
}

.guides-label {
  font-size: 13px;
  color: var(--color-text-muted);
}

.guide-link {
  font-size: 13px;
  color: var(--color-text);
  text-decoration: none;
  padding: 4px 10px;
  background: var(--color-border);
  border-radius: 4px;
}

.guide-link:hover {
  background: var(--color-text);
  color: var(--color-bg);
}

.support-link {
  margin: 8px 0 16px;
  font-size: 13px;
}

.support-link a {
  color: var(--color-text);
  text-decoration: underline;
}

.support-link a:hover {
  opacity: 0.8;
}

.domain-input-wrapper {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.domain-input-wrapper--embedded .input-row .button.primary {
  flex: 0 0 96px;
  padding-inline: 24px;
}

.input-row {
  display: flex;
  gap: 12px;
  min-width: 0;
}

.domain-options {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.checkbox {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--color-text-muted);
}

.domain-preview {
  font-size: 12px;
  color: var(--color-text-muted);
}

.domain-preview strong {
  color: var(--color-text);
}

.domain-note {
  font-size: 12px;
  color: var(--color-text-muted);
}

.domain-note strong {
  color: var(--color-text);
}

.domain-input {
  flex: 1;
  min-width: 0;
  padding: 12px 16px;
  font-size: 14px;
  border: 2px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
  color: var(--color-text);
}

@media (max-width: 720px) {
  .domain-input-wrapper:not(.domain-input-wrapper--embedded) .input-row,
  .hostname-list li {
    align-items: stretch;
    flex-direction: column;
  }
}

.domain-input::placeholder {
  color: var(--color-text-muted);
}

.domain-input:focus {
  outline: none;
  border-color: var(--color-text);
}

.button {
  padding: 12px 24px;
  font-size: 14px;
  font-weight: 600;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.button.primary {
  background: var(--color-text);
  color: var(--color-bg);
}

.button.primary:hover:not(:disabled) {
  opacity: 0.9;
}

.button.secondary {
  background: var(--color-border);
  color: var(--color-text);
}

.button.danger {
  background: #e53935;
  color: white;
}

.button.danger-outline {
  background: transparent;
  border: 1px solid #e53935;
  color: #e53935;
  padding: 8px 16px;
  font-size: 13px;
}

.button.text {
  background: none;
  color: var(--color-text-muted);
  padding: 8px 0;
}

.button.small {
  padding: 8px 16px;
  font-size: 13px;
}

.button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error {
  color: #e53935;
  font-size: 13px;
}

.button.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@media (prefers-color-scheme: dark) {
  .status-badge.active {
    background: #1b5e20;
    color: #a5d6a7;
  }

  .status-badge.pending {
    background: #e65100;
    color: #ffe0b2;
  }

  .status-badge.failed {
    background: #b71c1c;
    color: #ffcdd2;
  }

  .availability {
    background: #b71c1c;
    color: #ffcdd2;
  }

  .availability.available {
    background: #1b5e20;
    color: #a5d6a7;
  }
}
</style>
