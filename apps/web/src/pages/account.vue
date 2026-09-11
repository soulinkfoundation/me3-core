<script setup lang="ts">
import { definePage } from "unplugin-vue-router/runtime";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api";
import { getEmailTestOperation, finishEmailTestOperation } from "../utils/emailTestOperation";
import Button from "../components/Button.vue";
import PageLoading from "../components/PageLoading.vue";
import PluginList from "../components/PluginList.vue";
import SoulinkConnectPanel from "../components/SoulinkConnectPanel.vue";
import StatusBadge from "../components/StatusBadge.vue";
import TelegramConnectPanel from "../components/TelegramConnectPanel.vue";
import UiIcon from "../components/UiIcon.vue";
import { useAppToast } from "../composables/useAppToast";
import { useTheme, type ThemePreference } from "../composables/useTheme";
import { useAuthStore } from "../stores/auth";
import { useSitesStore } from "../stores/sites";
import {
  detectBrowserTimeZone,
  getTimeZoneDisplayLabel,
  isValidTimeZone,
  listSupportedTimeZones,
} from "../utils/timezone";
import {
  AI_AGENT_MODEL_OPTIONS,
  type AiAgentModelOption,
} from "../utils/aiModelCatalog";
import {
  isPluginHiddenFromList,
  isPluginEnabled,
  type PluginRecord,
  type PluginsResponse,
} from "../utils/plugins";
import {
  COMMERCE_CURRENCY_OPTIONS,
  STRIPE_CONNECT_COUNTRIES,
  getInitialStripeConnectCountry,
  persistStripeConnectCountry,
  type CommerceSettingsResponse,
} from "../utils/commerce";

definePage({
  alias: ["/settings"],
  meta: {
    requiresAuth: true,
    title: "Settings | ME3",
    description: "Manage your local ME3 settings.",
    robots: "noindex,follow",
  },
});

type AccountResponse = {
  user: {
    id: string;
    email: string | null;
    name: string;
    username: string;
    timezone: string | null;
    locale: string;
    localeSource: "explicit" | "inferred";
  };
};

type MailboxRecord = {
  id: string;
  aliasLocalPart: string;
  aliasAddress: string | null;
  forwardingEmail: string;
  forwardingStatus: "pending" | "verified";
  forwardingEnabled: boolean;
  forwardingMode: "me3_only" | "forward";
  status: "pending_setup" | "active" | "paused";
  approvalPolicy: "all";
  dailyInboundLimit: number;
  dailyOutboundLimit: number;
  activatedAt: string | null;
  forwardingVerifiedAt: string | null;
  cloudflareDestinationId: string | null;
  cloudflareRuleId: string | null;
  cloudflareLastSyncedAt: string | null;
  cloudflareLastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type MailboxActivity = {
  id: string;
  direction: "inbound" | "outbound";
  kind: "email" | "draft" | "system";
  status:
    | "received"
    | "forwarded"
    | "pending_approval"
    | "approved"
    | "rejected"
    | "sent"
    | "failed"
    | "dropped";
  subject: string;
  preview: string;
  forwardedTo: string | null;
  errorMessage: string | null;
  receivedAt: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  createdAt: string;
};

type MailboxSource = {
  id: string;
  type: "me3_alias" | "custom_domain" | "external_forward";
  address: string;
  status: "pending" | "active" | "paused" | "failed";
  inboundEnabled: boolean;
  outboundEnabled: boolean;
};

type MailboxResponse = {
  tier: "core";
  available: boolean;
  approvalRequired: boolean;
  cloudflareManaged: boolean;
  suggestedAliasLocalPart: string;
  mailbox: MailboxRecord | null;
  sources: MailboxSource[];
  recentActivity: MailboxActivity[];
};

type LocalExecutorPairingInstructions = {
  code: string;
  sourceCommand: string;
  runCommand: string;
  keepAwakeCommand: string;
  expiresAt: string | null;
};

type AiRouteId =
  | "default"
  | "chat"
  | "reasoning"
  | "extraction"
  | "image_generation";

type AiProviderRecord = {
  id: string;
  label: string;
  description: string;
  setupLabel: string;
  supportsApiKey: boolean;
  secretLabel: string | null;
  configured: boolean;
  setupRequired: boolean;
  statusLabel: string;
  source: "binding" | "environment" | "stored" | "not_configured";
  keyHint: string | null;
  keyUpdatedAt: string | null;
  recommendedModels: Record<AiRouteId, string>;
};

type AiRouteRecord = {
  id: AiRouteId;
  label: string;
  providerId: string;
  providerLabel: string;
  model: string;
  configured: boolean;
  setupRequired: boolean;
  source: "stored" | "environment" | "recommended";
};

type AiSettingsResponse = {
  deploymentMode: "managed" | "self_hosted";
  encryptionConfigured: boolean;
  providers: AiProviderRecord[];
  routes: AiRouteRecord[];
  defaults: Record<AiRouteId, AiRouteRecord>;
};

type ManagedAiBillingSettings = {
  available: boolean;
  managed: boolean;
  currency: "usd";
  billingSource: "internal" | "storekit" | "stripe" | null;
  defaultModel: string;
  models: ManagedAiModelOption[];
  eligible: boolean;
  ineligibleReason: string | null;
  overagesEnabled: boolean;
  includedMonthlyCents: number;
  monthlyMaximumCents: number;
  minimumMonthlyMaximumCents: number;
  maximumMonthlyMaximumCents: number;
  currentMonth: string;
  currentMonthUsageMicrousd: number;
  currentMonthBillableMicrousd: number;
  effectiveMaximumCents: number;
  fallbackActive: boolean;
};

type ManagedAiModelOption = {
  id: string;
  label: string;
  description: string;
  recommended: boolean;
};

type ManagedAiLimitChoice = "25" | "50" | "100" | "custom";

type AiRouteInputs = Record<AiRouteId, { providerId: string; model: string }>;

type EmailProviderId =
  | "managed_gateway"
  | "cloudflare-email"
  | "smtp"
  | "mailgun"
  | "postmark";

type EmailProviderSetupRequirement = {
  id: string;
  label: string;
  required: boolean;
  configured: boolean;
  note?: string;
};

type EmailProviderInputs = {
  transport: "binding" | "rest" | "smtp";
  fromAddress: string;
  fromName: string;
  replyToAddress: string;
  sendingDomain: string;
  accountId: string;
  messageStream: string;
  smtpHost: string;
  smtpPort: number | string;
  smtpSecurity: "starttls" | "tls" | "none";
  smtpUsername: string;
  mailgunRegion: "us" | "eu";
  apiToken: string;
};

type EmailProviderRecord = {
  id: EmailProviderId;
  label: string;
  description: string;
  recommended: boolean;
  stable: boolean;
  configured: boolean;
  setupRequired: boolean;
  statusLabel: string;
  source: "managed" | "binding" | "stored" | "manual" | "not_configured";
  secretLabel: string | null;
  keyHint: string | null;
  keyUpdatedAt: string | null;
  lastStatus: "not_configured" | "ready" | "failed" | null;
  lastStatusCheckedAt: string | null;
  lastTestSentAt: string | null;
  lastTestError: string | null;
  setupRequirements: EmailProviderSetupRequirement[];
  config: EmailProviderInputs;
};

type FutureEmailProviderRecord = {
  id: "ses" | "resend" | "sendgrid";
  label: string;
  description: string;
};

type EmailProviderSettingsResponse = {
  encryptionConfigured: boolean;
  activeProviderId: EmailProviderId;
  providers: EmailProviderRecord[];
  futureProviders: FutureEmailProviderRecord[];
};

type AppConnectionsResponse = {
  me3: {
    connected: boolean;
    origin: string;
    disconnectAvailable: boolean;
    installId: string | null;
    coreOrigin: string;
    coreApiOrigin: string;
    meJsonUrl: string;
    meJsonSource: "core_install" | "hosted_profile";
  };
  localAccess: {
    passwordConfigured: boolean;
    transferReadiness: {
      ready: boolean;
      blockers: string[];
    };
  };
};

type CoreGithubStatusResponse = {
  ok: boolean;
  core: {
    version: string;
    releaseChannel: string;
    updateManifestUrl: string;
    releaseNotesUrl: string;
  };
  me3AppConnected: boolean;
  github: {
    connected: boolean;
    accountLogin: string | null;
    repositoryOwner: string | null;
    repositoryName: string | null;
    repositoryUrl: string | null;
    lastUpdateRunId: string | null;
    lastUpdateRunUrl: string | null;
  };
  unavailableReason: string | null;
};

type CoreUpdateManifest = {
  latest?: {
    version?: string;
  };
};

type CoreGithubActionResponse = {
  ok?: boolean;
  url?: string;
  runUrl?: string;
  run_url?: string;
  htmlUrl?: string;
  html_url?: string;
  workflowUrl?: string;
  workflow_url?: string;
  lastUpdateRunUrl?: string;
  last_update_run_url?: string;
  github?: {
    lastUpdateRunUrl?: string | null;
  };
};

type CoreStorageStatusResponse = {
  ok: boolean;
  r2Available: boolean;
  binding: "SITE_ASSETS";
  suggestedBucketName: string;
  r2ActivationUrl: string;
};

const auth = useAuthStore();
const sites = useSitesStore();
const { themePreference, setThemePreference } = useTheme();
const route = useRoute();
const router = useRouter();
const { toastFromUnknown, toastSuccess } = useAppToast();

const loading = ref(false);
const saving = ref(false);
const timezoneInput = ref("");
const savedTimezoneInput = ref("");
const error = ref<string | null>(null);
const supportedTimeZones = listSupportedTimeZones();
const mailboxLoading = ref(false);
const mailboxSaving = ref(false);
const mailboxActivating = ref(false);
const mailboxAvailable = ref(false);
const mailboxCloudflareManaged = ref(false);
const mailbox = ref<MailboxRecord | null>(null);
const mailboxAliasInput = ref("");
const emailAddressInput = ref("");
const mailboxForwardingEnabled = ref(false);
const mailboxForwardingEmail = ref("");
const mailboxError = ref<string | null>(null);
const pluginsLoading = ref(false);
const plugins = ref<PluginRecord[]>([]);
const pluginActionLoading = ref<string | null>(null);
const pluginsError = ref<string | null>(null);
const localExecutorSetupOpen = ref(false);
const localExecutorPairing = ref<LocalExecutorPairingInstructions | null>(null);
const localExecutorPairingBusy = ref(false);
const localExecutorPairingError = ref<string | null>(null);
const localExecutorCopiedCommand = ref<string | null>(null);
const aiSettingsLoading = ref(false);
const aiSettingsSaving = ref(false);
const aiProviders = ref<AiProviderRecord[]>([]);
const aiRoutes = ref<AiRouteRecord[]>([]);
const aiEncryptionConfigured = ref(false);
const aiProviderKeyInputs = ref<Record<string, string>>({});
const aiRouteInputs = ref<AiRouteInputs>(createEmptyAiRouteInputs());
const aiSettingsError = ref<string | null>(null);
const aiDeploymentMode = ref<"managed" | "self_hosted" | null>(null);
const managedAiBilling = ref<ManagedAiBillingSettings | null>(null);
const managedAiDefaultModelInput = ref("");
const managedAiOveragesEnabledInput = ref(false);
const managedAiLimitChoice = ref<ManagedAiLimitChoice>("25");
const managedAiCustomMaximumDollarsInput = ref(300);
const managedAiLimitPresets = ["25", "50", "100"] as const;
const emailProviderLoading = ref(false);
const emailProviderSaving = ref(false);
const emailProviderTesting = ref(false);
const emailProviderEncryptionConfigured = ref(false);
const emailProviders = ref<EmailProviderRecord[]>([]);
const selectedEmailProviderId = ref<EmailProviderId>("cloudflare-email");
const emailProviderInputs = ref<Record<EmailProviderId, EmailProviderInputs>>(
  createEmptyEmailProviderInputs(),
);
const emailProviderError = ref<string | null>(null);
const mailboxGuideOpen = ref(false);
const appConnectionsLoading = ref(false);
const appConnectionsSaving = ref(false);
const me3Connection = ref<AppConnectionsResponse["me3"] | null>(null);
const appConnectionsError = ref<string | null>(null);
const localPasswordConfigured = ref(false);
const localPasswordFormOpen = ref(false);
const localPasswordSaving = ref(false);
const localPasswordInput = ref("");
const localPasswordConfirmationInput = ref("");
const localPasswordError = ref<string | null>(null);
const coreGithubLoading = ref(false);
const coreGithubSaving = ref<"connect" | "update" | null>(null);
const coreGithubStatus = ref<CoreGithubStatusResponse | null>(null);
const coreGithubLatestVersion = ref<string | null>(null);
const coreGithubLastRunUrl = ref<string | null>(null);
const coreGithubError = ref<string | null>(null);
const storageLoading = ref(false);
const storageSaving = ref(false);
const storageModalOpen = ref(route.query.section === "storage");
const storageStatus = ref<CoreStorageStatusResponse | null>(null);
const storageError = ref<string | null>(null);
const storageActivationRunUrl = ref<string | null>(null);
const storagePolling = ref(false);
let storagePollTimer: number | null = null;
let storagePollCount = 0;
const commerceLoading = ref(false);
const commerceSaving = ref(false);
const commerceConnecting = ref(false);
const commerceSettings = ref<CommerceSettingsResponse | null>(null);
const stripeSecretInput = ref("");
const showStripeSecret = ref(false);
const defaultCurrencyInput = ref("USD");
const savedDefaultCurrencyInput = ref("USD");
const commerceError = ref<string | null>(null);
const stripeConnectCountry = ref(getInitialStripeConnectCountry());

const commerceCurrencyOptions = COMMERCE_CURRENCY_OPTIONS;

const soulinkPanelRef = ref<InstanceType<typeof SoulinkConnectPanel> | null>(
  null,
);
const telegramPanelRef = ref<InstanceType<typeof TelegramConnectPanel> | null>(
  null,
);
const telegramSetupOpen = ref(route.query.section === "telegram");

const openSection = ref({
  ai: false,
  appConnections: false,
  account: false,
  mailbox: false,
  payments: false,
  plugins: false,
  storage: route.query.section === "storage",
  timezone: false,
});
const showAiModelSection = true;

const siteDomainSummaries = computed(() =>
  sites.sites.filter(
    (site) =>
      site.site_role === "profile" || site.site_role === "organization",
  ),
);

const saveDisabled = computed(
  () =>
    saving.value ||
    !timezoneInput.value ||
    !isValidTimeZone(timezoneInput.value) ||
    timezoneInput.value === savedTimezoneInput.value,
);

const mailboxAliasNormalized = computed(() =>
  normalizeMailboxAlias(mailboxAliasInput.value),
);

const emailAddressNormalized = computed(() =>
  emailAddressInput.value.trim().toLowerCase(),
);

const emailAddressLocalPart = computed(() => {
  const [localPart = ""] = emailAddressNormalized.value.split("@");
  return normalizeMailboxAlias(localPart);
});

const emailAddressDomain = computed(() => {
  const [, domain = ""] = emailAddressNormalized.value.split("@");
  return normalizeEmailDomain(domain);
});

const emailAddressIsValid = computed(
  () =>
    isValidMailboxEmail(emailAddressNormalized.value) &&
    emailAddressLocalPart.value ===
      emailAddressNormalized.value.split("@")[0] &&
    Boolean(emailAddressDomain.value),
);

const emailDisplayName = computed(() => {
  const name = auth.user?.name?.trim() || "";
  return /^ME3(?: Core)? Owner$/i.test(name) ? "" : name;
});

const installationEmailDomain = computed(() => {
  if (mailboxCloudflareManaged.value) return "me3.app";
  return inferEmailDomainFromHost(window.location.hostname);
});

const managedMailboxAddress = computed(() => {
  const address = mailbox.value?.aliasAddress?.trim().toLowerCase() || "";
  if (mailboxCloudflareManaged.value && isValidMailboxEmail(address)) {
    return address;
  }
  const localPart =
    mailboxAliasNormalized.value || mailbox.value?.aliasLocalPart || "";
  return mailboxCloudflareManaged.value && localPart
    ? `${localPart}@me3.app`
    : "";
});

const mailboxRoutedAddress = computed(() => {
  const localPart =
    mailboxAliasNormalized.value || mailbox.value?.aliasLocalPart || "";
  if (localPart && installationEmailDomain.value) {
    return `${localPart}@${installationEmailDomain.value}`;
  }
  return "";
});

const selectedEmailProviderIsManaged = computed(
  () => selectedEmailProviderId.value === "managed_gateway",
);

const selectedProviderNeedsSecret = computed(() => {
  const active = activeEmailProvider.value;
  if (
    !active?.secretLabel ||
    selectedEmailProviderId.value === "cloudflare-email"
  ) {
    return false;
  }
  return !active.keyHint && !activeEmailProviderInput.value.apiToken.trim();
});

const emailProviderSpecificSettingsValid = computed(() => {
  const input = activeEmailProviderInput.value;
  if (selectedEmailProviderId.value === "smtp") {
    return Boolean(
      input.smtpHost.trim() &&
      input.smtpUsername.trim() &&
      Number(input.smtpPort) > 0 &&
      !selectedProviderNeedsSecret.value,
    );
  }
  if (selectedEmailProviderId.value === "mailgun") {
    return Boolean(
      input.sendingDomain.trim() && !selectedProviderNeedsSecret.value,
    );
  }
  if (selectedEmailProviderId.value === "postmark") {
    return !selectedProviderNeedsSecret.value;
  }
  return true;
});

const unifiedEmailSaveDisabled = computed(
  () =>
    mailboxSaving.value ||
    mailboxActivating.value ||
    emailProviderSaving.value ||
    mailboxLoading.value ||
    emailProviderLoading.value ||
    !mailboxAvailable.value ||
    !activeEmailProvider.value ||
    !emailAddressIsValid.value ||
    !emailProviderSpecificSettingsValid.value ||
    (emailProviderApiTokenCount.value > 0 &&
      !emailProviderEncryptionConfigured.value),
);

const emailSenderSaveDisabled = computed(
  () =>
    emailProviderSaving.value ||
    emailProviderLoading.value ||
    !activeEmailProvider.value ||
    (!selectedEmailProviderIsManaged.value &&
      (!emailAddressIsValid.value ||
        !emailProviderSpecificSettingsValid.value ||
        (emailProviderApiTokenCount.value > 0 &&
          !emailProviderEncryptionConfigured.value))),
);

const soulinkStatusLabel = computed(() => {
  const panel = soulinkPanelRef.value;
  if (!panel) return "";
  if (!panel.available) return "Not available";
  if (!panel.configured) return "Needs setup";
  if (!panel.connection) return "Not connected";
  if (panel.connection.status === "active") return "Connected";
  if (panel.connection.status === "disconnected") return "Disconnected";
  return "Pending setup";
});

const soulinkStatusClass = computed(() => {
  const panel = soulinkPanelRef.value;
  if (!panel) return "pending_setup";
  if (!panel.available || !panel.connection) return "pending_setup";
  if (panel.connection.status === "disconnected") return "paused";
  return panel.connection.status;
});

const telegramStatusLabel = computed(() => {
  const panel = telegramPanelRef.value;
  if (!panel) return "";
  if (!panel.available) return "Not available";
  if (!panel.configured) return "Needs setup";
  if (!panel.connection) return "Not connected";
  if (panel.connection.status === "active") return "Connected";
  if (panel.connection.status === "disconnected") return "Disconnected";
  return "Pending setup";
});

const telegramStatusClass = computed(() => {
  const panel = telegramPanelRef.value;
  if (!panel) return "pending_setup";
  if (!panel.available || !panel.connection) return "pending_setup";
  if (panel.connection.status === "disconnected") return "paused";
  return panel.connection.status;
});

const visibleAccountPlugins = computed(() =>
  plugins.value.filter((plugin) => !isPluginHiddenFromList(plugin)),
);

const pluginBusyIds = computed(() =>
  pluginActionLoading.value ? [pluginActionLoading.value.split(":")[0]] : [],
);

const localExecutorPlugin = computed(
  () =>
    plugins.value.find((plugin) => plugin.id === "me3.local-executor") || null,
);

const localExecutorPluginEnabled = computed(() =>
  Boolean(
    localExecutorPlugin.value && isPluginEnabled(localExecutorPlugin.value),
  ),
);

const localExecutorPairingExpiryLabel = computed(() =>
  formatLocalExecutorExpiry(localExecutorPairing.value?.expiresAt),
);

const localExecutorPairingCommand = computed(
  () => localExecutorPairing.value?.sourceCommand || "",
);

const aiDefaultRouteInput = computed(
  () => aiRouteInputs.value.default || { providerId: "", model: "" },
);

const selectedAgentModelOption = computed(
  () =>
    AI_AGENT_MODEL_OPTIONS.find(
      (option) =>
        option.providerId === aiDefaultRouteInput.value.providerId &&
        option.model === aiDefaultRouteInput.value.model,
    ) || null,
);

const selectedAgentProvider = computed(() =>
  aiProviders.value.find(
    (provider) => provider.id === aiDefaultRouteInput.value.providerId,
  ),
);

const visibleAiProviders = computed(() =>
  aiProviders.value.filter((provider) =>
    AI_AGENT_MODEL_OPTIONS.some((option) => option.providerId === provider.id),
  ),
);

const visibleAgentModelOptions = computed(() =>
  AI_AGENT_MODEL_OPTIONS.filter(
    (option) => option.providerId === aiDefaultRouteInput.value.providerId,
  ),
);

const selectedAgentModelDescription = computed(
  () =>
    selectedAgentModelOption.value?.description ||
    "Use this model for the ME3 agent.",
);

const selectedAgentModelCostLabel = computed(
  () => selectedAgentModelOption.value?.costLabel || "Paid",
);

const selectedProviderKeyInput = computed({
  get() {
    return (
      aiProviderKeyInputs.value[aiDefaultRouteInput.value.providerId] || ""
    );
  },
  set(value: string) {
    aiProviderKeyInputs.value = {
      ...aiProviderKeyInputs.value,
      [aiDefaultRouteInput.value.providerId]: value,
    };
  },
});

const selectedProviderNeedsKey = computed(
  () =>
    Boolean(selectedAgentProvider.value?.supportsApiKey) &&
    !selectedAgentProvider.value?.configured,
);

const aiProviderKeyInputCount = computed(
  () =>
    Object.values(aiProviderKeyInputs.value).filter((value) => value.trim())
      .length,
);

const aiAgentModelInvalid = computed(
  () =>
    !aiDefaultRouteInput.value.providerId ||
    !aiDefaultRouteInput.value.model.trim(),
);

const aiSettingsSaveDisabled = computed(
  () =>
    aiSettingsSaving.value ||
    aiSettingsLoading.value ||
    aiAgentModelInvalid.value ||
    (selectedProviderNeedsKey.value &&
      !selectedProviderKeyInput.value.trim()) ||
    (aiProviderKeyInputCount.value > 0 && !aiEncryptionConfigured.value),
);

const managedAiMonthlyMaximumCentsInput = computed(() => {
  if (managedAiLimitChoice.value === "custom") {
    return Math.round(Number(managedAiCustomMaximumDollarsInput.value) * 100);
  }
  return Number(managedAiLimitChoice.value) * 100;
});

const managedAiSelectedModel = computed(() =>
  managedAiBilling.value?.models.find(
    (model) => model.id === managedAiDefaultModelInput.value,
  ) || null,
);

const managedAiBillingSaveDisabled = computed(() => {
  const settings = managedAiBilling.value;
  if (!settings || !settings.managed || aiSettingsSaving.value) return true;
  if (!settings.eligible && managedAiOveragesEnabledInput.value) return true;
  const maximum = managedAiMonthlyMaximumCentsInput.value;
  return (
    !Number.isInteger(maximum) ||
    maximum < settings.minimumMonthlyMaximumCents ||
    maximum > settings.maximumMonthlyMaximumCents ||
    (managedAiDefaultModelInput.value === settings.defaultModel &&
      managedAiOveragesEnabledInput.value === settings.overagesEnabled &&
      (!managedAiOveragesEnabledInput.value && !settings.overagesEnabled ||
        maximum === settings.monthlyMaximumCents))
  );
});

const managedAiUsagePercent = computed(() => {
  const settings = managedAiBilling.value;
  if (!settings) return 0;
  const maximumMicrousd = Math.max(1, settings.effectiveMaximumCents * 10_000);
  return Math.min(
    100,
    Math.max(0, (settings.currentMonthUsageMicrousd / maximumMicrousd) * 100),
  );
});

const managedAiUsageLabel = computed(() => {
  return `${Math.round(managedAiUsagePercent.value)}% used`;
});

const activeEmailProvider = computed(
  () =>
    emailProviders.value.find(
      (provider) => provider.id === selectedEmailProviderId.value,
    ) || null,
);

const activeEmailProviderInput = computed(
  () => emailProviderInputs.value[selectedEmailProviderId.value],
);

const emailProviderSecretPlaceholder = computed(() => {
  const hasStoredSecret = Boolean(activeEmailProvider.value?.keyHint);
  if (selectedEmailProviderId.value === "smtp") {
    return hasStoredSecret
      ? "Paste a new password to replace stored value"
      : "Paste SMTP password";
  }
  if (selectedEmailProviderId.value === "mailgun") {
    return hasStoredSecret
      ? "Paste a new API key to replace stored value"
      : "Paste Mailgun API key";
  }
  return hasStoredSecret
    ? "Paste a new token to replace stored value"
    : "Paste provider token";
});

const emailProviderApiTokenCount = computed(
  () =>
    Object.values(emailProviderInputs.value).filter((value) =>
      value.apiToken.trim(),
    ).length,
);

const commerceSaveDisabled = computed(
  () =>
    commerceSaving.value ||
    commerceLoading.value ||
    (!stripeSecretInput.value.trim() &&
      defaultCurrencyInput.value === savedDefaultCurrencyInput.value),
);

const commerceClearDisabled = computed(
  () => commerceSaving.value || commerceLoading.value,
);

const managedStripeStatusLabel = computed(() => {
  const status = commerceSettings.value?.stripe.connectionStatus;
  if (status === "active") return "Stripe connected";
  if (status === "restricted") return "Action required";
  if (status === "pending") return "Setup incomplete";
  if (status === "unavailable") return "Status unavailable";
  return "Not connected";
});

const managedStripeStatusTone = computed(() => {
  const status = commerceSettings.value?.stripe.connectionStatus;
  if (status === "active") return "active";
  if (status === "pending") return "pending";
  if (status === "restricted" || status === "unavailable") return "failed";
  return "disconnected";
});

const managedStripeDescription = computed(() => {
  const status = commerceSettings.value?.stripe.connectionStatus;
  if (status === "active") {
    return commerceSettings.value?.stripe.mode === "managed"
      ? "Stripe Connect is active. Processing fees, refunds, and disputes are handled on your Stripe account."
      : "Stripe Connect is ready. Switch to it to stop using the stored API key for customer payments.";
  }
  if (status === "restricted") {
    return "Stripe needs more information before payments and payouts are ready.";
  }
  if (status === "pending") {
    return "Continue Stripe setup before publishing paid bookings or products.";
  }
  if (status === "unavailable") {
    return "ME3 could not check Stripe right now. Try again before publishing paid offers.";
  }
  return "Connect your Stripe account before publishing paid bookings or products.";
});

const managedStripeActionLabel = computed(() => {
  const status = commerceSettings.value?.stripe.connectionStatus;
  if (commerceConnecting.value) return "Opening Stripe...";
  if (status === "pending" || status === "restricted") return "Continue Stripe setup";
  return "Connect Stripe";
});

const me3ConnectionStatusLabel = computed(() => {
  if (appConnectionsLoading.value) return "Loading";
  return me3Connection.value?.connected ? "Connected" : "Not connected";
});

const me3ConnectionStatusClass = computed(() =>
  me3Connection.value?.connected ? "active" : "pending_setup",
);

const me3ConnectionDescription = computed(() => {
  const connection = me3Connection.value;
  if (!connection)
    return "Use ME3.app to claim and sign in to this Core install.";
  if (connection.connected) {
    return connection.meJsonSource === "core_install"
      ? "ME3.app is linked and should prefer this Core install's public me.json."
      : "ME3.app is linked.";
  }
  return "Use ME3.app to claim and sign in to this Core install.";
});

const me3AccountURL = computed(() => {
  const origin = me3Connection.value?.origin || "https://me3.app";
  try {
    return new URL("/account", origin).toString();
  } catch {
    return "https://me3.app/account";
  }
});

const localPasswordSaveDisabled = computed(
  () =>
    localPasswordSaving.value ||
    localPasswordInput.value.trim().length < 8 ||
    localPasswordInput.value.trim() !==
      localPasswordConfirmationInput.value.trim(),
);

const localPasswordConfirmationMismatch = computed(
  () =>
    localPasswordConfirmationInput.value.length > 0 &&
    localPasswordInput.value.trim() !==
      localPasswordConfirmationInput.value.trim(),
);

const coreGithubConnection = computed(
  () => coreGithubStatus.value?.github || null,
);

const coreGithubNeedsMe3Reconnect = computed(
  () =>
    Boolean(coreGithubStatus.value?.me3AppConnected) &&
    !coreGithubConnection.value?.connected &&
    coreGithubStatus.value?.unavailableReason?.startsWith("Reconnect ME3.app"),
);

const coreGithubConnectLabel = computed(() => {
  if (coreGithubNeedsMe3Reconnect.value) {
    return appConnectionsSaving.value ? "Opening..." : "Reconnect";
  }
  return coreGithubSaving.value === "connect" ? "Opening..." : "Connect";
});

const coreGithubStatusLabel = computed(() => {
  if (coreGithubLoading.value) return "Loading";
  if (!coreGithubStatus.value?.me3AppConnected) return "Needs ME3.app";
  if (coreGithubConnection.value?.connected) return "Connected";
  return "Not connected";
});

const coreGithubStatusClass = computed(() => {
  if (!coreGithubStatus.value?.me3AppConnected) return "pending_setup";
  return coreGithubConnection.value?.connected ? "active" : "pending_setup";
});

const coreGithubInstalledVersion = computed(
  () => coreGithubStatus.value?.core.version || "",
);

const coreGithubUpdateAvailable = computed(
  () =>
    Boolean(coreGithubLatestVersion.value) &&
    Boolean(coreGithubInstalledVersion.value) &&
    coreGithubLatestVersion.value !== coreGithubInstalledVersion.value,
);

const coreGithubRepositoryLabel = computed(() => {
  const connection = coreGithubConnection.value;
  if (!connection?.repositoryOwner || !connection.repositoryName) return "";
  return `${connection.repositoryOwner}/${connection.repositoryName}`;
});

const coreGithubRunUrl = computed(
  () =>
    coreGithubLastRunUrl.value ||
    coreGithubConnection.value?.lastUpdateRunUrl ||
    null,
);

const coreGithubDescription = computed(() => {
  if (!coreGithubStatus.value?.me3AppConnected) {
    return "Connect ME3.app to configure the ME3 Updater.";
  }
  if (coreGithubConnection.value?.connected) {
    return coreGithubUpdateAvailable.value
      ? "A newer stable Core release is available."
      : "GitHub updates are ready for this Core repository.";
  }
  if (coreGithubStatus.value.unavailableReason) {
    return coreGithubStatus.value.unavailableReason;
  }
  return "Install the ME3 Updater GitHub App on this Core repository.";
});

const storageBucketName = computed(
  () => storageStatus.value?.suggestedBucketName || "me3-storage",
);

const storageActivationUrl = computed(
  () =>
    storageStatus.value?.r2ActivationUrl ||
    "https://dash.cloudflare.com/?to=/:account/r2/plans",
);

const storageStatusLabel = computed(() => {
  if (storageLoading.value) return "Loading";
  if (storageStatus.value?.r2Available) return "Active";
  if (storagePolling.value) return "Activating";
  return "Not configured";
});

const storageStatusClass = computed(() => {
  if (storageStatus.value?.r2Available) return "active";
  return storagePolling.value ? "pending" : "pending_setup";
});

const storageDescription = computed(() => {
  if (storageStatus.value?.r2Available) {
    return "Storage is active for email attachments, assistant images, generated images, and larger site media.";
  }
  return "Storage is needed for email attachments, assistant image uploads, generated images, and larger site media.";
});

const storageCanActivate = computed(
  () =>
    Boolean(coreGithubConnection.value?.connected) &&
    !storageStatus.value?.r2Available &&
    !storageSaving.value,
);

const themeOptions: Array<{
  value: ThemePreference;
  label: string;
  icon: "Sun" | "Monitor" | "Moon";
}> = [
  {
    value: "light",
    label: "Light",
    icon: "Sun",
  },
  {
    value: "system",
    label: "System",
    icon: "Monitor",
  },
  {
    value: "dark",
    label: "Dark",
    icon: "Moon",
  },
];

function chooseThemePreference(nextTheme: ThemePreference) {
  setThemePreference(nextTheme);
}

function normalizeMailboxAlias(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}

function isValidMailboxEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim().toLowerCase());
}

function normalizeEmailDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .replace(/^www\./, "")
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/^[.-]+|[.-]+$/g, "");
}

function inferEmailDomainFromHost(hostname: string) {
  const normalized = normalizeEmailDomain(hostname);
  if (
    !normalized ||
    normalized === "localhost" ||
    normalized.endsWith(".workers.dev")
  ) {
    return "";
  }
  const parts = normalized.split(".");
  if (parts.length > 2 && ["me3", "api", "www"].includes(parts[0])) {
    return parts.slice(1).join(".");
  }
  return normalized;
}

function inferMailboxAlias() {
  return normalizeMailboxAlias(auth.user?.username || auth.user?.email || "");
}

function inferEmailAddressFromState() {
  const activeFromAddress =
    emailProviderInputs.value[selectedEmailProviderId.value]?.fromAddress || "";
  if (isValidMailboxEmail(activeFromAddress))
    return activeFromAddress.trim().toLowerCase();

  const cloudflareFromAddress =
    emailProviderInputs.value["cloudflare-email"]?.fromAddress || "";
  if (isValidMailboxEmail(cloudflareFromAddress)) {
    return cloudflareFromAddress.trim().toLowerCase();
  }

  if (managedMailboxAddress.value) return managedMailboxAddress.value;

  if (mailboxRoutedAddress.value) return mailboxRoutedAddress.value;

  const localPart =
    mailboxAliasNormalized.value || mailbox.value?.aliasLocalPart || "";
  if (localPart && installationEmailDomain.value) {
    return `${localPart}@${installationEmailDomain.value}`;
  }

  return "";
}

function syncEmailAddressInput(force = false) {
  const inferred = inferEmailAddressFromState();
  if (inferred && (force || !emailAddressInput.value.trim())) {
    emailAddressInput.value = inferred;
  }
}

function syncAccount(response: AccountResponse) {
  auth.setSession({
    ...response.user,
    name: response.user.name ?? auth.user?.name ?? "ME3 Owner",
    username: response.user.username ?? auth.user?.username ?? "owner",
  });
  timezoneInput.value = response.user.timezone || "";
  savedTimezoneInput.value = timezoneInput.value;
}

async function ensureBrowserTimezoneSaved(response: AccountResponse) {
  if (response.user.timezone) return;

  const detected = detectBrowserTimeZone();
  if (!detected) return;

  timezoneInput.value = detected;
  try {
    const saved = await api.put<AccountResponse>("/account", {
      timezone: detected,
      locale: null,
    });
    syncAccount(saved);
  } catch {
    timezoneInput.value = response.user.timezone || "";
    savedTimezoneInput.value = timezoneInput.value;
  }
}

async function loadAccount() {
  loading.value = true;
  error.value = null;
  try {
    const response = await api.get<AccountResponse>("/account");
    syncAccount(response);
    await ensureBrowserTimezoneSaved(response);
  } catch (e: any) {
    error.value = e.message || "Failed to load account settings";
  } finally {
    loading.value = false;
  }
}

function detectTimezoneValue() {
  const detected = detectBrowserTimeZone();
  if (!detected || !isValidTimeZone(detected)) {
    error.value = "Could not detect a valid browser timezone.";
    return;
  }
  timezoneInput.value = detected;
  error.value = null;
}

async function saveSettings() {
  if (saveDisabled.value) return;
  saving.value = true;
  error.value = null;
  try {
    const response = await api.put<AccountResponse>("/account", {
      timezone: timezoneInput.value,
      locale: null,
    });
    syncAccount(response);
    toastSuccess("Regional settings updated.");
  } catch (e: any) {
    error.value = e.message || "Failed to save regional settings";
  } finally {
    saving.value = false;
  }
}

function syncMailboxInputs(response: MailboxResponse) {
  mailboxAvailable.value = response.available;
  mailboxCloudflareManaged.value = response.cloudflareManaged;
  mailbox.value = response.mailbox;
  mailboxAliasInput.value =
    response.mailbox?.aliasLocalPart ||
    mailboxAliasInput.value ||
    response.suggestedAliasLocalPart ||
    inferMailboxAlias();
  mailboxForwardingEnabled.value = Boolean(response.mailbox?.forwardingEnabled);
  mailboxForwardingEmail.value =
    response.mailbox?.forwardingEmail || auth.user?.email || "";
  syncEmailAddressInput();
}

async function loadMailbox() {
  mailboxLoading.value = true;
  mailboxError.value = null;

  try {
    const response = await api.get<MailboxResponse>("/mailbox");
    syncMailboxInputs(response);
  } catch (e: any) {
    mailboxError.value = e.message || "Failed to load mailbox";
  } finally {
    mailboxLoading.value = false;
  }
}

