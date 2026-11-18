/**
 * Social sign-ins started from the ME3 phone apps finish here instead of on the web Social page,
 * so the in-app browser sheet closes and the app refreshes its accounts. The page forwards only a
 * checked platform name or error code to a fixed app scheme; it reads no owner data.
 */
import { APP_SCHEMES, stripeAppReturnPage, type StripeReturnApp } from "./stripe-app-return";

export const SOCIAL_APP_RETURN_PATH = "/api/social/oauth/app-return";

/** The return path Core stores with the OAuth state; the callback adds social_connected or social_error. */
export function socialAppReturnPath(app: StripeReturnApp): string {
  return `${SOCIAL_APP_RETURN_PATH}?app=${app}`;
}

export function socialAppDeepLink(
  app: StripeReturnApp,
  query: { connected?: string | null; error?: string | null },
): string {
  const base = `${APP_SCHEMES[app]}://social`;
  if (query.connected && /^[a-z]{1,20}$/.test(query.connected)) {
    return `${base}?social_connected=${query.connected}`;
  }
  const error = query.error && /^[a-z0-9_]{1,40}$/.test(query.error) ? query.error : "failed";
  return `${base}?social_error=${error}`;
}

export function socialAppReturnPage(deepLink: string): string {
  return stripeAppReturnPage(deepLink, "Taking you back to ME3.");
}
