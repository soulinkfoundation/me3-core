import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

test("save, reload and publish fixed USD/PKR product pricing", async ({ page }, testInfo) => {
  const handle = `pricing${Date.now().toString(36)}`;
  const bootstrap = await page.request.post("http://127.0.0.1:8787/api/admin/bootstrap", {
    data: { bootstrapCode: "me3-e2e-local-only", email: "pricing@e2e.example.test", name: "Pricing Owner", username: "owner", password: "local-e2e-password" },
  });
  expect(bootstrap.ok(), await bootstrap.text()).toBeTruthy();
  await page.goto("/create?step=basics");
  const start = page.getByRole("button", { name: "Get started" });
  if (await start.isVisible()) await start.click();
  await page.locator("#name").fill("Regional Pricing Example");
  await page.locator("#handle").fill(handle);
  await page.getByRole("checkbox", { name: "Make my profile public" }).check();
  await expect(page.locator(".nav-btn.next")).toBeEnabled();
  await page.goto("/create?step=additional-features");
  await page.getByRole("checkbox", { name: "Enable products" }).press("Space");
  await expect(page.getByRole("checkbox", { name: "Enable products" })).toBeChecked();
  await page.goto("/create?step=products");
  await page.getByRole("button", { name: "+ Add product" }).click();
  await page.getByLabel("Product title").fill("Session guide");
  await page.getByLabel("Price", { exact: true }).fill("50");
  await page.getByLabel("Set a separate price for Pakistan").check();
  await expect(page.getByLabel("Currency", { exact: true })).toBeDisabled();
  await expect(page.getByText("Enter the fixed Pakistan price before publishing.")).toBeVisible();
  await page.getByLabel("Pakistan price (PKR)", { exact: true }).fill("8000");
  await expect(page.getByText("Enter the fixed Pakistan price before publishing.")).toHaveCount(0);
  await page.getByRole("radio", { name: /Pay separately/ }).check();
  await page.getByLabel("Payment details for this offer").fill("Contact the seller to arrange payment in the amount shown.");
  await page.getByLabel("What happens after purchase?").fill("The guide will be emailed after payment is confirmed.");
  await page.getByLabel("Outside Pakistan price (USD)").click(); // Commit title edits on blur.
  const draft = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith("me3_wizard_state")).map(key => JSON.parse(localStorage.getItem(key) || "{}")).find(value => value.products?.length));
  expect(draft.products[0]).toMatchObject({ price: 5000, currency: "USD", regionalPrices: [{ country: "PK", currency: "PKR", amount: 800000 }] });

  for (const [name, width, height, mode] of [
    ["desktop-light", 1280, 900, "light"], ["desktop-dark", 1280, 900, "dark"],
    ["phone-light", 390, 844, "light"], ["phone-dark", 390, 844, "dark"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: mode });
    await page.evaluate(colorMode => { document.documentElement.dataset.theme = colorMode; document.documentElement.setAttribute("data-color-mode", colorMode); }, mode);
    await page.getByLabel("Pakistan price (PKR)", { exact: true }).scrollIntoViewIfNeeded();
    await testInfo.attach(name, { body: await page.screenshot(), contentType: "image/png" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.reload();
  await page.getByRole("button", { name: "Edit product" }).click();
  await expect(page.getByLabel("Pakistan price (PKR)", { exact: true })).toHaveValue("8000");
  await expect(page.getByLabel("Outside Pakistan price (USD)")).toHaveValue("50");
  await page.goto("/create?step=publish");
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(page).toHaveURL(new RegExp(`/sites/${handle}(?:$|[/?])`));

  const fresh = await page.context().browser()!.newContext();
  try {
    const publicPage = await fresh.newPage();
    await publicPage.goto(`http://127.0.0.1:8787/site/${handle}/products/session-guide`);
    await expect(publicPage.locator(".product-price")).toHaveText("50.00 USD");
    const saved = await page.request.get(`http://127.0.0.1:8787/api/sites/${handle}/content`);
    expect(saved.ok(), await saved.text()).toBeTruthy();
    const content = await saved.json();
    expect(content.products[0]).toMatchObject({ price: 5000, currency: "USD", regionalPrices: [{ country: "PK", currency: "PKR", amount: 800000 }] });
    await testInfo.attach("persisted-regional-pricing", { body: JSON.stringify({ revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), command: "pnpm --filter @me3/web exec playwright test --config playwright.real.config.ts regional-pricing.spec.ts", handle, publicUrl: publicPage.url(), persistedProduct: content.products[0], geolocation: "Local worker uses default country; PK country selection is covered by worker integration tests.", payments: "Manual; no external payment provider contacted." }, null, 2), contentType: "application/json" });
  } finally { await fresh.close(); }
});
