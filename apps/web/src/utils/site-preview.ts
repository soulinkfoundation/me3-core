type SitePreviewPaths = {
  blog: string;
  shop: string;
};

export function sitePreviewFileForView(
  view: string | undefined,
  options: {
    paths: SitePreviewPaths;
  },
): string {
  if (!view || view === "home") return "index.html";

  const [section, item] = view.split(":", 2);
  if (item) return `${section}/${item}.html`;
  if (section === options.paths.blog || section === options.paths.shop) {
    return `${section}/index.html`;
  }

  return `${section}.html`;
}
