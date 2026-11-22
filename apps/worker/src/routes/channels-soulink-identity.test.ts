import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSoulinkOwnerAssertion, revokeSoulinkConnection } from "./channels";
import type { Env } from "../types";

function envWithSecrets(secrets: Record<string, string>): Env {
  return {
    ME3_CLOUD_API_ORIGIN: "https://api.me3.app",
    DB: {
      prepare: () => {
        let name = "";
        const statement = {
          bind: (value: string) => { name = value; return statement; },
          first: async () => (secrets[name] ? { value: secrets[name] } : null),
        };
        return statement;
      },
    },
  } as unknown as Env;
}

const linked = {
  ME3_CLOUD_OWNER_ID: "cloud-user",
  ME3_CORE_INSTALL_ID: "core_1",
  ME3_CLOUD_CORE_TOKEN: "core-token",
};

afterEach(() => vi.restoreAllMocks());

describe("Soulink owner identity", () => {
  it("asks ME3 Cloud to vouch for the owner at this install's origin", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ token: "assertion", expiresIn: 300 }));
    expect(await fetchSoulinkOwnerAssertion(envWithSecrets(linked), "https://clara.me3.app")).toBe("assertion");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.me3.app/v1/network/soulink-owner-assertion");
    expect(JSON.parse(String(init?.body))).toEqual({ coreOrigin: "https://clara.me3.app" });
    expect(init?.headers).toMatchObject({
      "X-ME3-Core-Owner-ID": "cloud-user",
      "X-ME3-Core-Install-ID": "core_1",
      "X-ME3-Core-Update-Token": "core-token",
    });
  });

  it("connects without an assertion when the install is not linked to ME3 Cloud", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    expect(await fetchSoulinkOwnerAssertion(envWithSecrets({}), "https://me.example")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("connects without an assertion when ME3 Cloud refuses", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ error: "no" }, { status: 403 }));
    expect(await fetchSoulinkOwnerAssertion(envWithSecrets(linked), "https://me.example")).toBeNull();
  });

  it("revokes the Soulink connection with its dispatch token", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true }));
    expect(await revokeSoulinkConnection("https://soulinkfoundation.org", "dispatch")).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://soulinkfoundation.org/api/me3/assistant-channel/disconnect");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer dispatch" });
  });
});
