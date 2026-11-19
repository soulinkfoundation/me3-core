import { test, expect } from "./fixtures/test";

test.describe("unified profile onboarding", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          user: {
            id: "owner-1",
            email: "owner@example.com",
            name: "ME3 Owner",
            username: "owner",
            timezone: null,
          },
        }),
      });
    });

    await page.route("**/api/plugins", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ plugins: [] }),
      });
    });
  });

  test("opens the single profile onboarding flow at /create", async ({ page }) => {
    await page.route("**/api/sites", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sites: [] }),
      });
    });

    await page.goto("/create?step=basics");

    await expect(page).toHaveURL(/\/create\?step=basics$/);
    await expect(
      page.getByRole("heading", { name: "Let's start with the basics" }),
    ).toBeVisible();
    await expect(page.locator(".step-count")).toContainText("1/8");
  });

  test("hydrates an existing profile directly in /create", async ({ page }) => {
    const publishedAt = "2026-08-06T10:00:00.000Z";
    await page.route("**/api/sites", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sites: [
            {
              id: "site-owner",
              username: "owner",
              user_id: "owner-1",
              site_type: "profile",
              site_role: "profile",
              published_at: publishedAt,
              created_at: publishedAt,
              updated_at: publishedAt,
            },
          ],
        }),
      });
    });
    await page.route("**/api/sites/owner/content", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          profile: { name: "Existing Owner", handle: "owner" },
          pages: [],
          posts: [],
          products: [],
        }),
      });
    });

    await page.goto("/create?step=basics");

    await expect(page).toHaveURL(/\/create\?step=basics$/);
    await expect(page.getByLabel("Your name *")).toHaveValue("Existing Owner");
  });

  test("opens the unified editor from an existing site's Edit Site action", async ({
    page,
  }) => {
    const publishedAt = "2026-08-06T10:00:00.000Z";
    await page.route("**/api/sites", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          sites: [
            {
              id: "site-owner",
              username: "owner",
              user_id: "owner-1",
              site_type: "profile",
              site_role: "profile",
              published_at: publishedAt,
              created_at: publishedAt,
              updated_at: publishedAt,
            },
          ],
        }),
      });
    });
    await page.route("**/api/sites/owner/content", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          profile: { name: "Existing Owner", handle: "owner" },
          pages: [],
          posts: [],
          products: [],
        }),
      });
    });

    await page.goto("/sites/owner");
    await page.getByRole("button", { name: /Edit Site/ }).click();

    await expect(page).toHaveURL(/\/create$/);
    await expect(page.getByLabel("Your name *")).toHaveValue("Existing Owner");
  });
});
