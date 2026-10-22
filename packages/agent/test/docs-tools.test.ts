import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { docSections, docsTools, ME3_DOCS_URL, resetDocsCache } from "../src/tools/docs.ts";

const DOCS = "# ME3 Docs\n\n> Help.\n\n## Self-hosting\n\n### Email\n\nReceiving email needs a custom domain.\n\n### AI\n\nWorkers AI needs no key.\n\n## Hosted by ME3\n\n### Delete your account\n\n1. Open Delete account.\n";

const context = () => ({ signal: new AbortController().signal, toolCallId: "call" }) as never;

function setup(responses: (() => Promise<Response>)[]) {
  let clock = 0;
  const urls: string[] = [];
  const [tool] = docsTools(async url => { urls.push(url); return responses.shift()!(); }, () => clock);
  return { tool: tool!, urls, advance: (ms: number) => { clock += ms; } };
}

beforeEach(resetDocsCache);

test("returns the whole docs with the web link and splits sections at the next heading", async () => {
  const { tool, urls } = setup([async () => new Response(DOCS)]);
  assert.equal(tool.name, "core_docs_read");
  assert.equal(tool.effect, "read");
  assert.equal(tool.approval, "none");
  assert.deepEqual(await tool.execute({}, context()), { status: "ok", data: { webUrl: "https://me3.app/docs", markdown: DOCS } });
  assert.deepEqual(urls, [ME3_DOCS_URL]);
  assert.deepEqual(docSections(DOCS).map(section => section.title), ["Email", "AI", "Delete your account"]);
  assert.equal(docSections(DOCS)[1]!.markdown, "### AI\n\nWorkers AI needs no key.");
});

test("reads one section by title and names the sections when the title is unknown", async () => {
  const { tool } = setup([async () => new Response(DOCS)]);
  assert.deepEqual(await tool.execute({ section: "delete your account" }, context()), { status: "ok", data: { webUrl: "https://me3.app/docs", section: "Delete your account", markdown: "### Delete your account\n\n1. Open Delete account." } });
  assert.deepEqual(await tool.execute({ section: "Billing" }, context()), { status: "error", error: "No docs section is called Billing. Sections: Email, AI, Delete your account." });
});

test("keeps a copy for ten minutes, then reads the docs again", async () => {
  const { tool, urls, advance } = setup([async () => new Response(DOCS), async () => new Response(DOCS)]);
  await tool.execute({}, context());
  advance(9 * 60_000);
  await tool.execute({}, context());
  assert.equal(urls.length, 1);
  advance(2 * 60_000);
  await tool.execute({}, context());
  assert.equal(urls.length, 2);
});

test("points the owner to the web docs when the docs cannot be read", async () => {
  const failure = { status: "error", error: "The ME3 docs could not be read right now. Point the owner to https://me3.app/docs." };
  const { tool } = setup([async () => new Response("down", { status: 503 }), async () => { throw new Error("network"); }]);
  assert.deepEqual(await tool.execute({}, context()), failure);
  assert.deepEqual(await tool.execute({}, context()), failure);
});
