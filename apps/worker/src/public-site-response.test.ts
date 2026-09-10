import { describe, expect, it } from 'vitest';
import { publicSiteFileResponse } from './public-site-response';

describe('published snapshot caching', () => {
  const response = (text: string, request?: Request, published = true, path?: string) => publicSiteFileResponse({ content: new TextEncoder().encode(text).buffer, contentType: 'text/html', published, profileUrl: '/site/alex/me.json', request, path });
  it('revalidates unchanged content and returns changed content after publishing', async () => {
    const first = await response('Version one');
    expect(first.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    expect(first.headers.get('Link')).toContain('</site/alex/me.json>');
    const request = new Request('https://example.com/site/alex/', { headers: { 'If-None-Match': `W/${first.headers.get('ETag')}` } });
    const unchanged = await response('Version one', request);
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe('');
    const changed = await response('Version two', request);
    expect(changed.status).toBe(200);
    expect(await changed.text()).toBe('Version two');
    expect(changed.headers.get('ETag')).not.toBe(first.headers.get('ETag'));
  });
  it('does not cache or index previews even with a matching conditional request', async () => {
    const preview = await response('Preview', new Request('https://example.com', { headers: { 'If-None-Match': '*' } }), false);
    expect(preview.status).toBe(200);
    expect(preview.headers.get('Cache-Control')).toBe('no-store');
    expect(preview.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(preview.headers.get('ETag')).toBeNull();
  });
  it('reserves immutable caching for a filename that matches the content hash', async () => {
    const first = await response('image');
    const hash = first.headers.get('ETag')!.replaceAll('"', '');
    expect((await response('image', undefined, true, `files/responsive/${hash}.webp`)).headers.get('Cache-Control')).toContain('immutable');
    expect((await response('changed image', undefined, true, `files/responsive/${hash}.webp`)).headers.get('Cache-Control')).not.toContain('immutable');
  });
});
