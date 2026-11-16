import { test, expect } from "./fixtures/test";

// UI test: the Files API is simulated. Covers image thumbnails, the grid view and
// stepping back out of a folder.
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
const folders = [
  folder("f1", "Generated Images", null, "Generated Images"),
  folder("f2", "Drafts", "f1", "Generated Images/Drafts"),
];
const files = [
  file("a", "cover.png", null, "image/png", "image"),
  file("b", "talk.mp4", null, "video/mp4", "download"),
  file("c", "guide.pdf", null, "application/pdf", "pdf"),
  file("d", "generated-1.png", "f1", "image/png", "image"),
  file("e", "sketch.png", "f2", "image/png", "image"),
];

for (const mobile of [false, true]) {
  test(`Files browser on ${mobile ? "phone" : "desktop"}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace(/^\/api/, "");
      if (/^\/files\/[^/]+\/content$/.test(path)) {
        return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
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
  });
}
