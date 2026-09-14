import { test } from "./fixtures/test";
import { WizardPage } from "./helpers/wizard";

test.describe("Wizard Banner Step", () => {
  let wizard: WizardPage;

  test.beforeEach(async ({ page }) => {
    wizard = new WizardPage(page);

    await page.route("**/api/usernames/*/available", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ available: true }),
      });
    });

    await wizard.goto();

    // Navigate to banner step
    await wizard.fillBasics("Banner Test", "bannertest", "Testing banner");
    await wizard.waitForUsernameCheck();
    await wizard.nextStep(); // Avatar
    await wizard.nextStep(); // Banner
  });

  test("should display banner step", async ({ page }) => {
    await wizard.expectStepName("Banner");
  });

  test("should allow skipping banner step", async ({ page }) => {
    await wizard.nextStep();

    await wizard.expectStepName("Who you help");
  });
});
