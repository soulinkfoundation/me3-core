/**
 * Owner app static files: everything Vite emits under /assets plus the
 * top-level entries in apps/web/public. These never need D1, so the Worker
 * serves them straight from the ASSETS binding before any host lookup.
 */

// Every top-level entry in apps/web/public except the public site's own robots.txt, sitemap.xml and llms.txt;
// anything missing here 404s on the installation host because the public site answers it.
export const OWNER_APP_ASSET_PATHS = [
  "/assets", "/icons", "/images", "/landing-page-lab", "/manifest.webmanifest", "/sw.js",
  "/favicon.ico", "/favicon.png", "/flower.png", "/me3protocol.jpg",
  "/me3-logo-light.png", "/me3-logo-dark.png",
  "/me3-dog-head-emoji-smooth.png", "/me3-dog-head-emoji-smooth.webp",
  "/me3-dog-head-panting.gif", "/me3-dog-head-panting.webp",
];

const ASSET_DIRECTORIES = new Set(["/assets", "/icons", "/images", "/landing-page-lab"]);

export function isOwnerAppStaticAssetPath(pathname: string): boolean {
  return OWNER_APP_ASSET_PATHS.some((entry) =>
    ASSET_DIRECTORIES.has(entry) ? pathname.startsWith(`${entry}/`) : pathname === entry,
  );
}

const HASHED_ASSET = /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;
const BRAND_IMAGE = /^\/(icons|images)\/|^\/(favicon\.(ico|png)|flower\.png|me3protocol\.jpg|me3-logo-(light|dark)\.png|me3-dog-head-[a-z-]+\.(png|webp|gif))$/;

/**
 * Browser cache policy for an owner app static file, or null to keep what the
 * asset layer sent. Hashed Vite output never changes; brand images change with
 * a Core release at most, so a day in the browser cache is safe.
 */
export function ownerAppAssetCacheControl(pathname: string): string | null {
  if (HASHED_ASSET.test(pathname)) return "public, max-age=31536000, immutable";
  if (BRAND_IMAGE.test(pathname)) return "public, max-age=86400, stale-while-revalidate=604800";
  return null;
}

/**
 * True when the ASSETS binding answered with the SPA fallback (index.html)
 * instead of the file that was asked for.
 */
export function isSpaFallbackResponse(response: Response, pathname: string): boolean {
  if (pathname.endsWith(".html")) return false;
  const type = response.headers.get("content-type") || "";
  return type.startsWith("text/html");
}
