import { domainTool, ok, optionalString } from "./common";

export const ME3_DOCS_URL = "https://me3.app/docs.md";
const DOCS_WEB_URL = "https://me3.app/docs";
const CACHE_MS = 10 * 60_000;
const MAX_CHARACTERS = 30_000;

type DocsFetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

// Public docs, so one copy per isolate serves every owner; self-hosted installs read the same page.
let cached: { markdown: string; fetchedAt: number } | undefined;

export function docsTools(fetchDocs: DocsFetch = (url, init) => fetch(url, init), now: () => number = Date.now) {
  return [
    domainTool("core.docs.read", async (args, context) => {
      const markdown = await readDocs(fetchDocs, now, context.signal);
      const section = optionalString(args.section)?.trim();
      if (!section) return ok({ webUrl: DOCS_WEB_URL, markdown: markdown.slice(0, MAX_CHARACTERS) });
      const sections = docSections(markdown);
      const match = sections.find(value => value.title.toLowerCase() === section.toLowerCase());
      if (!match) throw new Error(`No docs section is called ${section}. Sections: ${sections.map(value => value.title).join(", ")}.`);
      return ok({ webUrl: DOCS_WEB_URL, section: match.title, markdown: match.markdown });
    }),
  ];
}

async function readDocs(fetchDocs: DocsFetch, now: () => number, signal: AbortSignal) {
  if (cached && now() - cached.fetchedAt < CACHE_MS) return cached.markdown;
  try {
    const response = await fetchDocs(ME3_DOCS_URL, { signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]) });
    if (!response.ok) throw new Error(`status ${response.status}`);
    cached = { markdown: await response.text(), fetchedAt: now() };
    return cached.markdown;
  } catch {
    if (signal.aborted) throw new Error("Turn cancelled.");
    throw new Error(`The ME3 docs could not be read right now. Point the owner to ${DOCS_WEB_URL}.`);
  }
}

export function docSections(markdown: string) {
  return markdown.split(/^(?=### )/m).slice(1).map(chunk => {
    const body = chunk.split(/^(?=## )/m)[0]!.trim();
    return { title: body.split("\n")[0]!.slice(4).trim(), markdown: body };
  });
}

export function resetDocsCache() { cached = undefined; }
