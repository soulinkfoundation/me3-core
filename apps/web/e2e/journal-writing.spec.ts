import { test, expect, type Page } from './fixtures/test';

// UI test: every Core API is stubbed. Failure modes: the toolbar wraps to a second row beside the
// list; a daily row hides its day; older months don't fold or a fold doesn't toggle; the top-bar
// Daily/Notes buttons stop showing and hiding the list; on a phone the list doesn't take the
// screen or picking a page doesn't return to the editor; the goal, tasks or Jump to date come
// back onto the page; the dictate button leaves the page corner.
const stamp = '2026-11-12T09:00:00.000Z';
const days = ['2026-11-12', '2026-11-11', '2026-11-07', '2026-10-27', '2026-10-20'];
const entry = (date: string) => ({ id: `day-${date}`, date, title: null, body: `<p>Notes for ${date}, written at some length so the preview has to wrap onto a second line.</p>`, bodyFormat: 'html', preview: `Notes for ${date}, written at some length so the preview has to wrap onto a second line.`, metadata: {}, revision: 1, createdAt: stamp, updatedAt: stamp });

async function stub(page: Page) {
  await page.addInitScript(() => localStorage.setItem('me3.firstRun.handled.journal-writing', '1'));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const responses: Record<string, unknown> = {
      '/auth/me': { ok: true, user: { id: 'journal-writing', username: 'owner', name: 'Demo Owner' }, workspace: { hasProfileSite: true } },
      '/sites': { sites: [] }, '/config': {}, '/plugins': { plugins: ['calendar', 'journal', 'mission-control'].map(id => ({ id: `me3.${id}`, status: 'installed', enabled: true })) },
      '/navigation-features': { features: ['assistant', 'journal', 'tasks'].map(id => ({ id, visible: true })) },
      '/mission-control/projects': { projects: [{ id: 'house', name: 'House move' }] },
      // A focus goal and a task for today: neither may show on the page.
      '/mission-control/tasks': { tasks: [{ id: 't1', title: 'Fixture task for today', status: 'in_progress', updatedAt: stamp }] },
      '/tasks/goals': { goals: [{ id: 'g1', title: 'Fixture focus goal', status: 'active', progress: 20, focus: true }] },
      '/journal/folders': { folders: [] }, '/journal/archive': { entries: days.map(entry) },
      '/journal/articles': { articles: [{ id: 'a1', title: 'Take back the internet', body: '<p>Draft of the article.</p>', bodyFormat: 'html', revision: 1, projectId: null, createdAt: stamp, updatedAt: stamp }] },
    };
    if (path.startsWith('/journal/days/')) { const date = path.split('/').pop()!; return route.fulfill({ json: { entry: days.includes(date) ? entry(date) : null } }); }
    await route.fulfill({ json: responses[path] ?? {} });
  });
}

test('Journal on desktop: one-row toolbar, folding months, list buttons in the top bar', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await stub(page);
  await page.goto('/journal?date=2026-11-12');

  const daily = page.getByRole('button', { name: 'Daily', exact: true });
  const list = page.getByRole('complementary', { name: 'Daily pages' });
  await expect(daily).toHaveAttribute('aria-pressed', 'true');
  await expect(list.getByRole('button', { name: /^12 Nov 2026, / })).toContainText('Thu 12');

  // Every toolbar button shares one row, and none is cut off.
  const tops = await page.locator('.editor-toolbar .toolbar-btn').evaluateAll(buttons => buttons.map(button => Math.round(button.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  const lastRight = await page.locator('.editor-toolbar .toolbar-btn').last().evaluate(button => button.getBoundingClientRect().right);
  expect(lastRight).toBeLessThanOrEqual(1440);

  // The newest month is open, October is folded until opened.
  const october = list.getByRole('button', { name: /^October/ });
  await expect(october).toHaveAttribute('aria-expanded', 'false');
  await expect(list.getByRole('button', { name: /^27 Oct 2026, / })).toHaveCount(0);
  await october.click();
  await expect(list.getByRole('button', { name: /^27 Oct 2026, / })).toContainText('Tue 27');
  await list.getByRole('button', { name: /^November/ }).click();
  await expect(list.getByRole('button', { name: /^12 Nov 2026, / })).toHaveCount(0);
  await list.getByRole('button', { name: /^November/ }).click();

  await expect(page.getByText('Fixture focus goal')).toHaveCount(0);
  await expect(page.getByText('Fixture task for today')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Jump to date' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start voice dictation' })).toBeVisible();
  await testInfo.attach('journal-desktop-daily', { body: await page.screenshot(), contentType: 'image/png' });

  // Notes shows the notes; pressing the shown button hides the list, and that sticks on reload.
  const notes = page.getByRole('button', { name: 'Notes', exact: true });
  await notes.click();
  await expect(page.getByRole('complementary', { name: 'Notes' }).getByText('Take back the internet')).toBeVisible();
  await testInfo.attach('journal-desktop-notes', { body: await page.screenshot(), contentType: 'image/png' });
  await notes.click();
  await expect(page.getByRole('complementary')).toHaveCount(0);
  await expect(notes).toHaveAttribute('aria-pressed', 'false');
  await testInfo.attach('journal-desktop-focus', { body: await page.screenshot(), contentType: 'image/png' });
  await page.reload();
  await expect(page.locator('.journal__editor-wrap')).toContainText('Notes for 2026-11-12');
  await expect(page.getByRole('complementary')).toHaveCount(0);
});

test('Journal on a phone: the list takes the screen and a page returns to the editor', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await stub(page);
  await page.goto('/journal?date=2026-11-12');

  const editor = page.locator('.journal__editor-wrap');
  await expect(editor).toContainText('Notes for 2026-11-12');
  await expect(page.getByRole('complementary')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await testInfo.attach('journal-phone-editor', { body: await page.screenshot(), contentType: 'image/png' });

  await page.getByRole('button', { name: 'Daily', exact: true }).click();
  const list = page.getByRole('complementary', { name: 'Daily pages' });
  await expect(list).toBeVisible();
  await expect(editor).toBeHidden();
  await expect(page.getByRole('button', { name: 'Start voice dictation' })).toHaveCount(0);
  await testInfo.attach('journal-phone-list', { body: await page.screenshot(), contentType: 'image/png' });

  await list.getByRole('button', { name: /^11 Nov 2026, / }).click();
  await expect(page.getByRole('complementary')).toHaveCount(0);
  await expect(editor).toContainText('Notes for 2026-11-11');
  await expect(page.getByRole('button', { name: 'Start voice dictation' })).toBeVisible();
});