function buildEmailProviderUpdate(emailAddress: string) {
  const input = activeEmailProviderInput.value;
  const domain = normalizeEmailDomain(emailAddress.split("@")[1] || "");
  return {
    id: selectedEmailProviderId.value,
    transport:
      selectedEmailProviderId.value === "cloudflare-email"
        ? "binding"
        : input.transport,
    fromAddress: emailAddress,
    fromName: emailDisplayName.value,
    replyToAddress: emailAddress,
    sendingDomain:
      selectedEmailProviderId.value === "cloudflare-email"
        ? domain
        : input.sendingDomain || "",
    accountId: input.accountId || "",
    messageStream:
      selectedEmailProviderId.value === "postmark"
        ? input.messageStream || "outbound"
        : input.messageStream || "",
    smtpHost: input.smtpHost || "",
    smtpPort: input.smtpPort || "",
    smtpSecurity: input.smtpSecurity || "starttls",
    smtpUsername: input.smtpUsername || "",
    mailgunRegion: input.mailgunRegion || "us",
    apiToken: input.apiToken.trim() || undefined,
  };
}

async function saveUnifiedEmailSettings() {
  if (unifiedEmailSaveDisabled.value) return;

  mailboxSaving.value = true;
  emailProviderSaving.value = true;
  mailboxError.value = null;
  emailProviderError.value = null;

  const emailAddress = emailAddressNormalized.value;
  const localPart = emailAddressLocalPart.value;

  try {
    const mailboxResponse = await api.put<{
      mailbox: MailboxRecord | null;
      sources: MailboxSource[];
    }>("/mailbox", {
      aliasLocalPart: localPart,
      forwardingEnabled: mailboxForwardingEnabled.value,
      forwardingEmail: mailboxForwardingEnabled.value
        ? mailboxForwardingEmail.value.trim()
        : "",
    });
    mailbox.value = mailboxResponse.mailbox;
    mailboxAliasInput.value =
      mailboxResponse.mailbox?.aliasLocalPart || localPart;
    mailboxForwardingEnabled.value = Boolean(
      mailboxResponse.mailbox?.forwardingEnabled,
    );
    mailboxForwardingEmail.value =
      mailboxResponse.mailbox?.forwardingEmail || mailboxForwardingEmail.value;

    if (mailboxResponse.mailbox?.status !== "active") {
      mailboxActivating.value = true;
      const activated = await api.post<{ mailbox: MailboxRecord | null }>(
        "/mailbox/activate",
      );
      mailbox.value = activated.mailbox;
    }

    const providerResponse = await api.put<EmailProviderSettingsResponse>(
      "/email-provider-settings",
      {
        activeProviderId: selectedEmailProviderId.value,
        providers: [buildEmailProviderUpdate(emailAddress)],
      },
    );
    syncEmailProviderSettings(providerResponse);
    emailAddressInput.value = emailAddress;
    toastSuccess("Email settings saved.");
  } catch (e: any) {
    const message = e.message || "Failed to save email settings";
    mailboxError.value = message;
  } finally {
    mailboxSaving.value = false;
    mailboxActivating.value = false;
    emailProviderSaving.value = false;
  }
}

async function saveEmailSenderSettings() {
  if (!mailboxCloudflareManaged.value) {
    await saveUnifiedEmailSettings();
    return;
  }
  if (emailSenderSaveDisabled.value) return;

  emailProviderSaving.value = true;
  mailboxError.value = null;
  emailProviderError.value = null;

  try {
    const providerResponse = await api.put<EmailProviderSettingsResponse>(
      "/email-provider-settings",
      selectedEmailProviderIsManaged.value
        ? { activeProviderId: selectedEmailProviderId.value }
        : {
            activeProviderId: selectedEmailProviderId.value,
            providers: [
              buildEmailProviderUpdate(emailAddressNormalized.value),
            ],
          },
    );
    syncEmailProviderSettings(providerResponse);
    toastSuccess(
      selectedEmailProviderIsManaged.value
        ? "ME3 managed email restored as your sender."
        : "Custom email sender saved.",
    );
  } catch (e: any) {
    emailProviderError.value =
      e.message || "Failed to save email sender settings";
  } finally {
    emailProviderSaving.value = false;
  }
}

async function sendEmailProviderTest() {
  if (emailProviderTesting.value || !emailAddressIsValid.value) return;

  emailProviderTesting.value = true;
  mailboxError.value = null;
  emailProviderError.value = null;

  const scope = JSON.stringify([auth.user?.id, selectedEmailProviderId.value, emailAddressNormalized.value]);
  try {
    const { operationId } = getEmailTestOperation(localStorage, scope);
    const response = await api.post<{
      ok: boolean;
      sentTo: string;
      providerMessageId: string | null;
    }>("/email-provider-settings/test", {
      operationId,
      providerId: selectedEmailProviderId.value,
      to: emailAddressNormalized.value,
    });
    finishEmailTestOperation(localStorage, scope);
    toastSuccess(response.providerMessageId
      ? `Test email sent to ${response.sentTo}. Provider message ${response.providerMessageId}.`
      : `Test email accepted for ${response.sentTo}.`);
    await loadEmailProviderSettings();
  } catch (e: any) {
    if (e.status === 422) finishEmailTestOperation(localStorage, scope);
    emailProviderError.value = e.message || "Failed to send test email";
  } finally {
    emailProviderTesting.value = false;
  }
}

async function loadPlugins() {
  pluginsLoading.value = true;
  pluginsError.value = null;

  try {
    const response = await api.get<PluginsResponse>("/plugins");
    plugins.value = response.plugins || [];
  } catch (e: any) {
    pluginsError.value = e.message || "Failed to load plugins";
  } finally {
    pluginsLoading.value = false;
  }
}

function syncPlugin(plugin: PluginRecord) {
  const index = plugins.value.findIndex(
    (candidate) => candidate.id === plugin.id,
  );
  if (index >= 0) {
    plugins.value.splice(index, 1, plugin);
  } else {
    plugins.value.push(plugin);
  }
  window.dispatchEvent(new CustomEvent("me3:plugins-changed"));
}

function pluginActionKey(
  plugin: PluginRecord,
  action: "activate" | "deactivate",
) {
  return `${plugin.id}:${action}`;
}

const LOCAL_EXECUTOR_SOURCE_BIN =
  "node packages/local-executor/bin/me3-local-executor.mjs";
const LOCAL_EXECUTOR_CD_COMMAND =
  "cd /Users/[USERNAME]/[PROJECTS_FOLDER]/[YOUR_ME3_REPO]";
const LOCAL_EXECUTOR_CONFIG_COMMAND = `${LOCAL_EXECUTOR_SOURCE_BIN} config init --provider opencode`;
const LOCAL_EXECUTOR_RUN_COMMAND = `${LOCAL_EXECUTOR_SOURCE_BIN} run --interval 20`;
const LOCAL_EXECUTOR_KEEP_AWAKE_COMMAND = `caffeinate -dimsu ${LOCAL_EXECUTOR_RUN_COMMAND}`;

function openLocalExecutorSetup() {
  localExecutorSetupOpen.value = true;
  localExecutorPairingError.value = null;
}

function closeLocalExecutorSetup() {
  if (localExecutorPairingBusy.value) return;
  localExecutorSetupOpen.value = false;
  localExecutorCopiedCommand.value = null;
}

async function startLocalExecutorPairing() {
  if (!localExecutorPluginEnabled.value) {
    localExecutorPairingError.value =
      "Turn on Local Executor in the plugin row first.";
    return;
  }

  localExecutorPairingBusy.value = true;
  localExecutorPairingError.value = null;
  localExecutorCopiedCommand.value = null;

  try {
    const response = await api.post<{
      code: string;
      installCommand: string;
      expiresAt?: string | null;
    }>("/local-executor/pairing/start", {
      displayName: "Local runner",
    });
    localExecutorPairing.value = {
      code: response.code,
      sourceCommand: sourceLocalExecutorCommand(response.installCommand),
      runCommand: LOCAL_EXECUTOR_RUN_COMMAND,
      keepAwakeCommand: LOCAL_EXECUTOR_KEEP_AWAKE_COMMAND,
      expiresAt: response.expiresAt || null,
    };
  } catch (e: any) {
    localExecutorPairingError.value =
      e.message || "Could not create a pairing command.";
  } finally {
    localExecutorPairingBusy.value = false;
  }
}

function sourceLocalExecutorCommand(command: string) {
  return command.replace(/^me3-local-executor\b/, LOCAL_EXECUTOR_SOURCE_BIN);
}

function formatLocalExecutorExpiry(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

async function copyLocalExecutorCommand(command: string, key: string) {
  localExecutorPairingError.value = null;
  try {
    await navigator.clipboard.writeText(command);
    localExecutorCopiedCommand.value = key;
  } catch {
    localExecutorPairingError.value =
      "Copy did not work. Select the command and copy it manually.";
  }
}

async function togglePlugin(plugin: PluginRecord, enabled: boolean) {
  if (enabled) {
    await activatePlugin(plugin);
    return;
  }
  await deactivatePlugin(plugin);
}

async function activatePlugin(plugin: PluginRecord) {
  const key = pluginActionKey(plugin, "activate");
  pluginActionLoading.value = key;
  pluginsError.value = null;

  try {
    const response = await api.post<{ plugin: PluginRecord }>(
      `/plugins/${encodeURIComponent(plugin.id)}/activate`,
      {},
    );
    syncPlugin(response.plugin);
  } catch (e: any) {
    pluginsError.value = e.message || "Failed to activate plugin";
  } finally {
    pluginActionLoading.value = null;
  }
}

async function deactivatePlugin(plugin: PluginRecord) {
  const key = pluginActionKey(plugin, "deactivate");
  pluginActionLoading.value = key;
  pluginsError.value = null;

  try {
    const response = await api.post<{ plugin: PluginRecord }>(
      `/plugins/${encodeURIComponent(plugin.id)}/deactivate`,
      {},
    );
    syncPlugin(response.plugin);
  } catch (e: any) {
    pluginsError.value = e.message || "Failed to deactivate plugin";
  } finally {
    pluginActionLoading.value = null;
  }
}

function createEmptyAiRouteInputs(): AiRouteInputs {
  return {
    default: { providerId: "", model: "" },
    chat: { providerId: "", model: "" },
    reasoning: { providerId: "", model: "" },
    extraction: { providerId: "", model: "" },
    image_generation: { providerId: "", model: "" },
  };
}

function applyAgentModelOption(option: AiAgentModelOption) {
  aiRouteInputs.value.default = {
    providerId: option.providerId,
    model: option.model,
  };
}

function handleAgentProviderChange(providerId: string) {
  const firstModel =
    AI_AGENT_MODEL_OPTIONS.find((option) => option.providerId === providerId) ||
    AI_AGENT_MODEL_OPTIONS[0];
  applyAgentModelOption(firstModel);
}

function handleAgentModelChange(model: string) {
  const option = visibleAgentModelOptions.value.find(
    (candidate) => candidate.model === model,
  );
  if (option) {
    applyAgentModelOption(option);
    return;
  }
  aiRouteInputs.value.default.model = model;
}

function syncAiSettings(response: AiSettingsResponse) {
  aiDeploymentMode.value = response.deploymentMode;
  aiProviders.value = response.providers || [];
  aiRoutes.value = response.routes || [];
  aiEncryptionConfigured.value = response.encryptionConfigured;
  aiProviderKeyInputs.value = Object.fromEntries(
    aiProviders.value
      .filter((provider) => provider.supportsApiKey)
      .map((provider) => [provider.id, ""]),
  );

  const nextRouteInputs = createEmptyAiRouteInputs();
  for (const route of aiRoutes.value) {
    nextRouteInputs[route.id] = {
      providerId: route.providerId,
      model: route.model,
    };
  }
  aiRouteInputs.value = nextRouteInputs;
}

function syncManagedAiBilling(response: ManagedAiBillingSettings) {
  managedAiBilling.value = response;
  managedAiDefaultModelInput.value = response.defaultModel;
  managedAiOveragesEnabledInput.value = response.overagesEnabled;
  const maximumCents = Math.max(
    response.monthlyMaximumCents,
    response.minimumMonthlyMaximumCents,
  );
  const preset = ([2_500, 5_000, 10_000] as const).find(
    (value) => value === maximumCents,
  );
  if (preset) {
    managedAiLimitChoice.value = String(preset / 100) as ManagedAiLimitChoice;
  } else if (maximumCents > response.includedMonthlyCents) {
    managedAiLimitChoice.value = "custom";
    managedAiCustomMaximumDollarsInput.value = maximumCents / 100;
  } else {
    managedAiLimitChoice.value = "25";
  }
}

async function loadAiSettings() {
  aiSettingsLoading.value = true;
  aiSettingsError.value = null;

  try {
    const [response, billing] = await Promise.all([
      api.get<AiSettingsResponse>("/ai-settings"),
      api.get<ManagedAiBillingSettings>("/managed-ai-billing-settings"),
    ]);
    syncAiSettings(response);
    syncManagedAiBilling(billing);
  } catch (e: any) {
    aiSettingsError.value = e.message || "Failed to load AI provider settings";
  } finally {
    aiSettingsLoading.value = false;
  }
}

async function saveManagedAiBillingSettings() {
  if (managedAiBillingSaveDisabled.value) return;
  aiSettingsSaving.value = true;
  aiSettingsError.value = null;
  try {
    const response = await api.put<ManagedAiBillingSettings>(
      "/managed-ai-billing-settings",
      {
        defaultModel: managedAiDefaultModelInput.value,
        overagesEnabled: managedAiOveragesEnabledInput.value,
        monthlyMaximumCents: managedAiMonthlyMaximumCentsInput.value,
      },
    );
    syncManagedAiBilling(response);
    toastSuccess(response.overagesEnabled
      ? `AI settings saved with a ${formatManagedAiCents(response.monthlyMaximumCents)} monthly maximum.`
      : "AI settings saved. Additional usage is off.");
  } catch (e: any) {
    aiSettingsError.value = e.message || "Failed to save AI overage settings";
  } finally {
    aiSettingsSaving.value = false;
  }
}

function formatManagedAiCents(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

async function saveAiSettings() {
  if (aiSettingsSaveDisabled.value) return;

  aiSettingsSaving.value = true;
  aiSettingsError.value = null;

  const providers = Object.entries(aiProviderKeyInputs.value)
    .map(([id, apiKey]) => ({ id, apiKey: apiKey.trim() }))
    .filter((provider) => provider.apiKey);
  const agentModel = {
    providerId: aiDefaultRouteInput.value.providerId,
    model: aiDefaultRouteInput.value.model.trim(),
  };
  const defaults = Object.fromEntries(
    (["default", "chat", "reasoning", "extraction"] as const).map((routeId) => [
      routeId,
      agentModel,
    ]),
  );

  try {
    const response = await api.put<AiSettingsResponse>("/ai-settings", {
      providers,
      defaults,
    });
    syncAiSettings(response);
    toastSuccess("AI provider settings saved.");
  } catch (e: any) {
    aiSettingsError.value = e.message || "Failed to save AI provider settings";
  } finally {
    aiSettingsSaving.value = false;
  }
}

function createDefaultEmailProviderInput(
  id: EmailProviderId,
): EmailProviderInputs {
  return {
    transport:
      id === "cloudflare-email" ? "binding" : id === "smtp" ? "smtp" : "rest",
    fromAddress: "",
    fromName: "",
    replyToAddress: "",
    sendingDomain: "",
    accountId: "",
    messageStream: id === "postmark" ? "outbound" : "",
    smtpHost: "",
    smtpPort: id === "smtp" ? 587 : "",
    smtpSecurity: id === "smtp" ? "starttls" : "none",
    smtpUsername: "",
    mailgunRegion: "us",
    apiToken: "",
  };
}

function createEmptyEmailProviderInputs(): Record<
  EmailProviderId,
  EmailProviderInputs
> {
  return {
    managed_gateway: createDefaultEmailProviderInput("managed_gateway"),
    "cloudflare-email": createDefaultEmailProviderInput("cloudflare-email"),
    smtp: createDefaultEmailProviderInput("smtp"),
    mailgun: createDefaultEmailProviderInput("mailgun"),
    postmark: createDefaultEmailProviderInput("postmark"),
  };
}

function syncEmailProviderSettings(response: EmailProviderSettingsResponse) {
  emailProviderEncryptionConfigured.value = response.encryptionConfigured;
  emailProviders.value = response.providers || [];
  const activeProvider = emailProviders.value.find(
    (provider) => provider.id === response.activeProviderId,
  );
  selectedEmailProviderId.value =
    activeProvider &&
    (activeProvider.configured || activeProvider.source !== "not_configured")
      ? response.activeProviderId
      : "cloudflare-email";
  emailProviderInputs.value = createEmptyEmailProviderInputs();

  for (const provider of emailProviders.value) {
    emailProviderInputs.value[provider.id] = {
      ...createDefaultEmailProviderInput(provider.id),
      ...provider.config,
      apiToken: "",
    };
  }

  syncEmailAddressInput(true);
}

async function loadEmailProviderSettings() {
  emailProviderLoading.value = true;
  emailProviderError.value = null;

  try {
    const response = await api.get<EmailProviderSettingsResponse>(
      "/email-provider-settings",
    );
    syncEmailProviderSettings(response);
  } catch (e: any) {
    emailProviderError.value =
      e.message || "Failed to load email sender settings";
  } finally {
    emailProviderLoading.value = false;
  }
}

function syncCommerceSettings(response: CommerceSettingsResponse) {
  commerceSettings.value = response;
  defaultCurrencyInput.value =
    normalizeCommerceCurrency(response.defaultCurrency) || "USD";
  savedDefaultCurrencyInput.value = defaultCurrencyInput.value;
  stripeSecretInput.value = "";
}

async function loadCommerceSettings() {
  commerceLoading.value = true;
  commerceError.value = null;

  try {
    const response =
      await api.get<CommerceSettingsResponse>("/commerce/status");
    syncCommerceSettings(response);
  } catch (e: any) {
    commerceError.value = e.message || "Failed to load payment settings";
  } finally {
    commerceLoading.value = false;
  }
}

async function startManagedStripeOnboarding(
  mode: "onboard" | "refresh" = "onboard",
) {
  if (commerceConnecting.value) return;
  commerceConnecting.value = true;
  commerceError.value = null;

  try {
    persistStripeConnectCountry(stripeConnectCountry.value);
    const response = await api.post<{ url: string }>(
      `/commerce/connect/${mode}`,
      { country: stripeConnectCountry.value },
    );
    window.location.assign(response.url);
  } catch (error) {
    toastFromUnknown(error, "Failed to open Stripe setup.");
    commerceConnecting.value = false;
  }
}

function clearStripeConnectQuery() {
  const query = { ...route.query };
  delete query.stripe_connect;
  void router.replace({ path: route.path, query, hash: route.hash });
}

async function completeStripeConnectReturn() {
  const result = readRouteQueryString(route.query.stripe_connect);
  if (!result) {
    await loadCommerceSettings();
    return;
  }

  openSection.value.payments = true;
  if (result === "refresh") {
    await startManagedStripeOnboarding("refresh");
    return;
  }

  await loadCommerceSettings();
  clearStripeConnectQuery();
  if (commerceSettings.value?.stripe.connectionStatus === "active") {
    await selectCommerceStripeProvider(
      "managed",
      "Stripe Connect is active for customer payments.",
    );
  }
}

async function selectCommerceStripeProvider(
  provider: "direct" | "managed",
  successMessage?: string,
) {
  if (commerceSaving.value) return;
  commerceSaving.value = true;
  commerceError.value = null;
  try {
    const response = await api.put<CommerceSettingsResponse>(
      "/commerce/settings",
      { preferredStripeProvider: provider },
    );
    syncCommerceSettings(response);
    toastSuccess(
      successMessage ||
        (provider === "managed"
          ? "Stripe Connect is now handling customer payments."
          : "The configured Stripe API key is now handling customer payments."),
    );
  } catch (error) {
    toastFromUnknown(error, "Failed to change the Stripe payment provider.");
  } finally {
    commerceSaving.value = false;
  }
}

async function saveCommerceSettings() {
  if (commerceSaveDisabled.value) return;

  commerceSaving.value = true;
  commerceError.value = null;
  const hasStripeSecret = Boolean(stripeSecretInput.value.trim());

  try {
    const payload: { defaultCurrency: string; stripeSecretKey?: string } = {
      defaultCurrency: defaultCurrencyInput.value,
    };
    if (hasStripeSecret)
      payload.stripeSecretKey = stripeSecretInput.value.trim();
    const response = await api.put<CommerceSettingsResponse>(
      "/commerce/settings",
      payload,
    );
    syncCommerceSettings(response);
    toastSuccess(hasStripeSecret
      ? "Payment settings saved."
      : "Default currency saved.");
  } catch (error) {
    toastFromUnknown(error, "Failed to save payment settings.");
  } finally {
    commerceSaving.value = false;
  }
}

async function clearCommerceStripeKey() {
  commerceSaving.value = true;
  commerceError.value = null;

  try {
    const response = await api.put<CommerceSettingsResponse>(
      "/commerce/settings",
      {
        clearStripeSecretKey: true,
      },
    );
    syncCommerceSettings(response);
    toastSuccess("Stored Stripe key removed.");
  } catch (error) {
    toastFromUnknown(error, "Failed to remove the Stripe key.");
  } finally {
    commerceSaving.value = false;
  }
}

function normalizeCommerceCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const currency = value.trim().toUpperCase();
  return commerceCurrencyOptions.some((option) => option.value === currency)
    ? currency
    : null;
}

async function loadAppConnections() {
  appConnectionsLoading.value = true;
  appConnectionsError.value = null;

  try {
    const response = await api.get<AppConnectionsResponse>(
      "/account/app-connections",
    );
    me3Connection.value = response.me3;
    localPasswordConfigured.value = response.localAccess.passwordConfigured;
  } catch (e: any) {
    appConnectionsError.value = e.message || "Failed to load app connections";
  } finally {
    appConnectionsLoading.value = false;
  }
}

async function saveLocalPassword() {
  if (localPasswordSaveDisabled.value) return;
  localPasswordSaving.value = true;
  localPasswordError.value = null;

  try {
    await api.put("/account/password", {
      password: localPasswordInput.value,
      passwordConfirmation: localPasswordConfirmationInput.value,
    });
    localPasswordInput.value = "";
    localPasswordConfirmationInput.value = "";
    localPasswordConfigured.value = true;
    localPasswordFormOpen.value = false;
    toastSuccess("Local password verified. This installation is ready to export.");
    await loadAppConnections();
  } catch (e: any) {
    localPasswordError.value = e.message || "Failed to save local password";
  } finally {
    localPasswordSaving.value = false;
  }
}

function toggleLocalPasswordForm() {
  if (localPasswordFormOpen.value) {
    localPasswordInput.value = "";
    localPasswordConfirmationInput.value = "";
    localPasswordError.value = null;
  } else {
    localPasswordError.value = null;
  }
  localPasswordFormOpen.value = !localPasswordFormOpen.value;
}

async function connectMe3App() {
  if (appConnectionsSaving.value) return;

  appConnectionsSaving.value = true;
  appConnectionsError.value = null;

  try {
    const response = await api.post<{ ok: boolean; url?: string }>(
      "/account/app-connections/me3/start",
      { redirect: "/account?section=connections" },
    );
    if (response.ok && response.url) {
      window.location.href = response.url;
      return;
    }
    appConnectionsError.value = "ME3.app connection is not ready yet.";
  } catch (e: any) {
    appConnectionsError.value =
      e.message || "Failed to start ME3.app connection";
  } finally {
    appConnectionsSaving.value = false;
  }
}

async function disconnectMe3App() {
  if (appConnectionsSaving.value) return;

  appConnectionsSaving.value = true;
  appConnectionsError.value = null;

  try {
    await api.delete("/account/app-connections/me3");
    await loadAppConnections();
  } catch (e: any) {
    appConnectionsError.value = e.message || "Failed to disconnect ME3.app";
  } finally {
    appConnectionsSaving.value = false;
  }
}

async function loadCoreGithubUpdater() {
  coreGithubLoading.value = true;
  coreGithubError.value = null;

  try {
    const status = await api.get<CoreGithubStatusResponse>(
      "/core/github/status",
    );
    coreGithubStatus.value = status;
    if (status.github.lastUpdateRunUrl) {
      coreGithubLastRunUrl.value = status.github.lastUpdateRunUrl;
    }
    await loadCoreGithubManifest(status.core.updateManifestUrl);
  } catch (e: any) {
    coreGithubError.value = e.message || "Failed to load Core updater";
  } finally {
    coreGithubLoading.value = false;
  }
}

async function loadCoreGithubManifest(manifestUrl: string) {
  coreGithubLatestVersion.value = null;
  if (!manifestUrl) return;

  try {
    const response = await fetch(manifestUrl);
    if (!response.ok) return;
    const manifest = (await response.json()) as CoreUpdateManifest;
    coreGithubLatestVersion.value = manifest.latest?.version || null;
  } catch {
    coreGithubLatestVersion.value = null;
  }
}

async function connectCoreGithubUpdater() {
  if (coreGithubSaving.value) return;

  if (coreGithubNeedsMe3Reconnect.value) {
    await connectMe3App();
    return;
  }

  coreGithubSaving.value = "connect";
  coreGithubError.value = null;

  try {
    const response = await api.post<CoreGithubActionResponse>(
      "/core/github/install/start",
      { redirect: "/account?section=connections" },
    );
    if (response.url) {
      window.location.href = response.url;
      return;
    }
    coreGithubError.value = "GitHub install is not ready yet.";
  } catch (e: any) {
    coreGithubError.value = e.message || "Failed to start GitHub install";
  } finally {
    coreGithubSaving.value = null;
  }
}

async function updateCoreFromGithub() {
  if (coreGithubSaving.value) return;

  coreGithubSaving.value = "update";
  coreGithubError.value = null;

  try {
    const response = await api.post<CoreGithubActionResponse>(
      "/core/github/update",
    );
    coreGithubLastRunUrl.value = readCoreGithubActionUrl(response);
    toastSuccess("Core update started.");
    await loadCoreGithubUpdater();
  } catch (e: any) {
    coreGithubError.value = e.message || "Failed to start Core update";
  } finally {
    coreGithubSaving.value = null;
  }
}

async function loadCoreStorageStatus(silent = false) {
  if (!silent) {
    storageLoading.value = true;
    storageError.value = null;
  }

  try {
    const status = await api.get<CoreStorageStatusResponse>(
      "/core/storage/status",
    );
    storageStatus.value = status;
    if (status.r2Available) {
      stopStoragePolling();
    }
  } catch (e: any) {
    storageError.value = e.message || "Failed to load storage status";
  } finally {
    if (!silent) storageLoading.value = false;
  }
}

async function activateCoreStorage() {
  if (storageSaving.value || storageStatus.value?.r2Available) return;
  if (!coreGithubConnection.value?.connected) {
    storageError.value = "Connect ME3 Updater to activate storage.";
    return;
  }

  storageSaving.value = true;
  storageError.value = null;

  try {
    const response = await api.post<CoreGithubActionResponse>(
      "/core/storage/r2/activate",
      { bucketName: storageBucketName.value },
    );
    storageActivationRunUrl.value = readCoreGithubActionUrl(response);
    toastSuccess("Storage activation started. Waiting for Cloudflare to redeploy.");
    await loadCoreStorageStatus(true);
    if (!storageStatus.value?.r2Available) startStoragePolling();
  } catch (e: any) {
    storageError.value = e.message || "Failed to activate storage";
  } finally {
    storageSaving.value = false;
  }
}

async function copyStorageBucketName() {
  try {
    await navigator.clipboard.writeText(storageBucketName.value);
    toastSuccess("Bucket name copied.");
  } catch {
    storageError.value = "Copy failed. Select the bucket name and copy it manually.";
  }
}

function startStoragePolling() {
  stopStoragePolling();
  storagePolling.value = true;
  storagePollCount = 0;
  storagePollTimer = window.setInterval(async () => {
    storagePollCount += 1;
    await loadCoreStorageStatus(true);
    if (storageStatus.value?.r2Available || storagePollCount >= 40) {
      stopStoragePolling();
    }
  }, 15_000);
}

function stopStoragePolling() {
  if (storagePollTimer !== null) {
    window.clearInterval(storagePollTimer);
    storagePollTimer = null;
  }
  storagePolling.value = false;
}

function readCoreGithubActionUrl(response: CoreGithubActionResponse) {
  return (
    response.runUrl ||
    response.run_url ||
    response.htmlUrl ||
    response.html_url ||
    response.workflowUrl ||
    response.workflow_url ||
    response.lastUpdateRunUrl ||
    response.last_update_run_url ||
    response.github?.lastUpdateRunUrl ||
    response.url ||
    null
  );
}

function readRouteQueryString(value: unknown): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw.trim() : "";
}

