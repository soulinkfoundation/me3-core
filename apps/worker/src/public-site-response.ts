/** Revalidate public snapshots on every use so publishing and revocation are immediate. */
export async function publicSiteFileResponse(options: {
  content: ArrayBuffer;
  contentType: string;
  sha256?: string | null;
  published: boolean;
  profileUrl: string;
  request?: Request;
  path?: string;
  noindex?: boolean;
  showCreateSitePrompt?: boolean;
  regionalPricing?: boolean;
}): Promise<Response> {
  const showPrompt = options.published && options.showCreateSitePrompt && options.contentType.startsWith('text/html');
  const content = showPrompt
    ? new TextEncoder().encode(addCreateSitePrompt(new TextDecoder().decode(options.content))).buffer
    : options.content;
  const headers = new Headers({ 'Content-Type': options.contentType });
  if (!options.published || options.regionalPricing) {
    headers.set('Cache-Control', options.published ? 'private, no-store' : 'no-store');
    if (!options.published || options.noindex) headers.set('X-Robots-Tag', 'noindex, nofollow');
    if (options.published) headers.set('Link', `<${options.profileUrl}>; rel="alternate"; type="application/json"; title="ME3 public profile"`);
    return new Response(options.request?.method === 'HEAD' ? null : content, { headers });
  }
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  const digest = (!showPrompt && options.sha256) || Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', content)), byte => byte.toString(16).padStart(2, '0')).join('');
  const etag = `"${digest}"`;
  headers.set('ETag', etag);
  if (options.path === `files/responsive/${digest}.webp`) headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (options.noindex) headers.set('X-Robots-Tag', 'noindex, nofollow');
  if (options.contentType.startsWith('text/html')) {
    headers.set('Link', `<${options.profileUrl}>; rel="alternate"; type="application/json"; title="ME3 public profile"`);
  }
  const conditional = options.request?.headers.get('If-None-Match');
  if ((!options.request || ['GET', 'HEAD'].includes(options.request.method)) && conditional?.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(options.request?.method === 'HEAD' ? null : content, { headers });
}

function addCreateSitePrompt(html: string): string {
  // Rendered sites already credit ME3 in their footer, so only hand-built pages get the badge.
  if (/<a\b[^>]*href=["']https:\/\/me3\.app\/?["']/i.test(html)) return html;
  // Inline at the end of the page rather than fixed, so it never covers a sticky booking or buy bar.
  const prompt = `<style>
    .me3-create-site-row{display:flex;justify-content:center;padding:24px 16px calc(24px + env(safe-area-inset-bottom))}
    a.me3-create-site{box-sizing:border-box;display:inline-flex;align-items:center;gap:8px;min-height:32px;padding:4px 12px 4px 4px;border:1px solid rgba(0,0,0,.08);border-radius:999px;background:rgba(255,255,255,.88);color:#3d3d3d;font:500 12px/1 system-ui,-apple-system,sans-serif;text-decoration:none;white-space:nowrap;opacity:.92;transition:opacity .15s}
    a.me3-create-site:hover{opacity:1}
    a.me3-create-site:focus-visible{outline:2px solid #0b806e;outline-offset:2px}
    .me3-create-site-mark{display:grid;place-items:center;flex:none;width:24px;height:24px;border-radius:50%;background:#171717;color:#fff;font-size:8px;font-weight:800;letter-spacing:-.04em}
    @media(prefers-color-scheme:dark){a.me3-create-site{border-color:rgba(255,255,255,.12);background:rgba(28,28,28,.82);color:#e8e8e8}.me3-create-site-mark{background:#fff;color:#171717}}
  </style><div class="me3-create-site-row"><a class="me3-create-site" href="https://me3.app/" aria-label="Made with ME3. Create your own site"><span class="me3-create-site-mark" aria-hidden="true">ME3</span><span>Made with ME3</span></a></div>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${prompt}</body>`) : `${html}${prompt}`;
}
