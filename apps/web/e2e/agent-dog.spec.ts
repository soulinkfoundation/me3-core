import { test, expect } from './fixtures/test';

// UI checks: synthetic Core replies and an oscillator stream exercise the actual
// MediaRecorder without requesting a microphone or using an external AI provider.
for (const mobile of [false, true]) for (const dark of [false, true]) {
  test(`Chat dog states on ${mobile ? 'phone' : 'desktop'} ${dark ? 'dark' : 'light'}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light', reducedMotion: 'no-preference' });
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
        const context = new AudioContext(); const oscillator = context.createOscillator();
        const destination = context.createMediaStreamDestination(); oscillator.connect(destination); oscillator.start();
        return destination.stream;
      } });
    });
    const thread = { id: 'main', title: 'Main conversation', status: 'active', isPrimary: true };
    let releaseTurn: (() => void) | undefined;
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api/, '');
      if (path === '/assistant/chat/turn/stream') {
        await new Promise<void>(resolve => { releaseTurn = resolve; });
        await route.fulfill({ status: 503, json: { error: 'Synthetic provider unavailable' } }).catch(() => {});
        return;
      }
      const data: Record<string, unknown> = {
        '/auth/me': { ok: true, user: { id: 'dog-owner', name: 'Demo Owner', username: 'demo' }, workspace: { hasProfileSite: true } },
        '/sites': { sites: [] }, '/plugins': { plugins: [] }, '/navigation-features': { features: [] },
        '/assistant/threads/primary': { thread }, '/assistant/threads': { threads: [thread] }, '/assistant/threads/main/messages': { thread, messages: [] },
        '/assistant/jobs': { jobs: [] }, '/assistant/jobs/recipes': { recipes: [] }, '/assistant/settings': { settings: { name: 'ME3' } },
        '/ai-settings': { deploymentMode: 'self_hosted', providers: [] }, '/managed-ai-billing-settings': { available: false },
        '/assistant/voice/transcribe': { text: 'Help me plan my day' },
        '/mission-control/tasks': { tasks: [] }, '/mission-control/projects': { projects: [] }, '/mission-control/approvals': { approvals: [] },
        '/calendar/feed': { events: [], sources: [] }, '/tasks/goals': { goals: [] }, '/journal/wheel': { settings: { segments: [] }, snapshots: [] },
        '/mailbox/messages': { messages: [] }, '/journal/archive': { entries: [] }, '/journal/articles': { articles: [] },
      };
      await route.fulfill({ status: 200, json: data[path] ?? {} });
    });
    await page.goto('/assistant?view=chat');
    const idle = page.locator('.agent-dog[data-state="idle"]:visible');
    await expect(page.getByRole('heading', { name: 'What should I fetch?' })).toBeVisible();
    await expect(idle).toBeVisible();
    await expect(page.getByRole('button', { name: "What's on tomorrow?", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('chat-empty.png'), fullPage: true });
    await page.emulateMedia({ reducedMotion: 'reduce' }); await expect(idle.locator('img')).toHaveCSS('animation-name', 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: 'Start voice dictation', exact: true }).click();
    const listening = page.getByRole('status', { name: 'ME3 is listening' });
    await expect(listening).toBeVisible(); await expect(listening).toContainText('0:01');
    await expect(idle).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('chat-listening.png'), fullPage: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(listening.locator('img')).toHaveCSS('animation-name', 'none');
    await expect(listening.locator('.agent-dog__rings span').first()).toHaveCSS('animation-name', 'none');
    await listening.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.locator('#assistant-console-input')).toHaveValue('Help me plan my day');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const working = page.locator('.agent-dog[data-state="working"]:visible');
    await expect(working).toBeVisible(); await expect(working.locator('img')).toHaveCSS('animation-name', 'none');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.screenshot({ path: testInfo.outputPath('chat-working.png'), fullPage: true });
    await page.getByRole('button', { name: 'Stop response', exact: true }).click();
    releaseTurn?.(); await expect(working).toHaveCount(0);
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(page.locator('.agent-dog:visible')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}