function clearCoreGithubInstallQuery() {
  const query = { ...route.query };
  delete query.installation_id;
  delete query.installationId;
  delete query.setup_action;
  delete query.setupAction;
  delete query.repository_selection;
  delete query.repositorySelection;
  delete query.state;
  void router.replace({ path: route.path, query, hash: route.hash });
}

async function completeCoreGithubInstallFromRoute() {
  const installationId =
    readRouteQueryString(route.query.installation_id) ||
    readRouteQueryString(route.query.installationId);
  if (!installationId) return false;

  coreGithubSaving.value = "connect";
  coreGithubError.value = null;

  try {
    await api.post<CoreGithubActionResponse>("/core/github/install/complete", {
      installationId,
      setupAction:
        readRouteQueryString(route.query.setup_action) ||
        readRouteQueryString(route.query.setupAction),
      repositorySelection:
        readRouteQueryString(route.query.repository_selection) ||
        readRouteQueryString(route.query.repositorySelection),
      state: readRouteQueryString(route.query.state),
    });
    toastSuccess("GitHub updater connected.");
  } catch (e: any) {
    coreGithubError.value = e.message || "Failed to complete GitHub install";
  } finally {
    coreGithubSaving.value = null;
    clearCoreGithubInstallQuery();
    await loadCoreGithubUpdater();
  }

  return true;
}

async function logout() {
  await auth.logout();
  router.push("/");
}

async function scrollToRouteHash() {
  if (!route.hash) return;
  await nextTick();
  window.requestAnimationFrame(() => {
    document
      .getElementById(route.hash.slice(1))
      ?.scrollIntoView({ block: "start" });
  });
}

onMounted(async () => {
  await loadAccount();
  void sites.ensureSites();
  void loadMailbox();
  void loadAiSettings();
  void loadEmailProviderSettings();
  void loadPlugins();
  void loadAppConnections();
  void completeCoreGithubInstallFromRoute().then((completed) => {
    if (!completed) void loadCoreGithubUpdater();
  });
  void loadCoreStorageStatus();
  void completeStripeConnectReturn();
  if (
    route.query.section === "connections" ||
    route.query.section === "app-connections"
  ) {
    openSection.value.appConnections = true;
  }
  if (typeof route.query.me3_claim_error === "string") {
    openSection.value.appConnections = true;
    appConnectionsError.value = "ME3.app connection failed. Please try again.";
  }
  if (route.query.section === "soulink" || route.query.section === "telegram") {
    openSection.value.appConnections = true;
  }
  if (route.query.section === "mailbox") {
    openSection.value.mailbox = true;
  }
  if (route.query.section === "storage") {
    openSection.value.storage = true;
    storageModalOpen.value = true;
  }
  if (
    route.query.section === "domain" ||
    route.query.section === "custom-domain"
  ) {
    openSection.value.mailbox = true;
  }
  if (route.query.section === "ai" || route.query.section === "providers") {
    openSection.value.ai = true;
  }
  if (route.query.section === "plugins") {
    openSection.value.plugins = true;
  }
  if (
    route.query.section === "payments" ||
    route.query.section === "commerce"
  ) {
    openSection.value.payments = true;
  }
  if (route.query.section === "timezone") {
    openSection.value.timezone = true;
  }
  await scrollToRouteHash();
});

onBeforeUnmount(() => {
  stopStoragePolling();
});
</script>

