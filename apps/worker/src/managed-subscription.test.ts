import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ManagedSubscriptionError,
  forwardManagedSubscriptionRequest,
  readManagedSubscriptionPurchase,
} from "./managed-subscription";
import type { Env } from "./types";

function createEnv(secrets: Record<string, string>): Env {
  return {
    ME3_CLOUD_API_ORIGIN: "https://api.me3.app/",
    DB: {
      prepare(sql: string) {
        return {
          bind(name: string) {
            return {
              async first<T>() {
                if (!sql.includes("FROM install_secrets")) return null;
                const value = secrets[name];
                return value ? ({ value } as T) : null;
              },
            };
          },
        };
      },
    } as unknown as D1Database,
  } as Env;
}

const linked = {
  ME3_CLOUD_OWNER_ID: "cloud-owner",
  ME3_CLOUD_CORE_TOKEN: "core-token",
  ME3_CORE_INSTALL_ID: "core_install",
};

afterEach(() => vi.unstubAllGlobals());

describe("managed subscription forwarding", () => {
  // Settings > Plan failure mode: the app asked a signed-in owner for an emailed ME3.app
  // code before every Google Play purchase it could not otherwise verify.
  it("forwards a Google Play purchase with the installation's ME3 Cloud credential", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, entitled: true, source: "google_play" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await forwardManagedSubscriptionRequest(
      createEnv(linked),
      readManagedSubscriptionPurchase("google_play", { purchaseToken: " play-token ", email: "x@example.com" }),
    );

    expect(result).toMatchObject({ entitled: true, source: "google_play" });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.me3.app/v1/managed-subscription/google-play/reconcile",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ purchaseToken: "play-token" }),
        headers: expect.objectContaining({
          "X-ME3-Core-Owner-ID": "cloud-owner",
          "X-ME3-Core-Update-Token": "core-token",
          "X-ME3-Core-Install-ID": "core_install",
        }),
      }),
    );
  });

  it("keeps ME3 Cloud's reason for a refused purchase", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      Response.json({ error: "This ME3 account already has an active subscription" }, { status: 409 })));

    await expect(forwardManagedSubscriptionRequest(
      createEnv(linked),
      { kind: "storekit", signedTransaction: "signed" },
    )).rejects.toMatchObject({ status: 409, message: "This ME3 account already has an active subscription" });
  });

  it("never reports a refused installation credential as the app's sign-in failing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      Response.json({ error: "Invalid installation credentials" }, { status: 401 })));

    await expect(forwardManagedSubscriptionRequest(createEnv(linked), { kind: "entitlement" }))
      .rejects.toMatchObject({ status: 502 });
  });

  it("refuses when the installation is not linked to ME3 Cloud", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(forwardManagedSubscriptionRequest(createEnv({}), { kind: "entitlement" }))
      .rejects.toBeInstanceOf(ManagedSubscriptionError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing or oversized purchase before calling ME3 Cloud", () => {
    expect(() => readManagedSubscriptionPurchase("google_play", {})).toThrow(ManagedSubscriptionError);
    expect(() => readManagedSubscriptionPurchase("google_play", { purchaseToken: "x".repeat(501) }))
      .toThrow(ManagedSubscriptionError);
    expect(() => readManagedSubscriptionPurchase("storekit", { signedTransaction: 4 })).toThrow(ManagedSubscriptionError);
  });
});
