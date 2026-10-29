import { beforeEach, describe, expect, it } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { useWizardStore } from "./wizard";

describe("profile visibility in the site wizard", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("defaults a new profile to public and serializes the owner decision", () => {
    const wizard = useWizardStore();
    wizard.updateProfile({ name: "Connie", handle: "connie" });

    expect(wizard.profile.visibility).toBe("public");
    expect(wizard.generateMe3Json()).toMatchObject({
      name: "Connie",
      handle: "connie",
      visibility: "public",
    });

    wizard.updateProfile({ visibility: "private" });
    expect(wizard.generateMe3Json().visibility).toBe("private");
  });

  it("does not apply profile visibility to organization sites", () => {
    const wizard = useWizardStore();
    wizard.setSiteRole("organization");
    wizard.updateProfile({ name: "Connie Studio", visibility: "private" });

    expect(wizard.generateMe3Json()).not.toHaveProperty("visibility");
  });
});