<template>
  <div class="account-page">
    <Teleport to="#app-side-nav-mobile-page-controls" defer disabled>
      <div class="account-mobile-nav">
        <h1 class="account-title account-mobile-nav__title">
          <span>Account</span>
          <span
            v-if="coreGithubInstalledVersion"
            class="account-title__version"
          >
            v{{ coreGithubInstalledVersion }}
          </span>
        </h1>
        <div
          class="theme-segmented account-theme-switch account-mobile-nav__actions"
          role="radiogroup"
          aria-label="Interface theme"
        >
          <button
            v-for="option in themeOptions"
            :key="option.value"
            type="button"
            class="theme-segmented__option"
            :class="{
              'theme-segmented__option--active':
                themePreference === option.value,
            }"
            role="radio"
            :aria-checked="themePreference === option.value"
            :aria-label="`${option.label} theme`"
            :title="`${option.label} theme`"
            @click="chooseThemePreference(option.value)"
          >
            <UiIcon :name="option.icon" :size="16" aria-hidden="true" />
          </button>
        </div>
      </div>
    </Teleport>

    <main class="main">
      <header class="account-header">
        <div>
          <h1 class="account-title">
            <span>Account</span>
            <span
              v-if="coreGithubInstalledVersion"
              class="account-title__version"
            >
              v{{ coreGithubInstalledVersion }}
            </span>
          </h1>
        </div>
        <div
          class="theme-segmented account-theme-switch"
          role="radiogroup"
          aria-label="Interface theme"
        >
          <button
            v-for="option in themeOptions"
            :key="option.value"
            type="button"
            class="theme-segmented__option"
            :class="{
              'theme-segmented__option--active':
                themePreference === option.value,
            }"
            role="radio"
            :aria-checked="themePreference === option.value"
            :aria-label="`${option.label} theme`"
            :title="`${option.label} theme`"
            @click="chooseThemePreference(option.value)"
          >
            <UiIcon :name="option.icon" :size="16" aria-hidden="true" />
          </button>
        </div>
      </header>

      <PageLoading v-if="loading" label="Loading account..." />

      <template v-else>
        <section
          v-if="aiDeploymentMode === 'self_hosted'"
          class="core-update-callout"
          aria-labelledby="core-update-title"
          aria-live="polite"
        >
          <div class="core-update-callout__copy">
            <div class="core-update-callout__heading">
              <UiIcon
                class="core-update-callout__icon"
                name="RefreshCw"
                :size="17"
                aria-hidden="true"
              />
              <h2 id="core-update-title">
                {{
                  coreGithubUpdateAvailable
                    ? "ME3 update available"
                    : "ME3 updater"
                }}
              </h2>
              <StatusBadge :tone="coreGithubStatusClass">
                {{ coreGithubStatusLabel }}
              </StatusBadge>
            </div>
            <p>{{ coreGithubDescription }}</p>
            <div class="core-update-callout__details">
              <span v-if="coreGithubInstalledVersion">
                Installed v{{ coreGithubInstalledVersion }}
              </span>
              <span v-if="coreGithubLatestVersion">
                Latest v{{ coreGithubLatestVersion }}
              </span>
              <a
                v-if="
                  coreGithubConnection?.repositoryUrl &&
                  coreGithubRepositoryLabel
                "
                :href="coreGithubConnection.repositoryUrl"
                target="_blank"
                rel="noopener"
              >
                {{ coreGithubRepositoryLabel }}
              </a>
              <a
                v-if="coreGithubRunUrl"
                :href="coreGithubRunUrl"
                target="_blank"
                rel="noopener"
              >
                Latest run
              </a>
            </div>
            <p v-if="coreGithubError" class="core-update-callout__error">
              {{ coreGithubError }}
            </p>
          </div>
          <div class="core-update-callout__actions">
            <Button
              v-if="coreGithubConnection?.connected"
              color="primary"
              size="compact"
              type="button"
              :disabled="Boolean(coreGithubSaving)"
              @click="updateCoreFromGithub"
            >
              {{ coreGithubSaving === "update" ? "Starting..." : "Update" }}
            </Button>
            <Button
              v-else
              color="primary"
              size="compact"
              type="button"
              :disabled="
                Boolean(coreGithubSaving) ||
                appConnectionsSaving ||
                coreGithubLoading ||
                !coreGithubStatus?.me3AppConnected
              "
              @click="connectCoreGithubUpdater"
            >
              {{ coreGithubConnectLabel }}
            </Button>
          </div>
        </section>

        <section class="card accordion-card account-section primary-section">
          <button
            id="account-trigger-account"
            class="accordion-trigger"
            type="button"
            :aria-expanded="openSection.account"
            aria-controls="account-panel-account"
            @click="openSection.account = !openSection.account"
          >
            <span class="accordion-title-wrap accordion-title-flex">
              <h2>Account</h2>
            </span>
            <span class="accordion-chevron" aria-hidden="true">▼</span>
          </button>
          <div
            id="account-panel-account"
            class="accordion-panel"
            role="region"
            aria-labelledby="account-trigger-account"
            :hidden="!openSection.account"
          >
            <p class="hint account-signin-hint">
              Used for signing in to this ME3 account.
            </p>
            <div class="email-row account-email-row">
              <label class="field account-email-field">
                <span>Email</span>
                <input
                  class="input"
                  type="email"
                  :value="auth.user?.email || ''"
                  disabled
                />
              </label>
              <Button
                color="secondary"
                shape="soft"
                size="compact"
                type="button"
                @click="logout"
              >
                Sign out
              </Button>
            </div>

            <div class="account-resources">
              <nav class="account-resource-links" aria-label="Account resources">
                <a
                  v-if="me3Connection?.connected"
                  :href="me3AccountURL"
                  target="_blank"
                  rel="noopener"
                >
                  Manage account
                </a>
                <a
                  href="https://me3.app/support"
                  target="_blank"
                  rel="noopener"
                >
                  Support
                </a>
                <a href="https://me3.app/terms" target="_blank" rel="noopener">
                  Terms
                </a>
                <a
                  href="https://me3.app/privacy"
                  target="_blank"
                  rel="noopener"
                >
                  Privacy
                </a>
              </nav>

              <p
                v-if="me3Connection?.connected"
                class="account-resources__billing-note"
              >
                Deleting your ME3 account does not cancel Apple subscriptions.
                Cancel them in App Store settings.
              </p>
            </div>
          </div>
        </section>

        <section class="card accordion-card primary-section">
          <button
            id="account-trigger-mailbox"
            class="accordion-trigger"
            type="button"
            :aria-expanded="openSection.mailbox"
            aria-controls="account-panel-mailbox"
            @click="openSection.mailbox = !openSection.mailbox"
          >
            <span class="accordion-title-wrap accordion-title-flex">
              <h2>Mailbox &amp; domains</h2>
            </span>
            <span class="accordion-chevron" aria-hidden="true">▼</span>
          </button>
          <div
            id="account-panel-mailbox"
            class="accordion-panel"
            role="region"
            aria-labelledby="account-trigger-mailbox"
            :hidden="!openSection.mailbox"
          >
            <PageLoading
              v-if="mailboxLoading || emailProviderLoading"
              compact
              label="Loading email settings..."
            />

            <template v-else-if="mailboxAvailable">
              <div class="email-settings">
                <section class="domain-email-section">
                  <div class="setup-disclosure-intro">
                    <div>
                      <h3>Sites and website domains</h3>
                    </div>
                  </div>

                  <ul v-if="siteDomainSummaries.length" class="site-domain-summary">
                    <li v-for="site in siteDomainSummaries" :key="site.id">
                      <span>@{{ site.username }}</span>
                      <span>{{ site.custom_domain || "Default ME3 address" }}</span>
                    </li>
                  </ul>
                  <Button color="outline" shape="soft" size="compact" to="/sites">
                    Manage site domains
                  </Button>
                </section>

                <section class="mailbox-setup">
                  <div class="setup-disclosure-intro">
                    <div>
                      <h3>Mailbox</h3>
                      <p v-if="!mailboxCloudflareManaged">
                        Follow the steps in the
                        <button
                          class="setup-guide-link"
                          type="button"
                          @click="mailboxGuideOpen = true"
                        >
                          setup guide</button
                        >.
                      </p>
                    </div>
                  </div>

                  <div
                    v-if="mailboxCloudflareManaged"
                    class="email-address-save"
                  >
                    <label class="field email-address-field">
                      <span>ME3 email address</span>
                      <input
                        class="input email-address-input"
                        type="email"
                        :value="managedMailboxAddress"
                        readonly
                        aria-readonly="true"
                      />
                    </label>
                  </div>

                  <div v-else class="email-address-save">
                    <label class="field email-address-field">
                      <span>Email address</span>
                      <input
                        v-model="emailAddressInput"
                        class="input email-address-input"
                        type="email"
                        placeholder="name@your-domain.com"
                        autocomplete="email"
                        spellcheck="false"
                      />
                    </label>
                    <button
                      class="button primary email-address-save__button"
                      type="button"
                      :disabled="unifiedEmailSaveDisabled"
                      @click="saveUnifiedEmailSettings"
                    >
                      {{
                        mailboxSaving ||
                        emailProviderSaving ||
                        mailboxActivating
                          ? "Saving..."
                          : "Save"
                      }}
                    </button>
                  </div>
                  <p
                    v-if="
                      !mailboxCloudflareManaged &&
                      emailAddressInput.trim() &&
                      !emailAddressIsValid
                    "
                    class="error compact-error"
                  >
                    Enter an address like name@your-domain.com. Use letters,
                    numbers, dots, underscores, or hyphens before @.
                  </p>
                </section>

                <details
                  v-if="!mailboxCloudflareManaged"
                  class="email-disclosure"
                >
                  <summary>Forward a copy</summary>
                  <div class="email-disclosure-body email-forwarding-row">
                    <label class="checkbox-row email-forwarding-row__toggle">
                      <input
                        v-model="mailboxForwardingEnabled"
                        type="checkbox"
                      />
                      <span>Turn on forwarding</span>
                    </label>
                    <input
                      v-model="mailboxForwardingEmail"
                      class="input email-forwarding-row__input"
                      type="email"
                      :disabled="!mailboxForwardingEnabled"
                      placeholder="you@example.com"
                      aria-label="Forward copy to"
                    />
                  </div>
                </details>

                <details class="email-disclosure">
                  <summary>Email sender</summary>
                  <div class="email-disclosure-body">
                    <p v-if="!emailProviderEncryptionConfigured" class="error">
                      Install encryption is required before provider tokens can
                      be saved.
                    </p>

                    <div class="field">
                      <select
                        v-model="selectedEmailProviderId"
                        class="input"
                        aria-label="Email sender provider"
                        @change="syncEmailAddressInput(true)"
                      >
                        <option
                          v-for="provider in emailProviders"
                          :key="provider.id"
                          :value="provider.id"
                        >
                          {{ provider.label }}
                        </option>
                      </select>
                    </div>

                    <div
                      v-if="activeEmailProvider"
                      class="email-provider-fields"
                    >
                      <label
                        v-if="
                          mailboxCloudflareManaged &&
                          !selectedEmailProviderIsManaged
                        "
                        class="field"
                      >
                        <span>From address</span>
                        <input
                          v-model="emailAddressInput"
                          class="input"
                          type="email"
                          placeholder="name@your-domain.com"
                          autocomplete="email"
                          spellcheck="false"
                        />
                      </label>

                      <p
                        v-if="
                          mailboxCloudflareManaged &&
                          selectedEmailProviderIsManaged
                        "
                        class="email-provider-managed-note"
                      >
                        ME3 sends from
                        <strong>{{ managedMailboxAddress }}</strong>. No
                        provider credentials are needed.
                      </p>

                      <template v-if="selectedEmailProviderId === 'smtp'">
                        <label class="field">
                          <span>SMTP host</span>
                          <input
                            v-model="
                              emailProviderInputs[selectedEmailProviderId]
                                .smtpHost
                            "
                            class="input"
                            type="text"
                            placeholder="smtp.example.com"
                            spellcheck="false"
                          />
                        </label>

                        <label class="field">
                          <span>Port</span>
                          <input
                            v-model.number="
                              emailProviderInputs[selectedEmailProviderId]
                                .smtpPort
                            "
                            class="input"
                            type="number"
                            inputmode="numeric"
                            min="1"
                            max="65535"
                            placeholder="587"
                          />
                        </label>

                        <label class="field">
                          <span>Security</span>
                          <select
                            v-model="
                              emailProviderInputs[selectedEmailProviderId]
                                .smtpSecurity
                            "
                            class="input"
                          >
                            <option value="starttls">STARTTLS</option>
                            <option value="tls">TLS</option>
                            <option value="none">None</option>
                          </select>
                        </label>

                        <label class="field">
                          <span>Username</span>
                          <input
                            v-model="
                              emailProviderInputs[selectedEmailProviderId]
                                .smtpUsername
                            "
                            class="input"
                            type="text"
                            autocomplete="username"
                            placeholder="smtp-user"
                            spellcheck="false"
                          />
                        </label>
                      </template>

                      <template v-if="selectedEmailProviderId === 'mailgun'">
                        <label class="field">
                          <span>Mailgun domain</span>
                          <input
                            v-model="
                              emailProviderInputs[selectedEmailProviderId]
                                .sendingDomain
                            "
                            class="input"
                            type="text"
                            placeholder="mg.example.com"
                            spellcheck="false"
                          />
                        </label>

                        <label class="field">
                          <span>Region</span>
                          <select
                            v-model="
                              emailProviderInputs[selectedEmailProviderId]
                                .mailgunRegion
                            "
                            class="input"
                          >
                            <option value="us">US</option>
                            <option value="eu">EU</option>
                          </select>
                        </label>
                      </template>

                      <label
                        v-if="
                          activeEmailProvider.secretLabel &&
                          selectedEmailProviderId !== 'cloudflare-email'
                        "
                        class="field"
                      >
                        <span>{{ activeEmailProvider.secretLabel }}</span>
                        <input
                          v-model="
                            emailProviderInputs[selectedEmailProviderId]
                              .apiToken
                          "
                          class="input"
                          type="password"
                          autocomplete="off"
                          spellcheck="false"
                          :placeholder="emailProviderSecretPlaceholder"
                        />
                      </label>
                    </div>
                    <div class="email-provider-actions">
                      <button
                        v-if="mailboxCloudflareManaged"
                        class="button primary"
                        type="button"
                        :disabled="emailSenderSaveDisabled"
                        @click="saveEmailSenderSettings"
                      >
                        {{
                          emailProviderSaving
                            ? "Saving..."
                            : "Save sender"
                        }}
                      </button>
                      <button
                        class="button secondary"
                        type="button"
                        :disabled="
                          emailProviderTesting ||
                          emailProviderSaving ||
                          mailboxSaving ||
                          !emailAddressIsValid
                        "
                        @click="sendEmailProviderTest"
                      >
                        {{
                          emailProviderTesting
                            ? "Sending..."
                            : "Send test email"
                        }}
                      </button>
                      <p class="email-provider-test-note">
                        {{
                          mailboxCloudflareManaged
                            ? "Your ME3 mailbox remains active when you use a custom sender. Connecting a website domain does not configure email."
                            : "Save changes first."
                        }}
                        The test sends to
                        {{
                          emailAddressNormalized ||
                          managedMailboxAddress ||
                          "this address"
                        }}.
                      </p>
                    </div>
                  </div>
                </details>

                <p v-if="mailboxError" class="error">{{ mailboxError }}</p>
                <p v-if="emailProviderError" class="error">
                  {{ emailProviderError }}
                </p>
              </div>
            </template>

            <p v-else class="error">
              Mailbox configuration is not available in this Core install.
            </p>
          </div>
        </section>

        <section class="card accordion-card plugins-section">
          <button
            id="account-trigger-plugins"
            class="accordion-trigger"
            type="button"
            :aria-expanded="openSection.plugins"
            aria-controls="account-panel-plugins"
            @click="openSection.plugins = !openSection.plugins"
          >
            <span class="accordion-title-wrap accordion-title-flex">
              <h2>Plugins</h2>
            </span>
            <span class="accordion-chevron" aria-hidden="true">▼</span>
          </button>
          <div
            id="account-panel-plugins"
            class="accordion-panel"
            role="region"
            aria-labelledby="account-trigger-plugins"
            :hidden="!openSection.plugins"
          >
            <PageLoading
              v-if="pluginsLoading"
              compact
              label="Loading plugins..."
            />
            <p v-else-if="pluginsError" class="error">{{ pluginsError }}</p>

            <template v-else>
              <PluginList
                v-if="visibleAccountPlugins.length"
                :plugins="visibleAccountPlugins"
                :busy-plugin-ids="pluginBusyIds"
                :show-local-executor-config="true"
                :show-coming-soon="true"
                @toggle="togglePlugin"
                @configure-local-executor="openLocalExecutorSetup"
              />

              <p v-else-if="plugins.length === 0" class="field-hint">
                No curated plugins are registered in this Core build.
              </p>
            </template>
          </div>
        </section>

        <section class="card accordion-card app-connections-section">
          <button
            id="account-trigger-app-connections"
            class="accordion-trigger"
            type="button"
            :aria-expanded="openSection.appConnections"
            aria-controls="account-panel-app-connections"
            @click="openSection.appConnections = !openSection.appConnections"
          >
            <span class="accordion-title-wrap accordion-title-flex">
              <h2>App Connections</h2>
            </span>
            <span class="accordion-chevron" aria-hidden="true">▼</span>
          </button>
          <div
            id="account-panel-app-connections"
            class="accordion-panel"
            role="region"
            aria-labelledby="account-trigger-app-connections"
            :hidden="!openSection.appConnections"
          >
            <div class="advanced-subsection">
              <div class="connection-lines">
                <div
                  v-if="appConnectionsLoading"
                  class="connection-line connection-line--loading"
                >
                  <span class="connection-line__title">ME3.app</span>
                  <span class="connection-line__meta">Loading...</span>
                </div>
                <div
                  v-else
                  class="connection-line"
                  :class="{
                    'connection-line--connected': me3Connection?.connected,
                  }"
                >
                  <div class="connection-line__copy">
                    <span class="connection-line__title">ME3.app</span>
                    <p class="connection-line__description">
                      {{ me3ConnectionDescription }}
                    </p>
                    <div
                      v-if="me3Connection?.connected"
                      class="connection-line__details"
                    >
                      <a
                        :href="me3Connection.meJsonUrl"
                        target="_blank"
                        rel="noopener"
                      >
                        Core me.json
                      </a>
                      <a
                        :href="me3AccountURL"
                        target="_blank"
                        rel="noopener"
                      >
                        Manage ME3 account
                      </a>
                    </div>
                  </div>
                  <div class="connection-line__end">
                    <StatusBadge :tone="me3ConnectionStatusClass">
                      {{ me3ConnectionStatusLabel }}
                    </StatusBadge>
                    <Button
                      v-if="me3Connection?.connected"
                      color="outline"
                      size="compact"
                      type="button"
                      :disabled="
                        appConnectionsSaving ||
                        !me3Connection.disconnectAvailable
                      "
                      @click="disconnectMe3App"
                    >
                      {{
                        appConnectionsSaving ? "Disconnecting..." : "Disconnect"
                      }}
                    </Button>
                    <Button
                      v-else
                      color="primary"
                      size="compact"
                      type="button"
                      :disabled="appConnectionsSaving"
                      @click="connectMe3App"
                    >
                      {{ appConnectionsSaving ? "Opening..." : "Connect" }}
                    </Button>
                  </div>
                </div>

                <div
                  v-if="!appConnectionsLoading"
                  class="connection-line connection-line--local-password"
                  :class="{
                    'connection-line--connected': localPasswordConfigured,
                  }"
                >
                  <div class="connection-line__header">
                    <div class="connection-line__copy">
                      <span class="connection-line__title">Local password</span>
                      <p class="connection-line__description">
                        Sign in directly after a restore without needing the
                        operator setup password.
                      </p>
                    </div>
                    <div class="connection-line__end">
                      <StatusBadge
                        :tone="localPasswordConfigured ? 'active' : 'pending_setup'"
                      >
                        {{ localPasswordConfigured ? "Ready" : "Required" }}
                      </StatusBadge>
                      <Button
                        color="outline"
                        size="compact"
                        type="button"
                        :disabled="localPasswordSaving"
                        @click="toggleLocalPasswordForm"
                      >
                        {{
                          localPasswordFormOpen
                            ? "Cancel"
                            : localPasswordConfigured
                              ? "Change"
                              : "Add password"
                        }}
                      </Button>
                    </div>
                  </div>

                  <form
                    v-if="localPasswordFormOpen"
                    class="local-password-form"
                    aria-label="Local password"
                    @submit.prevent="saveLocalPassword"
                  >
                    <div class="local-password-form__fields">
                      <label class="field local-password-form__field">
                        <span>New password</span>
                        <input
                          v-model="localPasswordInput"
                          class="input"
                          type="password"
                          autocomplete="new-password"
                          aria-describedby="local-password-guidance"
                          minlength="8"
                          required
                        />
                      </label>
                      <label class="field local-password-form__field">
                        <span>Confirm password</span>
                        <input
                          v-model="localPasswordConfirmationInput"
                          class="input"
                          type="password"
                          autocomplete="new-password"
                          :aria-invalid="localPasswordConfirmationMismatch"
                          :aria-describedby="
                            localPasswordConfirmationMismatch
                              ? 'local-password-guidance local-password-confirmation-error'
                              : 'local-password-guidance'
                          "
                          minlength="8"
                          required
                        />
                      </label>
                      <Button
                        color="primary"
                        size="compact"
                        type="submit"
                        :disabled="localPasswordSaveDisabled"
                      >
                        {{ localPasswordSaving ? "Verifying..." : "Save password" }}
                      </Button>
                    </div>
                    <p id="local-password-guidance" class="connection-lines__hint">
                      Use at least 8 characters. The password and its hash are
                      never returned by the API.
                    </p>
                    <p
                      v-if="localPasswordConfirmationMismatch"
                      id="local-password-confirmation-error"
                      class="connection-line__error"
                      role="alert"
                    >
                      Password confirmation does not match.
                    </p>
                  </form>

                  <p
                    v-if="localPasswordError"
                    class="connection-line__error"
                    role="alert"
                  >
                    {{ localPasswordError }}
                  </p>
                </div>

                <div
                  class="connection-line connection-line--telegram"
                  :class="{
                    'connection-line--connected':
                      telegramPanelRef?.connection?.status === 'active',
                    'connection-line--telegram-connected':
                      telegramPanelRef?.connection?.status === 'active',
                  }"
                >
                  <div
                    v-if="telegramPanelRef?.connection?.status === 'active'"
                    class="connection-line__copy"
                  >
                    <span class="connection-line__title">Telegram</span>
                    <p class="connection-line__description">
                      Chat with your ME3 assistant in Telegram.
                    </p>
                  </div>
                  <template v-else>
                    <div class="connection-line__header">
                      <div class="connection-line__copy">
                        <span class="connection-line__title">Telegram</span>
                        <p class="connection-line__description">
                          Chat with your ME3 assistant in Telegram.
                        </p>
                      </div>
                      <div class="connection-line__end">
                        <StatusBadge
                          v-if="telegramPanelRef?.available"
                          :tone="telegramStatusClass"
                        >
                          {{ telegramStatusLabel }}
                        </StatusBadge>
                        <Button
                          color="outline"
                          size="compact"
                          type="button"
                          aria-controls="telegram-setup-panel"
                          :aria-expanded="telegramSetupOpen"
                          @click="telegramSetupOpen = !telegramSetupOpen"
                        >
                          {{ telegramSetupOpen ? "Hide setup" : "Configure" }}
                        </Button>
                      </div>
                    </div>
                    <div
                      id="telegram-setup-panel"
                      v-show="telegramSetupOpen"
                      class="telegram-setup-panel"
                    >
                      <ol class="telegram-setup-steps">
                        <li>Open Telegram and search for BotFather.</li>
                        <li>
                          Type <code>/newbot</code> and follow the instructions.
                        </li>
                        <li>
                          You will get a bot name and token. Save them here.
                        </li>
                      </ol>
                      <div class="connection-line__end">
                        <TelegramConnectPanel
                          ref="telegramPanelRef"
                          :show-status-row="false"
                          :compact-connected="true"
                          :auto-prepare-when-not-connected="
                            route.query.section === 'telegram'
                          "
                        />
                      </div>
                    </div>
                  </template>
                  <div
                    v-if="telegramPanelRef?.connection?.status === 'active'"
                    class="connection-line__end"
                  >
                    <StatusBadge
                      v-if="
                        telegramPanelRef?.available &&
                        telegramPanelRef?.connection?.status === 'active'
                      "
                      :tone="telegramStatusClass"
                    >
                      {{ telegramStatusLabel }}
                    </StatusBadge>
                    <TelegramConnectPanel
                      ref="telegramPanelRef"
                      :show-status-row="false"
                      :compact-connected="true"
                      :auto-prepare-when-not-connected="
                        route.query.section === 'telegram'
                      "
                    />
                  </div>
                </div>

                <div
                  class="connection-line"
                  :class="{
                    'connection-line--connected':
                      soulinkPanelRef?.connection?.status === 'active',
                  }"
                >
                  <div class="connection-line__copy">
                    <span class="connection-line__title">Soulink (Beta)</span>
                    <p class="connection-line__description">
                      Chat with your ME3 assistant on the go. Built by the
                      creator of ME3.
                    </p>
                  </div>
                  <div class="connection-line__end">
                    <StatusBadge
                      v-if="soulinkPanelRef?.available"
                      :tone="soulinkStatusClass"
                    >
                      {{ soulinkStatusLabel }}
                    </StatusBadge>
                    <SoulinkConnectPanel ref="soulinkPanelRef" variant="inline" />
                  </div>
                </div>
              </div>

              <template v-if="!appConnectionsLoading">
                <p v-if="appConnectionsError" class="error">
                  {{ appConnectionsError }}
                </p>
              </template>
              <p v-if="soulinkPanelRef?.error" class="error">
                {{ soulinkPanelRef.error }}
              </p>
              <p v-if="telegramPanelRef?.error" class="error">
                {{ telegramPanelRef.error }}
              </p>
            </div>
          </div>
        </section>

        <section class="card accordion-card storage-section">
          <button
            id="account-trigger-storage"
            class="accordion-trigger"
            type="button"
            :aria-expanded="openSection.storage"
            aria-controls="account-panel-storage"
            @click="openSection.storage = !openSection.storage"
          >
            <span class="accordion-title-wrap accordion-title-flex">
              <h2>Storage</h2>
            </span>
            <span class="accordion-chevron" aria-hidden="true">▼</span>
          </button>
          <div
            id="account-panel-storage"
            class="accordion-panel"
            role="region"
            aria-labelledby="account-trigger-storage"
            :hidden="!openSection.storage"
          >
            <div
              class="connection-line"
              :class="{
                'connection-line--connected': storageStatus?.r2Available,
              }"
            >
              <div class="connection-line__copy">
                <span class="connection-line__title">File storage</span>
                <p class="connection-line__description">
                  {{ storageDescription }}
                </p>
                <div
                  v-if="storageActivationRunUrl"
                  class="connection-line__details"
                >
                  <a
                    :href="storageActivationRunUrl"
                    target="_blank"
                    rel="noopener"
                  >
                    Latest run
                  </a>
                </div>
                <p v-if="storageError" class="connection-line__error">
                  {{ storageError }}
                </p>
              </div>
              <div class="connection-line__end">
                <StatusBadge :tone="storageStatusClass">
                  {{ storageStatusLabel }}
                </StatusBadge>
                <Button
                  color="outline"
                  size="compact"
                  type="button"
                  :disabled="storageLoading"
                  @click="loadCoreStorageStatus()"
                >
                  Check again
                </Button>
                <Button
                  color="primary"
                  size="compact"
                  type="button"
                  :disabled="storageStatus?.r2Available"
                  @click="storageModalOpen = true"
                >
                  Configure
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section
          v-if="showAiModelSection"
          id="account-ai-model"
          class="card accordion-card ai-section"
        >
          <button
            id="account-trigger-ai"
            class="accordion-trigger"
            type="button"
            :aria-expanded="openSection.ai"
            aria-controls="account-panel-ai"
            @click="openSection.ai = !openSection.ai"
          >
            <span class="accordion-title-wrap accordion-title-flex">
              <h2>AI</h2>
            </span>
            <span class="accordion-chevron" aria-hidden="true">▼</span>
          </button>
          <div
            id="account-panel-ai"
            class="accordion-panel"
            role="region"
            aria-labelledby="account-trigger-ai"
            :hidden="!openSection.ai"
          >
            <div class="advanced-subsection">
              <PageLoading
                v-if="aiSettingsLoading"
                compact
                label="Loading AI provider settings..."
              />

              <template v-else>
                <p v-if="aiSettingsError" class="error" role="alert">
                  {{ aiSettingsError }}
                </p>

                <template v-if="managedAiBilling?.managed">
                  <div class="managed-ai-settings">
                    <div class="managed-ai-row">
                      <label class="field managed-ai-model-field">
                        <span>Default model</span>
                        <select
                          v-model="managedAiDefaultModelInput"
                          class="input"
                          :disabled="aiSettingsSaving || !managedAiBilling.available"
                        >
                          <option
                            v-for="model in managedAiBilling.models"
                            :key="model.id"
                            :value="model.id"
                          >
                            {{ model.label }}{{ model.recommended ? " — Recommended" : "" }}
                          </option>
                        </select>
                      </label>
                      <p v-if="managedAiSelectedModel" class="managed-ai-help">
                        {{ managedAiSelectedModel.description }}
                      </p>
                    </div>

                    <div class="managed-ai-row managed-ai-usage">
                      <div class="managed-ai-usage__labels">
                        <span>Monthly usage</span>
                        <strong>{{ managedAiUsageLabel }}</strong>
                      </div>
                      <div
                        class="managed-ai-usage__track"
                        role="progressbar"
                        aria-label="Monthly AI usage"
                        aria-valuemin="0"
                        aria-valuemax="100"
                        :aria-valuenow="Math.round(managedAiUsagePercent)"
                      >
                        <span
                          class="managed-ai-usage__fill"
                          :style="{ width: `${managedAiUsagePercent}%` }"
                        />
                      </div>
                      <p class="managed-ai-help">
                        Resets each calendar month. At the limit, ME3 switches
                        to a lower-cost backup model until the next month.
                      </p>
                    </div>

                    <div class="managed-ai-row managed-ai-additional">
                      <div class="managed-ai-row__heading">
                        <div>
                          <h3>Additional usage</h3>
                          <p class="managed-ai-help">
                            Continue using your selected model after the included allowance.
                          </p>
                        </div>
                        <label class="managed-ai-switch">
                          <span class="sr-only">Allow additional paid AI usage</span>
                          <input
                            v-model="managedAiOveragesEnabledInput"
                            type="checkbox"
                            :disabled="
                              aiSettingsSaving ||
                              !managedAiBilling.available ||
                              !managedAiBilling.eligible
                            "
                          />
                        </label>
                      </div>

                      <fieldset
                        v-if="
                          managedAiBilling.eligible &&
                          managedAiOveragesEnabledInput
                        "
                        class="managed-ai-limit"
                        :disabled="aiSettingsSaving"
                      >
                        <legend>Monthly maximum</legend>
                        <div class="managed-ai-limit__options">
                          <button
                            v-for="choice in managedAiLimitPresets"
                            :key="choice"
                            type="button"
                            class="managed-ai-limit__option"
                            :class="{ 'managed-ai-limit__option--active': managedAiLimitChoice === choice }"
                            :aria-pressed="managedAiLimitChoice === choice"
                            @click="managedAiLimitChoice = choice"
                          >
                            ${{ choice }}
                          </button>
                          <button
                            type="button"
                            class="managed-ai-limit__option"
                            :class="{ 'managed-ai-limit__option--active': managedAiLimitChoice === 'custom' }"
                            :aria-pressed="managedAiLimitChoice === 'custom'"
                            @click="managedAiLimitChoice = 'custom'"
                          >
                            Custom
                          </button>
                        </div>

                        <label
                          v-if="managedAiLimitChoice === 'custom'"
                          class="field managed-ai-limit__custom"
                        >
                          <span>Custom monthly maximum</span>
                          <span class="managed-ai-money-input">
                            <span aria-hidden="true">$</span>
                            <input
                              v-model.number="managedAiCustomMaximumDollarsInput"
                              class="input"
                              type="number"
                              inputmode="decimal"
                              step="1"
                              :min="managedAiBilling.minimumMonthlyMaximumCents / 100"
                              :max="managedAiBilling.maximumMonthlyMaximumCents / 100"
                            />
                          </span>
                        </label>
                      </fieldset>

                      <p
                        v-if="!managedAiBilling.eligible"
                        class="managed-ai-unavailable"
                      >
                        {{
                          managedAiBilling.billingSource === "internal"
                            ? "Additional usage is not available for this test installation."
                            : managedAiBilling.ineligibleReason ||
                              "Additional usage is not available for this subscription."
                        }}
                      </p>
                      <p
                        v-else-if="managedAiOveragesEnabledInput"
                        class="managed-ai-help"
                      >
                        Only additional usage is billed through Stripe. You’ll
                        never be charged above your selected limit.
                      </p>
                    </div>

                    <div class="managed-ai-actions">
                      <Button
                        color="primary"
                        size="compact"
                        type="button"
                        :disabled="managedAiBillingSaveDisabled"
                        @click="saveManagedAiBillingSettings"
                      >
                        {{ aiSettingsSaving ? "Saving..." : "Save AI settings" }}
                      </Button>
                    </div>

                  </div>
                </template>

                <template v-else>
                <p v-if="!aiEncryptionConfigured" class="error">
                  Install encryption is created automatically during owner
                  setup. If this remains visible, run the latest migrations and
                  sign in or bootstrap again.
                </p>

                <div class="ai-model-row">
                  <label class="field ai-model-row__field">
                    <span class="ai-model-row__label">Provider</span>
                    <select
                      class="input ai-model-row__input"
                      :value="aiDefaultRouteInput.providerId"
                      @change="
                        handleAgentProviderChange(
                          ($event.target as HTMLSelectElement).value,
                        )
                      "
                    >
                      <option
                        v-for="provider in visibleAiProviders"
                        :key="provider.id"
                        :value="provider.id"
                      >
                        {{ provider.label }}
                      </option>
                    </select>
                  </label>

                  <label class="field ai-model-row__field">
                    <span class="ai-model-row__label">Model</span>
                    <select
                      class="input ai-model-row__input"
                      :value="aiDefaultRouteInput.model"
                      @change="
                        handleAgentModelChange(
                          ($event.target as HTMLSelectElement).value,
                        )
                      "
                    >
                      <option
                        v-for="option in visibleAgentModelOptions"
                        :key="option.id"
                        :value="option.model"
                      >
                        {{ option.label }} · {{ option.costLabel }}
                      </option>
                    </select>
                  </label>

                  <Button
                    color="primary"
                    size="compact"
                    type="button"
                    :disabled="aiSettingsSaveDisabled"
                    @click="saveAiSettings"
                  >
                    {{ aiSettingsSaving ? "Saving..." : "Save" }}
                  </Button>
                </div>

                <p class="selected-model-note selected-model-note--compact">
                  <strong>{{ selectedAgentModelCostLabel }}</strong>
                  {{ selectedAgentModelDescription }}
                </p>

                <label
                  v-if="selectedAgentProvider?.supportsApiKey"
                  class="field ai-model-key-field"
                >
                  <span>{{ selectedAgentProvider.label }} API key</span>
                  <input
                    v-model="selectedProviderKeyInput"
                    class="input ai-model-row__input"
                    type="password"
                    autocomplete="off"
                    spellcheck="false"
                    :placeholder="
                      selectedAgentProvider.configured
                        ? 'Paste a new key to replace stored key'
                        : 'Paste API key'
                    "
                  />
                </label>

                </template>

              </template>
            </div>
          </div>
        </section>

        <section
          id="account-payments"
          class="card accordion-card payments-section"
        >
          <button
            id="account-trigger-payments"
            class="accordion-trigger"
            type="button"
            :aria-expanded="openSection.payments"
            aria-controls="account-panel-payments"
            @click="openSection.payments = !openSection.payments"
          >
            <span class="accordion-title-wrap accordion-title-flex">
              <h2>Payments</h2>
            </span>
            <span class="accordion-chevron" aria-hidden="true">▼</span>
          </button>
          <div
            id="account-panel-payments"
            class="accordion-panel"
            role="region"
            aria-labelledby="account-trigger-payments"
            :hidden="!openSection.payments"
          >
            <div class="advanced-subsection">
              <PageLoading
                v-if="commerceLoading"
                compact
                label="Loading payment settings..."
              />

              <template v-else>
                <div
                  v-if="commerceSettings?.stripe.managedAvailable"
                  class="managed-stripe-panel"
                >
                  <div class="managed-stripe-panel__header">
                    <div>
                      <h3>Stripe payments</h3>
                      <p>{{ managedStripeDescription }}</p>
                    </div>
                    <StatusBadge :tone="managedStripeStatusTone">
                      {{ managedStripeStatusLabel }}
                    </StatusBadge>
                  </div>

                  <p
                    v-if="commerceSettings.stripe.requirementsDue.length"
                    class="managed-stripe-panel__requirements"
                    role="status"
                  >
                    {{ commerceSettings.stripe.requirementsDue.length }} Stripe
                    {{ commerceSettings.stripe.requirementsDue.length === 1 ? "requirement" : "requirements" }}
                    still {{ commerceSettings.stripe.requirementsDue.length === 1 ? "needs" : "need" }} attention.
                  </p>

                  <div class="managed-stripe-panel__actions">
                    <label
                      v-if="!commerceSettings.stripe.connected"
                      class="field managed-stripe-panel__country"
                      for="stripe-connect-country"
                    >
                      <span>Business country</span>
                      <select
                        id="stripe-connect-country"
                        v-model="stripeConnectCountry"
                        class="input"
                      >
                        <option
                          v-for="country in STRIPE_CONNECT_COUNTRIES"
                          :key="country.value"
                          :value="country.value"
                        >
                          {{ country.label }}
                        </option>
                      </select>
                    </label>

                    <Button
                      v-if="commerceSettings.stripe.connectionStatus !== 'active'"
                      color="primary"
                      size="compact"
                      type="button"
                      :disabled="commerceConnecting"
                      @click="startManagedStripeOnboarding(commerceSettings.stripe.connected ? 'refresh' : 'onboard')"
                    >
                      {{ managedStripeActionLabel }}
                    </Button>

                    <Button
                      v-if="
                        commerceSettings.stripe.connectionStatus === 'active' &&
                        commerceSettings.stripe.mode !== 'managed'
                      "
                      color="primary"
                      size="compact"
                      type="button"
                      :disabled="commerceSaving"
                      @click="selectCommerceStripeProvider('managed')"
                    >
                      Use Stripe Connect
                    </Button>

                    <Button
                      v-if="commerceSettings.stripe.connectionStatus === 'active'"
                      color="outline"
                      size="compact"
                      href="https://dashboard.stripe.com/"
                      target="_blank"
                      rel="noopener"
                    >
                      Open Stripe dashboard
                    </Button>
                  </div>
                </div>

                <div class="commerce-settings-row">
                  <label class="field commerce-settings-row__field">
                    <span>Default currency</span>
                    <select v-model="defaultCurrencyInput" class="input">
                      <option
                        v-for="option in commerceCurrencyOptions"
                        :key="option.value"
                        :value="option.value"
                      >
                        {{ option.label }}
                      </option>
                    </select>
                  </label>

                  <div
                    v-if="commerceSettings?.stripe.directKeySetupAllowed && !commerceSettings.stripe.directConfigured"
                    class="field commerce-settings-row__field commerce-settings-row__field--secret payment-key-field"
                  >
                    <label for="stripe-secret-key-input">
                      Stripe secret key
                    </label>
                    <div class="password-field payment-key-row">
                      <input
                        id="stripe-secret-key-input"
                        v-model="stripeSecretInput"
                        class="input password-field__input payment-key-row__input"
                        :type="showStripeSecret ? 'text' : 'password'"
                        autocomplete="off"
                        spellcheck="false"
                        placeholder="sk_live_... or sk_test_..."
                        @keydown.enter.prevent="saveCommerceSettings"
                      />
                      <button
                        type="button"
                        class="password-field__toggle"
                        :aria-label="
                          showStripeSecret
                            ? 'Hide Stripe secret key'
                            : 'Show Stripe secret key'
                        "
                        :aria-pressed="showStripeSecret"
                        @click="showStripeSecret = !showStripeSecret"
                      >
                        <UiIcon
                          :name="showStripeSecret ? 'EyeOff' : 'Eye'"
                          :size="18"
                        />
                      </button>
                    </div>
                  </div>

                  <Button
                    color="primary"
                    size="compact"
                    type="button"
                    :disabled="commerceSaveDisabled"
                    @click="saveCommerceSettings"
                  >
                    {{ commerceSaving ? "Saving..." : "Save settings" }}
                  </Button>
                </div>

                <p
                  v-if="
                    commerceSettings?.stripe.directSource === 'environment' &&
                    commerceSettings?.stripe.keyHint
                  "
                  class="field-hint"
                >
                  A configured Wrangler secret takes priority over any stored
                  account key.
                </p>

                <p
                  v-if="
                    commerceSettings && !commerceSettings.encryptionConfigured
                  "
                  class="field-hint"
                >
                  A local encryption key will be initialized before this Stripe
                  key is stored.
                </p>

                <p
                  v-if="
                    commerceSettings?.stripe.mode === 'managed' &&
                    commerceSettings.stripe.directConfigured
                  "
                  class="field-hint"
                >
                  The configured API key is retained as a fallback and is not
                  used while Stripe Connect is active.
                </p>

                <div
                  v-if="commerceSettings?.stripe.directConfigured"
                  class="commerce-provider-actions"
                >
                  <Button
                    v-if="commerceSettings.stripe.directKeySetupAllowed && commerceSettings.stripe.mode === 'managed'"
                    color="outline"
                    size="compact"
                    type="button"
                    :disabled="commerceSaving"
                    @click="selectCommerceStripeProvider('direct')"
                  >
                    Use configured API key
                  </Button>

                  <Button
                    v-if="commerceSettings.stripe.directSource === 'stored'"
                    color="outline"
                    size="compact"
                    type="button"
                    :disabled="commerceClearDisabled"
                    @click="clearCommerceStripeKey"
                  >
                    Remove stored key
                  </Button>
                </div>

                <p v-if="commerceError" class="error">{{ commerceError }}</p>
              </template>
            </div>
          </div>
        </section>

        <section class="card accordion-card timezone-section">
          <button
            id="account-trigger-timezone"
            class="accordion-trigger"
            type="button"
            :aria-expanded="openSection.timezone"
            aria-controls="account-panel-timezone"
            @click="openSection.timezone = !openSection.timezone"
          >
            <span class="accordion-title-wrap accordion-title-flex">
              <h2>Timezone</h2>
            </span>
            <span class="accordion-chevron" aria-hidden="true">▼</span>
          </button>
          <div
            id="account-panel-timezone"
            class="accordion-panel"
            role="region"
            aria-labelledby="account-trigger-timezone"
            :hidden="!openSection.timezone"
          >
            <div class="advanced-subsection">
              <div class="timezone-row">
                <label class="field timezone-row__field">
                  <input
                    v-model="timezoneInput"
                    class="input timezone-row__input"
                    type="text"
                    list="account-timezone-options"
                    aria-label="Timezone"
                    placeholder="Start typing a timezone"
                    spellcheck="false"
                  />
                  <datalist id="account-timezone-options">
                    <option
                      v-for="zone in supportedTimeZones"
                      :key="zone"
                      :value="zone"
                    >
                      {{ getTimeZoneDisplayLabel(zone) }}
                    </option>
                  </datalist>
                </label>
                <div class="timezone-row__actions">
                  <Button
                    color="outline"
                    size="compact"
                    type="button"
                    @click="detectTimezoneValue"
                  >
                    Detect from browser
                  </Button>
                  <Button
                    color="primary"
                    size="compact"
                    type="button"
                    :disabled="saveDisabled"
                    @click="saveSettings"
                  >
                    {{ saving ? "Saving..." : "Save" }}
                  </Button>
                </div>
              </div>

              <p v-if="error" class="error">{{ error }}</p>
            </div>
          </div>
        </section>

      </template>
    </main>

    <Teleport to="body">
      <div
        v-if="localExecutorSetupOpen"
        class="modal-overlay local-executor-modal-overlay"
        @click.self="closeLocalExecutorSetup"
      >
        <section
          class="modal local-executor-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="local-executor-modal-title"
        >
          <div class="modal-header local-executor-modal__header">
            <div>
              <h2 id="local-executor-modal-title">
                Connect to your local computer
              </h2>
            </div>
            <Button
              color="ghost"
              shape="soft"
              size="compact"
              icon-only
              class="modal-close"
              type="button"
              aria-label="Close Local Executor setup"
              title="Close"
              :disabled="localExecutorPairingBusy"
              @click="closeLocalExecutorSetup"
            >
              <UiIcon name="X" :size="18" aria-hidden="true" />
            </Button>
          </div>

          <p v-if="!localExecutorPluginEnabled" class="local-executor-note">
            First, turn on Local Executor in this plugin row. Then come back
            here and create the pairing command.
          </p>

          <ol class="local-executor-steps">
            <li>
              <strong>Clone your ME3 repo.</strong>
              <span>
                Put the ME3 repo on the computer that will run local tasks.
                This is the repo with
                <code>packages/local-executor</code> inside it.
              </span>
            </li>
            <li>
              <strong>Open Terminal and go to that repo.</strong>
              <span>
                Replace the placeholders with your real folders, or type
                <code>cd </code>, drag the ME3 folder into Terminal, and press
                Return.
              </span>
              <div class="local-executor-command">
                <pre><code>{{ LOCAL_EXECUTOR_CD_COMMAND }}</code></pre>
                <Button
                  color="outline"
                  size="small"
                  shape="soft"
                  type="button"
                  @click="
                    copyLocalExecutorCommand(LOCAL_EXECUTOR_CD_COMMAND, 'cd')
                  "
                >
                  {{ localExecutorCopiedCommand === "cd" ? "Copied" : "Copy" }}
                </Button>
              </div>
            </li>
            <li>
              <strong>Pair this computer with ME3.</strong>
              <span>
                Create a temporary pairing command, then paste it into Terminal.
                The code is already inside the command.
              </span>
              <Button
                color="primary"
                size="compact"
                shape="soft"
                type="button"
                :disabled="
                  localExecutorPairingBusy || !localExecutorPluginEnabled
                "
                @click="startLocalExecutorPairing"
              >
                {{
                  localExecutorPairingBusy
                    ? "Creating..."
                    : localExecutorPairing
                      ? "Create fresh command"
                      : "Create pairing command"
                }}
              </Button>
              <span v-if="localExecutorPairing">
                <template v-if="localExecutorPairingExpiryLabel">
                  It expires {{ localExecutorPairingExpiryLabel }}.
                </template>
                It saves a small runner token at
                <code>~/.me3/local-executor/token.json</code>.
              </span>
              <div
                v-if="localExecutorPairingCommand"
                class="local-executor-command"
              >
                <pre><code>{{ localExecutorPairingCommand }}</code></pre>
                <Button
                  color="outline"
                  size="small"
                  shape="soft"
                  type="button"
                  @click="
                    copyLocalExecutorCommand(
                      localExecutorPairingCommand,
                      'pair',
                    )
                  "
                >
                  {{
                    localExecutorCopiedCommand === "pair" ? "Copied" : "Copy"
                  }}
                </Button>
              </div>
            </li>
            <li>
              <strong>Configure your local AI agent.</strong>
              <span>
                OpenCode, Codex, and Claude are supported. Install and sign in
                to the tool locally first. Use <code>opencode</code>,
                <code>codex</code>, or <code>claude</code> in this command.
              </span>
              <div class="local-executor-command">
                <pre><code>{{ LOCAL_EXECUTOR_CONFIG_COMMAND }}</code></pre>
                <Button
                  color="outline"
                  size="small"
                  shape="soft"
                  type="button"
                  @click="
                    copyLocalExecutorCommand(
                      LOCAL_EXECUTOR_CONFIG_COMMAND,
                      'config',
                    )
                  "
                >
                  {{
                    localExecutorCopiedCommand === "config" ? "Copied" : "Copy"
                  }}
                </Button>
              </div>
            </li>
            <li>
              <strong>Start the local runner.</strong>
              <span>
                Leave this Terminal window open. This is the process that checks
                ME3 and picks up local tasks while your computer is awake.
              </span>
              <div class="local-executor-command">
                <pre><code>{{ LOCAL_EXECUTOR_RUN_COMMAND }}</code></pre>
                <Button
                  color="outline"
                  size="small"
                  shape="soft"
                  type="button"
                  @click="
                    copyLocalExecutorCommand(LOCAL_EXECUTOR_RUN_COMMAND, 'run')
                  "
                >
                  {{ localExecutorCopiedCommand === "run" ? "Copied" : "Copy" }}
                </Button>
              </div>
              <span>
                On macOS, use this version if you want Terminal to keep the
                computer awake while the runner is open.
              </span>
              <div class="local-executor-command">
                <pre><code>{{ LOCAL_EXECUTOR_KEEP_AWAKE_COMMAND }}</code></pre>
                <Button
                  color="outline"
                  size="small"
                  shape="soft"
                  type="button"
                  @click="
                    copyLocalExecutorCommand(
                      LOCAL_EXECUTOR_KEEP_AWAKE_COMMAND,
                      'awake',
                    )
                  "
                >
                  {{
                    localExecutorCopiedCommand === "awake" ? "Copied" : "Copy"
                  }}
                </Button>
              </div>
            </li>
            <li>
              <strong>Add a local project.</strong>
              <span>
                Visit your ME3 site, open Tasks, and add a project with type
                <code>Local</code>. Use the local folder
                path for the project repo you want the runner to work in.
              </span>
              <router-link
                class="local-executor-project-link"
                to="/tasks"
                @click="closeLocalExecutorSetup"
              >
                Open Projects
              </router-link>
            </li>
            <li>
              <strong>Add a task and move it to Doing.</strong>
              <span>
                Backlog is just a holding area. When a task in a local project
                moves to Doing, the local runner can claim it and run it inside
                that project repo.
              </span>
            </li>
            <li>
              <strong>Check the result.</strong>
              <span>
                The local runner follows the rules in that project repo,
                including its <code>AGENTS.md</code>. When the run succeeds, ME3
                moves the task to Done.
              </span>
            </li>
          </ol>

          <p v-if="localExecutorPairingError" class="error">
            {{ localExecutorPairingError }}
          </p>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="storageModalOpen"
        class="modal-overlay"
        @click.self="storageModalOpen = false"
      >
        <section
          class="modal storage-guide-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="storage-guide-title"
          tabindex="-1"
          @keydown.escape="storageModalOpen = false"
        >
          <header class="modal-header">
            <h2 id="storage-guide-title">Configure storage</h2>
            <button
              class="modal-close"
              type="button"
              aria-label="Close storage setup guide"
              @click="storageModalOpen = false"
            >
              ×
            </button>
          </header>

          <p class="storage-guide-copy">
            R2 storage is required for email attachments, assistant image
            uploads, generated images, and larger site media.
            <strong>Cloudflare R2 includes 10 GB-month of Standard storage free.</strong>
          </p>

          <ol class="domain-email-guide-list storage-guide-list">
            <li>
              <strong>Activate R2 in Cloudflare.</strong>
              <span>
                Open
                <a
                  :href="storageActivationUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  >Cloudflare R2 plans</a
                >
                and activate storage for your account if it is not already
                active.
              </span>
            </li>
            <li>
              <strong>Create this bucket.</strong>
              <span>
                In R2, create a bucket with the generated name below.
              </span>
              <div class="storage-bucket-row">
                <code class="storage-bucket-code">{{ storageBucketName }}</code>
                <Button
                  color="outline"
                  size="small"
                  shape="soft"
                  type="button"
                  @click="copyStorageBucketName"
                >
                  Copy
                </Button>
              </div>
            </li>
            <li>
              <strong>Activate storage in ME3.</strong>
              <span>
                ME3 Updater commits the R2 binding to your Core repo. Cloudflare
                Workers Builds then redeploys the Worker.
              </span>
            </li>
          </ol>

          <p
            v-if="!coreGithubConnection?.connected"
            class="storage-guide-note"
          >
            Connect ME3 Updater to activate storage from here. You can still
            complete the Cloudflare R2 steps first.
          </p>
          <p v-if="storageError" class="storage-guide-error">
            {{ storageError }}
          </p>

          <div class="storage-guide-actions">
            <Button
              v-if="!coreGithubConnection?.connected"
              color="outline"
              size="compact"
              shape="soft"
              type="button"
              :disabled="
                Boolean(coreGithubSaving) ||
                appConnectionsSaving ||
                coreGithubLoading ||
                !coreGithubStatus?.me3AppConnected
              "
              @click="connectCoreGithubUpdater"
            >
              {{ coreGithubConnectLabel }}
            </Button>
            <Button
              color="outline"
              size="compact"
              shape="soft"
              type="button"
              :disabled="storageLoading"
              @click="loadCoreStorageStatus()"
            >
              Check again
            </Button>
            <Button
              color="primary"
              size="compact"
              shape="soft"
              type="button"
              :disabled="!storageCanActivate"
              @click="activateCoreStorage"
            >
              {{ storageSaving ? "Activating..." : "Activate storage" }}
            </Button>
          </div>
        </section>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="mailboxGuideOpen"
        class="modal-overlay"
        @click.self="mailboxGuideOpen = false"
      >
        <section
          class="modal domain-email-guide-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mailbox-guide-title"
          tabindex="-1"
          @keydown.escape="mailboxGuideOpen = false"
        >
          <header class="modal-header">
            <h2 id="mailbox-guide-title">Configure your email mailbox</h2>
            <button
              class="modal-close"
              type="button"
              aria-label="Close mailbox setup guide"
              @click="mailboxGuideOpen = false"
            >
              ×
            </button>
          </header>

          <div class="domain-email-guide-section">
            <h3>Receiving email</h3>
            <p>Requires a custom domain.</p>
            <ol class="domain-email-guide-list">
              <li>
                Visit Cloudflare
                <a
                  href="https://dash.cloudflare.com/?to=/:account/email-service/routing"
                  target="_blank"
                  rel="noopener noreferrer"
                  >Email Routing</a
                >
                and click <strong>+ Onboard Domain</strong>.
              </li>
              <li>
                Add your domain, open the settings page, then click the
                <strong>Routing rules</strong> tab.
              </li>
              <li>
                Click <strong>+ Create Routing Rule</strong> and enter
                <code>name@yourdomain.com</code>, for example
                <code>assistant@yourdomain.com</code>. For
                <strong>Action</strong>, select <strong>Send to worker</strong>,
                then for <strong>Destination</strong>, select your ME3 worker
                installation, for example <code>kierans-me3</code>.
              </li>
            </ol>
          </div>

          <div class="domain-email-guide-section">
            <h3>Sending email</h3>
            <p>
              Cloudflare Email Service requires a Workers paid subscription at
              $5/month.
            </p>
            <ol class="domain-email-guide-list">
              <li>
                Visit Cloudflare
                <a
                  href="https://dash.cloudflare.com/?to=/:account/email-service/sending/onboarding"
                  target="_blank"
                  rel="noopener noreferrer"
                  >Email Sending</a
                >.
              </li>
              <li>Select your domain and click done.</li>
              <li>
                Visit
                <a href="/email" target="_blank" rel="noopener noreferrer"
                  >/email</a
                >
                to send an email.
              </li>
            </ol>
            <p>
              If you want to use another sender/provider like Postmark, Mailgun,
              or SMTP, they need different configuration.
            </p>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.account-page {
  min-height: 100vh;
}

