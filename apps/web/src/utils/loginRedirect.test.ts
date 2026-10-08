import { describe, expect, it } from "vitest";
import {
  resolveAuthenticatedLoginRedirect,
  resolveMe3OAuthRedirect,
  resolveProfileSetupPath,
} from "./loginRedirect";

const options = {
  origin: "https://core.example",
  hostname: "core.example",
  dev: false,
};

describe("login redirects", () => {
  it("only routes to setup after a successful empty site lookup", () => {
    expect(
      resolveProfileSetupPath({
        sitesLoaded: false,
        hasProfileSite: false,
        defaultPath: "/mission-control",
      }),
    ).toBe("/mission-control");
    expect(
      resolveProfileSetupPath({
        sitesLoaded: true,
        hasProfileSite: true,
        defaultPath: "/mission-control",
      }),
    ).toBe("/mission-control");
    expect(
      resolveProfileSetupPath({
        sitesLoaded: true,
        hasProfileSite: false,
        defaultPath: "/mission-control",
      }),
    ).toBe("/create");
  });

  it("resumes imported managed onboarding even when the profile site exists", () => {
    expect(
      resolveProfileSetupPath({
        sitesLoaded: true,
        hasProfileSite: true,
        onboardingStartStep: 2,
        defaultPath: "/mission-control",
      }),
    ).toBe("/create");
  });

  it("sends first ME3.app claims to profile setup", () => {
    expect(
      resolveMe3OAuthRedirect(undefined, {
        ...options,
        setupIncomplete: true,
      }),
    ).toBe("/create");
    expect(
      resolveMe3OAuthRedirect("/mission-control", {
        ...options,
        setupIncomplete: true,
      }),
    ).toBe("/create");
  });

  it("returns to login for ME3.app OAuth so setup state can decide", () => {
    expect(resolveMe3OAuthRedirect(undefined, options)).toBe("/login");
  });

  it("keeps safe same-origin redirects", () => {
    expect(resolveMe3OAuthRedirect("/account?section=connections", options)).toBe(
      "/account?section=connections",
    );
  });

  it("preserves a nested site editor route after authentication", () => {
    const redirect =
      "/create?siteId=32a88b9f-b974-4df0-bf7a-f34de676329d&site=sarahshook&return=/sites/sarahshook";

    expect(resolveAuthenticatedLoginRedirect(redirect, options)).toBe(redirect);
  });

  it("converts a safe same-origin URL into an internal router location", () => {
    expect(
      resolveAuthenticatedLoginRedirect(
        "https://core.example/create?site=sarahshook#pages",
        options,
      ),
    ).toBe("/create?site=sarahshook#pages");
  });

  it("rejects an external authenticated redirect", () => {
    expect(
      resolveAuthenticatedLoginRedirect(
        "https://attacker.example/create?site=sarahshook",
        options,
      ),
    ).toBeNull();
  });
});
