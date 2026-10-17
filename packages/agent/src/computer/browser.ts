/**
 * The browser contract a computer job drives. Browser Run implements it in the
 * Worker; tests use the fake driver. Version 1 is read-only: there is no input,
 * click or script method, so a job cannot change anything on a page.
 */
export type BrowserNode = {
  /** Stable reference for later page actions; opaque to the model. */
  ref?: string;
  role: string;
  name?: string;
  /** Raw control value. Never leaves the driver boundary: snapshots replace it with [filled]/[empty]. */
  value?: string;
  href?: string;
  level?: number;
  checked?: boolean;
  disabled?: boolean;
  children?: BrowserNode[];
};
export type BrowserPage = { url: string; title: string; status?: number | null };
export type BrowserSnapshot = BrowserPage & { nodes: BrowserNode[] };
export type BrowserScreenshot = { url: string; bytes: Uint8Array; mimeType: "image/png" | "image/jpeg" };

export interface BrowserSession {
  open(url: string, signal: AbortSignal): Promise<BrowserPage>;
  snapshot(signal: AbortSignal): Promise<BrowserSnapshot>;
  screenshot(signal: AbortSignal): Promise<BrowserScreenshot>;
  close(): Promise<void>;
}

export type BrowserLaunchInput = {
  /** Every top-level navigation and subresource request must pass this check. */
  allowRequest(url: string, kind: "navigation" | "subresource"): boolean;
  signal: AbortSignal;
};
export interface BrowserDriver {
  launch(input: BrowserLaunchInput): Promise<BrowserSession>;
}

/** The remote browser went away (idle timeout, platform release, crash). Reads can start again in a new session. */
export class BrowserSessionLost extends Error {
  constructor(message = "The browser session was lost") { super(message); this.name = "BrowserSessionLost"; }
}
/** A navigation or redirect was refused by ME3's address policy. */
export class BrowserAddressBlocked extends Error {
  constructor(message: string) { super(message); this.name = "BrowserAddressBlocked"; }
}
