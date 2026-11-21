import { describe, expect, it } from "vitest";
import { FREE_IMPORT_AUDIENCE, FREE_IMPORT_TOKEN_TYPE, freeImportClaimsAccepted } from "./free-import";

// Failure modes: a token for another ME3, another account or another purpose is accepted; an old token is replayed.
describe("free import token", () => {
  const now = 1_800_000_000;
  const good = { aud: FREE_IMPORT_AUDIENCE, typ: FREE_IMPORT_TOKEN_TYPE, sub: "inst_1", installation_id: "inst_1", owner_id: "user_1", iat: now - 5, exp: now + 120 };

  it("accepts a fresh token for this ME3 and its owner", () => {
    expect(freeImportClaimsAccepted(good, "inst_1", "user_1", now)).toBe(true);
  });

  it.each([
    ["another ME3", { sub: "inst_2", installation_id: "inst_2" }],
    ["another account", { owner_id: "user_2" }],
    ["another purpose", { aud: "me3-managed-runtime-control" }],
    ["another token type", { typ: "managed_runtime_control" }],
    ["an expired token", { iat: now - 400, exp: now - 100 }],
    ["a long-lived token", { exp: now + 3600 }],
    ["a token from the future", { iat: now + 600, exp: now + 700 }],
  ])("refuses %s", (_name, change) => {
    expect(freeImportClaimsAccepted({ ...good, ...change }, "inst_1", "user_1", now)).toBe(false);
  });

  it("refuses when this ME3 has no installation id or owner", () => {
    expect(freeImportClaimsAccepted(good, null, "user_1", now)).toBe(false);
    expect(freeImportClaimsAccepted(good, "inst_1", null, now)).toBe(false);
  });
});
