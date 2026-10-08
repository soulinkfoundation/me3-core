<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { definePage } from "unplugin-vue-router/runtime";
import { useRouter, useRoute } from "vue-router";
import BrandLogo from "../components/BrandLogo.vue";
import LandingGrids from "../components/LandingGrids.vue";
import UiIcon from "../components/UiIcon.vue";
import { api } from "../api";
import { useAuthStore } from "../stores/auth";
import { useSitesStore } from "../stores/sites";
import { DEFAULT_APP_PATH } from "../utils/navigation";
import {
  resolveAuthenticatedLoginRedirect,
  resolveMe3OAuthRedirect,
  resolveProfileSetupPath,
} from "../utils/loginRedirect";
import { detectBrowserTimeZone } from "../utils/timezone";

definePage({
  path: "/login",
  meta: {
    title: "Set up ME3 | Personal AI assistant",
    description: "Claim installation with a ME3 account.",
    robots: "noindex,follow",
    ogImage: "/icons/icon-512.png",
  },
});

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const sites = useSitesStore();
const remoteApiHost = import.meta.env.DEV
  ? import.meta.env.VITE_REMOTE_API_HOST || ""
  : "";

const email = ref("");
const name = ref("");
const bootstrapCode = ref("");
const password = ref("");
const showBootstrapCode = ref(false);
const showPassword = ref(false);
const loading = ref(false);
const me3SignInLoading = ref(false);
const configLoading = ref(true);
const ownerAuthConfigured = ref(false);
const ownerPasswordAuthConfigured = ref(false);
const ownerMe3AuthConfigured = ref(false);
const deploymentMode = ref<"managed" | "self_hosted" | "">("");
const setupRequired = ref<string[]>([]);
const resetMode = ref(false);
const showAdvancedSetup = ref(false);
const error = ref("");
const notice = ref("");
const passwordMinLength = 8;

const isSetupMode = computed(() => !ownerAuthConfigured.value);
const isResetMode = computed(
  () => ownerAuthConfigured.value && resetMode.value,
);
const isCustomPasswordSetupMode = computed(
  () =>
    ownerAuthConfigured.value &&
    ownerMe3AuthConfigured.value &&
    !ownerPasswordAuthConfigured.value &&
    showAdvancedSetup.value &&
    !isResetMode.value,
);
const isManagedInstall = computed(() => deploymentMode.value === "managed");
const canUseRemotePasswordSignIn = computed(
  () => Boolean(remoteApiHost && ownerPasswordAuthConfigured.value),
);
const showAuthChoice = computed(
  () => {
    if (isManagedInstall.value) {
      return !canUseRemotePasswordSignIn.value || !showAdvancedSetup.value;
    }
    return (
      !showAdvancedSetup.value &&
      !isResetMode.value &&
      (!ownerAuthConfigured.value ||
        (ownerMe3AuthConfigured.value && !ownerPasswordAuthConfigured.value))
    );
  },
);
const useBootstrapCodeInput = computed(
  () =>
    isSetupMode.value || isResetMode.value || isCustomPasswordSetupMode.value,
);
const missingBootstrapCode = computed(
  () =>
    (isSetupMode.value ||
      isResetMode.value ||
      isCustomPasswordSetupMode.value) &&
    setupRequired.value.includes("SETUP_PASSWORD"),
);
const missingOwnerSecrets = computed(() => missingBootstrapCode.value);
const showBootstrapSetup = computed(
  () =>
    !showAuthChoice.value &&
    (!isSetupMode.value || isResetMode.value || showAdvancedSetup.value),
);
const needsNewPassword = computed(
  () =>
    showBootstrapSetup.value &&
    (isSetupMode.value || isResetMode.value || isCustomPasswordSetupMode.value),
);
const showPasswordRequirement = computed(
  () => needsNewPassword.value && password.value.length < passwordMinLength,
);
const passwordRequirementText = computed(() => {
  const remaining = passwordMinLength - password.value.length;
  if (remaining <= 0) return "Password meets the length requirement.";

  return remaining === passwordMinLength
    ? `Password must be at least ${passwordMinLength} characters.`
    : `Add ${remaining} more character${remaining === 1 ? "" : "s"}. Passwords must be at least ${passwordMinLength} characters.`;
});

