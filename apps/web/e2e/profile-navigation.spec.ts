import { test, expect } from './fixtures/test';

// UI checks with synthetic Core/plugin data. Verify the former drawer destinations,
// keyboard focus, route changes, feature gates, and failed/successful logout.
for (const mobile of [false, true]) for (const dark of [false, true]) {
  test(`Avatar navigation on ${mobile ? 'phone' : 'desktop'} ${dark ? 'dark' : 'light'}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const user = { id: 'nav-owner', name: 'Demo Owner', username: 'demo', email: 'demo@example.test', timezone: 'Europe/Dublin' };
    const thread = { id: 'main', title: 'Main conversation', status: 'active', isPrimary: true };
    let authenticated = true, rejectLogout = true, hideWorkspaces = false;
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
      const responses: Record<string, unknown> = {
        '/auth/me': { ok: true, user: authenticated ? user : null, workspace: { hasProfileSite: true } }, '/account': { user },
        '/sites': { sites: [{ id: 'profile', username: 'demo', site_role: 'profile', avatar: './files/avatar.svg' }] }, '/config': {},
        '/plugins': { plugins: ['calendar', 'journal', 'mission-control', 'accounts', 'social-publishing'].map(id => ({ id: `me3.${id}`, status: 'installed', enabled: true })) },
        '/navigation-features': { features: ['assistant', 'calendar', 'journal', 'wheel-of-life', 'tasks', 'email', 'files', 'social', 'accounts'].map(id => ({ id, visible: !hideWorkspaces })) },
        '/assistant/threads/primary': { thread }, '/assistant/threads': { threads: [thread] }, '/assistant/threads/main/messages': { thread, messages: [] },
        '/assistant/jobs': { jobs: [] }, '/assistant/jobs/recipes': { recipes: [] }, '/assistant/settings': { settings: { name: 'ME3' } },
        '/ai-settings': { deploymentMode: 'self_hosted', providers: [] }, '/managed-ai-billing-settings': { available: false },
        '/mission-control/projects': { projects: [] }, '/mission-control/tasks': { tasks: [] }, '/mission-control/approvals': { approvals: [] },
        '/mission-control/dashboard': {}, '/tasks/goals': { goals: [] }, '/journal/wheel': { settings: { segments: [] }, snapshots: [] },
        '/calendar/feed': { events: [], sources: [] }, '/mailbox': { available: false, mailbox: null, sources: [] }, '/mailbox/messages': { messages: [] },
        '/soulink/status': { recentEvents: [] }, '/journal/archive': { entries: [] }, '/journal/articles': { articles: [] },
        '/email-provider-settings': { activeProviderId: 'cloudflare-email', providers: [], futureProviders: [] },
        '/account/app-connections': { me3: { connected: false, disconnectAvailable: false }, localAccess: { passwordConfigured: true } },
        '/core/github/status': { core: { version: '0.0.0', updateManifestUrl: '' }, github: { connected: false }, me3AppConnected: false },
        '/core/storage/status': { r2Available: false },
        '/commerce/status': { encryptionConfigured: false, defaultCurrency: 'USD', stripe: { configured: false, source: 'not_configured', mode: 'direct', preferredProvider: 'auto', directConfigured: false, directKeySetupAllowed: true, managedAvailable: false, connected: false, requirementsDue: [] } },
        '/accounts/stats': { stats: {} }, '/accounts/entries': { entries: [], total: 0 },
      };
      if (path === '/auth/logout') {
        if (rejectLogout) return route.fulfill({ status: 503, json: { error: 'Temporarily unavailable' } });
        authenticated = false;
      }
      const data = path.startsWith('/journal/days/') ? { entry: null } : responses[path] ?? { ok: true };
      await route.fulfill({ status: 200, json: data });
    });
    await page.route('**/preview/demo/files/avatar.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="40" fill="#1B4D3E"/><text x="40" y="54" font-family="sans-serif" font-size="40" text-anchor="middle" fill="white">D</text></svg>' }));
    await page.goto('/assistant');
    const avatar = page.getByRole('button', { name: 'Open profile menu', exact: true });
    await expect(page.getByRole('button', { name: 'Open navigation', exact: true })).toHaveCount(0);
    await expect(avatar.locator('img')).toBeVisible();
    await avatar.focus(); await avatar.press('ArrowDown');
    const menu = page.getByRole('menu', { name: 'Your profile and navigation' });
    await expect(menu).toContainText('Demo Owner');
    await expect(menu.getByRole('menuitem', { name: 'Edit site', exact: true })).toHaveAttribute('href', /siteId=profile/);
    await expect(menu.getByRole('menuitem').first()).toHaveAttribute('href', 'http://localhost:8787/preview/demo/');
    const goTo = menu.getByRole('navigation', { name: 'Go to' });
    const destinations = [['Calendar', '/calendar'], ['Email', '/email'], ['Writing', '/journal'], ['Tasks', '/tasks'], ['Files', '/files'], ['Socials', '/social'], ['Accounts', '/accounts'], ['Wheel of Life', '/wheel-of-life'], ['Website', '/sites'], ['Chat', '/assistant?view=chat']];
    for (const [label, href] of destinations) await expect(goTo.getByRole('menuitem', { name: label, exact: true })).toHaveAttribute('href', href);
    await page.screenshot({ path: testInfo.outputPath('avatar-menu.png'), fullPage: true });
    await page.keyboard.press('End'); await expect(menu.getByRole('menuitem', { name: 'Log out', exact: true })).toBeFocused();
    await page.keyboard.press('Escape'); await expect(menu).not.toBeVisible(); await expect(avatar).toBeFocused();
    await avatar.click(); await menu.getByRole('menuitem', { name: 'Writing', exact: true }).click();
    await expect(page).toHaveURL(/\/journal$/); await expect(menu).not.toBeVisible();
    await expect(page.getByRole('link', { name: 'Home', exact: true })).toBeVisible();
    await expect(page.locator('.journal__editor-wrap')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('writing-navigation.png'), fullPage: true });
    await page.getByRole('link', { name: 'Home', exact: true }).click(); await expect(page).toHaveURL(/\/assistant(?:\?|$)/);
    await avatar.click(); await menu.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    await expect(page.locator('.accordion-card').first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('settings-navigation.png'), fullPage: true });
    await avatar.click(); await menu.getByRole('menuitem', { name: 'App connections', exact: true }).click();
    await expect(page).toHaveURL(/section=connections/);
    await expect(page.locator('[aria-controls="account-panel-app-connections"]')).toHaveAttribute('aria-expanded', 'true');
    hideWorkspaces = true; await page.evaluate(() => window.dispatchEvent(new Event('me3:plugins-changed')));
    await avatar.click(); await expect(goTo.getByRole('menuitem', { name: 'Calendar', exact: true })).toHaveCount(0);
    for (const label of ['Email', 'Writing', 'Tasks', 'Files', 'Wheel of Life', 'Chat']) await expect(goTo.getByRole('menuitem', { name: label, exact: true })).toHaveCount(0);
    for (const label of ['Website', 'Socials', 'Accounts']) await expect(goTo.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
    await menu.getByRole('menuitem', { name: 'Log out', exact: true }).click(); await expect(menu).toBeVisible(); await expect(page).toHaveURL(/\/settings(?:\?|$)/);
    rejectLogout = false; await menu.getByRole('menuitem', { name: 'Log out', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/); await expect(avatar).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}
