import { test, expect } from './fixtures/test';

// UI failure modes: goals mix unrelated work; chart loses saved area values; masonry loses
// reading order; menus trap focus; dragging/removal fails to survive a fresh page; retries multiply.
for (const mobile of [false, true]) for (const dark of [false, true]) {
  test(`Redesigned Home on ${mobile ? 'phone' : 'desktop'} ${dark ? 'dark' : 'light'}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const thread = { id: 'main', title: 'Main conversation', status: 'active', isPrimary: true };
    const today = new Date().toLocaleDateString('en-CA');
    const goals = [
      { id: 'launch', title: 'Launch ME3 mobile', status: 'active', areaId: 'work', progress: 60, projectIds: ['app'], taskIds: ['deck'] },
      { id: 'run', title: 'Run a 10k', status: 'active', areaId: 'health', progress: 35, projectIds: [], taskIds: ['5k'] },
    ];
    let tasks = [
      { id: 'deck', title: 'Send the intro deck', goalId: 'launch', status: 'backlog' },
      { id: 'design', title: 'Prep design review notes', projectId: 'app', status: 'backlog' },
      { id: '5k', title: 'Easy 5k after lunch', goalId: 'run', status: 'backlog' },
    ];
    const areas = ['health', 'spirituality', 'work', 'finances', 'home', 'joy'].map((id, i) => ({ id, label: ['Health', 'Spirituality', 'Work', 'Finances', 'Home', 'Joy'][i], color: ['#ff3b30', '#34c759', '#ff9500', '#ffcc00', '#007aff', '#af52de'][i], emoji: ['❤️', '🌿', '💼', '💰', '🏡', '🤗'][i], value: [6, 7, 8, 5, 7, 4][i] }));
    let unavailable = false;
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
      const responses: Record<string, unknown> = {
        '/auth/me': { ok: true, user: { id: 'home-redesign', username: 'owner', name: 'Demo Owner' }, workspace: { hasProfileSite: true } },
        '/sites': { sites: [] }, '/config': {}, '/plugins': { plugins: ['calendar', 'journal', 'mission-control', 'accounts'].map(id => ({ id: `me3.${id}`, status: 'installed', enabled: true })) },
        '/navigation-features': { features: ['assistant', 'calendar', 'journal', 'wheel-of-life', 'tasks', 'email', 'files'].map(id => ({ id, visible: true })) },
        '/assistant/threads/primary': { thread }, '/assistant/threads': { threads: [thread] }, '/assistant/threads/main/messages': { thread, messages: [] }, '/assistant/settings': { settings: { name: 'ME3' } }, '/ai-settings': { deploymentMode: 'self_hosted', providers: [] },
        '/mission-control/projects': { projects: [] }, '/mission-control/tasks': { tasks }, '/mission-control/approvals': { approvals: [] },
        '/mission-control/dashboard': { missionStatement: 'A calm life built around meaningful work and the people I love.' }, '/tasks/goals': { goals },
        '/journal/wheel': { settings: { segments: areas }, snapshots: [{ id: 'check-in', createdAt: `${today}T10:00:00Z`, segments: areas }] },
        '/calendar/feed': { events: [{ id: 'review', title: 'Design review', startsAt: `${today}T09:30:00` }], bookings: [], sources: [{}] },
        '/mailbox': { mailbox: { aliasAddress: 'me3@example.test' } }, '/mailbox/messages': { messages: [{ id: 'coffee', subject: 'Coffee next week', fromName: 'Sam', preview: 'Tuesday morning works for me.' }] },
        '/soulink/status': { recentEvents: [] }, '/journal/archive': { entries: [{ id: 'day', date: today, title: 'Slow Sunday', body: 'Market in the morning. Everything smelled of apples.' }] },
        '/journal/articles': { articles: [{ id: 'quiet-week', title: 'The quiet week', body: 'A few words about the quiet week.' }] },
        '/accounts/stats': { stats: { thisMonthCents: 234000, defaultCurrency: 'EUR' } }, '/accounts/entries': { total: 2 },
      };
      if (unavailable && ['/calendar/feed', '/mailbox/messages'].includes(path)) return route.fulfill({ status: 503, json: { error: 'Offline fixture' } });
      let data = responses[path] ?? {};
      if (path.startsWith('/mission-control/tasks/') && route.request().method() === 'PATCH') {
        const id = path.split('/').pop(); tasks = tasks.map(task => task.id === id ? { ...task, status: 'done' } : task); data = { task: tasks.find(task => task.id === id) };
      }
      if (path === '/journal/wheel/snapshots') data = { snapshot: { ...route.request().postDataJSON(), id: 'saved' } };
      await route.fulfill({ status: 200, json: data });
    });
    await page.goto('/assistant');
    const mission = page.getByRole('article', { name: 'Mission', exact: true });
    await expect(mission).toContainText('60%'); await expect(mission).toContainText('Work');
    await expect(mission).toContainText('Send the intro deck'); await expect(mission).toContainText('Prep design review notes');
    await expect(mission).not.toContainText('Easy 5k after lunch');
    await mission.getByRole('button', { name: 'Run a 10k', exact: true }).click();
    await expect(mission).toContainText('Easy 5k after lunch'); await expect(mission).not.toContainText('Send the intro deck');
    await mission.getByRole('button', { name: 'Launch ME3 mobile', exact: true }).click();
    const wheel = page.getByRole('article', { name: 'Wheel of Life', exact: true });
    await expect(wheel).toContainText('Joy'); await expect(wheel).toContainText('4');
    await expect(wheel.locator('svg text')).toHaveCount(6);
    const bounds = await page.locator('.home-card').evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; }));
    expect(new Set(bounds.map(b => b.x)).size).toBe(mobile ? 1 : 2);
    await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
    await wheel.getByRole('button', { name: 'Open Wheel of Life', exact: true }).click();
    const fullWheel = page.getByRole('dialog', { name: 'Wheel of Life', exact: true });
    await expect(fullWheel).toBeVisible();
    await fullWheel.getByRole('button', { name: 'Work, 8 out of 10', exact: true }).click();
    await expect(fullWheel).toContainText('Launch ME3 mobile');
    await page.screenshot({ path: testInfo.outputPath('wheel.png'), fullPage: true });
    await fullWheel.getByRole('button', { name: 'Check in', exact: true }).click();
    await fullWheel.getByLabel('Joy score', { exact: true }).fill('5');
    await fullWheel.getByRole('button', { name: 'Save check-in', exact: true }).click();
    await expect(fullWheel).not.toBeVisible();
    const writing = page.getByRole('article', { name: 'Writing', exact: true });
    await writing.getByRole('button', { name: 'Writing options' }).focus();
    await writing.getByRole('button', { name: 'Writing options' }).press('Enter');
    await page.getByRole('menuitem', { name: 'Move up', exact: true }).click();
    await writing.getByRole('button', { name: 'Writing options' }).click();
    await page.getByRole('menuitem', { name: 'Move up', exact: true }).click();
    await writing.getByRole('button', { name: 'Writing options' }).click();
    await page.getByRole('menuitem', { name: 'Move up', exact: true }).click();
    await expect(page.locator('.home-card').first()).toHaveAttribute('aria-label', 'Writing');
    await page.reload(); await expect(page.locator('.home-card').first()).toHaveAttribute('aria-label', 'Writing');
    await page.getByRole('button', { name: 'Drag Writing to reorder' }).dragTo(page.getByRole('article', { name: 'Today', exact: true }).locator('header'));
    await expect(page.locator('.home-card').first()).toHaveAttribute('aria-label', 'Today');
    await page.reload(); await expect(page.locator('.home-card').first()).toHaveAttribute('aria-label', 'Today');
    await writing.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Remove from Home', exact: true }).click(); await expect(writing).toHaveCount(0);
    await page.getByRole('button', { name: 'Add to Home', exact: true }).click();
    await page.getByRole('dialog', { name: 'Add to Home' }).getByRole('button', { name: 'Writing', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('add-to-home.png'), fullPage: true });
    await page.getByRole('button', { name: 'Close Home editor' }).click(); await expect(writing).toBeVisible();
    await page.getByRole('button', { name: 'Complete Send the intro deck' }).click(); await expect(mission).not.toContainText('Send the intro deck');
    unavailable = true;
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.locator('.home-offline')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(1);
    await expect(page.getByRole('article', { name: 'Today', exact: true })).toContainText('Design review');
    await page.screenshot({ path: testInfo.outputPath('offline.png'), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}