.main {
  display: flex;
  flex-direction: column;
  max-width: 700px;
  margin: 0 auto;
  padding: 20px 40px;
}

.account-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 20px;
}

h1 {
  margin: 0;
  font-size: 28px;
  line-height: 1.1;
}

.account-title {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}

.account-title__version {
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 0.72em;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
}

.account-theme-switch {
  flex: 0 0 auto;
}

.account-mobile-nav {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-width: 0;
  min-height: 44px;
}

.account-mobile-nav__actions {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
}

.account-header {
  display: none;
}

.account-mobile-nav__title {
  margin: 0;
  color: var(--color-text);
  font-size: 15px;
  font-weight: 700;
  line-height: 1.2;
  text-align: center;
}

.primary-section {
  order: 2;
}

.storage-section {
  order: 3;
}

.plugins-section {
  order: 4;
}

.app-connections-section {
  order: 5;
}

.ai-section {
  order: 6;
}

.payments-section {
  order: 7;
}

.timezone-section {
  order: 8;
}

.account-resources {
  display: grid;
  gap: 14px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--ui-border, var(--color-border));
}

.account-resources__billing-note {
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
  line-height: 1.45;
}

.account-resource-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
}

.account-resource-links a {
  color: var(--ui-accent-strong, var(--color-text));
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
}