const canSubmit = computed(() => {
  if (loading.value || configLoading.value) return false;
  if (email.value.trim().length === 0 || password.value.length === 0)
    return false;

  if (isResetMode.value) {
    return bootstrapCode.value.trim().length > 0 && password.value.length >= 8;
  }

  if (isCustomPasswordSetupMode.value) {
    return bootstrapCode.value.trim().length > 0 && password.value.length >= 8;
  }

  if (!isSetupMode.value) return true;

  return (
    bootstrapCode.value.trim().length > 0 &&
    name.value.trim().length > 0 &&
    password.value.length >= 8
  );
});

function deriveUsername() {
  const source = email.value.split("@")[0] || name.value;
  const username = source
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return username || "owner";
}

async function resolveDefaultPostLoginRedirect(): Promise<string> {
  try {
    await sites.fetchSites();
    return resolveProfileSetupPath({
      sitesLoaded: sites.loaded,
      hasProfileSite: sites.hasProfileSite,
      defaultPath: DEFAULT_APP_PATH,
    });
  } catch {
    return DEFAULT_APP_PATH;
  }
}

async function resolvePostLoginRedirect(raw: unknown): Promise<string> {
  const redirect = resolveAuthenticatedLoginRedirect(raw, {
    origin: window.location.origin,
    hostname: window.location.hostname,
    dev: import.meta.env.DEV,
  });
  if (!redirect) return resolveDefaultPostLoginRedirect();
  return redirect;
}

function navigateAfterLogin(target: string) {
  router.push(target);
}

async function loadConfig() {
  try {
    const config = await api.get<{
      deploymentMode?: "managed" | "self_hosted";
      ownerAuthConfigured?: boolean;
      ownerPasswordAuthConfigured?: boolean;
      ownerMe3AuthConfigured?: boolean;
      setupRequired?: string[];
    }>("/config");
    deploymentMode.value = config.deploymentMode || "";
    ownerAuthConfigured.value = Boolean(config.ownerAuthConfigured);
    ownerPasswordAuthConfigured.value = Boolean(
      config.ownerPasswordAuthConfigured,
    );
    ownerMe3AuthConfigured.value = Boolean(config.ownerMe3AuthConfigured);
    setupRequired.value = Array.isArray(config.setupRequired)
      ? config.setupRequired
      : [];
  } catch (configError) {
    console.error("Config load error:", configError);
    error.value = "Unable to load setup state.";
  } finally {
    configLoading.value = false;
  }
}

async function submitAuth() {
  if (!canSubmit.value) return;

  loading.value = true;
  error.value = "";
  notice.value = "";

  if (isResetMode.value || isCustomPasswordSetupMode.value) {
    const wasCustomPasswordSetup = isCustomPasswordSetupMode.value;
    const success = await auth.resetOwnerPassword({
      email: email.value,
      bootstrapCode: bootstrapCode.value,
      password: password.value,
    });

    if (success) {
      resetMode.value = false;
      ownerPasswordAuthConfigured.value = true;
      bootstrapCode.value = "";
      password.value = "";
      notice.value = wasCustomPasswordSetup
        ? "Custom authentication enabled. Sign in with your new password."
        : "Password reset. Sign in with your new password.";
    } else {
      error.value = wasCustomPasswordSetup
        ? "Custom authentication setup failed. Check your ME3 account email, setup password, and new password."
        : "Reset failed. Check your email, setup password, and new password.";
    }

    loading.value = false;
    return;
  }

  const success = isSetupMode.value
    ? await auth.bootstrapOwner({
        bootstrapCode: bootstrapCode.value,
        email: email.value,
        name: name.value,
        username: deriveUsername(),
        password: password.value,
        timezone: detectBrowserTimeZone(),
      })
    : await auth.loginOwner({
        email: email.value,
        password: password.value,
      });

  if (success) {
    const redirect = await resolvePostLoginRedirect(route.query.redirect);
    navigateAfterLogin(redirect);
  } else {
    error.value = isSetupMode.value
      ? "Setup failed. Check your setup password and account password."
      : "Sign in failed. Check your email and password.";
  }

  loading.value = false;
}

