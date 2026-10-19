import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { useAuthStore } from "./auth";
import { api } from "../api";

vi.mock("../api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const storedUser = {
  id: "owner",
  email: "owner@example.com",
  name: "ME3 Owner",
  username: "owner",
  timezone: null,
  locale: "en-US",
  localeSource: "inferred" as const,
};

describe("auth store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(api.get).mockRejectedValue(new Error("No session"));
    vi.mocked(api.post).mockResolvedValue({ ok: true });
  });

  describe("initialization", () => {
    it("starts unauthenticated before hydration", () => {
      const store = useAuthStore();
      expect(store.user).toBeNull();
      expect(store.isAuthenticated).toBe(false);
      expect(store.initialized).toBe(false);
    });

    it("hydrates session from /auth/me", async () => {
      window.localStorage.setItem(
        "me3_core_owner_session",
        JSON.stringify(storedUser),
      );
      vi.mocked(api.get).mockResolvedValue({
        ok: true,
        user: {
          id: "owner",
          email: "owner@example.com",
          name: "ME3 Owner",
          username: "owner",
          timezone: null,
        },
      });

      const store = useAuthStore();
      await store.ensureInitialized();

      expect(store.initialized).toBe(true);
      expect(store.user).toEqual(storedUser);
      expect(store.isAuthenticated).toBe(true);
      expect(api.get).toHaveBeenCalledWith("/auth/me");
      expect(window.localStorage.getItem("me3_core_owner_session")).toBeNull();
    });

    it("treats missing session as unauthenticated", async () => {
      const store = useAuthStore();
      await store.ensureInitialized();

      expect(store.initialized).toBe(true);
      expect(store.user).toBeNull();
      expect(store.isAuthenticated).toBe(false);
      expect(api.get).toHaveBeenCalledWith("/auth/me");
    });

    it("does not rehydrate after initialization", async () => {
      vi.mocked(api.get).mockResolvedValue({
        ok: true,
        user: {
          id: "owner",
          email: "owner@example.com",
          name: "ME3 Owner",
          username: "owner",
          timezone: null,
        },
      });

      const store = useAuthStore();
      await store.ensureInitialized();
      vi.mocked(api.get).mockRejectedValue(new Error("No session"));
      await store.ensureInitialized();

      expect(store.user).toEqual(storedUser);
      expect(api.get).toHaveBeenCalledTimes(1);
    });
  });

  describe("bootstrapOwner", () => {
    it("sets the owner session when bootstrap succeeds", async () => {
      vi.mocked(api.post).mockResolvedValue({
        ok: true,
        owner: {
          id: "owner",
          email: "owner@example.com",
          name: "ME3 Owner",
          username: "owner",
          timezone: "Europe/Dublin",
        },
      });

      const store = useAuthStore();
      const result = await store.bootstrapOwner({
        bootstrapCode: "local-code",
        email: "owner@example.com",
        name: "ME3 Owner",
        username: "owner",
        password: "correct-horse-battery",
      });

      expect(result).toBe(true);
      expect(store.user).toEqual({
        ...storedUser,
        timezone: "Europe/Dublin",
      });
      expect(store.isAuthenticated).toBe(true);
      expect(store.initialized).toBe(true);
      expect(window.localStorage.getItem("me3_core_owner_session")).toBeNull();
      expect(api.post).toHaveBeenCalledWith("/admin/bootstrap", {
        bootstrapCode: "local-code",
        email: "owner@example.com",
        name: "ME3 Owner",
        username: "owner",
        password: "correct-horse-battery",
      });
    });

    it("omits a blank email", async () => {
      vi.mocked(api.post).mockResolvedValue({
        ok: true,
        owner: {
          id: "owner",
          email: null,
          name: "ME3 Owner",
          username: "owner",
          timezone: "UTC",
        },
      });

      const store = useAuthStore();
      const result = await store.bootstrapOwner({
        bootstrapCode: "local-code",
        email: "   ",
        name: "ME3 Owner",
        username: "owner",
        password: "correct-horse-battery",
      });

      expect(result).toBe(true);
      expect(api.post).toHaveBeenCalledWith("/admin/bootstrap", {
        bootstrapCode: "local-code",
        email: undefined,
        name: "ME3 Owner",
        username: "owner",
        password: "correct-horse-battery",
      });
    });

    it("returns false on invalid bootstrap", async () => {
      vi.mocked(api.post).mockRejectedValue(new Error("Invalid code"));

      const store = useAuthStore();
      const result = await store.bootstrapOwner({
        bootstrapCode: "bad-code",
        name: "ME3 Owner",
        username: "owner",
        password: "correct-horse-battery",
      });

      expect(result).toBe(false);
      expect(store.user).toBeNull();
      expect(store.isAuthenticated).toBe(false);
    });
  });

  describe("loginOwner", () => {
    it("sets the owner session when login succeeds", async () => {
      vi.mocked(api.post).mockResolvedValue({
        ok: true,
        owner: {
          id: "owner",
          email: "owner@example.com",
          name: "ME3 Owner",
          username: "owner",
          timezone: "Europe/Dublin",
        },
      });

      const store = useAuthStore();
      const result = await store.loginOwner({
        email: " owner@example.com ",
        password: "correct-horse-battery",
      });

      expect(result).toBe(true);
      expect(store.user).toEqual({
        ...storedUser,
        timezone: "Europe/Dublin",
      });
      expect(api.post).toHaveBeenCalledWith("/auth/login", {
        email: "owner@example.com",
        password: "correct-horse-battery",
      });
    });

    it("returns false on invalid login", async () => {
      vi.mocked(api.post).mockRejectedValue(new Error("Invalid login"));

      const store = useAuthStore();
      const result = await store.loginOwner({
        email: "owner@example.com",
        password: "wrong-password",
      });

      expect(result).toBe(false);
      expect(store.user).toBeNull();
      expect(store.isAuthenticated).toBe(false);
    });
  });

  describe("resetOwnerPassword", () => {
    it("posts setup-password password reset details", async () => {
      vi.mocked(api.post).mockResolvedValue({ ok: true });

      const store = useAuthStore();
      const result = await store.resetOwnerPassword({
        email: " owner@example.com ",
        bootstrapCode: "local-code",
        password: "new-correct-horse",
      });

      expect(result).toBe(true);
      expect(store.user).toBeNull();
      expect(api.post).toHaveBeenCalledWith("/auth/password-reset/bootstrap", {
        email: "owner@example.com",
        bootstrapCode: "local-code",
        password: "new-correct-horse",
      });
    });

    it("returns false when setup-password password reset fails", async () => {
      vi.mocked(api.post).mockRejectedValue(new Error("Invalid code"));

      const store = useAuthStore();
      const result = await store.resetOwnerPassword({
        email: "owner@example.com",
        bootstrapCode: "bad-code",
        password: "new-correct-horse",
      });

      expect(result).toBe(false);
    });
  });

  describe("logout", () => {
    it("clears user and local storage", async () => {
      const store = useAuthStore();
      store.setSession(storedUser);

      await store.logout();

      expect(api.post).toHaveBeenCalledWith("/auth/logout");
      expect(store.user).toBeNull();
      expect(store.isAuthenticated).toBe(false);
      expect(store.initialized).toBe(true);
      expect(window.localStorage.getItem("me3_core_owner_session")).toBeNull();
    });
  });
});
