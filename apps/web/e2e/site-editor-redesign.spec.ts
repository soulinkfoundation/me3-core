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
    await expect(page.locator('.wizard-header').getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
    await expect(page.locator('.wizard-step-button small')).toHaveCount(0);
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
    for (const label of ['Enable links', 'Enable call-to-action', 'Enable bookings', 'Enable newsletter', 'Enable testimonials', 'Enable blog']) await page.getByRole('switch', { name: label, exact: true }).check();
    await screenshot('editor-features');
    await jump('Links'); await page.getByRole('button', { name: 'Instagram', exact: true }).click();
    await page.getByRole('textbox', { name: 'Instagram link' }).fill('demo');
    await screenshot('editor-links');
    await jump('Buttons'); await page.getByRole('button', { name: 'Book a session', exact: true }).click();
    const action = page.getByRole('dialog', { name: 'Edit action button' });
    await action.getByRole('textbox', { name: 'Link URL', exact: true }).fill('#booking');
    await action.getByRole('button', { name: 'Add button', exact: true }).click();
    await expect(page.locator('.button-item')).toContainText('Book a session');
    await expect(page.locator('.button-item .remove-btn, .button-item .drag-handle')).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit Book a session', exact: true }).click();
    await expect(action.getByRole('button', { name: 'Remove button', exact: true })).toBeVisible();
    await action.getByRole('button', { name: 'Close action button', exact: true }).click();
    await jump('Pages');
    for (const title of ['First Review', 'Second Review']) {
      await page.locator('.add-pages').first().getByRole('button', { name: 'Custom', exact: true }).click();
      await page.locator('#page-title-input').fill(title);
      await page.getByRole('button', { name: 'Back to pages' }).click();
    }
    const first = page.locator('.page-item').filter({ hasText: 'First Review' }).locator('.page-details');
    const second = page.locator('.page-item').filter({ hasText: 'Second Review' }).locator('.page-details');
    const a = await first.boundingBox(), b = await second.boundingBox(); expect(a && b).toBeTruthy();
    await page.mouse.move(b!.x + 10, b!.y + b!.height / 2); await page.mouse.down();
    await page.mouse.move(a!.x + 10, a!.y + 3, { steps: 12 }); await page.mouse.up();
    await expect(page.locator('.page-title')).toHaveText(['Home', 'Second Review', 'First Review']);
    await page.getByRole('button', { name: 'Edit home', exact: true }).click();
    await expect(page.locator('#home-main-action')).toHaveCount(0);
    await page.getByRole('button', { name: 'Back to pages' }).click();
    await screenshot('editor-pages');
    await jump('Blog');
    await page.getByRole('button', { name: 'Add a post', exact: true }).click();
    await page.locator('#blog-title-input').fill('Review article');
    await page.locator('[contenteditable="true"]').pressSequentially('![Review](/favicon.png)');
    await page.getByRole('button', { name: 'Back to posts' }).click();
    await expect(page.locator('.post-thumbnail')).toHaveAttribute('src', '/favicon.png');
    await expect(page.locator('.post-item .remove-btn')).toHaveCount(0);
    await screenshot('editor-blog');
    await jump('Bookings');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: '1:1', exact: true }).click();
    await expect(page.getByText('Confirmation emails', { exact: true })).toBeVisible();
    await screenshot('editor-bookings');
    await jump('Testimonials');
    await page.getByRole('button', { name: 'Add testimonial', exact: true }).click();
    const testimonialEditor = page.getByRole('dialog', { name: 'Edit testimonial', exact: true });
    await testimonialEditor.getByRole('textbox', { name: 'Name', exact: true }).fill('Sam');
    await testimonialEditor.getByRole('textbox', { name: 'Quote', exact: true }).fill('A thoughtful session.');
    await testimonialEditor.getByRole('button', { name: 'Add testimonial', exact: true }).click();
    await expect(page.locator('.testimonial-item')).not.toHaveAttribute('open');
    await expect(page.getByRole('button', { name: 'Remove Sam', exact: true })).toHaveCount(0);
    const row = page.locator('.swipe-row');
    const rect = await row.boundingBox(); expect(rect).toBeTruthy();
    await page.mouse.move(rect!.x + rect!.width - 80, rect!.y + 20); await page.mouse.down();
    await page.mouse.move(rect!.x + 20, rect!.y + 20); await page.mouse.up();
    await expect(page.getByRole('button', { name: 'Remove Sam', exact: true })).toBeVisible();
    await expect(page.locator('.testimonial-item')).not.toHaveAttribute('open');
    await screenshot('editor-testimonials');
    await page.getByRole('button', { name: 'Remove Sam', exact: true }).click();
    await expect(page.locator('.testimonial-item')).toHaveCount(0);
    await jump('Publish');
    await page.getByRole('radio', { name: 'Split', exact: true }).check();
    await page.getByRole('button', { name: 'Meadow theme', exact: true }).click();
    await page.getByRole('radio', { name: 'Dark', exact: true }).check();
    await page.getByRole('button', { name: 'Use accent #315d86', exact: true }).click();
    await screenshot('editor-look');
    // Publishing from a prior step uses the same pipeline and leaves the draft
    // editable on failure; it must not show the success finish prematurely.
    await jump('Basics'); await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.locator('[data-sonner-toast]')).toContainText('Temporary storage error');
    await expect(page.getByRole('heading', { name: 'You’re live', exact: true })).toHaveCount(0);
    rejectUpload = false; await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'You’re live', exact: true })).toBeVisible();
    expect(uploaded).toContain('"layout": "split"'); expect(uploaded).toContain('"theme": "meadow"');
    const finish = page.locator('.wizard-finish');
    await expect(finish).not.toContainText(/Soulink/i);
    const copyLink = finish.getByRole('button', { name: 'Copy site link', exact: true });
    await expect(copyLink).toBeVisible();
    await page.mouse.move(0, 0);
    await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Temporary storage error' })).toHaveCount(0, { timeout: 10_000 });
    await screenshot('editor-live');
    const siteLink = await finish.getByRole('link', { name: 'View site', exact: true }).getAttribute('href');
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await copyLink.click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(siteLink);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}
