import { test, expect } from "./fixtures/test";

// UI test: the Worker API is simulated here. The Worker tests separately verify
// snapshot notes against real SQLite (apps/worker/src/routes/wheel-of-life-notes.test.ts).
// Failure modes: the edit list grows sliders/colour/helper inputs again; the 6–8 limits
// stop showing; Add area does not take a fresh palette colour or select the name;
// Remove loses its Undo or restores in the wrong place; Save opens a notes dialog or
// saves before every area is scored; the saved view loses the previous outline,
// changes or private notes; notes are not written back to the snapshot.
const ids = ["health", "spirituality", "work", "finances", "home", "joy"];
const labels = ["Health", "Spirituality", "Work", "Finances", "Home", "Joy"];
const emoji = ["❤️", "🌿", "💼", "💰", "🏡", "🤗"];
const palette = ["#26806f", "#7c3aed", "#2563eb", "#ca8a04", "#c2410c", "#be123c"];

for (const mobile of [false, true]) for (const dark of [false, true]) {
  test(`Wheel of Life on ${mobile ? "phone" : "desktop"} ${dark ? "dark" : "light"}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    await page.addInitScript(() => localStorage.setItem("me3.firstRun.handled.wheel-ui", "1"));
    const current = ids.map((id, i) => ({ id, label: labels[i], helper: `${labels[i]} helper`, color: palette[i], emoji: emoji[i], value: [7, 6, 8, 3, null, null][i] }));
    const previous = { id: "before", createdAt: "2026-10-12T09:00:00Z", segments: ids.map((id, i) => ({ ...current[i], value: [6, 5, 8, 4, 6, 5][i], notes: "" })) };
    const settingsPatches: Array<{ segments: Array<Record<string, unknown>> }> = [];
    const snapshotPosts: Array<Record<string, unknown>> = [];
    const notePatches: Array<{ path: string; body: Record<string, unknown> }> = [];
    let saved: { id: string; createdAt: string; segments: Array<Record<string, unknown>> } | null = null;
    const thread = { id: "main", title: "Main conversation", status: "active", isPrimary: true };

    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
      const method = route.request().method();
      const responses: Record<string, unknown> = {
        "/auth/me": { ok: true, user: { id: "wheel-ui", username: "synthetic", name: "Synthetic Owner" }, workspace: { hasProfileSite: true } },
        "/sites": { sites: [] }, "/config": {}, "/plugins": { plugins: ["journal", "mission-control"].map(id => ({ id: `me3.${id}`, status: "installed", enabled: true })) },
        "/navigation-features": { features: ["assistant", "journal", "wheel-of-life"].map(id => ({ id, visible: true })) },
        "/assistant/threads/primary": { thread }, "/assistant/threads": { threads: [thread] }, "/assistant/settings": { settings: { name: "ME3" } },
        "/journal/wheel": { settings: { segments: current }, snapshots: [previous] },
      };
      let data = responses[path] ?? {};
      let status = 200;
      if (path === "/journal/wheel/settings" && method === "PATCH") {
        const body = route.request().postDataJSON();
        settingsPatches.push(body);
        data = { settings: { segments: body.segments } };
      }
      if (path === "/journal/wheel/snapshots" && method === "POST") {
        const body = route.request().postDataJSON();
        snapshotPosts.push(body);
        saved = { id: "saved", createdAt: "2026-11-24T10:00:00Z", segments: body.segments.map((segment: Record<string, unknown>) => ({ ...segment, notes: "" })) };
        data = { snapshot: saved };
        status = 201;
      }
      if (path.startsWith("/journal/wheel/snapshots/") && method === "PATCH") {
        const body = route.request().postDataJSON();
        notePatches.push({ path, body });
        const notes = body.notes as Record<string, string>;
        saved = { ...saved!, segments: saved!.segments.map(segment => (segment.id as string) in notes ? { ...segment, notes: notes[segment.id as string] } : segment) };
        data = { snapshot: saved };
      }
      await route.fulfill({ status, json: data });
    });

    await page.goto("/wheel-of-life");
    const main = page.locator(".life-wheel");
    const save = main.getByRole("button", { name: "Save", exact: true });
    await expect(main.getByText("Score Home and Joy to save.")).toBeVisible();
    await expect(save).toBeDisabled();

    // Edit areas: emoji, name and Remove only.
    await page.getByRole("button", { name: "Edit areas", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Edit areas", exact: true });
    await expect(dialog.getByRole("textbox", { name: "Area name" })).toHaveCount(6);
    await expect(dialog.locator('input[type="range"], input[type="color"]')).toHaveCount(0);
    await expect(dialog.getByRole("textbox", { name: /helper/i })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
    await expect(dialog).toContainText("A wheel needs at least six areas. Rename one to change it.");

    await dialog.getByRole("button", { name: "Add area", exact: true }).click();
    const names = dialog.getByRole("textbox", { name: "Area name" });
    await expect(names).toHaveCount(7);
    await expect(names.nth(6)).toBeFocused();
    await expect(names.nth(6)).toHaveValue("New area");
    await page.keyboard.type("Family");
    await expect(names.nth(6)).toHaveValue("Family");
    await dialog.getByRole("button", { name: "Add area", exact: true }).click();
    await expect(names).toHaveCount(8);
    const full = dialog.getByRole("button", { name: "Eight areas is the most", exact: true });
    await expect(full).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("edit-areas.png"), fullPage: true });

    await dialog.getByRole("button", { name: "Remove Family", exact: true }).click();
    await expect(names).toHaveCount(7);
    const toast = page.locator("[data-sonner-toast]").filter({ hasText: "Removed Family" });
    await expect(toast).toBeVisible();
    await toast.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(names).toHaveCount(8);
    await expect(names.nth(6)).toHaveValue("Family");
    await dialog.getByRole("button", { name: "Remove New area", exact: true }).click();
    await expect(names).toHaveCount(7);
    await expect(dialog.getByRole("button", { name: "Add area", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await expect.poll(() => settingsPatches.at(-1)?.segments.map(segment => segment.label)).toEqual([...labels, "Family"]);
    const lastSettings = settingsPatches.at(-1)!.segments;
    expect(lastSettings[0]).toMatchObject({ helper: "Health helper", color: palette[0], value: 7 });
    expect(lastSettings[6].color).toBe("#0e7490");

    // Score by keyboard on the wheel; the hint names what is left.
    await expect(main.getByText("Score Home, Joy and Family to save.")).toBeVisible();
    await main.getByRole("button", { name: "Home, not scored", exact: true }).press("End");
    await main.getByRole("button", { name: "Joy, not scored", exact: true }).press("Enter");
    await expect(main.getByText("Score Family to save.")).toBeVisible();
    await expect(save).toBeDisabled();
    await main.getByRole("button", { name: "Family, not scored", exact: true }).press("Enter");
    await expect(main.getByText("Tap a slice again to change it.")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("scored.png"), fullPage: true });

    // Save posts at once and shows the saved snapshot.
    await save.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(snapshotPosts).toHaveLength(1);
    expect((snapshotPosts[0].segments as Array<{ value: number }>).map(segment => segment.value)).toEqual([7, 6, 8, 3, 10, 5, 5]);
    const savedView = page.locator(".life-wheel-saved");
    await expect(savedView).toContainText("Average 6.3");
    await expect(savedView).toContainText("up 0.6 since");
    const row = (name: string) => savedView.locator(".life-wheel-saved__rows").getByRole("button", { name: new RegExp(`^${name},`) });
    await expect(row("Health")).toContainText("+1");
    await expect(row("Finances")).toContainText("−1");
    await expect(row("Work")).toContainText("Same");
    await expect(row("Family")).toContainText("New");
    await expect(savedView).toContainText("Only you can see this. It stays on your ME3.");
    await expect(savedView.locator(".life-wheel-chart__previous")).toHaveCount(1);
    if (!mobile) {
      const wheelBox = await savedView.locator(".life-wheel-chart").boundingBox();
      const listBox = await savedView.locator(".life-wheel-saved__rows").boundingBox();
      expect(listBox!.x).toBeGreaterThan(wheelBox!.x + wheelBox!.width - 1);
    }

    await row("Work").click();
    const note = savedView.getByRole("textbox", { name: "Note on Work", exact: true });
    await expect(note).toBeFocused();
    await note.fill("Busy month");
    await note.press("Tab");
    await expect.poll(() => notePatches.at(-1)).toEqual({ path: "/journal/wheel/snapshots/saved", body: { notes: { work: "Busy month" } } });
    await page.screenshot({ path: testInfo.outputPath("saved.png"), fullPage: true });

    await savedView.getByRole("button", { name: "Done", exact: true }).click();
    await expect(save).toBeVisible();
    await expect(main.getByText("Tap a slice again to change it.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  });
}
