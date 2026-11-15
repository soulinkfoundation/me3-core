import { test, expect, type Page } from './fixtures/test';

// UI test: every Core API is stubbed. Failure modes: the toolbar wraps to a second row beside the
// list; today's tasks show unfolded, or the folded line doesn't open; day arrows or a date picker
// come back; the Notes | Today switch stops reaching notes or today; the library loses Notes first,
// its Daily month headings, or its hide button; on a phone the library doesn't take the screen or
// picking a page doesn't return to the editor; the goal comes back onto the page.
const stamp = '2026-11-12T09:00:00.000Z';
const days = ['2026-11-12', '2026-11-11', '2026-11-07', '2026-10-27', '2026-10-20'];
const entry = (date: string) => ({ id: `day-${date}`, date, title: null, body: `<p>Notes for ${date}, written at some length so the preview has to wrap onto a second line.</p>`, bodyFormat: 'html', preview: `Notes for ${date}, written at some length so the preview has to wrap onto a second line.`, metadata: {}, revision: 1, createdAt: stamp, updatedAt: stamp });

const note = { id: 'a1', title: 'Take back the internet', body: '<p>Draft of the article.</p>', bodyFormat: 'html', revision: 1, projectId: 'house', createdAt: stamp, updatedAt: stamp };

async function stub(page: Page) {
  await page.addInitScript(() => localStorage.setItem('me3.firstRun.handled.journal-writing', '1'));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const responses: Record<string, unknown> = {
      '/auth/me': { ok: true, user: { id: 'journal-writing', username: 'owner', name: 'Demo Owner' }, workspace: { hasProfileSite: true } },
      '/sites': { sites: [] }, '/config': {}, '/plugins': { plugins: ['calendar', 'journal', 'mission-control'].map(id => ({ id: `me3.${id}`, status: 'installed', enabled: true })) },
      '/navigation-features': { features: ['assistant', 'journal', 'tasks'].map(id => ({ id, visible: true })) },
      '/mission-control/projects': { projects: [{ id: 'house', name: 'House move', icon: '🏠' }] },
      // A focus goal (never on the page) and a task for today (folded into one line).
      '/mission-control/tasks': { tasks: [{ id: 't1', title: 'Fixture task for today', status: 'in_progress', updatedAt: stamp }] },
      '/tasks/goals': { goals: [{ id: 'g1', title: 'Fixture focus goal', status: 'active', progress: 20, focus: true }] },
      '/journal/folders': { folders: [] }, '/journal/archive': { entries: days.map(entry) },
      '/journal/articles': { articles: [note] },
      '/journal/articles/a1': { article: note },
    };
    if (path.startsWith('/journal/days/')) { const date = path.split('/').pop()!; return route.fulfill({ json: { entry: days.includes(date) ? entry(date) : null } }); }
    await route.fulfill({ json: responses[path] ?? {} });
  });
}

