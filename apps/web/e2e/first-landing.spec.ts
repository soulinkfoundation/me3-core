import { test, expect } from "./fixtures/test";

// Failure mode: on an owner's first visit in this browser, the page opens on one tab and switches to the other by
// itself a moment later, once their site and chat load. Home or Chat must only appear once it is the right one.
for (const owner of ["new", "returning"] as const) {
  test(`a ${owner} owner's first visit opens on ${owner === "new" ? "Chat" : "Home"} without switching tabs`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const thread = { id: "main", title: "Main conversation", status: "active", isPrimary: true };
    // Record every tab that is ever on screen.
    await page.addInitScript(() => {
      const seen = new Set<string>();
      (window as unknown as { seenTabs: Set<string> }).seenTabs = seen;
      const look = () => {
        const visible = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector);
          return Boolean(element && element.offsetParent !== null);
        };
        if (visible(".assistant-home")) seen.add("home");
        if (visible(".assistant-timeline")) seen.add("chat");
        requestAnimationFrame(look);
      };
      requestAnimationFrame(look);
    });
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
      let data: unknown = {};
      if (path === "/auth/me") data = { ok: true, user: { id: `${owner}-owner`, username: "owner", name: "Demo Owner", email: "demo@example.com" }, workspace: { hasProfileSite: true } };
      else if (path === "/sites") {
        // The site loads slowly, as it does on a phone.
        await new Promise(resolve => setTimeout(resolve, 800));
        data = { sites: [{ username: "owner", site_role: "profile" }] };
      } else if (path === "/sites/owner/content") data = { profile: { bio: owner === "returning" ? "I make things." : "" } };
      else if (path === "/assistant/threads/primary") data = { thread };
      else if (path === "/assistant/threads") data = { threads: [thread] };
      else if (path.endsWith("/messages") && path.startsWith("/assistant")) data = { thread, messages: [] };
      else if (path === "/mission-control/wheel") data = { snapshots: [], settings: { segments: [] } };
      else if (path === "/mission-control/dashboard") data = { settings: { goals: [] } };
      else if (path === "/calendar/feed") data = { events: [], bookings: [], reminders: [], tasks: [], sources: [] };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
    });

    await page.goto("/assistant");
    const landed = owner === "new" ? "Chat" : "Home";
    await expect(page.getByRole("button", { name: landed, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(owner === "new" ? ".assistant-timeline" : ".assistant-home")).toBeVisible();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => [...(window as unknown as { seenTabs: Set<string> }).seenTabs])).toEqual([owner === "new" ? "chat" : "home"]);

    // The next visit is settled, so it opens on Home straight away with no wait.
    if (owner === "returning") {
      await page.reload();
      await expect(page.locator(".assistant-home")).toBeVisible({ timeout: 500 });
    }
  });
}
