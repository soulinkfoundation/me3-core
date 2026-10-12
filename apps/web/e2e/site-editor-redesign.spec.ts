import { test, expect } from './fixtures/test';

// UI workflows use synthetic Core replies; publishing persistence is checked
// separately with the real Worker and disposable D1 in site-publish.spec.ts.
for (const mobile of [false, true]) for (const dark of [false, true]) {
  test(`Site editor on ${mobile ? 'phone' : 'desktop'} ${dark ? 'dark' : 'light'}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, route => route.abort());
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    let rejectUpload = true, uploaded = '', claimed = false;
    const site = { id: 'site', username: 'demo-site', site_role: 'profile' };
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
      if (path === '/sites' && route.request().method() === 'POST') {
        claimed = true;
        return route.fulfill({ json: { site } });
      }
      const data: Record<string, unknown> = {
        '/auth/me': { ok: true, user: { id: 'editor-owner', name: 'Demo Owner', username: 'demo' }, workspace: { hasProfileSite: true } },
        '/sites': { sites: claimed ? [site] : [] },
        '/plugins': { plugins: [] }, '/navigation-features': { features: [] }, '/config': {},
        '/sites/quota': { can_create: true, capabilities: { maxSites: 3 }, current: 0, limit: 3, tier: 'core' },
        '/sites/demo-site/publish-manifest': { manifest: { version: 1, sourceFiles: {}, assetFiles: {} } },
        '/sites/demo-site/booking-meetings': { offers: [] }, '/soulink/status': { connection: null },
      };
      if (path.endsWith('/available')) return route.fulfill({ json: { available: true } });
      if (path.endsWith('/upload')) {
        uploaded = route.request().postData() || '';
        return route.fulfill({ status: rejectUpload ? 503 : 200, json: rejectUpload ? { error: 'Temporary storage error' } : { ok: true, publishedAt: new Date().toISOString() } });
      }
      await route.fulfill({ status: 200, json: data[path] ?? {} });
    });
    async function screenshot(name: string) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: testInfo.outputPath(`${name}.png`), fullPage: !mobile, animations: 'disabled' });
      if (mobile) await page.screenshot({ path: testInfo.outputPath(`${name}-full.png`), fullPage: true, animations: 'disabled' });
    }
    await page.goto('/create?step=basics', { waitUntil: 'domcontentloaded' });
    await page.locator('#name').fill('Demo Owner'); await page.locator('#handle').fill('demo-site');
    await page.getByRole('checkbox', { name: 'Make my profile public' }).check();
    await expect(page.locator('.nav-btn.next')).toBeEnabled();
    await expect(page.locator('#name')).toHaveCSS('border-top-width', '0px');
    await expect(page.frameLocator('.preview-panel iframe').getByRole('heading', { name: 'Demo Owner' })).toBeVisible();
    await screenshot('editor-basics');
    await page.reload({ waitUntil: 'domcontentloaded' }); await expect(page.locator('#name')).toHaveValue('Demo Owner');
    await page.getByRole('button', { name: 'Preview your site' }).click();
    const preview = page.getByRole('dialog', { name: 'Preview of your site' });
    await expect(preview).toBeVisible(); await preview.getByRole('button', { name: 'Desktop preview' }).click();
    await expect(preview.locator('.desktop-viewport')).toBeVisible();
    await page.keyboard.press('Escape'); await expect(preview).not.toBeVisible();
    async function jump(name: string) {
      await page.getByRole('button', { name: /Show all steps/ }).click();
      await page.getByRole('dialog', { name: 'All editor steps' }).getByRole('button', { name: new RegExp(name) }).click();
      await expect(page.locator('.step-name')).toContainText(name);
    }
    await jump('Features');
    for (const label of ['Enable links', 'Enable call-to-action', 'Enable bookings', 'Enable newsletter']) await page.getByRole('switch', { name: label, exact: true }).check();
    await screenshot('editor-features');
    await jump('Links'); await page.getByRole('button', { name: 'Instagram', exact: true }).click();
    await page.getByRole('textbox', { name: 'Instagram link' }).fill('demo');
    await screenshot('editor-links');
    await jump('Buttons'); await page.getByRole('button', { name: 'Book a session', exact: true }).click();
    const action = page.getByRole('dialog', { name: 'Edit action button' });
    await action.getByRole('textbox', { name: 'Link URL', exact: true }).fill('#booking');
    await action.getByRole('button', { name: 'Add button', exact: true }).click();
    await expect(page.locator('.button-item')).toContainText('Book a session');
    await jump('Bookings');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: '1:1', exact: true }).click();
    await expect(page.getByText('Confirmation emails', { exact: true })).toBeVisible();
    await screenshot('editor-bookings');
    await jump('Look');
    await page.getByRole('radio', { name: 'Split', exact: true }).check();
    await page.getByRole('button', { name: 'Meadow theme', exact: true }).click();
    await page.getByRole('radio', { name: 'Dark', exact: true }).check();
    await page.getByRole('button', { name: 'Use accent #315d86', exact: true }).click();
    await screenshot('editor-look');
    // Publishing from a prior step uses the same pipeline and leaves the draft
    // editable on failure; it must not show the success finish prematurely.
    await jump('Basics'); await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Temporary storage error');
    await expect(page.getByRole('heading', { name: 'You’re live', exact: true })).toHaveCount(0);
    rejectUpload = false; await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'You’re live', exact: true })).toBeVisible();
    expect(uploaded).toContain('"layout": "split"'); expect(uploaded).toContain('"theme": "meadow"');
    await screenshot('editor-live');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}
