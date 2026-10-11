import { test, expect } from './fixtures/test';

// UI checks against synthetic Core/plugin API responses; no external providers or owner data.
for (const mobile of [false, true]) for (const dark of [false, true]) {
  test(`Shared theme on ${mobile ? 'phone' : 'desktop'} ${dark ? 'dark' : 'light'}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const user = { id: 'theme-owner', name: 'Demo Owner', username: 'owner', email: 'demo@example.test', timezone: 'Europe/Dublin' };
    const thread = { id: 'main', title: 'Main conversation', status: 'active', isPrimary: true };
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
      const responses: Record<string, unknown> = {
        '/auth/me': { ok: true, user, workspace: { hasProfileSite: true } }, '/account': { user },
        '/sites': { sites: [] }, '/config': { ownerMe3AuthConfigured: false },
        '/plugins': { plugins: ['calendar', 'journal', 'mission-control'].map(id => ({ id: `me3.${id}`, status: 'installed', enabled: true })) },
        '/navigation-features': { features: ['assistant', 'calendar', 'journal', 'tasks', 'email', 'files'].map(id => ({ id, visible: true })) },
        '/assistant/threads/primary': { thread }, '/assistant/threads': { threads: [thread] },
        '/assistant/threads/main/messages': { thread, messages: [] }, '/assistant/settings': { settings: { name: 'ME3' } },
        '/ai-settings': { deploymentMode: 'self_hosted', providers: [], defaultModel: 'gpt-5.4-mini' },
        '/managed-ai-billing-settings': { available: false },
        '/mission-control/projects': { projects: [] }, '/mission-control/tasks': { tasks: [] },
        '/mission-control/approvals': { approvals: [] }, '/mission-control/dashboard': { settings: { goals: [] } },
        '/mission-control/wheel': { snapshots: [], settings: { segments: [] } },
        '/calendar/feed': { events: [], bookings: [], reminders: [], tasks: [], sources: [] },
        '/mailbox': { available: false, mailbox: null, sources: [], recentActivity: [] }, '/mailbox/messages': { messages: [] },
        '/soulink/status': { recentEvents: [] }, '/journal/archive': { entries: [] }, '/journal/articles': { articles: [] },
        '/email-provider-settings': { settings: {}, providers: [] }, '/app-connections': { connections: [] },
      };
      const data = path.startsWith('/journal/days/') ? { entry: null } : responses[path] ?? {};
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto('/assistant');
    const home = page.getByRole('button', { name: 'Home', exact: true });
    await expect(home).toHaveCSS('background-color', dark ? 'rgb(255, 255, 255)' : 'rgb(27, 77, 62)');
    const card = page.getByRole('article', { name: 'Today', exact: true });
    await expect(card).toHaveCSS('border-top-width', '0px');
    expect(await card.evaluate(el => getComputedStyle(el).boxShadow)).not.toBe('none');
    await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
    await page.goto('/journal');
    await expect(page.locator('.journal__editor-wrap')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('writing.png'), fullPage: true });
    await page.goto('/settings');
    await expect(page.locator('.accordion-card').first()).toBeVisible();
    await expect(page.locator('.accordion-card').first()).toHaveCSS('border-top-width', '0px');
    await page.screenshot({ path: testInfo.outputPath('settings.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}
