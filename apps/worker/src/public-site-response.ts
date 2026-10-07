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
  const prompt = `<style>
    .me3-create-site-space{height:96px}
    a.me3-create-site{box-sizing:border-box;position:fixed;z-index:1000;left:50%;bottom:calc(16px + env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;align-items:center;gap:14px;width:max-content;max-width:calc(100vw - 32px);min-height:58px;padding:8px 16px 8px 9px;border:1px solid #171717;border-radius:999px;background:#fff;color:#171717;box-shadow:0 8px 28px rgba(0,0,0,.25);font:600 14px/1.2 system-ui,-apple-system,sans-serif;text-decoration:none;white-space:nowrap}
    a.me3-create-site:hover{background:#f3f3f3}
    a.me3-create-site:focus-visible{outline:3px solid #0b806e;outline-offset:3px}
    .me3-create-site-mark{display:grid;place-items:center;flex:none;width:40px;height:40px;border-radius:50%;background:#171717;color:#fff;font-size:12px;font-weight:800;letter-spacing:-.06em}
    .me3-create-site-arrow{margin-left:auto;font-size:24px;font-weight:400;line-height:1}
    @media(max-width:380px){a.me3-create-site{gap:9px;padding-right:12px;font-size:12px}.me3-create-site-mark{width:36px;height:36px;font-size:11px}}
  </style><div class="me3-create-site-space" aria-hidden="true"></div><a class="me3-create-site" href="https://me3.app/"><span class="me3-create-site-mark" aria-hidden="true">ME3</span><span>Create a free ME3 site</span><span class="me3-create-site-arrow" aria-hidden="true">→</span></a>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${prompt}</body>`) : `${html}${prompt}`;
}
