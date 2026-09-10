import { describe, expect, it } from 'vitest';
import { generateSiteHtml, applyImageMetadata, publicSiteUrl } from './index';

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
  });
  it('never publishes a private profile or embeds author text as executable markup', async () => {
    expect(await generateSiteHtml({ visibility: 'private', bio: 'private' }, [])).toEqual({});
    const output = await generateSiteHtml({ name: '</script><script>alert(1)</script>' }, []);
    expect(output['index.html']).not.toContain('</script><script>alert(1)</script>');
    expect(output['index.html']).not.toContain('rel="canonical"');
    expect(output['sitemap.xml']).toBeUndefined();
    expect(publicSiteUrl('https://example.com', 'javascript:alert(1)')).toBeUndefined();
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
