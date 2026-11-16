import { test, expect } from "./fixtures/test";

// UI test: the Files API is simulated. Covers image thumbnails, the grid view,
// stepping back out of a folder, selecting several items and dragging onto a folder.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const stamp = "2026-11-11T16:08:00Z";
const folder = (id: string, name: string, parentId: string | null, path: string) => ({
  id, ownerId: "o", parentId, name, path, status: "active", createdAt: stamp, updatedAt: stamp,
});
const file = (id: string, filename: string, folderId: string | null, mimeType: string, previewKind: string) => ({
  id, ownerId: "o", folderId, filename, mimeType, size: 309300, etag: null, sha256: null,
  status: "ready", previewKind, metadata: {}, createdAt: stamp, updatedAt: stamp,
});
const seed = () => ({
  folders: [
    folder("f1", "Generated Images", null, "Generated Images"),
    folder("f2", "Drafts", "f1", "Generated Images/Drafts"),
  ],
  files: [
    file("a", "cover.png", null, "image/png", "image"),
    file("b", "talk.mp4", null, "video/mp4", "download"),
    file("c", "guide.pdf", null, "application/pdf", "pdf"),
    file("d", "generated-1.png", "f1", "image/png", "image"),
    file("e", "sketch.png", "f2", "image/png", "image"),
  ],
});

