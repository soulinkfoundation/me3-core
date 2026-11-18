/**
 * Theme lab: renders one profile through the real site renderer in every theme,
 * layout and colour mode, with and without the proposed polish, and writes a
 * viewer page that shows each one at desktop and phone width side by side.
 *
 *   pnpm --filter @me3-core/site-renderer lab -- --site https://kieran.me3.app
 *   pnpm --filter @me3-core/site-renderer lab            # built-in sample profile
 *
 * Output goes to packages/site-renderer/.theme-lab/ (gitignored). Serve that
 * folder with any static server and open index.html.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
      posts: (me.posts || []).map((post) => ({ slug: post.id, title: post.title, type: post.type, publishedAt: post.publishedAt, excerpt: post.excerpt })),
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

async function main() {
  const site = argValue("site");
  const source = site ? await profileFromSite(site) : { profile: SAMPLE };
  const proposedCss = await readFile(join(here, "proposed.css"), "utf8");
  const proposedHead = `<style data-theme-lab="proposed">${proposedCss}</style><script>(function(){function s(){document.body.classList.toggle("is-scrolled",scrollY>24)}addEventListener("scroll",s,{passive:true});addEventListener("DOMContentLoaded",function(){s();var links=document.querySelector(".site-cover-links .links"),intro=document.querySelector(".site-hero--cover .site-hero__intro");if(links&&intro){intro.append(links);document.querySelector(".site-cover-links").remove()}})})();</script>`;

  await rm(outDir, { recursive: true, force: true });
  const themes = Object.keys(siteThemes) as SiteThemeId[];
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
        const html = (await generateSiteHtml(profile, [], undefined, { baseUrl: site || "https://example.com" }))["index.html"];
        if (!html) throw new Error("Renderer returned no index.html");
        for (const polish of POLISH) {
          const page = polish === "proposed" ? html.replace("</head>", `${proposedHead}</head>`) : html;
          const file = join(outDir, "pages", polish, `${theme}-${layout}-${mode}.html`);
          await mkdir(dirname(file), { recursive: true });
          await writeFile(file, page);
          count++;
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
  };
  const viewer = await readFile(join(here, "viewer.html"), "utf8");
  await writeFile(join(outDir, "index.html"), viewer.replace("/*MANIFEST*/null", JSON.stringify(manifest)));
  console.log(`Theme lab: ${count} pages for ${manifest.name || "profile"} in ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
