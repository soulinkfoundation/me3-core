import { describe, expect, it } from "vitest";
import { ownerProfileTown, townFromProfile, townToTry } from "./news-place";
import { fastModelAllowed } from "./owner-public-page";
import { runWithFastModel } from "./soup-servings";
import type { Env } from "./types";

const env = {} as Env;
const profile = (town: { name: string; country: string | null } | null) => async () => town;

describe("the owner's town for local news", () => {
  it("reads the town from a profile's location", () => {
    expect(townFromProfile({ location: "Limerick, Ireland" })).toEqual({ name: "Limerick", country: null });
    expect(townFromProfile({ locationData: { locality: "Galway", label: "Galway, Ireland", countryCode: "ie" } })).toEqual({ name: "Galway", country: "IE" });
    expect(townFromProfile({ location: "12 Main Street" })).toBeNull();
    expect(townFromProfile({})).toBeNull();
    expect(townFromProfile(null)).toBeNull();
  });

  it("keeps a town the owner chose", async () => {
    expect(await townToTry(env, "o", "Cork", "Europe/Dublin", profile({ name: "Limerick", country: "IE" }))).toBeNull();
  });

  it("uses the profile's town when none was chosen, and over a town guessed from the timezone", async () => {
    const limerick = { name: "Limerick", country: "IE" };
    expect(await townToTry(env, "o", null, "Europe/Dublin", profile(limerick))).toEqual(limerick);
    expect(await townToTry(env, "o", "Dublin", "Europe/Dublin", profile(limerick))).toEqual(limerick);
    expect(await townToTry(env, "o", "Dublin", "Europe/Dublin", profile({ name: "Dublin", country: "IE" }))).toBeNull();
  });

  it("falls back to the timezone's city only when nothing is stored and the profile has no town", async () => {
    expect(await townToTry(env, "o", null, "Europe/Dublin", profile(null))).toEqual({ name: "Dublin", country: null });
    expect(await townToTry(env, "o", "Dublin", "Europe/Dublin", profile(null))).toBeNull();
    expect(await townToTry(env, "o", null, "UTC", profile(null))).toBeNull();
  });
});

// Failure modes: a free ME3 (no profile site) never gets a town from its public page; a Core install with a
// profile site reads the free page hook instead of its own me.json; a broken hook breaks the paper.
describe("the free plan's public page", () => {
  const noSite = { prepare: () => ({ bind: () => ({ first: async () => null }) }) } as unknown as Env["DB"];

  it("gives the town when the owner has no profile site", async () => {
    const page = async () => ({ location: "Ennis, Ireland", locationData: { locality: "Ennis", label: "Ennis, Ireland", countryCode: "IE" } });
    expect(await ownerProfileTown({ DB: noSite, ME3_OWNER_PUBLIC_PAGE: page } as unknown as Env, "owner")).toEqual({ name: "Ennis", country: "IE" });
  });

  it("gives nothing when there is no page, the page is private, or Cloud fails", async () => {
    expect(await ownerProfileTown({ DB: noSite } as unknown as Env, "owner")).toBeNull();
    expect(await ownerProfileTown({ DB: noSite, ME3_OWNER_PUBLIC_PAGE: async () => null } as unknown as Env, "owner")).toBeNull();
    expect(await ownerProfileTown({ DB: noSite, ME3_OWNER_PUBLIC_PAGE: async () => { throw new Error("down"); } } as unknown as Env, "owner")).toBeNull();
  });
});

// Failure modes: a paper keeps spending once the free allowance is used or free is paused; a Core install
// (no hook) loses its model; a failing budget check lets the call through.
describe("the fast model on the free plan", () => {
  it("is allowed on a Core install, and follows the free runtime's answer otherwise", async () => {
    expect(await fastModelAllowed({} as Env)).toBe(true);
    expect(await fastModelAllowed({ ME3_FAST_MODEL_ALLOWED: async () => true } as unknown as Env)).toBe(true);
    expect(await fastModelAllowed({ ME3_FAST_MODEL_ALLOWED: async () => false } as unknown as Env)).toBe(false);
    expect(await fastModelAllowed({ ME3_FAST_MODEL_ALLOWED: async () => { throw new Error("ledger down"); } } as unknown as Env)).toBe(false);
  });

  it("is never called once the allowance is used, so the paper prints without picks", async () => {
    let ran = false;
    const result = await runWithFastModel({ ME3_FAST_MODEL_ALLOWED: async () => false } as unknown as Env, "owner", "News picks", async () => { ran = true; return "picks"; });
    expect(result).toBeNull();
    expect(ran).toBe(false);
  });
});
