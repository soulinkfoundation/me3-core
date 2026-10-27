import type { Me3SiteProfile } from "@me3-core/site-renderer";
import {
  getOwnerContact,
  sendNewsletterWelcomeEmail,
  type TransactionalEmailResult,
} from "./transactional-emails";
import { getPublishedSiteBaseUrl } from "./sites";
import type { DbSite, Env } from "./types";

type SubscribeIntent = NonNullable<NonNullable<Me3SiteProfile["intents"]>["subscribe"]>;

export const NEWSLETTER_DOWNLOAD_MAX_BYTES = 25 * 1024 * 1024;
const DOWNLOAD_PATH = /^files\/downloads\/[a-z0-9][a-z0-9._-]{0,119}\.pdf$/;

/** Site path for an uploaded newsletter download, named after the owner's file. */
export function newsletterDownloadPath(filename: string): string {
  const stem = filename
    .toLowerCase()
    .replace(/\.pdf$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `files/downloads/${stem || "download"}.pdf`;
}

export function isPdf(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

/** The free download as a public URL, when the owner attached one. */
export function newsletterDownload(
  subscribe: SubscribeIntent | undefined,
  siteBaseUrl: string,
): { url: string; name: string } | null {
  const download = subscribe?.welcomeEmail?.download;
  const path = download?.path?.trim().replace(/^\.?\//, "") || "";
  if (!siteBaseUrl || !DOWNLOAD_PATH.test(path)) return null;
  return {
    url: `${siteBaseUrl.replace(/\/+$/, "")}/${path}`,
    name: download?.name?.trim() || "your download",
  };
}

/** Like booking confirmations, nothing generic is sent: the owner writes the subject and message. */
export function newsletterWelcomeIsReady(
  subscribe: SubscribeIntent | undefined,
): subscribe is SubscribeIntent & { welcomeEmail: { subject: string; message: string } } {
  const welcome = subscribe?.welcomeEmail;
  return Boolean(welcome?.enabled && welcome.subject?.trim() && welcome.message?.trim());
}

export async function siteBaseUrlForEmail(env: Env, site: DbSite, requestUrl: string): Promise<string> {
  const baseUrl = await getPublishedSiteBaseUrl(env, site).catch(() => "");
  return baseUrl || new URL(requestUrl).origin;
}

export async function sendNewsletterWelcome(
  env: Env,
  input: {
    site: DbSite;
    profile: Me3SiteProfile | null;
    email: string;
    siteBaseUrl: string;
    test?: boolean;
  },
): Promise<TransactionalEmailResult> {
  const subscribe = input.profile?.intents?.subscribe;
  if (!newsletterWelcomeIsReady(subscribe)) {
    return { status: "skipped", error: "Welcome email is not set up" };
  }
  const siteName = input.profile?.name?.trim() || input.site.username;
  const owner = await getOwnerContact(env, input.site.user_id);
  return sendNewsletterWelcomeEmail(env, {
    // One welcome per reader, so a rejoin or a repeated confirmation never resends it.
    operationId: input.test
      ? `newsletter-welcome-test:${input.site.id}:${crypto.randomUUID()}`
      : `newsletter-welcome:${input.site.id}:${input.email}`,
    ownerId: input.site.user_id,
    siteId: input.site.id,
    siteName,
    newsletterName: subscribe.title?.trim() || siteName,
    subscriberEmail: input.email,
    replyToAddress: owner.email,
    subject: subscribe.welcomeEmail.subject.trim(),
    messageText: subscribe.welcomeEmail.message,
    download: newsletterDownload(subscribe, input.siteBaseUrl),
    test: input.test,
  });
}
