import { describe, expect, it } from "vitest";
import { rewriteMobileInstall } from "../src/policy";

// Failure mode (seen on production, 2026-11-21): Core reports its own origin as the install's API base, which
// drops the /u/{userId} prefix, so every app request after sign-in hits the shared Worker's 404. It also
// advertises paid capabilities, so the apps show Email and Sites to free users.
const place = { base: "https://free.example.test/u/u_1", publicURL: "https://me3.app/ada" };

describe("install details the apps receive from the free runtime", () => {
  it("points a token response at the user's own base URL with free capabilities", () => {
    const body = { accessToken: "a", scope: ["mobile.v1", "mailbox"], install: { id: "core_x", label: "Ada's ME3", apiBaseURL: "https://free.example.test/api", publicURL: "https://free.example.test", capabilities: ["mobile.v1", "assistant", "mailbox", "sites"] } };
    expect(rewriteMobileInstall(body, place)).toEqual({
      accessToken: "a",
      scope: ["mobile.v1", "assistant", "mission-control", "calendar", "journal", "account"],
      install: { id: "core_x", label: "Ada's ME3", apiBaseURL: "https://free.example.test/u/u_1/api", publicURL: "https://me3.app/ada", capabilities: ["mobile.v1", "assistant", "mission-control", "calendar", "journal", "account"] },
    });
  });

  it("corrects the mobile config", () => {
    const body = { installId: "core_x", publicURL: "https://free.example.test", capabilities: { assistant: true, missionControl: true, calendar: true, journal: true, mailbox: true, sites: true, account: true } };
    expect(rewriteMobileInstall(body, place)).toEqual({ installId: "core_x", publicURL: "https://me3.app/ada", capabilities: { assistant: true, missionControl: true, calendar: true, journal: true, mailbox: false, sites: false, account: true } });
  });

  it("leaves other responses alone", () => {
    expect(rewriteMobileInstall({ ok: true }, place)).toEqual({ ok: true });
    expect(rewriteMobileInstall({ error: "nope" }, place)).toEqual({ error: "nope" });
    expect(rewriteMobileInstall(null, place)).toBeNull();
  });
});