for (const mobile of [false, true]) {
  test(`Files browser on ${mobile ? "phone" : "desktop"}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    let { folders, files } = seed();
    const thumbnailRequests: string[] = [];
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace(/^\/api/, "");
      const method = route.request().method();
      if (/^\/files\/[^/]+\/(content|thumbnail)$/.test(path)) {
        if (path.endsWith("/thumbnail")) thumbnailRequests.push(path);
        return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
      }
      const target = /^\/files\/(folders\/)?([^/]+)$/.exec(path);
      if (target && target[2] !== "folders" && target[2] !== "status" && target[2] !== "items" && method !== "GET") {
        const id = target[2];
        if (method === "DELETE") {
          files = files.filter(item => item.id !== id);
          folders = folders.filter(item => item.id !== id);
        } else {
          const body = route.request().postDataJSON();
          const movedFile = files.find(item => item.id === id);
          if (movedFile && "folderId" in body) movedFile.folderId = body.folderId;
          const movedFolder = folders.find(item => item.id === id);
          if (movedFolder && "parentId" in body) movedFolder.parentId = body.parentId;
        }
        return route.fulfill({ status: 200, json: { ok: true } });
      }
      const responses: Record<string, unknown> = {
        "/auth/me": { ok: true, user: { id: "files-ui", username: "synthetic", name: "Synthetic Owner", timezone: "Europe/Dublin" }, workspace: { hasProfileSite: true } },
        "/sites": { sites: [] }, "/config": {}, "/plugins": { plugins: [] },
        "/navigation-features": { features: ["assistant", "files"].map(id => ({ id, visible: true })) },
        "/files/status": { ok: true, r2Available: true, binding: "SITE_ASSETS" },
        "/files/folders": { ok: true, folders },
      };
      let data = responses[path] ?? {};
      if (path === "/files/items") {
        const folderId = url.searchParams.get("folderId");
        data = {
          ok: true, folderId, q: "",
          folders: folders.filter(item => item.parentId === folderId),
          files: files.filter(item => item.folderId === folderId),
        };
      }
      const preview = /^\/files\/([^/]+)\/preview$/.exec(path);
      if (preview) {
        const match = files.find(item => item.id === preview[1])!;
        data = { ok: true, file: match, previewKind: match.previewKind, truncated: false };
      }
      await route.fulfill({ status: 200, json: data });
    });

    await page.goto("/files");
    const rows = page.locator(".files-row");
    await expect(rows).toHaveCount(4);
    await expect(rows.filter({ hasText: "cover.png" }).locator(".files-thumb img")).toBeVisible();
    await expect(rows.filter({ hasText: "guide.pdf" }).locator(".files-thumb img")).toHaveCount(0);
    if (!mobile) await expect(rows.filter({ hasText: "talk.mp4" })).toContainText("Video");
    await page.screenshot({ path: testInfo.outputPath("root-list.png") });

    // One click or tap opens a folder; the path and Back button lead out again.
    await rows.filter({ hasText: "Generated Images" }).click();
    await expect(page).toHaveURL(/folder=f1/);
    await expect(rows).toHaveCount(2);
    await rows.filter({ hasText: "Drafts" }).click();
    const path = page.getByRole("navigation", { name: "Folder path" });
    await expect(path.locator("[aria-current=page]")).toHaveText("Drafts");
    await page.screenshot({ path: testInfo.outputPath("nested-folder.png") });
    await page.getByRole("button", { name: "Back to Generated Images" }).click();
    await expect(path.locator("[aria-current=page]")).toHaveText("Generated Images");
    await page.getByRole("button", { name: "Back to Files" }).click();
    await expect(rows).toHaveCount(4);
    await expect(page.getByRole("button", { name: /^Back to/ })).toHaveCount(0);

    // Browser Back returns to the folder; the path jumps straight to the top.
    await page.goBack();
    await expect(path.locator("[aria-current=page]")).toHaveText("Generated Images");
    await path.getByRole("button", { name: "Files" }).click();
    await expect(rows).toHaveCount(4);

    await page.getByRole("button", { name: "Grid view" }).click();
    await expect(page.locator(".files-list--grid")).toBeVisible();
    await expect(rows.filter({ hasText: "cover.png" }).locator(".files-thumb img")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("root-grid.png") });
    await page.reload();
    await expect(page.locator(".files-list--grid")).toBeVisible();

    await rows.filter({ hasText: "cover.png" }).click();
    await expect(page.locator(".files-image-preview")).toBeVisible();
    // Thumbnails come from the small-image endpoint, never the original.
    expect(thumbnailRequests).toContain("/files/a/thumbnail");
    if (mobile) await page.getByRole("button", { name: "Back to files" }).click();

    // Tick two files, then move them with the selection bar.
    await page.getByRole("button", { name: "List view" }).click();
    await page.getByRole("checkbox", { name: "Select cover.png" }).check();
    await rows.filter({ hasText: "guide.pdf" }).click();
    await expect(page.getByText("2 selected")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("selection.png") });
    await page.getByRole("button", { name: "Move", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Move 2 items");
    await dialog.getByRole("combobox").selectOption("f1");
    await dialog.getByRole("button", { name: "Move", exact: true }).click();
    await expect(rows).toHaveCount(2);
    await expect(page.getByText("2 selected")).toHaveCount(0);

    // Select all, then delete what is left in view.
    await rows.filter({ hasText: "Generated Images" }).click();
    await expect(rows).toHaveCount(4);
    await page.getByRole("checkbox", { name: "Select cover.png" }).check();
    await page.getByRole("button", { name: "Select all" }).click();
    await expect(page.getByText("4 selected")).toBeVisible();
    await page.getByRole("button", { name: "Clear selection" }).click();
    await page.getByRole("checkbox", { name: "Select guide.pdf" }).check();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(rows).toHaveCount(3);

    // Drag a file onto a folder row, then back out onto the path's top crumb.
    if (!mobile) {
      await rows.filter({ hasText: "cover.png" }).dragTo(rows.filter({ hasText: "Drafts" }));
      await expect(rows).toHaveCount(2);
      await rows.filter({ hasText: "Drafts" }).click();
      await expect(rows.filter({ hasText: "cover.png" })).toBeVisible();
      await rows.filter({ hasText: "cover.png" }).dragTo(path.getByRole("button", { name: "Files" }));
      await expect(rows.filter({ hasText: "cover.png" })).toHaveCount(0);
      await path.getByRole("button", { name: "Files" }).click();
      await expect(rows.filter({ hasText: "cover.png" })).toBeVisible();
    }
  });
}
