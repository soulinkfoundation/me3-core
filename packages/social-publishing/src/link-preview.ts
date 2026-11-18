export type SocialLinkPreview = {
  url: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  siteName: string;
};

const MAX_REDIRECTS = 4;
const MAX_HTML_BYTES = 512 * 1024;

export async function fetchSocialLinkPreview(
  input: unknown,
  fetcher: typeof fetch = fetch,
): Promise<SocialLinkPreview | null> {
  let currentUrl = publicHttpUrl(input);
  if (!currentUrl) return null;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await fetcher(currentUrl, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "ME3 link preview/1.0",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirectCount === MAX_REDIRECTS) return null;
      currentUrl = publicHttpUrl(new URL(location, currentUrl).toString());
      if (!currentUrl) return null;
      continue;
    }

    if (!response.ok) return null;
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      return null;
    }
    const contentLength = Number(response.headers.get("content-length") || "0");
    if (contentLength > MAX_HTML_BYTES) return null;

    const html = await readLimitedText(response, MAX_HTML_BYTES);
    if (!html) return null;
    return parseSocialLinkPreview(html, currentUrl);
  }

  return null;
}

export function parseSocialLinkPreview(
  html: string,
  pageUrl: string,
): SocialLinkPreview | null {
  const normalizedPageUrl = publicHttpUrl(pageUrl);
  if (!normalizedPageUrl) return null;
  const metadata = new Map<string, string>();

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = htmlAttributes(match[0]);
    const key = (attributes.property || attributes.name || "").trim().toLowerCase();
    const content = decodeHtml(attributes.content || "").trim();
    if (key && content && !metadata.has(key)) metadata.set(key, content);
  }

  const title = boundedText(
    metadata.get("og:title") ||
      metadata.get("twitter:title") ||
      decodeHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || ""),
    300,
  );
  const description = boundedText(
    metadata.get("og:description") ||
      metadata.get("twitter:description") ||
      metadata.get("description") ||
      "",
    500,
  ) || null;
  const imageUrl = resolvePublicUrl(
    metadata.get("og:image") ||
      metadata.get("og:image:url") ||
      metadata.get("twitter:image") ||
      metadata.get("twitter:image:src") ||
      "",
    normalizedPageUrl,
  );
  const hostname = new URL(normalizedPageUrl).hostname.replace(/^www\./, "");
  const siteName = boundedText(metadata.get("og:site_name") || hostname, 120) || hostname;

  if (!title && !description && !imageUrl) return null;
  return {
    url: normalizedPageUrl,
    title: title || normalizedPageUrl,
    description,
    imageUrl,
    siteName,
  };
}

function publicHttpUrl(input: unknown): string | null {
  if (typeof input !== "string" || input.length > 4_096) return null;
  try {
    const url = new URL(input);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal") ||
      hostname.endsWith(".home") ||
      hostname.endsWith(".lan") ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
      hostname.includes(":")
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function resolvePublicUrl(value: string, pageUrl: string): string | null {
  if (!value) return null;
  try {
    return publicHttpUrl(new URL(decodeHtml(value), pageUrl).toString());
  } catch {
    return null;
  }
}

function htmlAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(
    /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
  )) {
    const key = match[1]?.toLowerCase();
    if (!key || key === "meta") continue;
    attributes[key] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&(amp|quot|apos|lt|gt|nbsp);/gi, (_, entity: string) => ({
      amp: "&",
      quot: '"',
      apos: "'",
      lt: "<",
      gt: ">",
      nbsp: " ",
    })[entity.toLowerCase()] || "")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

async function readLimitedText(response: Response, limit: number): Promise<string | null> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytesRead += chunk.value.byteLength;
    if (bytesRead > limit) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
  return text + decoder.decode();
}