async function startMe3SignIn() {
  if (me3SignInLoading.value || configLoading.value) return;

  me3SignInLoading.value = true;
  error.value = "";
  notice.value = "";

  try {
    const response = await api.post<{ ok: boolean; url?: string }>(
      "/auth/me3/start",
      {
        redirect: resolveMe3OAuthRedirect(route.query.redirect, {
          origin: window.location.origin,
          hostname: window.location.hostname,
          dev: import.meta.env.DEV,
          setupIncomplete: !ownerAuthConfigured.value,
        }),
      },
    );

    if (response.ok && response.url) {
      window.location.href = response.url;
      return;
    }

    error.value = "ME3 sign-in is not ready for this install yet.";
  } catch (startError) {
    console.error("ME3 sign-in start error:", startError);
    error.value =
      "ME3 sign-in is not ready yet. Use advanced setup to claim this install manually.";
  } finally {
    me3SignInLoading.value = false;
  }
}

function startResetMode() {
  resetMode.value = true;
  showAdvancedSetup.value = true;
  bootstrapCode.value = "";
  password.value = "";
  error.value = "";
  notice.value = "";
}

function startAdvancedSetup() {
  showAdvancedSetup.value = true;
  error.value = "";
  notice.value = "";
}

function cancelResetMode() {
  resetMode.value = false;
  bootstrapCode.value = "";
  password.value = "";
  error.value = "";
}

onMounted(loadConfig);
</script>

