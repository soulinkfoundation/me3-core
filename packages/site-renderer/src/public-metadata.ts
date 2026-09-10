/** Public-site metadata shared by profile and business renderers. */
export function escapeMetadata(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function publicSiteUrl(base: string | undefined, path = ""): string | undefined {
  if (!base) return undefined;
  try {
    const url = new URL(base);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return undefined;
    url.search = ''; url.hash = '';
    url.pathname = url.pathname.replace(/\/?$/, '/');
    const target = new URL(path.replace(/^\.\//, ''), url);
    return ['http:', 'https:'].includes(target.protocol) && !target.username && !target.password ? target.href : undefined;
  } catch { return undefined; }
}

export function jsonLd(data: unknown): string {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

export function discoveryLinks(profileUrl: string): string {
  return `<link rel="alternate" type="application/json" title="ME3 public profile" href="${escapeMetadata(profileUrl)}">`;
}

export function socialMetadata(options: { title: string; description: string; canonicalUrl?: string; image?: string; type?: string }): string {
  const tag = (key: string, value: string) => `<meta property="${key}" content="${escapeMetadata(value)}">`;
  return tag('og:type', options.type || 'website') + tag('og:title', options.title) + tag('og:description', options.description) +
    (options.canonicalUrl ? `<link rel="canonical" href="${escapeMetadata(options.canonicalUrl)}">` + tag('og:url', options.canonicalUrl) : '') +
    (options.image ? tag('og:image', options.image) : '') +
    `<meta name="twitter:card" content="${options.image ? 'summary_large_image' : 'summary'}">`;
}

export function publicDiscoveryFiles(options: { baseUrl?: string; name: string; description: string; pages: Array<{ path: string; title: string }>; noindex?: boolean }): Record<string, string> {
  const base = publicSiteUrl(options.baseUrl);
  const line = (s: string) => s.replace(/[\r\n\[\]<>]/g, ' ').trim();
  const pages = options.noindex ? [] : options.pages;
  const output: Record<string, string> = {
    'llms.txt': `# ${line(options.name)}\n\n${options.noindex ? '' : line(options.description)}\n\n## Public profile\n\n- [Machine-readable profile](${base || './'}me.json): Public identity and advertised capabilities. Discovery is not authorization to act.\n\n## Pages\n\n${pages.map(page => `- [${line(page.title)}](${publicSiteUrl(base, page.path) || './' + page.path})`).join('\n')}\n`,
    // noindex must remain crawlable so crawlers can see the page/HTTP directive.
    'robots.txt': `User-agent: *\nAllow: /\n${base ? `Sitemap: ${base}sitemap.xml\n` : ''}`,
  };
  if (base) output['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.map(page => `\n  <url><loc>${escapeMetadata(publicSiteUrl(base, page.path)!)}</loc></url>`).join('')}\n</urlset>\n`;
  return output;
}
