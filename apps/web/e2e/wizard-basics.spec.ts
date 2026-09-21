import { test, expect } from "./fixtures/test";
import { WizardPage } from "./helpers/wizard";

test.describe("Wizard Basics Step", () => {
  let wizard: WizardPage;

  test.beforeEach(async ({ page }) => {
    wizard = new WizardPage(page);

    // Mock username availability API
    await page.route("**/api/usernames/*/available", async (route) => {
      const url = route.request().url();
      const handle = url.match(/usernames\/([^/]+)\/available/)?.[1];

      // Mock: 'taken' is unavailable, everything else is available
      const available = handle !== "taken";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ available }),
      });
    });

    await wizard.goto();
  });

  test("should display basics step on initial load", async ({ page }) => {
    await wizard.expectStepName("Basics");
    await expect(page.locator("#name")).toBeVisible();
    await expect(page.locator("#handle")).toBeVisible();
    await expect(page.locator("#bio")).toBeVisible();
  });

  test("should not allow proceeding with invalid name", async ({ page }) => {
    await page.fill("#name", "A"); // Too short (< 2 chars)
    await page.fill("#handle", "testuser");

    await wizard.waitForUsernameCheck();
    await wizard.expectCanProceed(false);
  });

  test("should not allow proceeding with invalid handle", async ({ page }) => {
    await page.fill("#name", "Test User");
    await page.fill("#handle", "ab"); // Too short (< 3 chars)

    await wizard.expectCanProceed(false);
  });

  test("should not allow proceeding when username is taken", async ({
    page,
  }) => {
    await page.fill("#name", "Test User");
    await page.fill("#handle", "taken");

    await wizard.waitForUsernameCheck();
    await expect(page.locator(".taken")).toBeVisible();
    await wizard.expectCanProceed(false);
  });

  test("should allow proceeding with valid data", async ({ page }) => {
    await page.fill("#name", "Test User");
    await page.fill("#handle", "testuser");

    await wizard.waitForUsernameCheck();
    await expect(page.locator(".available")).toBeVisible();
    await wizard.expectCanProceed(true);
  });

  test("should auto-clean handle input", async ({ page }) => {
    await page.fill("#handle", "TestUser123!@#");

    // Wait for the cleaned value
    await page.waitForTimeout(100);
    const handleValue = await page.locator("#handle").inputValue();

    // Should be lowercase and only contain alphanumeric, underscore, hyphen
    expect(handleValue).toBe("testuser123");
  });

  test("should show username availability status", async ({ page }) => {
    await page.fill("#handle", "testuser");

    // Should show checking status first
    await expect(page.locator(".checking")).toBeVisible({ timeout: 1000 });

    // Then show available status
    await wizard.waitForUsernameCheck();
    await expect(page.locator(".available")).toBeVisible();
    await expect(page.locator(".available")).toContainText(
      "testuser.example.com is available!",
    );
  });

  test("should show hint for short username", async ({ page }) => {
    await page.fill("#handle", "ab");

    await expect(page.locator(".hint")).toBeVisible();
    await expect(page.locator(".hint")).toContainText(
      "Username must be at least 3 characters",
    );
  });

  test("should enforce bio character limit", async ({ page }) => {
    const longBio = "a".repeat(321); // Exceeds 320 char limit
    await page.fill("#bio", longBio);

    const bioValue = await page.locator("#bio").innerText();
    expect(bioValue.length).toBeLessThanOrEqual(320);

    // Check character count display
    await expect(page.locator(".char-count")).toContainText("320/320");
  });

  test("should update bio character count", async ({ page }) => {
    await page.fill("#bio", "Hello world");

    await expect(page.locator(".char-count")).toContainText("11/320");
  });

  test("should allow optional fields to be empty", async ({ page }) => {
    await page.fill("#name", "Test User");
    await page.fill("#handle", "testuser");

    // Leave bio and location empty
    await wizard.waitForUsernameCheck();
    await wizard.expectCanProceed(true);
  });

  test("should navigate to next step when valid", async ({ page }) => {
    await page.fill("#name", "Test User");
    await page.fill("#handle", "testuser");

    await wizard.waitForUsernameCheck();
    await wizard.nextStep();

    // Should be on step 2 (Avatar)
    const currentStep = await wizard.getCurrentStep();
    expect(currentStep).toBe("2");
    await wizard.expectStepName("Avatar");
  });
});
