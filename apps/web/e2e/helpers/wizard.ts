import { Page, expect } from "@playwright/test";

const wizardStepNames: Record<string, string> = {
  basics: "Basics",
  avatar: "Avatar",
  banner: "Banner",
  mission: "Who you help",
  goals: "Site goals",
  "additional-features": "Additional Features",
  links: "Links",
  "call-to-action": "Call-to-action",
  pages: "Pages",
  newsletter: "Newsletter",
  bookings: "Bookings",
  blog: "Blog",
  offerings: "Products",
  products: "Products",
  testimonials: "Testimonials",
  publish: "Publish",
};

export class WizardPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto("/create?step=basics");
    await this.page.locator("#name").waitFor({ state: "visible" });
  }

  async gotoStep(stepId: string) {
    await this.page.goto(`/create?step=${encodeURIComponent(stepId)}`);
    const stepName = wizardStepNames[stepId];
    if (stepName) {
      await expect(this.page.locator(".step-name")).toContainText(stepName);
      return;
    }
    await this.page.locator(".step-name").waitFor({ state: "visible" });
  }

  async fillBasics(name: string, handle: string, bio?: string) {
    await this.page.fill("#name", name);
    await this.page.fill("#handle", handle);
    if (bio) await this.page.fill("#bio", bio);
  }

  async nextStep() {
    await this.page.click(".nav-btn.next");
  }

  async prevStep() {
    await this.page.click(".nav-btn.back");
  }

  async getCurrentStep(): Promise<string | null> {
    return this.page.locator(".step-current").textContent();
  }

  async expectStepName(name: string) {
    await expect(this.page.locator(".step-name")).toContainText(name);
  }

  async clickStepShortcut(name: string) {
    await this.page.locator(`.progress-step[data-step-name="${name}"]`).click();
  }

  async expectStepShortcutEnabled(name: string, enabled: boolean) {
    const shortcut = this.page.locator(
      `.progress-step[data-step-name="${name}"]`,
    );
    if (enabled) {
      await expect(shortcut).toBeEnabled();
    } else {
      await expect(shortcut).toBeDisabled();
    }
  }

  async expectCanProceed(canProceed: boolean) {
    const nextButton = this.page.locator(".nav-btn.next");
    if (canProceed) {
      await expect(nextButton).toBeEnabled();
    } else {
      await expect(nextButton).toBeDisabled();
    }
  }

  async waitForUsernameCheck() {
    // Wait for username checking to complete
    await this.page
      .waitForFunction(
        () => {
          const store = (window as any).__PINIA_STATE__;
          return (
            store && store.wizard && store.wizard.isCheckingUsername === false
          );
        },
        { timeout: 5000 },
      )
      .catch(() => {
        // If store not available, just wait a bit
      });
    await this.page.waitForTimeout(600); // Wait for debounce + API call
  }

  async addLink(platform: string, value: string) {
    // Find the input for the platform and fill it
    const platformInput = this.page
      .locator(`input[placeholder*="${platform}"], input[id*="${platform}"]`)
      .first();
    if ((await platformInput.count()) > 0) {
      await platformInput.fill(value);
    } else {
      // Try to find by label or other means
      await this.page.fill(`input[type="text"]`, value);
    }
  }

  async addButton(text: string, url: string) {
    // Click add button button if it exists
    const addButton = this.page
      .locator('button:has-text("Add Button"), button:has-text("Add")')
      .first();
    if ((await addButton.count()) > 0) {
      await addButton.click();
    }
    // Fill in button fields
    const textInput = this.page
      .locator('input[placeholder*="text" i], input[type="text"]')
      .first();
    const urlInput = this.page
      .locator('input[placeholder*="url" i], input[type="url"]')
      .first();
    await textInput.fill(text);
    await urlInput.fill(url);
  }

  async uploadImage(inputSelector: string, filePath: string) {
    const fileInput = this.page.locator(inputSelector);
    await fileInput.setInputFiles(filePath);
  }

  async selectVibe(vibeName: string) {
    await this.page.click(
      `button:has-text("${vibeName}"), [data-vibe="${vibeName}"]`,
    );
  }

  async reset() {
    await this.page.click(".reset-btn");
    await this.page.getByRole("button", { name: /confirm|ok|yes/i }).click();
  }

  async exit() {
    await this.page.click(".exit-btn");
    await this.page.getByRole("button", { name: /confirm|ok|yes/i }).click();
  }
}
