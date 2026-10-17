import { BrowserAddressBlocked, BrowserSessionLost, type BrowserDriver, type BrowserLaunchInput, type BrowserNode, type BrowserPage, type BrowserSession, type BrowserSnapshot } from "./browser";

/**
 * Deterministic in-memory browser for tests and local development. It never
 * touches the network. Pages are keyed by exact URL; a page can redirect, load
 * subresources (checked against the same request policy) or simulate a lost
 * session on a chosen call.
 */
export type FakePage = { title: string; nodes: BrowserNode[]; status?: number; redirectTo?: string; subresources?: string[]; delayMs?: number };
export type FakeBrowserOptions = {
  pages: Record<string, FakePage>;
  /** Throw BrowserSessionLost on these 1-based call numbers across the driver (open/snapshot/screenshot). */
  loseSessionOnCalls?: number[];
};
export type FakeBrowserLog = { launches: number; closes: number; calls: Array<{ method: "open" | "snapshot" | "screenshot"; url: string }>; blockedRequests: string[] };

export function createFakeBrowserDriver(options: FakeBrowserOptions): BrowserDriver & { log: FakeBrowserLog; openSessions(): number } {
  const log: FakeBrowserLog = { launches: 0, closes: 0, calls: [], blockedRequests: [] };
  let callCount = 0, open = 0;
  return {
    log,
    openSessions: () => open,
    async launch(input: BrowserLaunchInput): Promise<BrowserSession> {
      input.signal.throwIfAborted();
      log.launches++; open++;
      let current: { url: string; page: FakePage } | null = null, closed = false, lost = false;
      const guard = async (method: "open" | "snapshot" | "screenshot", url: string, signal: AbortSignal) => {
        signal.throwIfAborted();
        if (closed) throw new Error("Fake browser session is closed");
        if (lost) throw new BrowserSessionLost();
        callCount++;
        log.calls.push({ method, url });
        if (options.loseSessionOnCalls?.includes(callCount)) { lost = true; throw new BrowserSessionLost(); }
      };
      const wait = (ms: number | undefined, signal: AbortSignal) => ms ? new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, ms);
        signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
      }) : Promise.resolve();
      return {
        async open(url, signal): Promise<BrowserPage> {
          await guard("open", url, signal);
          let target = url;
          for (let hops = 0; hops < 5; hops++) {
            if (!input.allowRequest(target, "navigation")) { log.blockedRequests.push(target); current = null; throw new BrowserAddressBlocked(`Navigation to ${target} was blocked`); }
            const page = options.pages[target];
            if (!page) { current = { url: target, page: { title: "Not found", status: 404, nodes: [{ role: "heading", name: "Not found", level: 1 }] } }; break; }
            if (page.redirectTo) { target = page.redirectTo; continue; }
            for (const resource of page.subresources ?? []) if (!input.allowRequest(resource, "subresource")) log.blockedRequests.push(resource);
            await wait(page.delayMs, signal);
            current = { url: target, page };
            break;
          }
          if (!current) throw new Error("Too many redirects");
          return { url: current.url, title: current.page.title, status: current.page.status ?? 200 };
        },
        async snapshot(signal): Promise<BrowserSnapshot> {
          await guard("snapshot", current?.url ?? "about:blank", signal);
          if (!current) return { url: "about:blank", title: "", nodes: [] };
          return { url: current.url, title: current.page.title, status: current.page.status ?? 200, nodes: structuredClone(current.page.nodes) };
        },
        async screenshot(signal) {
          await guard("screenshot", current?.url ?? "about:blank", signal);
          const marker = new TextEncoder().encode(`fake-screenshot:${current?.url ?? "about:blank"}`);
          return { url: current?.url ?? "about:blank", mimeType: "image/png" as const, bytes: marker };
        },
        async close() { if (!closed) { closed = true; open--; log.closes++; } },
      };
    },
  };
}
