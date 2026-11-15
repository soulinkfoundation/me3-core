import { describe, expect, it } from "vitest";
import { townFromProfile, townToTry } from "./news-place";
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
