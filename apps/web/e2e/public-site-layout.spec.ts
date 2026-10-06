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

test("booking type links activate the matching panel and invalid offers keep the default", async ({ page }) => {
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
});
