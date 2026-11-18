import { afterEach, describe, expect, it, vi } from "vitest";
import { cachedManagedEmailAddresses, chooseManagedSendAddress, listManagedEmailAddresses, type ManagedEmailAddress } from "./managed-email-outbound";
import type { Env } from "./types";

// Failure modes (me3-2wb3, email on the owner's domain):
// 1. Mail goes out from an own-domain address before ME3 Cloud can send for it (it would bounce or spoof).
// 2. The owner picks an address at another domain and ME3 sends from it anyway.
// 3. Once the domain can send, the owner's mail keeps going out from handle@me3.app by default.
// 4. A slow or broken ME3 Cloud breaks the mailbox instead of falling back to handle@me3.app.

const me3: ManagedEmailAddress = { address: "river@me3.app", kind: "me3", receiving: true, sending: true, default: false };
const ready: ManagedEmailAddress = { address: "hello@riverbakery.com", kind: "custom_domain", receiving: true, sending: true, default: true };

describe("choosing the sender on ME3 hosting", () => {
  it("uses the owner's domain by default once it can send, and any address there they ask for", () => {
    expect(chooseManagedSendAddress([me3, ready], null)).toBe("hello@riverbakery.com");
    expect(chooseManagedSendAddress([me3, ready], "Orders@RiverBakery.com")).toBe("orders@riverbakery.com");
  });

  it("falls back to handle@me3.app until the domain can send, and never sends from someone else's domain", () => {
    const pending = { ...ready, sending: false, default: false };
    expect(chooseManagedSendAddress([{ ...me3, default: true }, pending], "hello@riverbakery.com")).toBeNull();
    expect(chooseManagedSendAddress([me3, ready], "hello@lakebakery.com")).toBe("hello@riverbakery.com");
    expect(chooseManagedSendAddress([{ ...me3, default: true }], "hello@lakebakery.com")).toBeNull();
  });
});

describe("listing the owner's addresses", () => {
  afterEach(() => vi.restoreAllMocks());
  const values: Record<string, string> = {
    ME3_CORE_INSTALL_ID: "core_11111111-1111-4111-8111-111111111111",
    ME3_CLOUD_CORE_TOKEN: "core-update-token",
    ME3_CLOUD_OWNER_ID: "cloud-owner",
  };
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind(...args: string[]) {
            return {
              async first() {
                return values[args[0]!] ? { value: values[args[0]!] } : null;
              },
              async run() {
                if (sql.includes("INSERT INTO install_secrets")) values[args[0]!] = args[1]!;
              },
            };
          },
        };
      },
    },
    ME3_DEPLOYMENT_MODE: "managed",
    ME3_MANAGED_INSTALLATION_ID: "mi-1234567890abcdef",
    ME3_MANAGED_EMAIL_GATEWAY_ORIGIN: "https://api.me3.app",
  } as unknown as Env;

  it("reads them from ME3 Cloud with the install's credentials", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
      addresses: [
        { address: "river@me3.app", kind: "me3", receiving: true, sending: true, default: false },
        { address: "Hello@RiverBakery.com", kind: "custom_domain", receiving: true, sending: true, default: true, status: "active" },
        { address: "not an address", kind: "custom_domain" },
      ],
    }));
    expect(await listManagedEmailAddresses(env)).toEqual([me3, { ...ready, status: "active" }]);
    // Sending reads the saved copy, so it never waits on ME3 Cloud.
    expect(await cachedManagedEmailAddresses(env)).toEqual([me3, { ...ready, status: "active" }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.me3.app/v1/installs/core_11111111-1111-4111-8111-111111111111/email/addresses");
    expect((init?.headers as Record<string, string>)["X-ME3-Core-Update-Token"]).toBe("core-update-token");
  });

  it("returns nothing, rather than failing, when ME3 Cloud is down or this isn't ME3 hosting", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    expect(await listManagedEmailAddresses(env)).toEqual([]);
    expect(await listManagedEmailAddresses({ ...env, ME3_DEPLOYMENT_MODE: "self_hosted" } as Env)).toEqual([]);
  });
});
