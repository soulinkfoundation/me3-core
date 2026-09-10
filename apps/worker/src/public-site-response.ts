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
}): Promise<Response> {
  const headers = new Headers({ 'Content-Type': options.contentType });
  if (!options.published) {
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Robots-Tag', 'noindex, nofollow');
    return new Response(options.request?.method === 'HEAD' ? null : options.content, { headers });
  }
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  const digest = options.sha256 || Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', options.content)), byte => byte.toString(16).padStart(2, '0')).join('');
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
  return new Response(options.request?.method === 'HEAD' ? null : options.content, { headers });
}
