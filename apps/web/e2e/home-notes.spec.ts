import { test, expect } from './fixtures/test';

// UI test: every Core API is stubbed. Failure modes: Notes shows without being added; the card
// loses a typed note on Cancel or a failed save; Save files a daily note or drops the project;
// the title or a row stops leading into Journal's Notes; the choice doesn't reach the shared layout.
for (const dark of [false, true]) {
  test(`Home Notes card ${dark ? 'dark' : 'light'}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light' });
    await page.setViewportSize({ width: 1100, height: 900 });
    const thread = { id: 'main', title: 'Main conversation', status: 'active', isPrimary: true };
    const stamp = new Date().toISOString();
    let layout: unknown = null;
    let failSave = true;
    const saved: Record<string, unknown>[] = [];
    let notes = [] as { id: string; title: string | null; preview: string; projectName: string | null }[];
    await page.addInitScript(() => localStorage.setItem('me3.firstRun.handled.home-notes', '1'));
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace(/^\/api/, '');
      const method = route.request().method();
      const responses: Record<string, unknown> = {
        '/auth/me': { ok: true, user: { id: 'home-notes', username: 'owner', name: 'Demo Owner' }, workspace: { hasProfileSite: true } },
        '/sites': { sites: [] }, '/config': {}, '/plugins': { plugins: ['calendar', 'journal', 'mission-control'].map(id => ({ id: `me3.${id}`, status: 'installed', enabled: true })) },
        '/navigation-features': { features: ['assistant', 'calendar', 'journal', 'tasks', 'email'].map(id => ({ id, visible: true })) },
        '/assistant/threads/primary': { thread }, '/assistant/threads': { threads: [thread] }, '/assistant/threads/main/messages': { thread, messages: [] }, '/assistant/settings': { settings: { name: 'ME3' } }, '/ai-settings': { deploymentMode: 'self_hosted', providers: [] },
        '/mission-control/projects': { projects: [{ id: 'house', name: 'House move' }] }, '/mission-control/tasks': { tasks: [] }, '/mission-control/approvals': { approvals: [] },
        '/calendar/feed': { events: [], bookings: [], sources: [{}] }, '/mailbox': { mailbox: { aliasAddress: 'me3@example.test' } }, '/mailbox/messages': { messages: [] },
        '/journal/folders': { folders: [] }, '/journal/archive': { entries: [] },
      };
      if (path === '/home/layout') { if (method === 'PUT') layout = route.request().postDataJSON(); return route.fulfill({ json: { layout } }); }
      if (path === '/journal/articles' && method === 'GET') {
        if (url.searchParams.get('preview') === '1') return route.fulfill({ json: { articles: notes.slice(0, Number(url.searchParams.get('limit')) || 200) } });
        return route.fulfill({ json: { articles: notes.map(note => ({ ...note, body: `<p>${note.preview}</p>`, bodyFormat: 'html', revision: 1, createdAt: stamp, updatedAt: stamp })) } });
      }
      if (path === '/journal/articles' && method === 'POST') {
        if (failSave) { failSave = false; return route.fulfill({ status: 500, json: { error: 'Fixture failure' } }); }
        const body = route.request().postDataJSON(); saved.push(body);
        const id = `article_${saved.length}`;
        notes = [{ id, title: null, preview: 'Call plumber Tue 10am', projectName: body.projectId ? 'House move' : null }, ...notes];
        return route.fulfill({ status: 201, json: { article: { id, ...body, revision: 1, createdAt: stamp, updatedAt: stamp } } });
      }
      if (path.startsWith('/journal/articles/')) return route.fulfill({ json: { article: { id: path.split('/').pop(), title: null, body: '<p>Call plumber Tue 10am</p>', bodyFormat: 'html', revision: 1, projectId: 'house', createdAt: stamp, updatedAt: stamp } } });
      await route.fulfill({ json: responses[path] ?? {} });
    });

    await page.goto('/assistant');
    const card = page.getByRole('article', { name: 'Notes', exact: true });
    await expect(page.getByRole('article', { name: 'Today', exact: true })).toBeVisible();
    await expect(card).toHaveCount(0);

    await page.getByRole('button', { name: 'Add to Home', exact: true }).click();
    const addDialog = page.getByRole('dialog', { name: 'Add to Home', exact: true });
    await addDialog.getByRole('button', { name: 'Notes', exact: true }).click();
    await addDialog.getByRole('button', { name: 'Close Home editor', exact: true }).click();
    await expect(card.getByText('No notes yet')).toBeVisible();
    expect(layout).toMatchObject({ pinned: ['notes'] });
    await testInfo.attach(`notes-empty-${dark ? 'dark' : 'light'}`, { body: await card.screenshot(), contentType: 'image/png' });

    await card.getByRole('button', { name: 'New note', exact: true }).click();
    const field = card.getByRole('textbox', { name: 'Note', exact: true });
    await expect(field).toBeFocused();
    await expect(card.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await field.fill('Call plumber Tue 10am\nAsk about the <boiler>');
    await card.getByRole('combobox', { name: 'Project', exact: true }).selectOption('house');
    await testInfo.attach(`notes-typing-${dark ? 'dark' : 'light'}`, { body: await card.screenshot(), contentType: 'image/png' });

    // Cancel and Esc keep the draft; a failed save keeps it too.
    await card.getByRole('button', { name: 'Cancel', exact: true }).click();
    await card.getByRole('button', { name: 'New note', exact: true }).click();
    await expect(field).toHaveValue('Call plumber Tue 10am\nAsk about the <boiler>');
    await card.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(field).toHaveValue('Call plumber Tue 10am\nAsk about the <boiler>');
    expect(saved).toHaveLength(0);

    await field.press('ControlOrMeta+Enter');
    await expect(card.getByRole('link', { name: 'Call plumber Tue 10am House move' })).toBeVisible();
    expect(saved).toEqual([{ title: null, body: '<p>Call plumber Tue 10am</p><p>Ask about the &lt;boiler&gt;</p>', bodyFormat: 'html', projectId: 'house' }]);
    await testInfo.attach(`notes-list-${dark ? 'dark' : 'light'}`, { body: await card.screenshot(), contentType: 'image/png' });
    await card.getByRole('button', { name: 'New note', exact: true }).click();
    await expect(field).toHaveValue('');
    await field.press('Escape');

    // The title opens Journal on its Notes tab; a row opens that note.
    await card.getByRole('link', { name: 'Notes', exact: true }).click();
    await expect(page).toHaveURL(/\/journal$/);
    await expect(page.getByRole('button', { name: 'Notes', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.goto('/journal?new=note');
    await expect(page).toHaveURL(/\/journal$/);
    await expect.poll(() => saved.length).toBe(2);
    expect(saved[1]).toMatchObject({ title: null, body: '' });
  });
}
