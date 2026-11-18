/**
 * Theme lab: renders one profile through the real site renderer in every theme,
 * layout and colour mode, with and without the proposed polish, and writes a
 * viewer page that shows each one at desktop and phone width side by side.
 *
 *   pnpm --filter @me3-core/site-renderer lab -- --site https://kieran.me3.app
 *   pnpm --filter @me3-core/site-renderer lab            # built-in sample profile
 *   ... lab -- --site https://kieran.me3.app --products  # add lab/sample-products.json (or --products path.json)
 *
 * Output goes to packages/site-renderer/.theme-lab/ (gitignored). Serve that
 * folder with any static server and open index.html.
 */
import { mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSiteHtml, siteThemes, type Me3SiteProfile, type SiteThemeId } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", ".theme-lab");

const LAYOUTS = ["card", "split", "cover", "minimal"] as const;
const MODES = ["light", "dark"] as const;
const POLISH = ["current", "proposed"] as const;
type Layout = (typeof LAYOUTS)[number];

type PublicMe = {
  name?: string; handle?: string; bio?: string; avatar?: string; banner?: string; location?: string;
  links?: Array<{ rel: string; href: string; label?: string }>;
  pages?: Array<{ id: string; title: string }>;
  posts?: Array<{ id: string; title: string; type?: string; publishedAt?: string; excerpt?: string }>;
  services?: Array<{ id?: string; title?: string; description?: string; durationMinutes?: number }>;
  actions?: { subscribe?: { description?: string } };
};

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Turn a site's public me.json back into the renderer's authoring shape, with absolute media URLs. */
async function profileFromSite(site: string): Promise<{ profile: Me3SiteProfile; ownTheme?: string; ownLayout?: string }> {
  const origin = site.replace(/\/+$/, "");
  const [meResponse, homeResponse] = await Promise.all([fetch(`${origin}/me.json`), fetch(`${origin}/`)]);
  if (!meResponse.ok) throw new Error(`Could not read ${origin}/me.json (${meResponse.status})`);
  const me = (await meResponse.json()) as PublicMe;
  const home = homeResponse.ok ? await homeResponse.text() : "";
  const absolute = (path?: string) => (path ? new URL(path, `${origin}/`).toString() : undefined);
  const links: Record<string, string> = {};
  const buttons: NonNullable<Me3SiteProfile["buttons"]> = [];
  for (const link of me.links || []) {
    if (link.rel === "cta") buttons.push({ text: link.label || "Visit", url: link.href });
    else links[link.rel] = link.href;
  }
  // me.json has no post images; the renderer uses each post's first content image, so read it from the post page.
  const thumbnails = await Promise.all((me.posts || []).map(async (post) => {
    const url = (post as { url?: string }).url;
    if (!url) return undefined;
    const response = await fetch(new URL(url, `${origin}/`)).catch(() => null);
    const html = response?.ok ? await response.text() : "";
    const content = html.slice(Math.max(0, html.search(/<(main|article)\b/i)));
    const src = [...content.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map((match) => match[1])
      .find((value) => value && !/logo|avatar/i.test(value));
    return src ? new URL(src.replace(/&amp;/g, "&"), new URL(url, `${origin}/`)).toString() : undefined;
  }));
  const offers = (me.services || []).map((service, index) => ({
    id: service.id || `offer-${index}`,
    title: service.title,
    description: service.description,
    duration: service.durationMinutes,
    meetingProvider: "soulink" as const,
  }));
  return {
    ownTheme: home.match(/data-vibe="([^"]+)"/)?.[1],
    ownLayout: home.match(/data-layout="([^"]+)"/)?.[1],
    profile: {
      name: me.name, handle: me.handle, bio: me.bio, location: me.location,
      avatar: absolute(me.avatar), banner: absolute(me.banner),
      links, buttons,
      pages: (me.pages || []).map((page) => ({ slug: page.id, title: page.title })),
      posts: (me.posts || []).map((post, index) => ({
        slug: post.id, title: post.title, type: post.type, publishedAt: post.publishedAt, excerpt: post.excerpt,
        media: thumbnails[index] ? { thumbnail: thumbnails[index] } : undefined,
      })),
      blogEnabled: Boolean(me.posts?.length),
      intents: {
        book: offers.length ? { enabled: true, offers } : undefined,
        subscribe: me.actions?.subscribe ? { enabled: true, title: "Newsletter", description: me.actions.subscribe.description } : undefined,
      },
    },
  };
}

