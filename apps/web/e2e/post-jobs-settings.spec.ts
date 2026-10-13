import { test, expect } from "./fixtures/test";

// UI tests with synthetic Core responses; no live calendar, mailbox, or push providers.
test.use({ trace: "on" });
for (const mobile of [false, true]) for (const dark of [false, true]) {
  test(`Calendar time and invoice toggle on ${mobile ? "phone" : "desktop"} ${dark ? "dark" : "light"}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const user = { id: "fixture-owner", name: "Demo Owner", username: "owner", email: "demo@example.test", timezone: "Europe/Dublin", dailyBriefingTime: "07:30" };
    let triageEnabled = true;
    let accountUpdate: unknown;
    await page.route("**/api/**", async route => {
      const request = route.request(); const url = new URL(request.url());
      const path = url.pathname.replace(/^\/api/, "");
      if (path === "/account" && request.method() === "PUT") {
        accountUpdate = request.postDataJSON(); user.dailyBriefingTime = request.postDataJSON().dailyBriefingTime;
      }
      if (path === "/accounts/email-triage" && request.method() === "PUT") triageEnabled = request.postDataJSON().enabled;
      const entry = { id: "receipt", date: "2026-10-13", description: "Forwarded receipt", amountCents: 2450, currency: "EUR", status: "needs_review", source: "email_triage", categoryName: "Software", projectName: null };
      const responses: Record<string, unknown> = {
        "/auth/me": { ok: true, user, workspace: { hasProfileSite: true } }, "/account": { user },
        "/sites": { sites: [] }, "/config": { ownerMe3AuthConfigured: false },
        "/plugins": { plugins: ["calendar", "accounts"].map(id => ({ id: `me3.${id}`, name: id === "calendar" ? "Calendar" : "Accounts", description: "Your personal workspace", status: "installed", enabled: true })) },
        "/navigation-features": { features: ["calendar", "accounts"].map(id => ({ id, name: id === "calendar" ? "Calendar" : "Accounts", description: "Your personal workspace", visible: true })) },
        "/ai-settings": { deploymentMode: "self_hosted", providers: [] },
        "/managed-ai-billing-settings": { available: false },
        "/mailbox": { available: false, mailbox: null, sources: [], recentActivity: [] },
        "/email-provider-settings": { settings: {}, providers: [] },
        "/account/app-connections": { me3: { connected: false }, localAccess: { passwordConfigured: true } },
        "/core/github/status": { core: { version: "0.1.216", updateManifestUrl: "" }, github: { connected: false }, me3AppConnected: false },
        "/core/storage/status": { r2Available: false },
        "/commerce/status": { encryptionConfigured: false, defaultCurrency: "EUR", stripe: { configured: false, source: "not_configured", mode: "direct", preferredProvider: "auto", directConfigured: false, directKeySetupAllowed: true, managedAvailable: false, connected: false, requirementsDue: [] } },
        "/accounts/email-triage": { enabled: triageEnabled }, "/accounts/stripe/status": { connected: false },
        "/accounts/entries": { entries: url.searchParams.get("entryType") === "expense" ? [entry] : [], total: url.searchParams.get("entryType") === "expense" ? 1 : 0 },
        "/accounts/categories": { categories: [] }, "/accounts/stats": { stats: { defaultCurrency: "EUR", thisMonthCents: 0, lastMonthCents: 0 } },
        "/mission-control/projects": { projects: [] },
      };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(responses[path] ?? {}) });
    });
    await page.goto("/settings?section=timezone");
    const time = page.getByLabel("Morning calendar time");
    await expect(time).toHaveValue("07:30"); await time.fill("08:45");
    await time.press("Tab");
    await page.locator("#account-panel-timezone").getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Regional settings updated.")).toBeVisible();
    expect(accountUpdate).toEqual({ dailyBriefingTime: "08:45" });
    await page.reload(); await expect(time).toHaveValue("08:45");
    await time.focus(); await expect(time).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("morning-calendar-settings.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();

    await page.goto("/accounts?view=expense");
    await expect(page.getByText("Forwarded receipt")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Needs review", exact: true })).toBeVisible();
    await page.locator(".accounts-actions-menu summary").click();
    const toggle = page.getByLabel("Triage invoices and receipts");
    await expect(toggle).toBeChecked(); await toggle.uncheck();
    await expect(toggle).toBeEnabled();
    await page.reload(); await page.locator(".accounts-actions-menu summary").click();
    await expect(toggle).not.toBeChecked(); await toggle.focus(); await expect(toggle).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("invoice-triage-settings.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}
