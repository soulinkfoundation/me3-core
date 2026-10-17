import puppeteer from "@cloudflare/puppeteer";
import { BrowserAddressBlocked, BrowserSessionLost, type BrowserDriver, type BrowserNode } from "../../../packages/agent/src/computer";

/**
 * Browser Run implementation of the agent computer's browser contract. Each job
 * gets a fresh incognito context; nothing survives the session. Every request
 * passes ME3's address policy through request interception, so redirects and
 * subresources cannot reach private or internal addresses. Version 1 exposes no
 * input methods and does not run page scripts.
 */
type AxValue = { value?: unknown };
type AxNode = { nodeId: string; ignored?: boolean; role?: AxValue; name?: AxValue; value?: AxValue; properties?: Array<{ name: string; value: AxValue }>; childIds?: string[]; parentId?: string; backendDOMNodeId?: number };

const NAVIGATION_TIMEOUT_MS = 30_000;
const LOST = /Target closed|Session closed|Connection closed|detached|WebSocket is not open|Browser has disconnected|Protocol error \(.*\): (Target|Session)/i;
const REFERENCED_ROLES = new Set(["link", "button", "textbox", "searchbox", "combobox", "checkbox", "radio", "menuitem", "tab", "option", "switch", "slider", "spinbutton", "listbox", "menuitemcheckbox", "menuitemradio", "treeitem"]);

export function createBrowserRunDriver(binding: Fetcher): BrowserDriver {
  return {
    async launch({ allowRequest, signal }) {
      const browser = await abortable(puppeteer.launch(binding as never, { keep_alive: 600_000 }), signal);
      let lost = false;
      browser.on("disconnected", () => { lost = true; });
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.setRequestInterception(true);
      page.on("request", request => {
        if (request.isInterceptResolutionHandled()) return;
        const navigation = request.isNavigationRequest() && request.frame() === page.mainFrame();
        if (allowRequest(request.url(), navigation ? "navigation" : "subresource")) void request.continue().catch(() => undefined);
        else void request.abort("blockedbyclient").catch(() => undefined);
      });
      const cdp = await page.createCDPSession();
      const guard = async <T>(work: () => Promise<T>, abort: AbortSignal): Promise<T> => {
        if (lost) throw new BrowserSessionLost();
        try { return await abortable(work(), abort); }
        catch (error) {
          if (lost || error instanceof Error && LOST.test(error.message)) { lost = true; throw new BrowserSessionLost(); }
          throw error;
        }
      };
      return {
        open: (url, abort) => guard(async () => {
          let response;
          try { response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS }); }
          catch (error) {
            if (error instanceof Error && /ERR_BLOCKED_BY_CLIENT/.test(error.message)) throw new BrowserAddressBlocked(`Navigation to ${url} or one of its redirects was blocked`);
            throw error;
          }
          await page.waitForNetworkIdle({ idleTime: 500, timeout: 3_000 }).catch(() => undefined);
          return { url: page.url(), title: await page.title(), status: response?.status() ?? null };
        }, abort),
        snapshot: abort => guard(async () => {
          const { nodes } = await cdp.send("Accessibility.getFullAXTree") as { nodes: AxNode[] };
          return { url: page.url(), title: await page.title(), nodes: toBrowserNodes(nodes) };
        }, abort),
        screenshot: abort => guard(async () => {
          const bytes = await page.screenshot({ type: "jpeg", quality: 70 });
          return { url: page.url(), mimeType: "image/jpeg" as const, bytes: new Uint8Array(bytes) };
        }, abort),
        async close() {
          await context.close().catch(() => undefined);
          await browser.close().catch(() => undefined);
        },
      };
    },
  };
}

/** Converts Chrome's flat accessibility tree into nested nodes; ignored nodes are flattened into their parent. */
export function toBrowserNodes(nodes: AxNode[]): BrowserNode[] {
  const byId = new Map(nodes.map(node => [node.nodeId, node]));
  const roots = nodes.filter(node => !node.parentId || !byId.has(node.parentId));
  const convert = (node: AxNode, seen: Set<string>): BrowserNode[] => {
    if (seen.has(node.nodeId)) return [];
    seen.add(node.nodeId);
    const children = (node.childIds ?? []).flatMap(id => { const child = byId.get(id); return child ? convert(child, seen) : []; });
    const role = String(node.role?.value ?? "");
    if (node.ignored || !role || role === "RootWebArea" || role === "WebArea") return children;
    const property = (name: string) => node.properties?.find(item => item.name === name)?.value?.value;
    const value = node.value?.value;
    return [{
      role, name: typeof node.name?.value === "string" ? node.name.value : undefined,
      ...(value !== undefined && value !== "" ? { value: String(value) } : {}),
      ...(REFERENCED_ROLES.has(role) && node.backendDOMNodeId ? { ref: `e${node.backendDOMNodeId}` } : {}),
      ...(typeof property("url") === "string" ? { href: property("url") as string } : {}),
      ...(typeof property("level") === "number" ? { level: property("level") as number } : {}),
      ...(property("checked") !== undefined ? { checked: property("checked") === true || property("checked") === "true" } : {}),
      ...(property("disabled") === true ? { disabled: true } : {}),
      ...(children.length ? { children } : {}),
    }];
  };
  const seen = new Set<string>();
  return roots.flatMap(root => convert(root, seen));
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}