.account-resource-links a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.core-update-callout {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 20px;
  padding: 14px 16px;
  border: 1px solid
    color-mix(
      in oklab,
      var(--ui-accent, #4caf50) 34%,
      var(--ui-border, var(--color-border))
    );
  border-radius: var(--ui-radius-sm, 8px);
  background: color-mix(
    in oklab,
    var(--ui-accent, #4caf50) 12%,
    var(--ui-surface, var(--color-bg))
  );
}

.core-update-callout__copy {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.core-update-callout__heading {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.core-update-callout__icon {
  flex-shrink: 0;
  color: var(--ui-accent-strong, var(--color-accent));
}

.core-update-callout h2,
.core-update-callout p {
  margin: 0;
}

.core-update-callout h2 {
  color: var(--ui-text, var(--color-text));
  font-size: 16px;
  line-height: 1.25;
}

.core-update-callout p {
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  line-height: 1.45;
}

.core-update-callout__details {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
  line-height: 1.4;
}

.core-update-callout__details a {
  color: var(--ui-accent-strong, var(--color-text));
  font-weight: 700;
  text-decoration: none;
}

.core-update-callout__details a:hover {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.core-update-callout__actions {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.core-update-callout__message {
  color: var(--ui-text-muted, var(--color-text-muted));
}

.core-update-callout__error {
  color: var(--ui-danger, #b42318);
}

.card {
  margin-bottom: 20px;
  border: 1px solid var(--color-border);
  border-radius: 8px;
  background: var(--color-bg);
}

.accordion-card {
  padding: 0;
  overflow: hidden;
}

.accordion-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  border: none;
  background: transparent;
  color: var(--color-text);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease;
}

.accordion-trigger:hover {
  background: var(--color-bg-subtle);
}

.accordion-title-wrap h2 {
  margin: 0;
  font-size: 18px;
  line-height: 1.2;
}

.accordion-title-flex {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
  min-width: 0;
}

.accordion-status-badges {
  display: inline-flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 8px;
}

.accordion-header-hint {
  flex: 1 1 200px;
  min-width: 0;
  color: var(--color-text-muted);
  font-size: 13px;
  line-height: 1.35;
}

.accordion-chevron {
  flex-shrink: 0;
  font-size: 11px;
  opacity: 0.65;
  transition: transform 0.2s ease;
}

.accordion-trigger[aria-expanded="true"] .accordion-chevron {
  transform: rotate(180deg);
}

.accordion-panel {
  padding: 10px 16px 16px;
}

.account-signin-hint {
  margin: 0 0 14px;
}

.email-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.email-row .input {
  flex: 1;
}

.account-email-row {
  align-items: end;
}

.account-email-field {
  flex: 1;
}

.hint {
  margin: 0 0 16px;
  color: var(--color-text-muted);
  font-size: 14px;
  line-height: 1.5;
}

.field {
  display: grid;
  gap: 8px;
  color: var(--color-text);
  font-size: 14px;
}

.timezone-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.timezone-row__field {
  flex: 1 1 220px;
  min-width: 0;
  margin: 0;
}

.timezone-row__input {
  min-height: 36px;
  padding: 8px 12px;
}

.timezone-row__actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.ai-model-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.ai-model-row__field {
  flex: 1 1 180px;
  min-width: 0;
  gap: 4px;
  margin: 0;
}

.ai-model-row__label {
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
  font-weight: 600;
}

.ai-model-row__input {
  min-height: 36px;
  padding: 8px 12px;
}

.ai-model-key-field {
  gap: 6px;
}

.managed-ai-settings {
  display: grid;
  gap: 0;
}

.managed-ai-row {
  display: grid;
  gap: 8px;
  padding: 16px 0;
  border-bottom: 1px solid var(--ui-border, var(--color-border));
}

.managed-ai-row:first-child {
  padding-top: 0;
}

.managed-ai-row__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.managed-ai-row h3 {
  margin: 0;
  color: var(--ui-text, var(--color-text));
  font-size: 15px;
  line-height: 1.3;
}

.managed-ai-help,
.managed-ai-unavailable {
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
  line-height: 1.5;
}

.managed-ai-model-field {
  gap: 6px;
  margin: 0;
}

.managed-ai-model-field .input {
  min-height: 44px;
}

.managed-ai-usage {
  gap: 7px;
}

.managed-ai-usage__labels {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
}

.managed-ai-usage__labels strong {
  color: var(--ui-text, var(--color-text));
  font-weight: 700;
}

.managed-ai-usage__track {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--ui-surface-strong, var(--color-border));
}

.managed-ai-usage__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--ui-accent, var(--color-accent));
}

.managed-ai-switch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  min-height: 44px;
  cursor: pointer;
}

.managed-ai-switch input {
  width: 20px;
  height: 20px;
  margin: 0;
  accent-color: var(--ui-accent, var(--color-accent));
}

.managed-ai-limit {
  display: grid;
  gap: 8px;
  margin: 4px 0 0;
  padding: 0;
  border: 0;
}

.managed-ai-limit legend,
.managed-ai-limit__custom > span:first-child {
  margin-bottom: 6px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
  font-weight: 600;
}

.managed-ai-limit__options {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.managed-ai-limit__option {
  min-height: 44px;
  padding: 8px 10px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  font: inherit;
  font-weight: 650;
  cursor: pointer;
}

.managed-ai-limit__option:hover:not(:disabled) {
  border-color: var(--ui-accent, var(--color-accent));
}

.managed-ai-limit__option--active {
  border-color: var(--ui-accent, var(--color-accent));
  background: color-mix(in oklab, var(--ui-accent, #009578) 12%, transparent);
}

.managed-ai-limit__option:focus-visible {
  outline: 2px solid var(--ui-accent, var(--color-accent));
  outline-offset: 2px;
}

.managed-ai-limit:disabled .managed-ai-limit__option {
  cursor: not-allowed;
  opacity: 0.55;
}

.managed-ai-limit__custom {
  gap: 0;
  margin: 4px 0 0;
}

.managed-ai-money-input {
  position: relative;
  display: block;
}

.managed-ai-money-input > span {
  position: absolute;
  top: 50%;
  left: 12px;
  z-index: 1;
  color: var(--ui-text-muted, var(--color-text-muted));
  transform: translateY(-50%);
  pointer-events: none;
}

.managed-ai-money-input .input {
  width: 100%;
  min-height: 44px;
  padding-left: 26px;
}

.managed-ai-unavailable {
  padding: 10px 12px;
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface-soft, var(--color-bg));
}

.managed-ai-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 16px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.account-inline-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.selected-model-note--compact {
  font-size: 12px;
  line-height: 1.4;
}

.advanced-subsection {
  display: grid;
  gap: 12px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--ui-border, var(--color-border));
}

.advanced-subsection:last-child {
  padding-bottom: 0;
  border-bottom: 0;
}

.advanced-subsection__header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.advanced-subsection__header h3 {
  margin: 0;
  color: var(--ui-text, var(--color-text));
  font-size: 15px;
  line-height: 1.25;
}

.theme-segmented {
  display: inline-grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  width: fit-content;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: 999px;
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.theme-segmented__option {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 999px;
  background: transparent;
  color: var(--ui-text-muted, var(--color-text-muted));
  font: inherit;
  cursor: pointer;
  transition:
    background 0.15s ease,
    border-color 0.15s ease,
    color 0.15s ease;
}

.theme-segmented__option:hover,
.theme-segmented__option:focus-visible {
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
}

.theme-segmented__option:focus-visible {
  outline: 2px solid var(--ui-accent, var(--color-accent));
  outline-offset: 2px;
}

.theme-segmented__option--active {
  border-color: color-mix(
    in oklab,
    var(--ui-accent, var(--color-accent)) 38%,
    var(--ui-border, var(--color-border))
  );
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  box-shadow: var(--ui-shadow-sm, var(--shadow-soft));
}

.field-hint {
  margin: 6px 0 0;
  color: var(--color-text-muted);
  font-size: 13px;
}

.email-settings {
  display: grid;
  gap: 16px;
}

.domain-email-guide-list {
  display: grid;
  gap: 10px;
  margin: 0;
  padding-left: 22px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  line-height: 1.45;
}

.domain-email-guide-list li::marker {
  color: var(--ui-accent, var(--color-accent));
  font-weight: 700;
}

.domain-email-guide-modal {
  display: grid;
  gap: 16px;
  max-height: min(720px, calc(100vh - 48px));
  overflow: auto;
}

.storage-guide-modal {
  display: grid;
  gap: 14px;
  max-height: min(720px, calc(100vh - 48px));
  overflow: auto;
}

.storage-guide-copy,
.storage-guide-note,
.storage-guide-status,
.storage-guide-error {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
}

.storage-guide-copy,
.storage-guide-note,
.storage-guide-status {
  color: var(--ui-text-muted, var(--color-text-muted));
}

.storage-guide-error {
  color: var(--ui-danger, #b42318);
}

.storage-guide-status a {
  margin-left: 6px;
  color: var(--ui-accent-strong, var(--color-text));
  font-weight: 700;
  text-decoration: none;
}

.storage-guide-status a:hover,
.storage-guide-status a:focus-visible {
  text-decoration: underline;
}

.storage-guide-list {
  margin: 0;
}

.storage-bucket-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  margin-top: 8px;
}

.storage-bucket-code {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  min-width: 0;
  max-width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  color: var(--ui-text, var(--color-text));
  font-size: 13px;
  overflow-wrap: anywhere;
}

.storage-guide-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

.domain-email-guide-list li {
  padding-left: 2px;
}

.domain-email-guide-list ol {
  display: grid;
  gap: 8px;
  margin: 8px 0 0;
  padding-left: 20px;
}

.domain-email-guide-list strong,
.domain-email-guide-list span {
  display: inline;
}

.domain-email-guide-list strong {
  color: var(--ui-text, var(--color-text));
}

.domain-email-guide-list code,
.domain-email-guide-section code {
  padding: 2px 5px;
  border-radius: 5px;
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  color: var(--ui-text, var(--color-text));
  font-size: 12px;
}

.domain-email-guide-section {
  display: grid;
  gap: 8px;
}

.domain-email-guide-section h3 {
  margin: 0;
  color: var(--ui-text, var(--color-text));
  font-size: 16px;
  line-height: 1.25;
}

.domain-email-guide-section p {
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  line-height: 1.45;
}

.domain-email-guide-modal a {
  color: var(--ui-accent, var(--color-accent));
  font-weight: 700;
  text-decoration: none;
}

.domain-email-guide-modal a:hover,
.domain-email-guide-modal a:focus-visible {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.email-settings__actions {
  gap: 8px;
  margin-top: 4px;
}

.setup-disclosure-intro {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.setup-disclosure-intro h3 {
  margin: 0 0 4px;
  color: var(--ui-text, var(--color-text));
  font-size: 15px;
  line-height: 1.25;
}

.setup-disclosure-intro p {
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  line-height: 1.45;
}

.domain-email-section {
  display: grid;
  gap: 12px;
}

.site-domain-summary {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.site-domain-summary li {
  display: flex;
  min-height: 40px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface-muted, var(--color-bg-subtle));
  color: var(--ui-text, var(--color-text));
  font-size: 13px;
}

.site-domain-summary li span:last-child {
  color: var(--ui-text-muted, var(--color-text-muted));
  overflow-wrap: anywhere;
  text-align: right;
}

.setup-guide-link {
  display: inline;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--ui-accent, var(--color-accent));
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

.setup-guide-link:hover,
.setup-guide-link:focus-visible {
  text-decoration: underline;
  text-underline-offset: 3px;
}

.mailbox-setup {
  display: grid;
  gap: 12px;
}

.email-address-save {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  min-width: 0;
}

.email-address-save__button {
  flex: 0 0 96px;
  min-height: 44px;
  padding-inline: 24px;
}

.email-address-field {
  flex: 1 1 240px;
  min-width: 0;
}

.email-address-input {
  font-size: 18px;
}

.compact-error {
  margin: 0;
  font-size: 13px;
}

.email-disclosure {
  border-top: 1px solid var(--ui-border, var(--color-border));
  padding-top: 12px;
}

.email-disclosure summary {
  width: fit-content;
  color: var(--ui-text, var(--color-text));
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.email-disclosure-body {
  display: grid;
  gap: 14px;
  padding-top: 14px;
}

.email-forwarding-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.email-forwarding-row__toggle {
  flex-shrink: 0;
}

.email-forwarding-row__input {
  flex: 1 1 200px;
  min-width: 0;
  min-height: 36px;
  padding: 8px 12px;
}

.mailbox-panel {
  margin-top: 16px;
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: 14px;
}

.mailbox-panel h3 {
  margin: 0;
  font-size: 16px;
}

.mailbox-panel h4 {
  margin: 0;
  font-size: 14px;
}

.mailbox-panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.mailbox-config-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-top: 14px;
}

.mailbox-route-summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 6px 12px;
  margin-top: 14px;
  padding: 12px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.mailbox-route-summary span {
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
  font-weight: 700;
  text-transform: uppercase;
}

.mailbox-route-summary strong {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--ui-text, var(--color-text));
  font-size: 13px;
}

.checkbox-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ui-text, var(--color-text));
  font-size: 13px;
  font-weight: 700;
}

.mailbox-forwarding-toggle {
  margin-top: 10px;
}

.connection-lines {
  display: grid;
  gap: 8px;
}

.connection-line {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-height: 40px;
  padding: 8px 12px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.connection-line--connected {
  border-color: color-mix(
    in oklab,
    var(--ui-accent, #4caf50) 34%,
    var(--ui-border, var(--color-border))
  );
  background: color-mix(
    in oklab,
    var(--ui-accent, #4caf50) 12%,
    var(--ui-surface, var(--color-bg))
  );
}

.connection-line--telegram {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  padding: 12px;
}

.connection-line--telegram-connected {
  display: flex;
  align-items: center;
  padding: 10px 12px;
}

.connection-line--local-password {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  padding: 12px;
}

.connection-line--local-password :deep(.me3-btn) {
  min-height: 44px;
}

.local-password-form {
  display: grid;
  gap: 6px;
  padding-top: 12px;
  border-top: 1px solid var(--ui-border, var(--color-border));
}

.local-password-form__fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr)) auto;
  align-items: end;
  gap: 8px;
}

.local-password-form__field {
  gap: 4px;
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
  font-weight: 600;
}

.connection-line__copy {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 2px;
}

.connection-line__title {
  min-width: 0;
  color: var(--ui-text, var(--color-text));
  font-size: 14px;
  font-weight: 650;
  line-height: 1.2;
}

.connection-line__description {
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
  line-height: 1.4;
}

.connection-line__message,
.connection-line__error {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 1.4;
}

.connection-line__message {
  color: var(--ui-text-muted, var(--color-text-muted));
}

.connection-line__error {
  color: var(--ui-danger, #b42318);
}

.connection-line__details {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 11px;
  line-height: 1.4;
}

.connection-line__details a {
  color: var(--ui-accent-strong, var(--color-text));
  text-decoration: none;
}

.connection-line__details a:hover {
  text-decoration: underline;
}

.connection-line__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.connection-line--telegram:not(.connection-line--telegram-connected)
  .connection-line__header {
  width: 100%;
}

.connection-line--telegram:not(.connection-line--telegram-connected)
  .connection-line__header
  .connection-line__end {
  display: inline-flex;
  padding-top: 0;
}

.connection-line__meta {
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
}

.connection-line__end {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  flex-shrink: 0;
  padding-top: 2px;
}

.connection-line--telegram .connection-line__end {
  display: inline-flex;
  padding-top: 0;
}

.connection-line--telegram-connected .connection-line__end {
  display: inline-flex;
  padding-top: 2px;
}

.telegram-setup-panel {
  display: grid;
  gap: 12px;
}

.telegram-setup-steps {
  display: grid;
  gap: 6px;
  margin: 0;
  padding-left: 20px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  line-height: 1.45;
}

.telegram-setup-steps li::marker {
  color: var(--ui-accent, var(--color-accent));
  font-weight: 700;
}

.telegram-setup-steps code {
  padding: 2px 5px;
  border-radius: 5px;
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  font-size: 12px;
}

.connection-lines__hint {
  margin: 8px 0 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 12px;
  line-height: 1.4;
}

.commerce-settings-row {
  display: grid;
  grid-template-columns: minmax(150px, 0.9fr) minmax(260px, 1.6fr) auto;
  align-items: end;
  gap: 8px;
  margin-bottom: 12px;
}

.managed-stripe-panel {
  display: grid;
  gap: 14px;
  margin-bottom: 16px;
  padding: 16px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-md, 12px);
  background: var(--ui-surface, var(--color-bg));
}

.managed-stripe-panel__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.managed-stripe-panel__header h3 {
  margin: 0 0 4px;
  color: var(--ui-text, var(--color-text));
  font-size: 15px;
}

.managed-stripe-panel__header p,
.managed-stripe-panel__requirements {
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  line-height: 1.45;
}

.managed-stripe-panel__requirements {
  color: var(--ui-danger, #c62828);
}

.managed-stripe-panel__actions {
  display: flex;
  align-items: end;
  gap: 10px;
  flex-wrap: wrap;
}

.managed-stripe-panel__actions .me3-btn,
.commerce-provider-actions .me3-btn {
  min-height: 44px;
}

.managed-stripe-panel__country {
  width: min(280px, 100%);
  margin: 0;
}

.commerce-provider-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.commerce-settings-row__field {
  flex: 1;
  min-width: 0;
}

.payment-key-field {
  margin-top: 0;
}

.payment-key-row {
  position: relative;
}

.payment-key-row__input {
  min-height: 36px;
  padding: 8px 44px 8px 12px;
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

.outbound-sender-panel {
  display: grid;
  gap: 14px;
}

.email-provider-config {
  display: grid;
  gap: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--ui-border, var(--color-border));
}

.email-provider-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.email-provider-managed-note {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  line-height: 1.45;
}

.email-provider-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 14px;
}

.email-provider-test-note {
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  line-height: 1.45;
}

.plugin-meta-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.plugin-meta-grid div {
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg-subtle);
}

.plugin-meta-grid dt,
.plugin-meta-grid dd {
  margin: 0;
}

.plugin-meta-grid dt {
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
}

.plugin-meta-grid dd {
  overflow-wrap: anywhere;
  color: var(--color-text);
  font-size: 13px;
  font-weight: 700;
  text-transform: capitalize;
}

.plugin-detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
  gap: 14px;
}

.plugin-detail-block {
  min-width: 0;
}

.plugin-detail-block h4 {
  margin: 0 0 8px;
  color: var(--color-text);
  font-size: 13px;
}

.plugin-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.plugin-chip-list--muted {
  padding-top: 2px;
}

.plugin-chip {
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-bg);
  color: var(--color-text-muted);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.selected-model-note {
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 13px;
  line-height: 1.5;
}

.selected-model-note strong {
  display: inline-flex;
  margin-right: 6px;
  padding: 2px 7px;
  border-radius: 999px;
  background: var(--ui-accent-soft, rgba(76, 175, 80, 0.1));
  color: var(--ui-accent-strong, #2e7d32);
  font-size: 12px;
}

.recommended-card {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid rgba(76, 175, 80, 0.3);
  border-radius: 12px;
  background: rgba(76, 175, 80, 0.08);
}

.recommended-card h3 {
  margin: 0;
  font-size: 16px;
}

.recommended-card .hint {
  margin-bottom: 0;
}

.recommended-pill {
  width: fit-content;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(46, 125, 50, 0.16);
  color: #2e7d32;
  font-size: 12px;
  font-weight: 700;
}

.input {
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  background: var(--color-bg);
  color: var(--color-text);
  font: inherit;
  box-sizing: border-box;
}

.input:disabled {
  color: var(--color-text-muted);
  opacity: 1;
}

.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 16px 0 0;
}

.button {
  padding: 12px 18px;
  border: none;
  border-radius: 10px;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}

.button.primary {
  background: var(--color-text);
  color: var(--color-bg);
}

.button.secondary {
  background: var(--color-border);
  color: var(--color-text);
}

.button.danger {
  background: #e53935;
  color: #ffffff;
}

.button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.link-button-inline {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: fit-content;
  text-decoration: none;
}

.success {
  margin: 12px 0 0;
  color: #2e7d32;
  font-size: 14px;
  font-weight: 600;
}

.error {
  margin: 12px 0 0;
  color: #e53935;
  font-size: 14px;
  font-weight: 600;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.45);
}

