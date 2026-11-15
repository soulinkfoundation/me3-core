/**
 * Stripe Connect onboarding started from the ME3 phone apps returns here, so the
 * owner lands back in the app instead of on a web page they may not be signed in to.
 * The page only forwards a fixed result to a fixed app scheme; it reads no owner data.
 */

export type StripeReturnApp = "ios" | "android";

const APP_SCHEMES: Record<StripeReturnApp, string> = {
  ios: "me3mobile",
  android: "me3android",
};

export const STRIPE_APP_RETURN_PATH = "/api/commerce/connect/return";

export function parseStripeReturnApp(value: unknown): StripeReturnApp | null {
  return value === "ios" || value === "android" ? value : null;
}

export function stripeAppReturnUrl(webOrigin: string, app: StripeReturnApp): string {
  const url = new URL(STRIPE_APP_RETURN_PATH, webOrigin);
  url.searchParams.set("app", app);
  return url.toString();
}

/** The app deep link for a Stripe result; anything but "success" is treated as "refresh". */
export function stripeAppDeepLink(app: StripeReturnApp, result: unknown): string {
  const status = result === "success" ? "success" : "refresh";
  return `${APP_SCHEMES[app]}://payments?stripe_connect=${status}`;
}

export function stripeAppReturnPage(deepLink: string): string {
  // deepLink is built from fixed values only, so it is safe to inline.
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Back to ME3</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px/1.5 -apple-system, system-ui, sans-serif; background: Canvas; color: CanvasText; }
  main { padding: 24px; text-align: center; max-width: 360px; }
  a { display: inline-block; margin-top: 16px; padding: 12px 20px; border-radius: 12px; background: #111; color: #fff; text-decoration: none; font-weight: 600; }
  @media (prefers-color-scheme: dark) { a { background: #fff; color: #111; } }
</style>
</head>
<body>
<main>
  <p>Stripe is done. Taking you back to ME3.</p>
  <a href="${deepLink}">Return to ME3</a>
</main>
<script>window.location.replace(${JSON.stringify(deepLink)});</script>
</body>
</html>`;
}
