import { getManagedCommerceBridgeConfig } from "./commerce-bridge";
import type { Env } from "./types";

/**
 * The mobile apps subscribe to ME3 hosting through this installation, which forwards the
 * store purchase to ME3 Cloud with its own installation credential. ME3 Cloud binds the
 * purchase to the account that owns this installation, so an owner already signed in here
 * never signs in to ME3.app again just to subscribe.
 */
export type ManagedSubscriptionRequest =
  | { kind: "entitlement" }
  | { kind: "google_play"; purchaseToken: string }
  | { kind: "storekit"; signedTransaction: string };

export class ManagedSubscriptionError extends Error {
  constructor(message: string, readonly status: 400 | 409 | 422 | 502 | 503) {
    super(message);
  }
}

export function readManagedSubscriptionPurchase(
  kind: "google_play" | "storekit",
  body: unknown,
): ManagedSubscriptionRequest {
  const input = body && typeof body === "object" && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  if (kind === "google_play") {
    const purchaseToken = typeof input.purchaseToken === "string" ? input.purchaseToken.trim() : "";
    if (!purchaseToken || purchaseToken.length > 500) {
      throw new ManagedSubscriptionError("Invalid Google Play purchase", 400);
    }
    return { kind, purchaseToken };
  }
  const signedTransaction = typeof input.signedTransaction === "string" ? input.signedTransaction.trim() : "";
  if (!signedTransaction || signedTransaction.length > 100_000) {
    throw new ManagedSubscriptionError("Invalid App Store purchase", 400);
  }
  return { kind, signedTransaction };
}

export async function forwardManagedSubscriptionRequest(
  env: Env,
  request: ManagedSubscriptionRequest,
): Promise<Record<string, unknown>> {
  const bridge = await getManagedCommerceBridgeConfig(env);
  if (!bridge) {
    throw new ManagedSubscriptionError("This ME3 isn't linked to ME3 Cloud, so it can't take a subscription.", 503);
  }
  const path = request.kind === "entitlement"
    ? "entitlement"
    : request.kind === "google_play" ? "google-play/reconcile" : "storekit/reconcile";
  const body = request.kind === "google_play"
    ? { purchaseToken: request.purchaseToken }
    : request.kind === "storekit" ? { signedTransaction: request.signedTransaction } : null;

  let response: Response;
  try {
    response = await fetch(`${bridge.origin}/v1/managed-subscription/${path}`, {
      method: body ? "POST" : "GET",
      headers: body ? { ...bridge.headers, "Content-Type": "application/json" } : bridge.headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    console.error("Managed subscription request failed", error);
    throw new ManagedSubscriptionError("ME3 Cloud is temporarily unavailable. Try again.", 503);
  }
  const payload = await response.json<unknown>().catch(() => null);
  const root = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : null;
  if (response.ok && root) return root;

  const message = typeof root?.error === "string" && root.error.trim()
    ? root.error.trim()
    : "ME3 Cloud could not check this purchase.";
  // A purchase ME3 Cloud refused keeps its reason. Anything else, including this
  // installation's own credential being refused, must not read as the app's sign-in failing.
  const status = response.status === 400 || response.status === 409 || response.status === 422
    ? response.status
    : response.status === 503 ? 503 : 502;
  throw new ManagedSubscriptionError(message, status);
}