.modal {
  width: min(560px, 100%);
  padding: 24px;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  background: var(--color-bg);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.modal-header h2 {
  margin: 0;
}

.modal-close {
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}

.local-executor-modal {
  display: grid;
  gap: 16px;
  width: min(680px, 100%);
  max-height: min(760px, calc(100vh - 48px));
  overflow-y: auto;
}

.local-executor-modal__header {
  margin-bottom: 0;
}

.local-executor-modal__intro,
.local-executor-note,
.local-executor-steps span {
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 14px;
  line-height: 1.5;
}

.local-executor-modal__intro,
.local-executor-note {
  margin: 0;
}

.local-executor-project-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  justify-self: start;
  min-height: 36px;
  padding: 0 12px;
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-accent-soft, var(--color-bg-subtle));
  color: var(--ui-accent, var(--color-primary));
  font-size: 14px;
  font-weight: 700;
  text-decoration: none;
}

.local-executor-project-link:hover {
  background: color-mix(
    in oklab,
    var(--ui-accent, var(--color-primary)),
    transparent 88%
  );
}

.local-executor-note {
  padding: 10px 12px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.local-executor-steps {
  display: grid;
  gap: 14px;
  margin: 0;
  padding-left: 22px;
}

.local-executor-steps li {
  display: grid;
  gap: 7px;
  padding-left: 4px;
}

.local-executor-steps strong {
  color: var(--ui-text, var(--color-text));
  font-size: 15px;
}

.local-executor-steps code,
.local-executor-command code {
  color: var(--ui-text, var(--color-text));
  font-family:
    ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
}

.local-executor-command {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: start;
  padding: 10px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface-muted, var(--color-bg-subtle));
}

.local-executor-command pre {
  margin: 0;
  max-width: 100%;
  overflow-x: auto;
  padding: 10px;
  border: 1px solid var(--ui-border, var(--color-border));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-surface, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
}

@media (max-width: 720px) {
  .main {
    padding: 16px;
  }

  .email-row,
  .connection-line {
    align-items: stretch;
  }

  .core-update-callout {
    flex-direction: column;
  }

  .core-update-callout__actions,
  .core-update-callout__actions :deep(.me3-btn) {
    width: 100%;
  }

  .connection-line {
    flex-direction: column;
    gap: 10px;
  }

  .connection-line__end {
    width: 100%;
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .connection-line__header {
    align-items: flex-start;
  }

  .connection-line--telegram:not(.connection-line--telegram-connected)
    .connection-line__header {
    align-items: stretch;
    flex-direction: column;
  }

  .connection-line--telegram-connected {
    align-items: stretch;
  }

  .connection-line--local-password .connection-line__header {
    align-items: stretch;
    flex-direction: column;
  }

  .local-password-form__fields {
    grid-template-columns: 1fr;
  }

  .timezone-row,
  .commerce-settings-row,
  .payment-key-row {
    align-items: stretch;
  }

  .commerce-settings-row {
    grid-template-columns: 1fr;
  }

  .managed-stripe-panel__header,
  .managed-stripe-panel__actions {
    align-items: stretch;
    flex-direction: column;
  }

  .managed-stripe-panel__country {
    width: 100%;
  }

  .timezone-row__actions {
    width: 100%;
    flex-wrap: wrap;
  }

  .ai-model-row {
    align-items: stretch;
  }

  .ai-model-row__field {
    flex-basis: 100%;
  }

  .managed-ai-limit__options {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .managed-ai-actions :deep(.me3-btn) {
    width: 100%;
    min-height: 44px;
  }

  .plugin-meta-grid,
  .plugin-detail-grid,
  .mailbox-config-grid,
  .email-provider-fields {
    grid-template-columns: 1fr;
  }

  .local-executor-modal {
    max-height: calc(100vh - 32px);
  }

  .local-executor-command {
    grid-template-columns: 1fr;
  }

  .local-executor-command :deep(.me3-btn) {
    width: 100%;
  }

  .email-row .button {
    width: 100%;
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