<template>
  <div class="login">
    <LandingGrids />
    <main class="login__main">
      <BrandLogo class="login__logo" alt="me3" />

      <section v-if="showAuthChoice" class="cloud-claim">
        <p class="cloud-claim__copy">
          {{
            isManagedInstall
              ? "Sign in with your ME3 account to open your managed installation."
              : "For simple authentication sign in via ME3.app"
          }}
        </p>
        <button
          type="button"
          class="button"
          :disabled="me3SignInLoading || configLoading"
          @click="startMe3SignIn"
        >
          {{ me3SignInLoading ? "Opening ME3..." : "Sign in with ME3.app" }}
        </button>
        <button
          v-if="!isManagedInstall || canUseRemotePasswordSignIn"
          type="button"
          class="text-button"
          @click="startAdvancedSetup"
        >
          {{ isManagedInstall ? "Use installation password" : "Advanced setup for custom authentication" }}
        </button>
        <p v-if="error" class="error">{{ error }}</p>
      </section>

      <form
        v-if="!showAuthChoice && (!isManagedInstall || canUseRemotePasswordSignIn)"
        class="login-form"
        @submit.prevent="submitAuth"
      >
        <section
          v-if="showBootstrapSetup && missingOwnerSecrets"
          class="setup-note"
          aria-live="polite"
        >
          <h1 class="setup-note__title">Configure</h1>
          <ol v-if="missingBootstrapCode" class="setup-note__steps">
            <li>
              Generate a secret key in the terminal using
              <code>openssl rand -hex 16</code>.
            </li>
            <li>
              Create a variable here: Cloudflare Dashboard -> Workers & Pages ->
              [YOUR ME3 WORKER NAME] -> Settings -> Variables and Secrets called
              <code>SETUP_PASSWORD</code> using the key you just generated.
            </li>
          </ol>
        </section>

        <button
          v-if="
            !isSetupMode &&
            ownerMe3AuthConfigured &&
            !ownerPasswordAuthConfigured &&
            !isResetMode &&
            !isCustomPasswordSetupMode
          "
          type="button"
          class="button"
          :disabled="me3SignInLoading || configLoading"
          @click="startMe3SignIn"
        >
          {{ me3SignInLoading ? "Opening ME3..." : "Sign in with ME3.app" }}
        </button>

        <p v-if="showBootstrapSetup && isResetMode" class="login-form__hint">
          Reset owner access with this install's setup password.
        </p>
        <p
          v-if="showBootstrapSetup && isCustomPasswordSetupMode"
          class="login-form__hint"
        >
          Enable custom authentication with this install's setup password.
        </p>

        <input
          v-if="showBootstrapSetup && isSetupMode"
          v-model="name"
          type="text"
          autocomplete="name"
          class="input"
          aria-label="Name"
          placeholder="Name"
          required
        />

        <input
          v-if="showBootstrapSetup || !isSetupMode"
          v-model="email"
          type="email"
          autocomplete="email"
          class="input"
          aria-label="Email"
          placeholder="Email"
          required
        />

        <div v-if="showBootstrapSetup || !isSetupMode" class="password-field">
          <input
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            :autocomplete="
              isSetupMode || isResetMode ? 'new-password' : 'current-password'
            "
            class="input password-field__input"
            aria-label="Password"
            :aria-describedby="
              needsNewPassword ? 'password-requirement' : undefined
            "
            :aria-invalid="showPasswordRequirement ? 'true' : undefined"
            :minlength="needsNewPassword ? passwordMinLength : undefined"
            :placeholder="
              isResetMode || isCustomPasswordSetupMode
                ? 'New password'
                : 'Password'
            "
            required
          />
          <button
            type="button"
            class="password-field__toggle"
            :aria-label="showPassword ? 'Hide password' : 'Show password'"
            :aria-pressed="showPassword"
            @click="showPassword = !showPassword"
          >
            <UiIcon :name="showPassword ? 'EyeOff' : 'Eye'" :size="18" />
          </button>
        </div>
        <p
          v-if="needsNewPassword"
          id="password-requirement"
          class="password-requirement"
          :class="{ 'password-requirement--error': showPasswordRequirement }"
          aria-live="polite"
        >
          {{ passwordRequirementText }}
        </p>

        <div
          v-if="showBootstrapSetup && useBootstrapCodeInput"
          class="password-field"
        >
          <input
            v-model="bootstrapCode"
            :type="showBootstrapCode ? 'text' : 'password'"
            autocomplete="one-time-code"
            class="input password-field__input"
            aria-label="Setup password"
            placeholder="Setup password"
            required
            autofocus
          />
          <button
            type="button"
            class="password-field__toggle"
            :aria-label="
              showBootstrapCode ? 'Hide setup password' : 'Show setup password'
            "
            :aria-pressed="showBootstrapCode"
            @click="showBootstrapCode = !showBootstrapCode"
          >
            <UiIcon :name="showBootstrapCode ? 'EyeOff' : 'Eye'" :size="18" />
          </button>
        </div>

        <button
          v-if="showBootstrapSetup || !isSetupMode"
          type="submit"
          class="button"
          :disabled="!canSubmit"
        >
          {{
            loading
              ? isResetMode
                ? "Resetting..."
                : isCustomPasswordSetupMode
                  ? "Enabling..."
                  : "Opening..."
              : isSetupMode
                ? "Create account"
                : isResetMode
                  ? "Reset password"
                  : isCustomPasswordSetupMode
                    ? "Enable custom authentication"
                    : "Sign in"
          }}
        </button>

        <button
          v-if="ownerPasswordAuthConfigured && !isResetMode && !remoteApiHost"
          class="text-button"
          type="button"
          @click="startResetMode"
        >
          Reset password
        </button>
        <button
          v-if="isResetMode"
          class="text-button"
          type="button"
          @click="cancelResetMode"
        >
          Back to sign in
        </button>
        <button
          v-if="
            showAdvancedSetup &&
            (isSetupMode ||
              isCustomPasswordSetupMode ||
              (isManagedInstall && canUseRemotePasswordSignIn))
          "
          class="text-button"
          type="button"
          @click="showAdvancedSetup = false"
        >
          Back to ME3 sign in
        </button>

        <p v-if="notice" class="notice">{{ notice }}</p>
        <p v-if="showBootstrapSetup && error" class="error">{{ error }}</p>
      </form>
    </main>
  </div>
