import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// Real Core authentication and navigation preferences in disposable local D1.
test('Avatar destinations use saved Core/plugin gates after a fresh login', async ({ page, browser }, testInfo) => {
  const api = 'http://127.0.0.1:8787/api';
  const credentials = { email: 'navigation@e2e.example.test', password: 'local-e2e-password' };
  const bootstrap = await page.request.post(`${api}/admin/bootstrap`, { data: { ...credentials, bootstrapCode: 'me3-e2e-local-only', name: 'Navigation Demo', username: 'navigation' } });
  expect(bootstrap.ok(), await bootstrap.text()).toBeTruthy();
  const site = await page.request.post(`${api}/sites`, { data: { username: 'navigation', siteRole: 'profile' } });
  expect(site.ok(), await site.text()).toBeTruthy();
  for (const id of ['assistant', 'calendar', 'journal', 'wheel-of-life', 'tasks', 'email', 'files']) {
    const response = await page.request.put(`${api}/navigation-features/${id}`, { data: { visible: true } });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  for (const id of ['me3.accounts', 'me3.social-publishing']) {
    const response = await page.request.post(`${api}/plugins/${id}/activate`);
    expect(response.ok(), await response.text()).toBeTruthy();
  }
  await page.goto('/assistant');
  const avatar = page.getByRole('button', { name: 'Open profile menu', exact: true });
  await avatar.click();
  const menu = page.getByRole('menu', { name: 'Your profile and navigation' });
  for (const label of ['Calendar', 'Email', 'Writing', 'Tasks', 'Files', 'Socials', 'Accounts', 'Wheel of Life', 'Website', 'Chat']) await expect(menu.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Writing', exact: true }).click();
  await expect(page.locator('.journal__editor-wrap')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('inner-page-real.png'), fullPage: true });
  await page.request.put(`${api}/navigation-features/calendar`, { data: { visible: false } });
  await page.request.post(`${api}/plugins/me3.accounts/deactivate`);
  const fresh = await browser.newContext();
  try {
    expect((await fresh.request.post(`${api}/auth/login`, { data: credentials })).ok()).toBeTruthy();
    const next = await fresh.newPage(); await next.goto('http://127.0.0.1:8787/assistant');
    await next.getByRole('button', { name: 'Open profile menu', exact: true }).click();
    const freshMenu = next.getByRole('menu', { name: 'Your profile and navigation' });
    await expect(freshMenu.getByRole('menuitem', { name: 'Calendar', exact: true })).toHaveCount(0);
    await expect(freshMenu.getByRole('menuitem', { name: 'Accounts', exact: true })).toHaveCount(0);
    await expect(freshMenu.getByRole('menuitem', { name: 'Socials', exact: true })).toBeVisible();
    await freshMenu.getByRole('menuitem', { name: 'Log out', exact: true }).click();
    await expect(next).toHaveURL(/\/login$/);
    expect((await (await fresh.request.get(`${api}/auth/me`)).json()).user).toBeNull();
    writeFileSync(testInfo.outputPath('navigation-persisted-evidence.json'), JSON.stringify({
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), workingTreeChanges: true,
      command: 'pnpm --filter @me3/web exec playwright test --config playwright.real.config.ts e2e-real/profile-navigation.spec.ts',
      seed: 'Isolated local Wrangler D1; all migrations; synthetic owner and navigation flags; no developer .dev.vars',
      persistedOutcome: 'Fresh login hides saved Calendar flag and disabled Accounts plugin, keeps Socials; logout revokes real cookie',
    }, null, 2));
  } finally { await fresh.close(); }
});
