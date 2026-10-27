import {
  PRODUCT_DOWNLOAD_MAX_BYTES,
  PRODUCT_DOWNLOAD_TYPES,
  type ProductDownloadFile,
} from "../../../shared/product-delivery";
import { isPdf } from "./newsletter-welcome";
import { getR2SiteFile, getSiteFile, putSiteMediaFile, sha256Text } from "./sites";
import type { DbSite, Env } from "./types";

/** How long a buyer's link works, and how many times. */
export const DOWNLOAD_LINK_DAYS = 7;
export const DOWNLOAD_LINK_USES = 5;
/** Links one order may be sent, so a leaked checkout reference cannot mint them forever. */
const MAX_LINKS_PER_ORDER = 10;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;

export class ProductDownloadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/**
 * Paid files live outside public/, so the site server never serves them.
 * Only a claimed download link reads them.
 */
export function productDownloadPath(file: Pick<ProductDownloadFile, "id" | "type">): string {
  return `private/products/${file.id}.${PRODUCT_DOWNLOAD_TYPES[file.type] || "bin"}`;
}

function downloadTypeFor(file: File, bytes: Uint8Array): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (extension === "pdf") return isPdf(bytes) ? "application/pdf" : null;
  if (extension === "epub") return zipped ? "application/epub+zip" : null;
  if (extension === "zip") return zipped ? "application/zip" : null;
  if (extension === "mp3") return "audio/mpeg";
  if (extension === "m4a") return "audio/mp4";
  if (extension === "wav") return "audio/wav";
  return null;
}

export async function storeProductDownload(env: Env, site: DbSite, file: File): Promise<ProductDownloadFile> {
  if (file.size <= 0) throw new ProductDownloadError("Choose a file to upload.");
  if (file.size > PRODUCT_DOWNLOAD_MAX_BYTES) throw new ProductDownloadError("Downloads must be 100 MB or smaller.", 413);
  const buffer = await file.arrayBuffer();
  const type = downloadTypeFor(file, new Uint8Array(buffer));
  if (!type) throw new ProductDownloadError("Downloads can be a PDF, EPUB, ZIP, MP3, M4A or WAV file.");
  const stored: ProductDownloadFile = {
    id: crypto.randomUUID(),
    name: file.name.replace(/[\\/\r\n"]/g, "").trim().slice(0, 120) || `download.${PRODUCT_DOWNLOAD_TYPES[type]}`,
    size: buffer.byteLength,
    type,
  };
  await putSiteMediaFile(env, site, productDownloadPath(stored), buffer, type);
  return stored;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const sqliteTime = (date: Date) => date.toISOString().slice(0, 19).replace("T", " ");

/** A new download link for a paid order; only its hash is stored. */
export async function issueDownloadToken(
  db: D1Database,
  input: { orderId: string; siteId: string; file: ProductDownloadFile },
  now = new Date(),
): Promise<string> {
  const issued = await db.prepare("SELECT COUNT(*) AS links FROM commerce_downloads WHERE order_id = ?")
    .bind(input.orderId).first<{ links: number }>();
  if (Number(issued?.links || 0) >= MAX_LINKS_PER_ORDER) {
    throw new ProductDownloadError("This order has had too many download links. Contact the seller.", 429);
  }
  const token = randomToken();
  await db.prepare(
    `INSERT INTO commerce_downloads (id, order_id, site_id, token_hash, file_path, file_name, content_type, expires_at, max_uses)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    input.orderId,
    input.siteId,
    await sha256Text(token),
    productDownloadPath(input.file),
    input.file.name,
    input.file.type,
    sqliteTime(new Date(now.getTime() + DOWNLOAD_LINK_DAYS * 86_400_000)),
    DOWNLOAD_LINK_USES,
  ).run();
  return token;
}

export type ClaimedDownload = { siteId: string; filePath: string; fileName: string; contentType: string };

/** Uses one of a link's downloads, or returns null when it is unknown, used up, expired or unpaid. */
export async function claimDownload(db: D1Database, token: string, now = new Date()): Promise<ClaimedDownload | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const hash = await sha256Text(token);
  const at = sqliteTime(now);
  const claimed = await db.prepare(
    `UPDATE commerce_downloads SET uses = uses + 1
     WHERE token_hash = ? AND uses < max_uses AND expires_at > ?
       AND order_id IN (SELECT id FROM commerce_orders WHERE status = 'paid')`,
  ).bind(hash, at).run();
  if (Number(claimed.meta.changes || 0) !== 1) return null;
  const row = await db.prepare("SELECT site_id, file_path, file_name, content_type FROM commerce_downloads WHERE token_hash = ?")
    .bind(hash).first<{ site_id: string; file_path: string; file_name: string; content_type: string }>();
  return row ? { siteId: row.site_id, filePath: row.file_path, fileName: row.file_name, contentType: row.content_type } : null;
}

export async function downloadResponse(env: Env, token: string): Promise<Response> {
  const notFound = () => new Response("This download link has expired or been used up. Contact the seller for a new one.", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
  const download = await claimDownload(env.DB, token);
  if (!download) return notFound();
  const site = await env.DB.prepare("SELECT * FROM sites WHERE id = ?").bind(download.siteId).first<DbSite>();
  const file = site
    ? (await getR2SiteFile(env, site, download.filePath)) || (await getSiteFile(env, site.id, download.filePath))
    : null;
  if (!file) return notFound();
  const asciiName = download.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  const content = file.content;
  const bytes = content instanceof ArrayBuffer ? new Uint8Array(content)
    : content instanceof Uint8Array ? content
    : Uint8Array.from(Array.isArray(content) ? content : Object.values(content));
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": download.contentType,
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(download.fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