</template>

<style scoped>
.login {
  position: relative;
  isolation: isolate;
  min-height: 100dvh;
  background: var(--ui-bg, var(--color-bg));
  color: var(--ui-text, var(--color-text));
}

.login__logo {
  display: block;
  width: min(140px, 48vw);
  height: auto;
  margin: 0 auto;
}

.login__main {
  position: relative;
  z-index: 1;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 28px;
  width: min(100% - 40px, 360px);
  margin: 0 auto;
  padding: 40px 0;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
}

.cloud-claim {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  text-align: center;
}

.cloud-claim__copy {
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 0.92rem;
  line-height: 1.45;
}

.login-form__hint {
  margin: 0;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 0.9rem;
  line-height: 1.45;
  text-align: center;
}

.setup-note {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--ui-border-strong, var(--color-border-strong));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(
    --ui-surface-muted,
    color-mix(in srgb, var(--ui-text, #fff) 5%, transparent)
  );
  color: var(--ui-text, var(--color-text));
  font-size: 0.9rem;
  line-height: 1.45;
}

.setup-note__title {
  margin: 0;
  font-size: 0.98rem;
  line-height: 1.2;
}

.setup-note p,
.setup-note__steps {
  margin: 0;
}

.setup-note__steps {
  padding-left: 20px;
}

.setup-note__steps li + li {
  margin-top: 6px;
}

.setup-note code {
  font-size: 0.84rem;
  color: var(--ui-text, var(--color-text));
  overflow-wrap: anywhere;
}

.input {
  width: 100%;
  min-height: 46px;
  padding: 0 12px;
  border: 1px solid var(--ui-border-strong, var(--color-border-strong));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-bg, var(--color-bg));
  color: var(--ui-text, var(--color-text));
  font-size: 0.98rem;
  outline: none;
}

.input::placeholder {
  color: var(--ui-text-muted, var(--color-text-muted));
  opacity: 0.78;
}

.input:focus {
  border-color: var(--ui-text, var(--color-text));
}

.password-field {
  position: relative;
  width: 100%;
}

.password-field__input {
  padding-right: 44px;
}

.password-field__toggle {
  position: absolute;
  top: 50%;
  right: 8px;
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

.password-requirement {
  margin: -4px 0 2px;
  color: var(--ui-text-muted, var(--color-text-muted));
  font-size: 0.84rem;
  line-height: 1.35;
}

.password-requirement--error {
  color: #c62828;
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding: 0 18px;
  border: 1px solid var(--ui-text, var(--color-text));
  border-radius: var(--ui-radius-sm, 8px);
  background: var(--ui-text, var(--color-text));
  color: var(--ui-bg, var(--color-bg));
  cursor: pointer;
  font-size: 0.98rem;
  font-weight: 800;
  transition: opacity 0.2s;
}

.button:hover:not(:disabled) {
  opacity: 0.9;
}

.button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.text-button {
  border: 0;
  background: transparent;
  color: var(--ui-text-muted, var(--color-text-muted));
  cursor: pointer;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.text-button:hover,
.text-button:focus-visible {
  color: var(--ui-text, var(--color-text));
}

.notice {
  margin: 0;
  color: #2e7d32;
  font-size: 0.9rem;
  font-weight: 700;
  text-align: center;
}

.error {
  margin: 0;
  color: #e53935;
  font-size: 0.9rem;
  text-align: center;
}
</style>
