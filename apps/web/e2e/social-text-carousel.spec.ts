import { test, expect } from "./fixtures/test";
import { account, capabilities, post, version } from "../src/utils/social-posts.fixtures";

// UI test: Social APIs and Files are simulated. The Worker tests cover template and slide storage.
const TEMPLATE_SETTINGS = {
  background: "site-light", photoFileId: null, dim: 45, accent: "site", font: "site", weight: "regular",
  position: "middle", align: "left", rule: true, cornerLeft: "@kieran", cornerRight: "", logo: true,
};

for (const mobile of [false, true]) {
  test(`text slides on ${mobile ? "phone" : "desktop"}`, async ({ page }, testInfo) => {
    await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const detail = post([version({ id: "ig-1", platform: "instagram", bodyText: "I write before I scroll." })]);
    let manifest: unknown[] = [];
    let saved: { templateId: string; slides: Array<{ main: string; small: string }>; fileIds: string[] } | null = null;
    const templates = [
      { id: "t1", siteId: "site-1", name: "My site", settings: { ...TEMPLATE_SETTINGS }, createdAt: "", updatedAt: "" },
      { id: "t2", siteId: "site-1", name: "My site, dark", settings: { ...TEMPLATE_SETTINGS, background: "site-dark", position: "bottom" }, createdAt: "", updatedAt: "" },
    ];
    const uploads: Array<{ size: number; width: number; height: number }> = [];
    let fileCount = 0;

    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace(/^\/api/, "");
      const method = request.method();
      if (path === "/files/upload" || (path === "/files" && method === "POST")) {
        const body = request.postDataBuffer();
        // JPEG SOF0 carries height then width.
        const sof = body ? body.indexOf(Buffer.from([0xff, 0xc0])) : -1;
        uploads.push({ size: body?.length || 0, height: sof > 0 ? body!.readUInt16BE(sof + 5) : 0, width: sof > 0 ? body!.readUInt16BE(sof + 7) : 0 });
        fileCount += 1;
        const file = { id: `file-${fileCount}`, folderId: null, filename: `Text slide ${fileCount}.jpg`, mimeType: "image/jpeg", size: body?.length || 0, status: "ready" };
        return route.fulfill({ status: 200, json: { file, files: [file] } });
      }
      let data: unknown = {};
      if (path === "/auth/me") data = { ok: true, user: { id: "slides-ui", username: "kieran", name: "Kieran", timezone: "Europe/Dublin" }, workspace: { hasProfileSite: true } };
      else if (path === "/plugins") data = { plugins: [{ id: "me3.social-publishing", status: "installed", enabled: true }] };
      else if (path === "/social/status") data = { access: "included", plugin: { status: "installed", enabled: true, ready: true, statusLabel: "Installed", platformCapabilities: capabilities }, hostedOAuth: { configured: true, platforms: ["instagram"] } };
      else if (path === "/social/accounts") data = { accounts: [account("instagram")] };
      else if (path === "/social/posts/post-1") data = { post: { ...detail, versions: [{ ...detail.versions[0]!, assetManifest: manifest }] } };
      else if (path === "/social/posts") data = { posts: [] };
      else if (path === "/sites") data = { sites: [{ id: "site-1", username: "kieran", site_role: "profile" }] };
      else if (path === "/sites/kieran/content") data = { ok: true, profile: { name: "Kieran", extensions: { "me3.app/site": { theme: "paper" } } }, pages: [], posts: [] };
      else if (path === "/social/carousel-templates" && method === "GET") data = { templates };
      else if (path.startsWith("/social/carousel-templates/") && method === "PATCH") {
        const template = templates.find((item) => path.endsWith(item.id))!;
        Object.assign(template, request.postDataJSON());
        data = { template };
      } else if (path === "/social/posts/post-1/text-carousel" && method === "GET") data = { carousel: saved };
      else if (path === "/social/posts/post-1/text-carousel" && method === "PUT") {
        saved = request.postDataJSON();
        data = { carousel: { postId: "post-1", updatedAt: "now", ...saved } };
      } else if (path === "/social/versions/ig-1" && method === "PATCH") {
        manifest = request.postDataJSON().assetManifest ?? manifest;
        data = { version: { ...detail.versions[0]!, assetManifest: manifest } };
      }
      await route.fulfill({ status: 200, json: data });
    });

    await page.goto("/social/post-1");
    // The composer names the platform in the URL once it loads.
    await expect(page).toHaveURL(/platform=instagram/);
    await page.getByRole("button", { name: "Make text slides" }).click();
    const editor = page.getByRole("dialog", { name: "Text slides" });
    await expect(editor.getByText("Uses your site's look: Paper theme")).toBeVisible();

    await editor.getByRole("textbox", { name: "Main text, slide 1" }).fill("Write before you scroll.");
    await editor.getByRole("button", { name: "+ Add slide" }).click();
    await editor.getByRole("textbox", { name: "Main text, slide 2" }).fill("I wasn't writing, I was replying.");
    await editor.getByRole("textbox", { name: "Small text, slide 2" }).fill("By the time I sat down to write, my head was full of other people's opinions.");
    await editor.getByRole("button", { name: "+ Add slide" }).click();
    await editor.getByRole("textbox", { name: "Main text, slide 3" }).fill("Read the full piece");
    await editor.getByLabel("Swap colours").last().check();
    await editor.getByRole("button", { name: "Bold" }).click();
    await expect.poll(() => templates[0]!.settings.weight).toBe("bold");

    // Drag slide 3 above slide 2 by its card, then delete it.
    const cards = editor.locator(".slide-card");
    await cards.nth(2).scrollIntoViewIfNeeded();
    const from = await cards.nth(2).boundingBox();
    const to = await cards.nth(1).boundingBox();
    await page.mouse.move(from!.x + 40, from!.y + 40);
    await page.mouse.down();
    await page.mouse.move(to!.x + 60, to!.y + 10, { steps: 8 });
    await page.mouse.up();
    await expect(editor.getByRole("textbox", { name: "Main text, slide 2" })).toHaveValue("Read the full piece");
    await editor.getByRole("button", { name: "Delete slide 2" }).click();
    await expect(editor.locator(".slide-card")).toHaveCount(2);

    if (mobile) {
      await page.getByRole("tab", { name: "Preview" }).click();
      await expect(editor.locator(".ig-counter")).toHaveText("2/2");
    }
    await page.screenshot({ path: testInfo.outputPath("editor.png") });
    if (mobile) await page.getByRole("tab", { name: "Edit" }).click();

    await editor.getByRole("button", { name: "Add to post" }).click();
    await expect(editor).toBeHidden();
    expect(uploads).toHaveLength(2);
    for (const upload of uploads) expect(upload).toMatchObject({ width: 1080, height: 1350 });
    expect(saved).toMatchObject({ templateId: "t1", fileIds: ["file-1", "file-2"] });
    expect(saved!.slides.map((slide) => slide.main)).toEqual(["Write before you scroll.", "I wasn't writing, I was replying."]);
    await expect.poll(() => manifest.length).toBe(2);

    // Edit slides reopens the same text and replaces the JPEGs in place.
    await page.getByRole("button", { name: "Edit slides" }).click();
    await expect(editor.getByRole("textbox", { name: "Main text, slide 2" })).toHaveValue("I wasn't writing, I was replying.");
    await editor.getByRole("button", { name: "Add to post" }).click();
    await expect(editor).toBeHidden();
    await expect.poll(() => (manifest as Array<{ fileId: string }>).map((asset) => asset.fileId)).toEqual(["file-3", "file-4"]);
    await page.screenshot({ path: testInfo.outputPath("composer.png") });
  });
}
