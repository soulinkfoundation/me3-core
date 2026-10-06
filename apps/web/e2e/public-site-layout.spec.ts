import { test, expect } from "@playwright/test";
import { generateSiteHtml, type Me3SiteProfile } from "../../../packages/site-renderer/src/index";

// UI tests: the booking API and media are simulated; no real bookings are made.
const profile: Me3SiteProfile = {
  name: "Example Owner", handle: "example",
  buttons: [{ text: "Website offer · €220", url: "/offers" }],
  pages: [{ slug: "about", file: "about.md", title: "About" }],
  posts: [
    { slug: "with-image", title: "With image", file: "image.md", publishedAt: "2026-07-29" },
    { slug: "without-image", title: "Without image", file: "plain.md", publishedAt: "2026-07-23" },
  ],
  extensions: { "me3.app/site": { layout: "card", theme: "tech", colorMode: "auto", sections: [
    { id: "offers", visible: true }, { id: "booking", visible: true },
  ] } },
  intents: { book: { enabled: true, title: "Bookings", availability: {
    timezone: "Europe/Dublin", windows: Object.fromEntries(["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map(day => [day, ["09:00-17:00"]])),
  }, offers: [
    { id: "website", title: "Website setup", duration: 60 },
    { id: "clarity", title: "Clarity call", duration: 30 },
  ] } },
};
const content = [
  { name: "about.md", content: "About the owner" },
  { name: "image.md", content: '![Cover](/files/cover.svg)\n\nA post with an image.' },
  { name: "plain.md", content: "A post without an image." },
];

async function serve(page: import("@playwright/test").Page, source = profile) {
  const files = await generateSiteHtml(source, content);
  await page.route("https://site.test/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith("/api/")) return route.fulfill({ json: { slots: [{ localTime: "10:00" }] } });
    if (path.startsWith("/files/")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#3f6b35"/></svg>' });
    const file = path.endsWith("/") ? `${path.slice(1)}index.html` : `${path.slice(1)}.html`;
    return route.fulfill({ contentType: "text/html", body: files[file] || files["index.html"] });
  });
  await page.route("https://fonts.googleapis.com/**", route => route.abort());
}

test("shared links select the offer, reveal inline booking, and scroll below the header", async ({ page }) => {
  const inline = structuredClone(profile);
  inline.extensions!["me3.app/site"]!.sections = [{ id: "offers", visible: true }];
  await serve(page, inline);
  await page.goto("https://site.test/?offer=clarity&bookingType=one_to_one#booking");
  await expect(page.getByRole("button", { name: "Clarity call 30 min" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#booking")).toBeVisible();
  expect(await page.locator("#booking").evaluate(el => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(60);
  expect(await page.locator("#booking").evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(150);
  await page.reload();
  await expect(page.getByRole("button", { name: "Clarity call 30 min" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.locator("#booking").evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(150);
});

for (const width of [375, 499, 776, 1022]) {
  for (const mode of ["light", "dark"] as const) {
    test(`calendar stays within ${width}px in ${mode} mode`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 847 });
      await page.emulateMedia({ colorScheme: mode });
      await serve(page);
      await page.goto("https://site.test/?offer=clarity#booking");
      await expect(page.locator(".booking-day")).toHaveCount(14);
      await expect(page.locator('[data-offer-id="clarity"]')).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator('[data-offer-id="clarity"]')).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const strip = page.locator(".booking-day-strip");
      expect(await strip.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
      await strip.press("Tab");
      await page.screenshot({ path: info.outputPath(`calendar-${width}-${mode}.png`) });
    });
  }
}

test("content action text contrasts with its background and blog rows have optional thumbnails", async ({ page }) => {
  await serve(page);
  await page.goto("https://site.test/about");
  const colors = await page.locator(".site-end-action__button").evaluate(el => {
    const style = getComputedStyle(el);
    return { color: style.color, background: style.backgroundColor };
  });
  expect(colors.color).not.toBe(colors.background);
  await page.goto("https://site.test/blog/");
  const withImage = page.locator(".blog-item").filter({ hasText: "With image" });
  await expect(withImage.locator("img")).toHaveAttribute("src", "../files/cover.svg");
  await expect(withImage.locator("img")).toHaveCSS("height", "90px");
  await expect(page.locator(".blog-item").filter({ hasText: "Without image" }).locator("img")).toHaveCount(0);
  expect(await page.locator(".blog-item-date").first().evaluate(el => el.getBoundingClientRect().left - el.closest("a")!.getBoundingClientRect().left)).toBeGreaterThan(0);
});

test("dropdown links select the offer and allow continuing with an available time", async ({ page }) => {
  const dropdown = structuredClone(profile);
  dropdown.intents!.book!.offerDisplayMode = "dropdown";
  await serve(page, dropdown);
  await page.goto("https://site.test/?offer=clarity#booking");
  await expect(page.getByRole("combobox", { name: "Choose an offer" })).toHaveValue("clarity");
  await page.getByRole("button", { name: "10:00", exact: false }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Your name" })).toBeVisible();
});

for (const mode of ["light", "dark"] as const) {
  test(`mobile dock follows booking selection and details in ${mode} mode`, async ({ page }, info) => {
    await page.setViewportSize({ width: 375, height: 847 });
    await page.emulateMedia({ colorScheme: mode });
    await serve(page);
    await page.goto("https://site.test/?offer=clarity#booking");
    const dock = page.locator(".site-action-dock");
    const promo = dock.getByRole("link", { name: "Website offer · €220" });
    const next = dock.getByRole("button", { name: "Continue", exact: true });
    const time = page.getByRole("button", { name: "10:00", exact: false });
    await expect(promo).toBeVisible();
    await expect(next).toBeHidden();
    await time.click();
    await expect(promo).toBeHidden();
    await expect(next).toBeVisible();
    await expect(page.locator("[data-booking-continue]")).toBeHidden();
    await page.screenshot({ path: info.outputPath(`booking-continue-${mode}.png`) });
    await next.press("Enter");
    await expect(page.getByRole("textbox", { name: "Your name" })).toBeFocused();
    await expect(page.getByRole("group", { name: "Available times" })).toBeHidden();
    await expect(dock).toBeHidden();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(promo).toBeVisible();
    await expect(next).toBeHidden();
    await time.click();
    await page.locator('[data-offer-id="website"]').click();
    await expect(promo).toBeVisible();
    await expect(next).toBeHidden();
    await time.click();
    await page.locator(".booking-day:not(.active):not(:disabled)").first().click();
    await expect(promo).toBeVisible();
    await expect(next).toBeHidden();
    await time.click();
    await next.click();
    await page.getByRole("textbox", { name: "Your name" }).fill("UI Test Guest");
    await page.getByRole("textbox", { name: "Your email" }).fill("guest@example.test");
    await page.getByRole("button", { name: "Confirm Booking", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Your booking is confirmed.");
    await expect(promo).toBeVisible();
    await expect(next).toBeHidden();
  });
}

test("desktop keeps its inline Continue action", async ({ page }) => {
  await page.setViewportSize({ width: 1022, height: 847 });
  await serve(page);
  await page.goto("https://site.test/?offer=clarity#booking");
  await page.getByRole("button", { name: "10:00", exact: false }).click();
  await expect(page.locator(".site-action-dock")).toBeHidden();
  await expect(page.locator("[data-booking-continue]")).toBeVisible();
});

test("booking type links activate the matching panel and invalid offers keep the default", async ({ page }) => {
  await page.setViewportSize({ width: 499, height: 847 });
  const multiple = structuredClone(profile);
  multiple.intents!.book!.bookingTypes = [
    { type: "one_to_one", offers: profile.intents!.book!.offers, availability: profile.intents!.book!.availability },
    { type: "class", classes: [{ id: "class-one", title: "Weekly class", duration: 60, recurrence: { weekday: "monday", startTime: "10:00" } }] },
  ];
  await serve(page, multiple);
  await page.goto("https://site.test/?offer=class-one&bookingType=class#booking");
  await expect(page.getByRole("tab", { name: "Classes", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-offer-id="class-one"]')).toBeVisible();
  await page.goto("https://site.test/?offer=unknown#booking");
  await expect(page.locator('[data-offer-id="website"]')).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "10:00", exact: false }).click();
  const next = page.locator("[data-booking-dock-continue]");
  await expect(next).toBeVisible();
  await page.getByRole("tab", { name: "Classes", exact: true }).click();
  await expect(next).toBeHidden();
  await expect(page.locator(".site-action-dock a")).toBeVisible();
  await page.getByRole("tab", { name: "1:1", exact: true }).click();
  await expect(next).toBeVisible();
});
