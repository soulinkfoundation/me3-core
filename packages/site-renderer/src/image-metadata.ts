import { escapeMetadata, publicSiteUrl } from './public-metadata';

export type SiteImageMetadata = Record<string, { width: number; height: number; variants?: Array<{ path: string; width: number }> }>;

/** Enrich local uploaded images only. No guessed URLs or paid image transformation service. */
export function applyImageMetadata(html: string, images: SiteImageMetadata, options: { baseUrl?: string; pagePath?: string; sizes: string }): string {
  const base = publicSiteUrl(options.baseUrl) || 'https://site.invalid/';
  const page = new URL(options.pagePath || '', base);
  return html.replace(/<img\b[^>]*>/gi, tag => {
    const source = tag.match(/\bsrc="([^"]+)"/i)?.[1]?.replace(/&amp;/g, '&');
    if (!source) return tag;
    let url: URL;
    try { url = new URL(source, page); } catch { return tag; }
    const root = new URL(base);
    if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) return tag;
    let path: string;
    try { path = decodeURIComponent(url.pathname.slice(root.pathname.length)); } catch { return tag; }
    const metadata = images[path];
    if (!metadata || !(metadata.width > 0 && metadata.height > 0)) return tag;
    const hasWidth = /\bwidth="\d+"/.test(tag);
    const hasHeight = /\bheight="\d+"/.test(tag);
    let attributes = !hasWidth && !hasHeight ? ` width="${metadata.width}" height="${metadata.height}"` : '';
    if (!/\bsrcset=/.test(tag) && metadata.variants?.length) {
      const candidates = metadata.variants.filter(v => v.width > 0 && v.width < metadata.width && /^files\/responsive\/[a-f0-9]{64}\.webp$/.test(v.path));
      if (candidates.length) {
        const variants = candidates.map(v => `${new URL(v.path, root).href} ${v.width}w`);
        variants.push(`${url.href} ${metadata.width}w`);
        // Relative paths keep downloadable/preview sites portable when no public base is available.
        const srcset = variants.join(', ').split('https://site.invalid/').join('../'.repeat((options.pagePath || '').split('/').length - 1) || './');
        const fixed = tag.match(/\bwidth="(\d+)"/)?.[1];
        attributes += ` srcset="${escapeMetadata(srcset)}" sizes="${escapeMetadata(fixed ? `${fixed}px` : options.sizes)}"`;
      }
    }
    return tag.replace(/\/?\s*>$/, `${attributes}>`);
  });
}
