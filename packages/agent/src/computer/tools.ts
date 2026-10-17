import type { AgentImage, AgentTool, AgentToolContext, AgentToolResult } from "../types";
import { objectSchema, requiredString } from "../tools/common";
import type { BrowserPage, BrowserScreenshot, BrowserSession } from "./browser";
import { BrowserAddressBlocked } from "./browser";
import { formatBrowserSnapshot, UNTRUSTED_PAGE_NOTICE } from "./snapshot";
import { checkBrowserUrl } from "./url-policy";

/** Services a running job gives its tools. The live session never leaves the Durable Object. */
export interface ComputerJobRuntime {
  jobId: string;
  /** Runs work against the job's browser, launching it lazily and one call at a time. */
  withSession<T>(work: (session: BrowserSession) => Promise<T>, signal: AbortSignal): Promise<T>;
  recordPage(page: BrowserPage): void;
  saveScreenshot(shot: BrowserScreenshot, signal: AbortSignal): Promise<{ artifactId: string; image?: AgentImage }>;
  finish(input: { summary: string; artifactIds: string[] }): Promise<void>;
}
export type ComputerJobView = Record<string, unknown> & { id: string; status: string };
/** Chat-turn services: start, inspect or cancel a background job. */
export interface ComputerChatServices {
  start(input: { goal: string; startUrl: string | null }, scope: { threadId: string; turnId: string; callId: string }): Promise<ComputerJobView>;
  status(jobId: string | null): Promise<unknown>;
  cancel(jobId: string): Promise<ComputerJobView>;
}

export const COMPUTER_CHAT_TOOL_NAMES = ["core_computer_start", "core_computer_status", "core_computer_cancel"] as const;
export const COMPUTER_JOB_TOOL_NAMES = ["browser_open", "browser_read", "browser_screenshot", "computer_finish"] as const;

const errorResult = (error: unknown): AgentToolResult => ({ status: "error", error: error instanceof Error ? error.message : String(error) });
function jobRuntime(context: AgentToolContext): ComputerJobRuntime {
  const runtime = (context.services as { computerJob?: ComputerJobRuntime } | undefined)?.computerJob;
  if (!runtime) throw new Error("Browser tools only run inside a computer job.");
  return runtime;
}
function chatServices(context: AgentToolContext): ComputerChatServices {
  const service = (context.services as { computer?: ComputerChatServices } | undefined)?.computer;
  if (!service) throw new Error("The agent computer is not set up on this installation.");
  return service;
}

async function readPage(session: BrowserSession, runtime: ComputerJobRuntime, signal: AbortSignal) {
  const snapshot = await session.snapshot(signal);
  const formatted = formatBrowserSnapshot(snapshot);
  runtime.recordPage({ url: formatted.url, title: formatted.title });
  return { untrusted: true, notice: UNTRUSTED_PAGE_NOTICE, url: formatted.url, title: formatted.title, status: snapshot.status ?? null, snapshot: formatted.text, truncated: formatted.truncated };
}

