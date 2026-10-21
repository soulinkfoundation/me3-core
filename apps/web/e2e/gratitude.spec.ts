import { test, expect } from "./fixtures/test";

// UI tests: application APIs and the push relay are simulated. The Worker tests
// separately verify persistence and reminder delivery against real SQLite.
for (const mobile of [false, true]) for (const dark of [false, true]) {
  test(`Gratitude on ${mobile ? "phone" : "desktop"} ${dark ? "dark" : "light"}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    await page.clock.install({ time: new Date("2026-10-13T08:00:00Z") });
    const thread = { id: "main", title: "Main conversation", status: "active", isPrimary: true };
    const quotes = [
      { id: "q216", text: "Very little is needed to make a happy life; it is all within yourself in your way of thinking.", author: "Marcus Aurelius", source: "Meditations 7.67", sourceUrl: null, savedAt: null as string | null },
      { id: "q227", text: "Do not spoil what you have by desiring what you have not.", author: "Epicurus", source: "Vatican Sayings 35", sourceUrl: null, savedAt: null as string | null },
    ];
    let quoteIndex = 0;
    const lists = { gratitude: ["", "", ""], goodThings: ["", "", ""] };
    const settings = { quoteInBriefing: true, eveningReminder: false };
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
      const method = route.request().method();
      const responses: Record<string, unknown> = {
        "/auth/me": { ok: true, user: { id: "gratitude-ui", username: "synthetic", name: "Synthetic Owner", timezone: "Europe/Dublin" }, workspace: { hasProfileSite: true } },
        "/sites": { sites: [] }, "/config": {}, "/plugins": { plugins: ["calendar", "journal", "mission-control"].map(id => ({ id: `me3.${id}`, status: "installed", enabled: true })) },
        "/navigation-features": { features: ["assistant", "calendar", "journal", "wheel-of-life", "tasks", "email", "files"].map(id => ({ id, visible: true })) },
        "/assistant/threads/primary": { thread }, "/assistant/threads": { threads: [thread] }, "/assistant/threads/main/messages": { thread, messages: [] }, "/assistant/settings": { settings: { name: "ME3" } }, "/ai-settings": { deploymentMode: "self_hosted", providers: [] },
        "/mission-control/projects": { projects: [] }, "/mission-control/tasks": { tasks: [] }, "/mission-control/approvals": { approvals: [] }, "/mission-control/dashboard": {}, "/tasks/goals": { goals: [] },
        "/journal/wheel": { settings: { segments: [] }, snapshots: [] },
        "/calendar/feed": { events: [], bookings: [], sources: [], reminders: settings.eveningReminder ? [{ id: "card-reminder", title: "Three good things", remindAt: "2026-10-13T20:00:00Z", timezone: "Europe/Dublin", recurrenceRule: "FREQ=DAILY", status: "pending", contextType: "card", contextId: "gratitude" }] : [] },
        "/mailbox": { mailbox: {} }, "/mailbox/messages": { messages: [] }, "/soulink/status": { recentEvents: [] }, "/journal/archive": { entries: [] }, "/journal/articles": { articles: [] },
      };
      let data = responses[path] ?? {};
      if (path === "/gratitude") data = { date: "2026-10-13", timezone: "Europe/Dublin", quote: quotes[quoteIndex], ...lists, settings, days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${7 + i}`, written: i === 1 || (i === 6 && [...lists.gratitude, ...lists.goodThings].some(line => line.trim())) })) };
      if (path === "/gratitude/lines" && method === "PATCH") { const body = route.request().postDataJSON(); if (body.gratitude) lists.gratitude = body.gratitude; if (body.goodThings) lists.goodThings = body.goodThings; data = { ok: true }; }
      if (path === "/gratitude/settings" && method === "PATCH") { Object.assign(settings, route.request().postDataJSON()); data = { settings }; }
      if (path === "/quotes/mine") data = { quotes: quotes.filter(quote => quote.savedAt) };
      if (path === "/quotes/another") { quoteIndex = 1 - quoteIndex; data = { quote: quotes[quoteIndex] }; }
      if (/^\/quotes\/[^/]+\/save$/.test(path)) { const quote = quotes.find(q => path.includes(q.id))!; quote.savedAt = method === "PUT" ? "2026-10-13T08:00:00Z" : null; data = { quote }; }
      if (path === "/journal/days/2026-10-13") data = { entry: { id: "day", date: "2026-10-13", title: "My day", body: `<p>My own writing.</p><h3>Grateful for</h3><ol><li><p>${lists.gratitude[0]}</p></li></ol><h3>Three good things</h3><ol><li><p>${lists.goodThings[0]}</p></li></ol>`, bodyFormat: "html", metadata: { ...lists, gratitudeInBody: true }, revision: 1 } };
      if (path.includes("/journal-links")) data = { links: [] };
      await route.fulfill({ status: 200, json: data });
    });
    await page.goto("/assistant");
    const card = page.locator(".gratitude-content");
    await expect(card).toContainText("Gratitude");
    await expect(card.locator("input")).toHaveCount(3);
    await card.getByRole("textbox", { name: "Grateful for 1" }).fill("Coffee with Ada");
    await page.clock.runFor(700);
    await expect.poll(() => lists.gratitude[0]).toBe("Coffee with Ada");
    await expect(card.locator(".gratitude-day.is-today")).toHaveClass(/is-written/);
    await page.screenshot({ path: testInfo.outputPath("morning.png"), fullPage: true });
    await card.getByRole("button", { name: "Today's quote", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Today's quote", exact: true });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Save", exact: true }).click();
    await expect(sheet.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
    await sheet.getByRole("switch", { name: "Three good things at 21:00" }).click();
    await expect(sheet.getByRole("switch", { name: "Three good things at 21:00" })).toHaveAttribute("aria-checked", "true");
    await page.screenshot({ path: testInfo.outputPath("quote-sheet.png"), fullPage: true });
    await sheet.getByRole("button", { name: "Another", exact: true }).click();
    await expect(sheet).toContainText("Epicurus");
    await sheet.getByRole("button", { name: "My quotes", exact: false }).click();
    await expect(page.getByRole("dialog", { name: "My quotes", exact: true })).toContainText("Marcus Aurelius");
    await page.keyboard.press("Escape");
    await expect(card.getByRole("button", { name: "Today's quote", exact: true })).toBeFocused();
    await page.clock.setSystemTime(new Date("2026-10-13T17:00:00Z"));
    await page.clock.runFor(30_000);
    await expect(card).toContainText("Three good things");
    await expect(card.locator(".gratitude-quote")).toHaveCount(0);
    await card.getByRole("textbox", { name: "Good thing 1" }).fill("A walk");
    await page.clock.runFor(700);
    await expect.poll(() => lists.goodThings[0]).toBe("A walk");
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Good thing 1" })).toHaveValue("A walk");
    await page.screenshot({ path: testInfo.outputPath("evening.png"), fullPage: true });
    await page.goto("/journal?date=2026-10-13");
    // The lines are part of the day's writing, so they show in the editor as text.
    await expect(page.locator(".journal__editor-wrap")).toContainText("My own writing.");
    await expect(page.locator(".journal__editor-wrap h3", { hasText: "Grateful for" })).toBeVisible();
    await expect(page.locator(".journal__editor-wrap")).toContainText("Coffee with Ada");
    await expect(page.locator(".journal__editor-wrap")).toContainText("A walk");
    await page.screenshot({ path: testInfo.outputPath("daily-page.png"), fullPage: true });
    await page.goto("/calendar");
    await expect(page.locator(".cal-card-reminders")).toContainText("Three good things");
    await expect(page.locator(".cal-board-wrap")).not.toContainText("Three good things");
  });
}
