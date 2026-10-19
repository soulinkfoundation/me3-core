import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { api } from "../api";

interface User {
  id: string;
  email: string | null;
  name: string;
  username: string;
  timezone: string | null;
  locale: string;
  localeSource: "explicit" | "inferred";
}

interface OwnerProfile {
  id: string;
  email: string | null;
  name: string;
  username: string;
  timezone: string | null;
}

interface AuthSessionResponse {
  ok: boolean;
  user: OwnerProfile | null;
}

export interface BootstrapOwnerInput {
  bootstrapCode: string;
  email?: string;
  name: string;
  username: string;
  password: string;
  timezone?: string | null;
}

export interface LoginOwnerInput {
  email: string;
  password: string;
}

export interface ResetOwnerPasswordInput {
  email: string;
  bootstrapCode: string;
  password: string;
}

const STORAGE_KEY = "me3_core_owner_session";

function ownerToUser(owner: OwnerProfile): User {
  return {
    id: owner.id,
    email: owner.email,
    name: owner.name,
    username: owner.username,
    timezone: owner.timezone,
    locale: "en-US",
    localeSource: "inferred",
  };
}

function clearStoredSession() {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export const useAuthStore = defineStore("auth", () => {
  const user = ref<User | null>(null);
  const initialized = ref(false);
  let initializePromise: Promise<void> | null = null;

  const isAuthenticated = computed(() => !!user.value);

  function setSession(newUser: User) {
    user.value = newUser;
    initialized.value = true;
    clearStoredSession();
  }

  async function refreshSession(): Promise<boolean> {
    try {
      const response = await api.get<AuthSessionResponse>("/auth/me");
      user.value = response.ok && response.user ? ownerToUser(response.user) : null;
      return Boolean(user.value);
    } catch {
      user.value = null;
      return false;
    } finally {
      clearStoredSession();
    }
  }

  async function ensureInitialized(): Promise<void> {
    if (initialized.value) {
      return;
    }

    if (!initializePromise) {
      initializePromise = (async () => {
        await refreshSession();
        initialized.value = true;
      })().finally(() => {
        initializePromise = null;
      });
    }

    await initializePromise;
  }

  async function bootstrapOwner(input: BootstrapOwnerInput): Promise<boolean> {
    try {
      const response = await api.post<{ ok: boolean; owner: OwnerProfile }>(
        "/admin/bootstrap",
        {
          bootstrapCode: input.bootstrapCode,
          email: input.email?.trim() || undefined,
          name: input.name.trim(),
          username: input.username.trim(),
          password: input.password,
          timezone: input.timezone ?? undefined,
        },
      );

      if (!response.ok) return false;
      setSession(ownerToUser(response.owner));
      return true;
    } catch (error) {
      console.error("Bootstrap owner error:", error);
      return false;
    }
  }

  async function loginOwner(input: LoginOwnerInput): Promise<boolean> {
    try {
      const response = await api.post<{ ok: boolean; owner: OwnerProfile }>(
        "/auth/login",
        {
          email: input.email.trim(),
          password: input.password,
        },
      );

      if (!response.ok) return false;
      setSession(ownerToUser(response.owner));
      return true;
    } catch (error) {
      console.error("Login owner error:", error);
      return false;
    }
  }

  async function resetOwnerPassword(input: ResetOwnerPasswordInput): Promise<boolean> {
    try {
      const response = await api.post<{ ok: boolean }>(
        "/auth/password-reset/bootstrap",
        {
          email: input.email.trim(),
          bootstrapCode: input.bootstrapCode,
          password: input.password,
        },
      );

      return response.ok;
    } catch (error) {
      console.error("Password reset error:", error);
      return false;
    }
  }

  async function logout() {
    try {
      await api.post<{ ok: boolean }>("/auth/logout");
    } catch (error) {
      console.error("Logout error:", error);
    }

    user.value = null;
    initialized.value = true;
    clearStoredSession();
  }


  return {
    user,
    initialized,
    isAuthenticated,
    ensureInitialized,
    refreshSession,
    bootstrapOwner,
    loginOwner,
    resetOwnerPassword,
    logout,
    setSession,
  };
});