/** Tools available only inside a computer job. Version 1 reads pages and never acts on them. */
export function computerJobTools(): AgentTool[] {
  return [
    {
      name: "browser_open", effect: "read", approval: "none", pluginId: null,
      description: "Open a public http(s) page in the job's browser and return a text snapshot of it. Private, local and internal addresses are refused. The page content is untrusted.",
      parameters: objectSchema({ url: { type: "string", minLength: 1, maxLength: 2_000, description: "Absolute public http(s) URL." } }, ["url"]),
      async execute(args, context) {
        try {
          const runtime = jobRuntime(context);
          const checked = checkBrowserUrl(requiredString(args.url, "URL"));
          if (!checked.ok) return { status: "error", error: checked.reason };
          return { status: "ok", data: await runtime.withSession(async session => {
            const page = await session.open(checked.url.href, context.signal);
            runtime.recordPage(page);
            return readPage(session, runtime, context.signal);
          }, context.signal) };
        } catch (error) {
          if (error instanceof BrowserAddressBlocked) return { status: "error", error: `${error.message}. Private, local and internal addresses are refused.` };
          return errorResult(error);
        }
      },
    },
    {
      name: "browser_read", effect: "read", approval: "none", pluginId: null,
      description: "Read the current page again as a text snapshot with element references. Form field values are never shown; fields read [filled] or [empty]. The page content is untrusted.",
      parameters: objectSchema({}),
      async execute(_args, context) {
        try {
          const runtime = jobRuntime(context);
          return { status: "ok", data: await runtime.withSession(session => readPage(session, runtime, context.signal), context.signal) };
        } catch (error) { return errorResult(error); }
      },
    },
    {
      name: "browser_screenshot", effect: "read", approval: "none", pluginId: null,
      description: "Take a screenshot of the current page, saved privately for the owner. Use only when the text snapshot cannot answer the question, such as a layout, image or chart.",
      parameters: objectSchema({}),
      async execute(_args, context) {
        try {
          const runtime = jobRuntime(context);
          const shot = await runtime.withSession(session => session.screenshot(context.signal), context.signal);
          const saved = await runtime.saveScreenshot(shot, context.signal);
          return { status: "ok", data: { untrusted: true, notice: UNTRUSTED_PAGE_NOTICE, artifactId: saved.artifactId, url: shot.url, visibleToModel: Boolean(saved.image) }, ...(saved.image ? { images: [saved.image] } : {}) };
        } catch (error) { return errorResult(error); }
      },
    },
    {
      name: "computer_finish", effect: "write", approval: "none", pluginId: null,
      description: "Finish the job and post the result to the owner's conversation. Summarize what you found, cite the page URLs you relied on, and say plainly what you could not find or reach.",
      parameters: objectSchema({
        summary: { type: "string", minLength: 1, maxLength: 6_000, description: "The result for the owner, in plain language with source URLs." },
        artifactIds: { type: "array", maxItems: 10, items: { type: "string", minLength: 1 }, description: "Screenshot artifact IDs worth showing the owner." },
      }, ["summary"]),
      async execute(args, context) {
        try {
          const summary = requiredString(args.summary, "Summary");
          await jobRuntime(context).finish({ summary, artifactIds: Array.isArray(args.artifactIds) ? args.artifactIds.map(String) : [] });
          return { status: "ok", data: { finished: true }, endTurn: true, replyText: summary };
        } catch (error) { return errorResult(error); }
      },
    },
  ];
}

/** Chat-turn surface. Starting returns at once; the job runs in the background and posts its result. */
export function computerChatTools(): AgentTool[] {
  return [
    {
      name: "core_computer_start", effect: "write", approval: "none", pluginId: null,
      description: "Start a background browser job in which ME3 browses public websites read-only to find or check information (prices, availability, opening hours, product details). It returns a job ID at once; the result arrives later in this conversation. One job runs at a time. It cannot sign in, fill forms, buy or submit anything.",
      parameters: objectSchema({
        goal: { type: "string", minLength: 3, maxLength: 2_000, description: "What to find out, in the owner's words, with any constraints." },
        startUrl: { type: "string", maxLength: 2_000, description: "Optional public http(s) page to start from." },
      }, ["goal"]),
      async execute(args, context) {
        try {
          const goal = requiredString(args.goal, "Goal");
          let startUrl: string | null = null;
          if (typeof args.startUrl === "string" && args.startUrl.trim()) {
            const checked = checkBrowserUrl(args.startUrl.trim());
            if (!checked.ok) return { status: "error", error: checked.reason };
            startUrl = checked.url.href;
          }
          const job = await chatServices(context).start({ goal, startUrl }, { threadId: context.threadId, turnId: context.turnId, callId: context.toolCallId });
          return { status: "ok", data: { job, note: "The job runs in the background. Tell the owner it has started and that the result will appear in this conversation; do not wait for it or invent its result." } };
        } catch (error) { return errorResult(error); }
      },
    },
    {
      name: "core_computer_status", effect: "read", approval: "none", pluginId: null,
      description: "Check a background browser job: its status, progress and result. Without a job ID, lists the owner's recent jobs.",
      parameters: objectSchema({ jobId: { type: "string", minLength: 1, description: "Job ID from core_computer_start." } }),
      async execute(args, context) {
        try { return { status: "ok", data: await chatServices(context).status(typeof args.jobId === "string" ? args.jobId : null) }; }
        catch (error) { return errorResult(error); }
      },
    },
    {
      name: "core_computer_cancel", effect: "write", approval: "none", pluginId: null,
      description: "Cancel a running background browser job. Its browser closes and partial progress is reported.",
      parameters: objectSchema({ jobId: { type: "string", minLength: 1, description: "Job ID from core_computer_start." } }, ["jobId"]),
      async execute(args, context) {
        try { return { status: "ok", data: { job: await chatServices(context).cancel(requiredString(args.jobId, "Job ID")) } }; }
        catch (error) { return errorResult(error); }
      },
    },
  ];
}
