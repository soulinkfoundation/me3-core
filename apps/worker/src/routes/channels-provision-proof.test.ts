import { describe, expect, it } from "vitest";
import { createSoulinkProvisionProof, verifySoulinkProvisionProof } from "./channels";
import type { Env } from "../types";

describe("Soulink assistant provisioning proof", () => {
  it("binds the owner, callback, and dispatch token for five minutes", async () => {
    const env = { JWT_SECRET: "test-secret-at-least-long-enough" } as Env;
    const input = { issuer: "https://core.example", subject: "owner", callbackUrl: "https://core.example/api/agent/channels/soulink/dispatch", dispatchToken: "token-1" };
    const proof = await createSoulinkProvisionProof(env, input);
    expect(await verifySoulinkProvisionProof(env, { ...input, proof })).toBe(true);
    expect(await verifySoulinkProvisionProof(env, { ...input, subject: "someone-else", proof })).toBe(false);
    expect(await verifySoulinkProvisionProof(env, { ...input, dispatchToken: "token-2", proof })).toBe(false);
    expect(await verifySoulinkProvisionProof(env, { ...input, proof: `1.${proof.split(".")[1]}` })).toBe(false);
  });
});
