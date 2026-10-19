import { test, expect } from "./fixtures/test";

// UI contract journey with synthetic API fixtures; no private account or live mail/calendar is used.
for (const mobile of [false, true]) for (const dark of [false, true]) {
  test(`Home and Chat parity on ${mobile ? 'phone' : 'desktop'} ${dark ? 'dark' : 'light'}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const today = new Date().toLocaleDateString('en-CA');
    const thread = { id: 'main', title: 'Main conversation', status: 'active', isPrimary: true };
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace(/^\/api/, '');
      let data: unknown = {};
      if (path === '/auth/me') data = { ok: true, user: { id: 'home-ui-owner', username: 'owner', name: 'Demo Owner', email: 'demo@example.com' }, workspace: { hasProfileSite: true } };
      else if (path === '/sites') data = { sites: [] };
      else if (path === '/plugins') data = { plugins: [] };
      else if (path === '/navigation-features') data = { features: [] };
      else if (path === '/assistant/threads/primary') data = { thread };
      else if (path === '/assistant/threads') data = { threads: [thread] };
      else if (path.endsWith('/messages') && path.startsWith('/assistant')) data = { thread, messages: [{ id: 'message', role: 'assistant', text: '- First item with enough text to wrap across lines on a narrow screen.\n  continuation\n  - Nested item\n- Second item' }] };
      else if (path === '/assistant/settings') data = { settings: { name: 'ME3' } };
      else if (path === '/ai-settings') data = { deploymentMode: 'self_hosted', providers: [] };
      else if (path === '/mission-control/projects') data = { projects: [] };
      else if (path === '/calendar/feed') data = { events: [], bookings: [], reminders: [], tasks: [], sources: [] };
      else if (path === '/mission-control/approvals') data = { approvals: [] };
      else if (path === '/mailbox') data = { available: true, mailbox: { aliasAddress: 'me3@example.com' } };
      else if (path === '/mailbox/messages') data = { messages: [] };
      else if (path === '/soulink/status') data = { recentEvents: [] };
      else if (path === '/mission-control/tasks') data = url.searchParams.has('cursor') ? { tasks: [{ id: 'due', title: 'Send the proposal', dueAt: today, status: 'backlog', updatedAt: new Date().toISOString() }], nextCursor: null } : { tasks: [{ id: 'later', title: 'A later idea', dueAt: '2099-01-01', status: 'backlog' }, { id: 'done', title: 'Finished reel', status: 'done', updatedAt: new Date().toISOString() }], nextCursor: 'next' };
      else if (path === '/mission-control/dashboard') data = { settings: { goals: [] } };
      else if (path === '/mission-control/wheel') data = { snapshots: [], settings: { segments: [] } };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
    await page.goto('/assistant');
    // Tasks load across pages: one due today on the second page, one finished today, one for later.
    const dayPage = page.getByRole('article', { name: 'Today', exact: true }).getByRole('link', { name: "Open today's page. 1 of 2 tasks left", exact: true });
    await expect(dayPage).toHaveText(/Today's page\s*· 1 of 2 left/);
    await expect(dayPage).toHaveAttribute('href', '/journal');
    await expect(page.getByRole('article', { name: 'Writing', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Start voice dictation', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toHaveCount(0);
    const composer = page.getByLabel('Message composer');
    expect((await composer.boundingBox())!.height).toBeLessThan(80);
    await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect(page.locator('.assistant-timeline ul ul')).toContainText('Nested item');
    await expect(page.locator('.assistant-timeline li').first()).toContainText('continuation');
    const draft = page.locator('#assistant-console-input');
    await draft.fill('First line\nSecond line\nThird line\nFourth line');
    await page.getByRole('button', { name: 'Chat', exact: true }).click();
    await expect.poll(async () => (await draft.boundingBox())!.height).toBeLessThanOrEqual(45);
    await draft.focus();
    await expect.poll(async () => (await draft.boundingBox())!.height).toBeGreaterThan(60);
    await draft.fill('Hello ME3');
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start voice dictation', exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('chat.png'), fullPage: true });
    await page.locator('#assistant-console-input').fill('');
    await page.getByLabel('Message options').click();
    await expect(page.getByLabel('Model', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Attach files', exact: true })).toBeVisible();
    await page.getByLabel('Message options').press('Escape');
    await expect(page.getByLabel('Model', { exact: true })).not.toBeVisible();
  });
}
