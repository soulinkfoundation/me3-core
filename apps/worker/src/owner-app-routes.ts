/**
 * Top-level owner app routes. Each one must be reserved here, or a direct visit
 * (reload, bookmark, typed URL) falls through to the public site and 404s even
 * though in-app navigation works. owner-app-routes.test.ts checks every page
 * in apps/web/src/pages is covered.
 */
export const OWNER_APP_ROUTE_PREFIXES = [
  "/account",
  "/accounts",
  "/assistant",
  "/calendar",
  "/contacts",
  "/create",
  "/email",
  "/files",
  "/journal",
  "/journal-wheel-of-life",
  "/login",
  "/mobile",
  "/mission",
  "/mission-control",
  "/mission-control-wheel-of-life",
  "/people",
  "/sites",
  "/social",
  "/tasks",
  "/agent",
  "/auth",
  "/clients",
  "/dashboard",
  "/home",
  "/messages",
  "/settings",
  "/socials",
  "/wheel-of-life",
];
