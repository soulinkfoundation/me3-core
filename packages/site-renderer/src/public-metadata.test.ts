import { describe, expect, it } from 'vitest';
import { generateSiteHtml, applyImageMetadata, publicSiteUrl } from './index';
import { publicDiscoveryFiles } from './public-metadata';

describe('public profile metadata', () => {
  it('uses the complete site base for canonical, image and discovery URLs and lists only emitted pages', async () => {
    const output = await generateSiteHtml({ name: 'A & B', bio: 'Public bio', avatar: './files/avatar.png', pages: [
      { slug: 'about', title: 'About', file: 'about.md' }, { slug: 'hidden', visible: false, file: 'hidden.md' }, { slug: 'missing', file: 'missing.md' },
    ], posts: [{ slug: 'hello', title: 'Hello', file: 'blog/hello.md' }, { slug: 'draft', draft: true, file: 'draft.md' }] }, [
      { name: 'about.md', content: 'About us' }, { name: 'blog/hello.md', content: 'Hello world' }, { name: 'hidden.md', content: 'Secret' },
    ], undefined, { baseUrl: 'https://example.com/site/alex' });
    expect(output['index.html']).toContain('rel="canonical" href="https://example.com/site/alex/"');
    expect(output['blog/hello.html']).toContain('rel="canonical" href="https://example.com/site/alex/blog/hello"');
    expect(output['blog/hello.html']).toContain('href="https://example.com/site/alex/me.json"');
    expect(output['index.html']).toContain('property="og:title" content="A &amp; B"');
    expect(output['index.html']).toContain('content="https://example.com/site/alex/files/avatar.png"');
    expect(output['index.html']).toContain('"@type":"ProfilePage"');
    expect(output['sitemap.xml']).toContain('https://example.com/site/alex/about');
    expect(output['sitemap.xml']).not.toMatch(/hidden|missing|draft/);
    expect(output['llms.txt']).not.toMatch(/Secret|hidden|missing|draft/);
    expect(output['robots.txt']).toContain('Sitemap: https://example.com/site/alex/sitemap.xml');
    expect(output['hidden.html']).toContain('Secret');
  });
  it('never publishes a private profile or embeds author text as executable markup', async () => {
    expect(await generateSiteHtml({ visibility: 'private', bio: 'private' }, [])).toEqual({});
    const output = await generateSiteHtml({ name: '</script><script>alert(1)</script>' }, []);
    expect(output['index.html']).not.toContain('</script><script>alert(1)</script>');
    expect(output['index.html']).not.toContain('rel="canonical"');
    expect(output['sitemap.xml']).toBeUndefined();
    expect(publicSiteUrl('https://example.com', 'javascript:alert(1)')).toBeUndefined();
  });
  it('names the ME3 connector in llms.txt only for a published, indexable site', async () => {
    const pages = [{ path: 'about', title: 'About' }];
    const published = publicDiscoveryFiles({ baseUrl: 'https://alex.me3.app', name: 'Alex', description: 'Coach', pages })['llms.txt'];
    expect(published).toContain('https://api.me3.app/mcp');
    expect(published).toMatch(/never books, pays or sends anything/);
    expect(publicDiscoveryFiles({ baseUrl: 'https://alex.me3.app', name: 'Alex', description: 'Coach', pages, noindex: true })['llms.txt']).not.toContain('api.me3.app/mcp');
    expect(publicDiscoveryFiles({ name: 'Alex', description: 'Coach', pages })['llms.txt']).not.toContain('api.me3.app/mcp');
    expect(await generateSiteHtml({ visibility: 'private', bio: 'private' }, [], undefined, { baseUrl: 'https://alex.me3.app' })).toEqual({});
  });
});

describe('responsive published images', () => {
  const hash = 'a'.repeat(64);
  const images = { 'files/photo.png': { width: 1600, height: 1000, variants: [{ path: `files/responsive/${hash}.webp`, width: 640 }] } };
  it('adds intrinsic dimensions and only real variant URLs across nested pages', () => {
    const html = applyImageMetadata('<img src="../files/photo.png" alt="Photo">', images, { baseUrl: 'https://example.com/site/a', pagePath: 'blog/post.html', sizes: '100vw' });
    expect(html).toContain('width="1600" height="1000"');
    expect(html).toContain(`https://example.com/site/a/files/responsive/${hash}.webp 640w`);
    expect(html).toContain('https://example.com/site/a/files/photo.png 1600w');
  });
  it('preserves fixed avatar sizes and leaves external, unknown and malformed sources untouched', () => {
    const fixed = applyImageMetadata('<img src="./files/photo.png" width="120" height="120">', images, { sizes: '100vw' });
    expect(fixed).toContain('sizes="120px"');
    expect(fixed.match(/width=/g)).toHaveLength(1);
    for (const src of ['https://other.example/files/photo.png', 'files/unknown.png', '%zz']) {
      const html = `<img src="${src}">`;
      expect(applyImageMetadata(html, images, { sizes: '100vw' })).toBe(html);
    }
  });
});

describe('site banner responsive sizes', () => {
  const hash = (n: string) => n.repeat(64);
  const images = { 'files/banner.jpg': { width: 2400, height: 1500, variants: [640, 1280, 1920].map((width, i) => ({ path: `files/responsive/${hash('abc'[i])}.webp`, width })) } };
  const bannerTag = (html: string) => html.match(/<div class="site-hero__banner"><img[^>]*>/)?.[0] || '';
  const render = (layout: string) => generateSiteHtml({ name: 'Niamh', banner: './files/banner.jpg', extensions: { 'me3.app/site': { layout } } } as never, [], undefined, { baseUrl: 'https://example.com', images });
  it('fills the full-bleed Cover hero from desktop-sized variants', async () => {
    const tag = bannerTag((await render('cover'))['index.html']);
    expect(tag).toContain('sizes="max(100vw, 960px)"');
    expect(tag.match(/sizes=/g)).toHaveLength(1);
    expect(tag).toContain(`files/responsive/${hash('c')}.webp 1920w`);
    expect(tag).toContain('files/banner.jpg 2400w');
  });
  it('keeps the Card banner on the column-width sizes', async () => {
    const tag = bannerTag((await render('card'))['index.html']);
    expect(tag).toContain('sizes="(max-width: 640px) 100vw, 640px"');
  });
});