const SAMPLE: Me3SiteProfile = {
  name: "Alex Rivera",
  handle: "alex",
  bio: "Breathwork coach and writer. Helping busy people find a calmer pace.",
  location: "Lisbon, Portugal",
  links: { instagram: "https://instagram.com/example", youtube: "https://youtube.com/@example", email: "mailto:hello@example.com" },
  buttons: [{ text: "Book a free call", url: "https://example.com/book" }, { text: "Read the guide", url: "https://example.com/guide" }],
  pages: [{ slug: "about", title: "About" }, { slug: "work-with-me", title: "Work with me" }],
  posts: [
    { slug: "slow-mornings", title: "The case for slow mornings", publishedAt: "2026-10-02T09:00:00.000Z", excerpt: "Ten quiet minutes changed my week." },
    { slug: "breath", title: "Three breaths before every meeting", publishedAt: "2026-09-12T09:00:00.000Z", excerpt: "A tiny habit that travels well." },
  ],
  blogEnabled: true,
  intents: {
    book: { enabled: true, offers: [{ id: "intro", title: "Intro call", description: "A relaxed first conversation.", duration: 30, meetingProvider: "soulink" }] },
    subscribe: { enabled: true, title: "Newsletter", description: "One calm email a month." },
  },
};

type ProductFixture = {
  shopTitle?: string;
  photos?: Record<string, string>;
  products: Array<NonNullable<Me3SiteProfile["products"]>[number] & { description?: string }>;
};

/** --products [path]: merge a products fixture (default lab/sample-products.json) and fetch its photos once. */
async function loadProducts(): Promise<{ products: Me3SiteProfile["products"]; shopTitle?: string; files: Array<{ name: string; content: string }> } | null> {
  const index = process.argv.indexOf("--products");
  if (index < 0) return null;
  const value = process.argv[index + 1];
  const path = value && !value.startsWith("--") ? value : join(here, "sample-products.json");
  const fixture = JSON.parse(await readFile(path, "utf8")) as ProductFixture;
  for (const [file, url] of Object.entries(fixture.photos || {})) {
    const target = join(outDir, file);
    if (await stat(target).then(() => true, () => false)) continue;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not fetch ${url} (${response.status})`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
  }
  const files = fixture.products.filter((product) => product.description)
    .map((product) => ({ name: `products/${product.slug}.md`, content: product.description! }));
  const products = fixture.products.map(({ description, ...product }) => ({ ...product, file: description ? `products/${product.slug}.md` : undefined }));
  return { products, shopTitle: fixture.shopTitle, files };
}

async function main() {
  const site = argValue("site");
  const source = site ? await profileFromSite(site) : { profile: SAMPLE };
  const shop = await loadProducts();
  if (shop) Object.assign(source.profile, { products: shop.products, shopTitle: shop.shopTitle });
  const proposedCss = await readFile(join(here, "proposed.css"), "utf8");
  const proposedHead = `<style data-theme-lab="proposed">${proposedCss}</style>`;

  // Keep downloaded photos in files/ between runs; everything else is regenerated.
  await rm(join(outDir, "pages"), { recursive: true, force: true });
  await mkdir(join(outDir, "files"), { recursive: true });
  const themes = Object.keys(siteThemes) as SiteThemeId[];
  const shopPath = "shop";
  const pages = [
    { id: "home", label: "Home", path: "index.html" },
    ...(shop ? [
      { id: "shop", label: "Shop", path: `${shopPath}/index.html` },
      ...(shop.products || []).map((product) => ({ id: product.slug!, label: product.title || product.slug!, path: `${shopPath}/${product.slug}.html` })),
    ] : []),
  ];
  let count = 0;
  for (const theme of themes) {
    for (const layout of LAYOUTS) {
      for (const mode of MODES) {
        const profile: Me3SiteProfile = {
          ...source.profile,
          extensions: { "me3.app/site": {
            theme, layout, colorMode: mode, visitorThemeToggle: true,
            sections: [
              { id: "offers", visible: true }, { id: "booking", visible: false }, { id: "writing", visible: true },
              { id: "testimonials", visible: true }, { id: "newsletter", visible: true },
            ],
          } },
        };
        const output = await generateSiteHtml(profile, shop?.files || [], undefined, { baseUrl: site || "https://example.com" });
        for (const polish of POLISH) {
          const dir = join(outDir, "pages", polish, `${theme}-${layout}-${mode}`);
          await mkdir(dir, { recursive: true });
          await symlink("../../../files", join(dir, "files"));
          for (const page of pages) {
            const html = output[page.path];
            if (!html) throw new Error(`Renderer returned no ${page.path}`);
            const file = join(dir, page.path);
            await mkdir(dirname(file), { recursive: true });
            await writeFile(file, polish === "proposed" ? html.replace("</head>", `${proposedHead}</head>`) : html);
            count++;
          }
        }
      }
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    source: site || "sample profile",
    name: source.profile.name,
    ownTheme: source.ownTheme,
    ownLayout: source.ownLayout,
    themes: themes.map((id) => ({ id, name: siteThemes[id].name, description: siteThemes[id].description })),
    layouts: LAYOUTS as readonly Layout[],
    modes: MODES,
    polish: POLISH,
    pages,
  };
  const viewer = await readFile(join(here, "viewer.html"), "utf8");
  await writeFile(join(outDir, "index.html"), viewer.replace("/*MANIFEST*/null", JSON.stringify(manifest)));
  console.log(`Theme lab: ${count} pages for ${manifest.name || "profile"} in ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
