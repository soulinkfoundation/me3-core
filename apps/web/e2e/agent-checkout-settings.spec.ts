import { test, expect } from "./fixtures/test";

// Synthetic Core responses; no Stripe or agent commerce calls.
test.use({ trace: "on" });
for (const mobile of [false, true]) for (const dark of [false, true]) {
  test(`Agent checkout switch on ${mobile ? "phone" : "desktop"} ${dark ? "dark" : "light"}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const user = { id: "fixture-owner", name: "Demo Owner", username: "owner", email: "demo@example.test", timezone: "Europe/Dublin" };
    let agentCheckoutEnabled = true;
    const updates: unknown[] = [];
    await page.route("**/api/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace(/^\/api/, "");
      if (path === "/commerce/settings" && request.method() === "PUT") {
        updates.push(request.postDataJSON());
        agentCheckoutEnabled = request.postDataJSON().agentCheckoutEnabled;
      }
      const commerce = {
        encryptionConfigured: true,
        defaultCurrency: "EUR",
        stripe: {
          configured: true, source: "stored", keyHint: "sk_...1234", keyUpdatedAt: null, mode: "direct", preferredProvider: "direct",
          directConfigured: true, directKeySetupAllowed: true, directSource: "stored", managedAvailable: false,
          connectionStatus: null, connected: false, chargesEnabled: false, payoutsEnabled: false, requirementsDue: [],
        },
        agentCheckout: { enabled: agentCheckoutEnabled },
      };
      const responses: Record<string, unknown> = {
        "/auth/me": { ok: true, user, workspace: { hasProfileSite: true } }, "/account": { user },
        "/sites": { sites: [] }, "/config": { ownerMe3AuthConfigured: false },
        "/plugins": { plugins: [] }, "/navigation-features": { features: [] },
        "/ai-settings": { deploymentMode: "self_hosted", providers: [] },
        "/managed-ai-billing-settings": { available: false },
        "/mailbox": { available: false, mailbox: null, sources: [], recentActivity: [] },
        "/email-provider-settings": { settings: {}, providers: [] },
        "/account/app-connections": { me3: { connected: false }, localAccess: { passwordConfigured: true } },
        "/core/github/status": { core: { version: "0.1.227", updateManifestUrl: "" }, github: { connected: false }, me3AppConnected: false },
        "/core/storage/status": { r2Available: false },
        "/commerce/status": { ok: true, ...commerce },
        "/commerce/settings": commerce,
      };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(responses[path] ?? {}) });
    });

    await page.goto("/settings?section=payments");
    const toggle = page.getByLabel("Let AI agents book and buy");
    await expect(toggle).toBeChecked();
    await expect(page.getByText("offerings stay listed")).toBeVisible();
    await toggle.uncheck();
    await expect(page.getByText("Agent checkout is off. Agents will send people to your site.")).toBeVisible();
    expect(updates).toEqual([{ agentCheckoutEnabled: false }]);
    await expect(toggle).not.toBeChecked();
    await page.reload();
    await expect(toggle).not.toBeChecked();
    await toggle.focus();
    await expect(toggle).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath("agent-checkout-settings.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}