test('Journal on desktop: Notes | Today switch, folded tasks, library with Notes first', async ({ page }, testInfo) => {
  await page.clock.setSystemTime(new Date('2026-11-15T10:00:00'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await stub(page);
  await page.goto('/journal');

  const today = page.getByRole('button', { name: 'Today', exact: true });
  const notes = page.getByRole('button', { name: 'Notes', exact: true });
  await expect(today).toHaveAttribute('aria-pressed', 'true');
  await expect(notes).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Previous day' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose journal date' })).toHaveCount(0);

  // Every toolbar button shares one row, and none is cut off.
  const tops = await page.locator('.editor-toolbar .toolbar-btn').evaluateAll(buttons => buttons.map(button => Math.round(button.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  const lastRight = await page.locator('.editor-toolbar .toolbar-btn').last().evaluate(button => button.getBoundingClientRect().right);
  expect(lastRight).toBeLessThanOrEqual(1440);

  // Today's tasks fold into one line; it opens in place to the list and All tasks.
  const tasksLine = page.getByRole('button', { name: '1 task', exact: true });
  await expect(tasksLine).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Fixture task for today')).toHaveCount(0);
  await tasksLine.click();
  await expect(page.getByRole('link', { name: 'Fixture task for today' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'All tasks' })).toHaveAttribute('href', '/tasks');
  await expect(page.getByText('Fixture focus goal')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start voice dictation' })).toBeVisible();
  await testInfo.attach('journal-desktop-today', { body: await page.screenshot(), contentType: 'image/png' });

  // The library opens on Notes, grouped by project; Daily has month headings.
  const library = page.getByRole('complementary', { name: 'Library' });
  const tabs = library.getByRole('tab');
  await expect(tabs).toHaveText(['Notes', 'Daily']);
  await expect(library.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
  await expect(library.locator('.notes-tree__toggle').first()).toContainText('🏠');
  await expect(library.getByText('Take back the internet')).toBeVisible();
  await library.getByRole('tab', { name: 'Daily' }).click();
  await expect(library.getByRole('heading', { name: 'November' })).toBeVisible();
  await expect(library.getByRole('heading', { name: 'October' })).toBeVisible();
  await expect(library.getByRole('button', { name: /^27 Oct 2026, / })).toContainText('Tue 27');

  // A past day opens from the library; Today goes back to today.
  await library.getByRole('button', { name: /^12 Nov 2026, / }).click();
  await expect(page.locator('.journal__editor-wrap')).toContainText('Notes for 2026-11-12');
  await expect(today).toHaveAttribute('aria-pressed', 'false');
  await expect(tasksLine).toHaveCount(0);
  await today.click();
  await expect(today).toHaveAttribute('aria-pressed', 'true');
  await expect(tasksLine).toBeVisible();

  // Notes opens the latest note beside the list.
  await notes.click();
  await expect(notes).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('Take back the internet');
  await expect(library.getByRole('tab', { name: 'Notes' })).toHaveAttribute('aria-selected', 'true');
  await testInfo.attach('journal-desktop-notes', { body: await page.screenshot(), contentType: 'image/png' });

  // The book button hides the library, and that sticks on reload.
  await page.getByRole('button', { name: 'Hide library' }).click();
  await expect(page.getByRole('complementary')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button', { name: '1 task', exact: true })).toBeVisible();
  await expect(page.getByRole('complementary')).toHaveCount(0);
});

test('Journal on a phone: the library takes the screen and a pick returns to the editor', async ({ page }, testInfo) => {
  await page.clock.setSystemTime(new Date('2026-11-15T10:00:00'));
  await page.setViewportSize({ width: 375, height: 800 });
  await stub(page);
  await page.goto('/journal');

  const editor = page.locator('.journal__editor-wrap');
  await expect(page.getByRole('button', { name: '1 task', exact: true })).toBeVisible();
  await expect(page.getByRole('complementary')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await testInfo.attach('journal-phone-today', { body: await page.screenshot(), contentType: 'image/png' });

  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  const library = page.getByRole('complementary', { name: 'Library' });
  await expect(library).toBeVisible();
  await expect(editor).toBeHidden();
  await expect(page.getByRole('button', { name: 'Start voice dictation' })).toHaveCount(0);
  await testInfo.attach('journal-phone-notes', { body: await page.screenshot(), contentType: 'image/png' });
  await library.getByText('Take back the internet').click();
  await expect(page.getByRole('complementary')).toHaveCount(0);
  await expect(editor).toContainText('Draft of the article.');

  await page.getByRole('button', { name: 'Show library' }).click();
  await library.getByRole('tab', { name: 'Daily' }).click();
  await library.getByRole('button', { name: /^11 Nov 2026, / }).click();
  await expect(page.getByRole('complementary')).toHaveCount(0);
  await expect(editor).toContainText('Notes for 2026-11-11');
  await expect(page.getByRole('button', { name: 'Start voice dictation' })).toBeVisible();
});
